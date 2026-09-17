import os
import copy
import hashlib
import json
import logging
import shutil
import tempfile
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple
from concurrent.futures import ProcessPoolExecutor, as_completed
from tqdm import tqdm

from .models import LayerEntry, PackManifest
from .geo import transform_to_wgs84, get_geometry_type
from .styles import find_lyrx_file, parse_lyrx_style
from .buffered_gradient import has_buffered_gradient, write_buffered_gradient_geojson
from .tiling import generate_pmtiles_smart
from .pmtiles_lifecycle import resolve_pmtiles_lifecycle

logger = logging.getLogger(__name__)


class TqdmLoggingHandler(logging.Handler):
    def emit(self, record):
        try:
            msg = self.format(record)
            tqdm.write(msg)
            self.flush()
        except Exception:
            self.handleError(record)


def setup_logging(level=logging.INFO):
    # Remove existing handlers
    main_logger = logging.getLogger()
    for handler in main_logger.handlers[:]:
        main_logger.removeHandler(handler)

    handler = TqdmLoggingHandler()
    formatter = logging.Formatter(
        "%(asctime)s - %(levelname)s - %(message)s", datefmt="%H:%M:%S"
    )
    handler.setFormatter(formatter)
    main_logger.addHandler(handler)
    main_logger.setLevel(level)


CACHE_FILE = ".layer-cache.json"
BUFFERED_GRADIENT_SIDECAR = "investigation_polygons.buffered-gradient.geojson"


def _replace_transaction_file(source: Path, destination: Path) -> None:
    os.replace(source, destination)


def _atomic_copy_file(source: Path, destination: Path) -> None:
    """Copy a file through a sibling temporary path before publishing it."""
    destination.parent.mkdir(parents=True, exist_ok=True)
    temporary = destination.with_name(destination.name + ".tmp")
    try:
        shutil.copy2(source, temporary)
        os.replace(temporary, destination)
    finally:
        if temporary.exists():
            temporary.unlink()


def _commit_buffered_gradient_transaction(
    staged_data: Path,
    staged_sidecar: Path,
    staged_pmtiles: Path,
    final_data: Path,
    final_sidecar: Path,
    final_pmtiles: Path,
    *,
    remove_pmtiles: bool = False,
) -> None:
    """Publish staged gradient outputs with rollback across every final file."""
    destinations = [final_data, final_sidecar, final_pmtiles]
    backups: Dict[Path, Path] = {}
    published = set()
    transaction_dir = staged_data.parent
    try:
        for destination in destinations:
            if destination.is_file():
                backup = transaction_dir / (destination.name + ".rollback")
                shutil.copy2(destination, backup)
                backups[destination] = backup

        _replace_transaction_file(staged_data, final_data)
        published.add(final_data)
        _replace_transaction_file(staged_sidecar, final_sidecar)
        published.add(final_sidecar)
        if staged_pmtiles.is_file():
            _replace_transaction_file(staged_pmtiles, final_pmtiles)
            published.add(final_pmtiles)
        elif remove_pmtiles and final_pmtiles.exists():
            final_pmtiles.unlink()
            published.add(final_pmtiles)
    except Exception:
        for destination in reversed(destinations):
            if destination not in published:
                continue
            backup = backups.get(destination)
            try:
                if backup is not None and backup.is_file():
                    _replace_transaction_file(backup, destination)
                elif destination.exists():
                    destination.unlink()
            except OSError:
                logger.exception("Could not roll back buffered-gradient output %s", destination)
        raise
    finally:
        for backup in backups.values():
            backup.unlink(missing_ok=True)


class _ResourceLayerEntry(LayerEntry):
    """LayerEntry variant carrying optional generated resource declarations."""

    def __init__(self, *args, resources: Optional[Dict[str, Any]] = None, **kwargs):
        super().__init__(*args, **kwargs)
        self.resources = resources

    def to_dict(self) -> Dict[str, Any]:
        result = super().to_dict()
        if self.resources:
            result["resources"] = self.resources
        return result

# Stem of gis files matching this pattern are copied to processed for masking only (not added as layers).
MASK_ASSET_STEM_SUFFIX = "_boundary"
ANIMATION_STYLE_OVERRIDES: Dict[str, Dict[str, Dict[str, Any]]] = {
    "october_7th": {
        "\u05d7\u05d3\u05d9\u05e8\u05d4_\u05dc\u05d9\u05e9\u05d5\u05d1-\u05e6\u05d9\u05e8": {
            "type": "flow",
            "enabledByDefault": False,
            "speed": 40,
            "dashArray": [10, 14],
            "directionPolicy": "feature_order",
        },
        "\u05de\u05d0\u05d1\u05e7_\u05d5\u05d2\u05d1\u05d5\u05e8\u05d4_\u05e6\u05d9\u05e8": {
            "type": "flow",
            "enabledByDefault": False,
            "speed": 40,
            "dashArray": [10, 14],
            "directionPolicy": "feature_order",
        },
    },
    "nli": {
        "investigation_polygons": {
            "type": "timeline",
            "enabledByDefault": False,
        },
        "lines": {
            "type": "timeline",
            "enabledByDefault": False,
        },
        "alarms": {
            "type": "timeline",
            "enabledByDefault": False,
        },
    },
}


def compute_file_hash(path: Path) -> str:
    hash_sha256 = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(4096), b""):
            hash_sha256.update(chunk)
    return hash_sha256.hexdigest()


def _geo_style_cache_fingerprint(geo_file: Path, styles_dir: Path) -> Tuple[str, str, str]:
    """
    Cache invalidation: GIS body + matching .lyrx so style-only edits re-run transforms.
    Returns (combined, geo_hash, lyrx_hash). combined is "geoHash:lyrxHash" (lyrxHash may be empty).
    For שמות_יישובים, optional manual label overrides JSON is included so edits invalidate cache.
    """
    from .shemot_label_overrides import (
        SHEMOT_LAYER_STEM,
        shemot_label_overrides_path,
    )

    geo_hash = compute_file_hash(geo_file)
    lyrx_path, _ = find_lyrx_file(geo_file, styles_dir)
    lyrx_hash = (
        compute_file_hash(lyrx_path)
        if lyrx_path is not None and lyrx_path.is_file()
        else ""
    )
    override_hash = ""
    if geo_file.stem == SHEMOT_LAYER_STEM:
        op = shemot_label_overrides_path(styles_dir)
        if op.is_file():
            override_hash = compute_file_hash(op)
    combined = f"{geo_hash}:{lyrx_hash}:{override_hash}"
    return combined, geo_hash, lyrx_hash


def _task_id(task: Dict) -> str:
    """Return a stable id for logging (pack_id/layer_or_file_name)."""
    pack_id = task["pack_id"]
    if "geo_file" in task:
        return f"{pack_id}/{task['geo_file'].name}"
    return f"{pack_id}/{task['image_file'].name}"


def _layer_render_sort_key(layer: Any) -> Any:
    """Render order: model_base first, then satellite_imagery, then others (dict or mapping)."""
    lid = layer.get("id", "") if isinstance(layer, dict) else getattr(layer, "id", "")
    if lid == "model_base":
        return (0, lid)
    if lid == "satellite_imagery":
        return (1, lid)
    # NLI copy of future_development ציר_232: keep under infiltration lines and people.
    if lid == "ציר_232":
        return (2, "k_nli_route_232")
    return (2, lid)


class ProcessingOrchestrator:
    def __init__(
        self,
        source_dir: Path,
        output_dir: Path,
        no_cache: bool = False,
        max_workers: int = 4,
    ):
        self.source_dir = source_dir
        self.output_dir = output_dir
        self.no_cache = no_cache
        self.max_workers = max_workers
        self.cache_path = output_dir / CACHE_FILE
        self.cache = {} if no_cache else self._load_cache()
        self.popup_config = self._load_popup_config()

    def _apply_animation_style_overrides(
        self, pack_id: str, layer_id: str, style_config: Optional[Dict[str, Any]]
    ) -> Optional[Dict[str, Any]]:
        if not style_config or not isinstance(style_config, dict):
            return style_config
        layer_overrides = ANIMATION_STYLE_OVERRIDES.get(pack_id, {})
        animation_cfg = layer_overrides.get(layer_id)
        if animation_cfg:
            style_config["animation"] = animation_cfg
        return style_config

    def _load_cache(self) -> Dict:
        if self.cache_path.exists():
            try:
                with open(self.cache_path, "r", encoding="utf-8") as f:
                    return json.load(f)
            except Exception as e:
                logger.warning(f"Could not load cache: {e}")
        return {}

    def save_cache(self):
        if not self.no_cache:
            self.output_dir.mkdir(parents=True, exist_ok=True)
            self._atomic_write_json(self.cache_path, self.cache)

    def _atomic_write_json(self, path: Path, data: Any) -> None:
        """
        Write JSON atomically: temp file in the same directory, then os.replace
        so readers never see a partial final file.
        """
        path.parent.mkdir(parents=True, exist_ok=True)
        tmp = path.with_name(path.name + ".tmp")
        try:
            with open(tmp, "w", encoding="utf-8") as f:
                json.dump(data, f, indent=2, ensure_ascii=False)
            os.replace(tmp, path)
        finally:
            if tmp.exists():
                tmp.unlink()

    def _begin_output_snapshot(self, pack_ids: List[str]):
        """Capture the files a processing run may publish for recoverable rollback."""
        parent = self.output_dir.parent
        parent.mkdir(parents=True, exist_ok=True)
        snapshot_dir = Path(tempfile.mkdtemp(prefix=".layer-publish-", dir=parent))
        packs_dir = snapshot_dir / "packs"
        packs_dir.mkdir()
        existing_packs = []
        for pack_id in pack_ids:
            output_pack = self.output_dir / pack_id
            if output_pack.is_dir():
                self._snapshot_tree(output_pack, packs_dir / pack_id)
                existing_packs.append(pack_id)
        root_files = []
        for name in (CACHE_FILE, "layers-manifest.json"):
            path = self.output_dir / name
            if path.is_file():
                shutil.copy2(path, snapshot_dir / name)
                root_files.append(name)
        return {
            "dir": snapshot_dir,
            "pack_ids": list(pack_ids),
            "existing_packs": existing_packs,
            "root_files": root_files,
            "cache": copy.deepcopy(self.cache),
        }

    @staticmethod
    def _snapshot_tree(source: Path, destination: Path) -> None:
        """Snapshot a tree with same-volume hardlinks, falling back to copies."""
        destination.mkdir(parents=True, exist_ok=True)
        for path in source.rglob("*"):
            relative = path.relative_to(source)
            target = destination / relative
            if path.is_dir():
                target.mkdir(parents=True, exist_ok=True)
                continue
            target.parent.mkdir(parents=True, exist_ok=True)
            try:
                os.link(path, target)
            except OSError:
                shutil.copy2(path, target)

    def _restore_output_snapshot(self, snapshot, pack_ids: Optional[List[str]] = None) -> None:
        """Restore only the named output packs and run-level metadata."""
        if not snapshot:
            return
        target_ids = list(pack_ids if pack_ids is not None else snapshot["pack_ids"])
        packs_dir = snapshot["dir"] / "packs"
        for pack_id in target_ids:
            output_pack = self.output_dir / pack_id
            if output_pack.exists():
                shutil.rmtree(output_pack)
            saved_pack = packs_dir / pack_id
            if saved_pack.is_dir():
                shutil.copytree(saved_pack, output_pack)
        if pack_ids is not None:
            failed_prefixes = tuple(f"{pack_id}/" for pack_id in target_ids)
            for key in list(self.cache):
                if key.startswith(failed_prefixes):
                    del self.cache[key]
            for key, value in snapshot["cache"].items():
                if key.startswith(failed_prefixes):
                    self.cache[key] = copy.deepcopy(value)
        if pack_ids is None:
            self.cache = copy.deepcopy(snapshot["cache"])
            for name in (CACHE_FILE, "layers-manifest.json"):
                path = self.output_dir / name
                saved = snapshot["dir"] / name
                if saved.is_file():
                    shutil.copy2(saved, path)
                elif path.exists():
                    path.unlink()

    def _finish_output_snapshot(self, snapshot) -> None:
        if snapshot:
            shutil.rmtree(snapshot["dir"], ignore_errors=True)

    def _load_popup_config(self) -> Dict:
        # source_dir is typically ".../public/source/layers" or just ".../public/source"
        # We want to find ".../public/source/popup-config.json"

        candidates = [
            self.source_dir / "popup-config.json",  # If source is root
            self.source_dir.parent / "popup-config.json",  # If source is layers/
        ]

        for path in candidates:
            if path.exists():
                try:
                    with open(path, "r", encoding="utf-8") as f:
                        logger.info(f"Loaded popup config from {path}")
                        return json.load(f)
                except Exception as e:
                    logger.warning(f"Could not load popup config from {path}: {e}")

        logger.warning(
            f"popup-config.json not found in candidates: {[str(p) for p in candidates]}"
        )
        return {}

    def scan_packs(self) -> List[Path]:
        packs = []
        source_layers = self.source_dir / "source" / "layers"
        if not source_layers.exists():
            source_layers = self.source_dir  # Fallback

        for d in source_layers.iterdir():
            if d.is_dir() and not d.name.startswith("."):
                gis_dir = d / "gis" if (d / "gis").exists() else d
                images_dir = d / "images"
                geo_files = list(gis_dir.glob("*.json")) + list(
                    gis_dir.glob("*.geojson")
                )
                image_files = (
                    list(images_dir.glob("*.png"))
                    + list(images_dir.glob("*.jpg"))
                    + list(images_dir.glob("*.jpeg"))
                    if images_dir.exists()
                    else []
                )
                if geo_files or image_files:
                    packs.append(d)
        return sorted(packs)

    def process_all(self, stuck_timeout: Optional[int] = None):
        packs = self.scan_packs()
        snapshot = self._begin_output_snapshot([pack.name for pack in packs])
        try:
            self._process_all_impl(stuck_timeout=stuck_timeout, _snapshot=snapshot)
        except Exception:
            self._restore_output_snapshot(snapshot)
            raise
        finally:
            self._finish_output_snapshot(snapshot)

    def _process_all_impl(self, stuck_timeout: Optional[int] = None, _snapshot=None):
        packs = self.scan_packs()
        if not packs:
            logger.warning("No layer packs found to process.")
            return

        # 1. Collect all layer tasks
        all_layer_tasks = []
        all_image_tasks = []
        boundary_assets = []  # (pack_id, geo_file, pack_output) for *_boundary.geojson
        pack_manifests = {}  # pack_id -> PackManifest (partial)
        styles_map = {}  # pack_id -> styles_dict

        logger.info(f"Scanning {len(packs)} packs for layers...")

        for pack_dir in packs:
            pack_id = pack_dir.name
            gis_dir = pack_dir / "gis" if (pack_dir / "gis").exists() else pack_dir
            images_dir = pack_dir / "images"
            styles_dir = pack_dir / "styles"

            # Prepare output dir
            pack_output = self.output_dir / pack_id
            pack_output.mkdir(parents=True, exist_ok=True)

            geo_files = [
                f
                for f in list(gis_dir.glob("*.json")) + list(gis_dir.glob("*.geojson"))
                if not f.name.endswith(".wmts.json")
            ]
            image_files = (
                list(images_dir.glob("*.png"))
                + list(images_dir.glob("*.jpg"))
                + list(images_dir.glob("*.jpeg"))
                if images_dir.exists()
                else []
            )

            # Initialize containers
            pack_manifests[pack_id] = {
                "id": pack_id,
                "name": pack_id.title().replace("_", " "),
                "layers": [],
            }
            styles_map[pack_id] = {}

            # Boundary assets: copy/transform to processed but do not add as layers.
            # WMTS layers are discovered from gis/*.wmts.json when writing manifests (not GeoJSON).
            for geo_file in geo_files:
                if geo_file.name.endswith(".wmts.json"):
                    continue
                if geo_file.stem.endswith(MASK_ASSET_STEM_SUFFIX):
                    boundary_assets.append((pack_id, geo_file, pack_output))
                    continue
                task = {
                    "pack_id": pack_id,
                    "geo_file": geo_file,
                    "styles_dir": styles_dir,
                    "pack_output": pack_output,
                }
                all_layer_tasks.append(task)

            for image_file in image_files:
                task = {
                    "pack_id": pack_id,
                    "image_file": image_file,
                    "pack_output": pack_output,
                }
                all_image_tasks.append(task)

        has_wmts_only = any(
            (p / "gis").exists() and list((p / "gis").glob("*.wmts.json"))
            for p in packs
        )
        if (
            not all_layer_tasks
            and not all_image_tasks
            and not boundary_assets
            and not has_wmts_only
        ):
            logger.warning("No layers found in packs.")
            return

        logger.info(
            f"Buffered {len(all_layer_tasks)} layers and {len(all_image_tasks)} images. Starting global parallel processing..."
        )

        # 2. Process all layers in a global pool
        processed_layers = []
        failed_pack_ids = set()

        with ProcessPoolExecutor(max_workers=self.max_workers) as executor:
            # Pass log level to workers
            log_level = logger.getEffectiveLevel()

            # Submit all tasks (GeoJSON layers)
            futures = {
                executor.submit(self.process_single_layer, task, log_level): task
                for task in all_layer_tasks
            }

            # Submit image tasks (no parallel processing needed, but keep consistent structure)
            for image_task in all_image_tasks:
                futures[
                    executor.submit(self.process_single_image, image_task, log_level)
                ] = image_task

            # Main Progress Bar; optional stuck_timeout to log which task is pending
            total_tasks = len(all_layer_tasks) + len(all_image_tasks)
            pending = dict(futures)
            with tqdm(total=total_tasks, desc="Total Layers", unit="lyr") as pbar:
                while pending:
                    try:
                        completion_iterator = as_completed(
                            pending.keys(), timeout=stuck_timeout
                        )
                        for future in completion_iterator:
                            task = pending[future]
                            task_id = _task_id(task)
                            try:
                                result = future.result()
                                logger.info("Completed: %s", task_id)
                                if result:
                                    # result is (layer_entry, style_entry_or_None, cache_key, cache_value)
                                    layer_entry, style_entry, cache_key, cache_val = result
                                    pack_id = cache_key.split("/")[0]

                                    # Update local cache in main process
                                    self.cache[cache_key] = cache_val

                                    # Add to appropriate pack manifest
                                    if pack_id in pack_manifests:
                                        pack_manifests[pack_id]["layers"].append(
                                            layer_entry
                                        )
                                        if style_entry:
                                            styles_map[pack_id][
                                                layer_entry.id
                                            ] = style_entry
                                else:
                                    failed_pack_ids.add(task["pack_id"])
                            except Exception as e:
                                logger.warning("Failed: %s — %s", task_id, e)
                                tqdm.write(f"Task failed: {e}")
                                failed_pack_ids.add(task["pack_id"])

                            del pending[future]
                            pbar.update(1)
                    except TimeoutError:
                        still_pending = [
                            (f, pending[f]) for f in pending if not f.done()
                        ]
                        for _f, t in still_pending:
                            logger.warning(
                                "No completion in %ss — still pending: %s",
                                stuck_timeout,
                                _task_id(t),
                            )
                        # continue while to keep waiting

        # Workers publish their own files for compatibility with single-layer mode.
        # A sibling failure must not leave those successful publications visible.
        if failed_pack_ids and _snapshot is not None:
            self._restore_output_snapshot(_snapshot, sorted(failed_pack_ids))

        # Copy boundary assets (transform to WGS84, write to processed; not added as layers)
        for pack_id, geo_file, pack_output in boundary_assets:
            if pack_id in failed_pack_ids:
                continue
            out_path = pack_output / f"{geo_file.stem}.geojson"
            try:
                if transform_to_wgs84(geo_file, out_path):
                    logger.info(f"Boundary asset: {pack_id}/{geo_file.name} -> {out_path.name}")
            except Exception as e:
                logger.warning(f"Boundary asset failed {pack_id}/{geo_file.name}: {e}")

        # 3. Write Manifests
        source_layers = self.source_dir / "source" / "layers"
        if not source_layers.exists():
            source_layers = self.source_dir

        processed_pack_ids = []
        for pack_id, manifest_data in pack_manifests.items():
            pack_output = self.output_dir / pack_id
            if pack_id in failed_pack_ids:
                # A partial worker result must not replace a previously good pack.
                if (pack_output / "manifest.json").is_file():
                    processed_pack_ids.append(pack_id)
                continue
            pack_dir = source_layers / pack_id
            gis_dir = pack_dir / "gis" if (pack_dir / "gis").exists() else pack_dir

            # Discover WMTS layers from gis/*.wmts.json
            for wmts_path in sorted(gis_dir.glob("*.wmts.json")):
                try:
                    with open(wmts_path, "r", encoding="utf-8") as f:
                        wmts_data = json.load(f)
                    layer_id = wmts_data.get("id", wmts_path.stem)
                    name = wmts_data.get("name", layer_id.replace("_", " ").title())
                    wmts_config = wmts_data.get("wmts")
                    mask_config = wmts_data.get("mask")
                    if wmts_config:
                        entry = LayerEntry.create_wmts_layer(
                            layer_id=layer_id,
                            name=name,
                            wmts_config=wmts_config,
                            mask=mask_config,
                        )
                        manifest_data["layers"].append(entry)
                        logger.info(f"WMTS layer from {wmts_path.name}: {pack_id}.{layer_id}")
                except Exception as e:
                    logger.warning(f"Could not load WMTS {wmts_path}: {e}")

            if not manifest_data["layers"]:
                continue

            processed_pack_ids.append(pack_id)

            # Sort layers by ID for consistency
            manifest_data["layers"].sort(key=lambda x: x.id)

            layers_list = [entry.to_dict() for entry in manifest_data["layers"]]
            layers_list.sort(key=_layer_render_sort_key)

            manifest_dict = {
                "id": manifest_data["id"],
                "name": manifest_data["name"],
                "layers": layers_list,
            }
            self._atomic_write_json(pack_output / "manifest.json", manifest_dict)
            self._atomic_write_json(pack_output / "styles.json", styles_map[pack_id])

        self.generate_root_manifest(processed_pack_ids)
        self.save_cache()
        logger.info("Processing complete.")

    def process_single_layer(self, task: Dict, log_level: int) -> Optional[Any]:
        """
        Process a single layer fully.
        Returns: (LayerEntry, StyleConfig or None, cache_key, cache_value)
        """
        # Configure logging for worker process
        logging.basicConfig(
            level=log_level, format="%(asctime)s - %(levelname)s - %(message)s"
        )

        pack_id = task["pack_id"]
        geo_file = task["geo_file"]
        styles_dir = task["styles_dir"]
        pack_output = task["pack_output"]
        pack_output.mkdir(parents=True, exist_ok=True)

        logger.info("Processing: %s/%s", pack_id, geo_file.name)
        layer_id = geo_file.stem
        cache_key = f"{pack_id}/{geo_file.name}"
        fingerprint, geo_hash, lyrx_hash = _geo_style_cache_fingerprint(
            geo_file, styles_dir
        )
        wgs84_file = pack_output / f"{layer_id}.geojson"
        pmtiles_file = pack_output / f"{layer_id}.pmtiles"
        sidecar_file = pack_output / BUFFERED_GRADIENT_SIDECAR
        cached = self.cache.get(cache_key, {})
        cached_style = cached.get("style")
        cached_resources = cached.get("resources")
        if not isinstance(cached_resources, dict):
            cached_resources = {}
        requires_sidecar = (
            pack_id == "nli"
            and layer_id == "investigation_polygons"
            and (
                has_buffered_gradient(cached_style or {})
                or bool(cached_resources.get("bufferedGradient"))
            )
        )
        declared_sidecar_missing = requires_sidecar and not sidecar_file.is_file()
        needed = (
            self.no_cache
            or cached.get("hash") != fingerprint
            or declared_sidecar_missing
        )

        style_config = None
        geom_type = "unknown"
        pmtiles_lifecycle = None
        resources: Optional[Dict[str, Any]] = None
        is_buffered_gradient_layer = False

        if needed:
            try:
                # Resolve the style before replacing any existing processed data.
                style_config, geom_type = self._resolve_style_for_geo_file(
                    geo_file, styles_dir
                )
                style_config = self._apply_animation_style_overrides(
                    pack_id, layer_id, style_config
                )

                is_buffered_gradient_layer = (
                    pack_id == "nli"
                    and layer_id == "investigation_polygons"
                    and has_buffered_gradient(style_config or {})
                )

                if is_buffered_gradient_layer:
                    # Keep data, sidecar, and PMTiles isolated until all work succeeds.
                    with tempfile.TemporaryDirectory(
                        dir=pack_output, prefix=".investigation-polygons-"
                    ) as transaction_dir:
                        transaction = Path(transaction_dir)
                        staged_wgs84 = transaction / wgs84_file.name
                        staged_sidecar = transaction / BUFFERED_GRADIENT_SIDECAR
                        staged_pmtiles = transaction / pmtiles_file.name
                        if not transform_to_wgs84(geo_file, staged_wgs84):
                            logger.error(f"Transformation failed for {layer_id}, skipping.")
                            return None
                        if geom_type == "unknown":
                            geom_type = get_geometry_type(staged_wgs84)
                        if not write_buffered_gradient_geojson(
                            staged_wgs84, style_config, staged_sidecar
                        ):
                            raise RuntimeError(
                                f"Buffered gradient sidecar was not generated for {layer_id}"
                            )
                        pmtiles_lifecycle = resolve_pmtiles_lifecycle(
                            pack_id,
                            layer_id,
                            geom_type,
                            style_config,
                            staged_wgs84,
                            staged_pmtiles,
                            generate_pmtiles=lambda input_geojson, output_pmtiles, preset: generate_pmtiles_smart(
                                input_geojson,
                                output_pmtiles,
                                preset=preset,
                            ),
                            regenerate_existing=True,
                        )
                        _commit_buffered_gradient_transaction(
                            staged_wgs84,
                            staged_sidecar,
                            staged_pmtiles,
                            wgs84_file,
                            sidecar_file,
                            pmtiles_file,
                            remove_pmtiles=(
                                pmtiles_file.is_file()
                                and not pmtiles_lifecycle.pmtiles_file
                            ),
                        )
                else:
                    # 1. Transform GeoJSON to WGS84
                    if not transform_to_wgs84(geo_file, wgs84_file):
                        logger.error(f"Transformation failed for {layer_id}, skipping.")
                        return None

                    if layer_id == "שמות_יישובים":
                        from .shemot_label_overrides import merge_shemot_label_overrides_into_geojson

                        merge_shemot_label_overrides_into_geojson(wgs84_file, styles_dir)

                    if geom_type == "unknown":
                        geom_type = get_geometry_type(wgs84_file)

                    pmtiles_lifecycle = resolve_pmtiles_lifecycle(
                        pack_id,
                        layer_id,
                        geom_type,
                        style_config,
                        wgs84_file,
                        pmtiles_file,
                        generate_pmtiles=lambda input_geojson, output_pmtiles, preset: generate_pmtiles_smart(
                            input_geojson,
                            output_pmtiles,
                            preset=preset,
                        ),
                        regenerate_existing=True,
                    )

                if is_buffered_gradient_layer and sidecar_file.is_file():
                    resources = {
                        "bufferedGradient": {
                            "file": BUFFERED_GRADIENT_SIDECAR,
                            "format": "geojson",
                        }
                    }

            except Exception as e:
                logger.error(f"Error processing {layer_id}: {e}")
                import traceback

                traceback.print_exc()
                return None
        else:
            cached = self.cache[cache_key]
            geom_type = cached.get("geometry_type", "unknown")
            style_config = cached.get("style")
            style_config = self._apply_animation_style_overrides(
                pack_id, layer_id, style_config
            )
            pmtiles_lifecycle = resolve_pmtiles_lifecycle(
                pack_id,
                layer_id,
                geom_type,
                style_config,
                wgs84_file,
                pmtiles_file,
                generate_pmtiles=lambda input_geojson, output_pmtiles, preset: generate_pmtiles_smart(
                    input_geojson,
                    output_pmtiles,
                    preset=preset,
                ),
                regenerate_existing=True,
            )
            resources = cached.get("resources")
            if (
                not resources
                and pack_id == "nli"
                and layer_id == "investigation_polygons"
                and has_buffered_gradient(style_config or {})
                and sidecar_file.is_file()
            ):
                resources = {
                    "bufferedGradient": {
                        "file": BUFFERED_GRADIENT_SIDECAR,
                        "format": "geojson",
                    }
                }

        popup_cfg = self._get_popup_config_for_layer(pack_id, layer_id)
        ui_popup = (
            {k: v for k, v in (popup_cfg or {}).items() if k != "legendLabel"}
            if popup_cfg
            else None
        )
        if ui_popup and len(ui_popup) == 0:
            ui_popup = None
        ui_legend_label = (popup_cfg or {}).get("legendLabel")

        entry_kwargs = {
            "id": layer_id,
            "name": geo_file.stem,
            "file": f"{layer_id}.geojson",
            "geometry_type": geom_type,
            "pmtiles_file": pmtiles_lifecycle.pmtiles_file if pmtiles_lifecycle else None,
            "tiling_preset": pmtiles_lifecycle.tiling_preset if pmtiles_lifecycle else None,
            "processing": pmtiles_lifecycle.metadata if pmtiles_lifecycle else None,
            "ui_popup": ui_popup,
            "ui_legend_label": ui_legend_label,
        }
        if resources:
            entry = _ResourceLayerEntry(**entry_kwargs, resources=resources)
        else:
            entry = LayerEntry(**entry_kwargs)

        return (
            entry,
            style_config,
            cache_key,
            {
                "hash": fingerprint,
                "geo_hash": geo_hash,
                "lyrx_hash": lyrx_hash,
                "geometry_type": geom_type,
                "style": style_config,
                "resources": resources,
            },
        )

    def generate_root_manifest(self, pack_ids: List[str]):
        root_manifest = {"packs": sorted(pack_ids)}
        self._atomic_write_json(
            self.output_dir / "layers-manifest.json", root_manifest
        )

    def _source_layers_root(self) -> Path:
        source_layers = self.source_dir / "source" / "layers"
        if not source_layers.exists():
            source_layers = self.source_dir
        return source_layers

    def _discover_packs_having_manifest(self) -> List[str]:
        if not self.output_dir.exists():
            return []
        pack_ids = [
            d.name
            for d in sorted(self.output_dir.iterdir())
            if d.is_dir()
            and not d.name.startswith(".")
            and (d / "manifest.json").is_file()
        ]
        return pack_ids

    def _resolve_geo_file_for_layer_stem(
        self, pack_dir: Path, layer_stem: str
    ) -> Path:
        gis_dir = pack_dir / "gis" if (pack_dir / "gis").exists() else pack_dir
        json_path = gis_dir / f"{layer_stem}.json"
        geojson_path = gis_dir / f"{layer_stem}.geojson"
        has_json = json_path.is_file()
        has_geojson = geojson_path.is_file()
        if has_json and has_geojson:
            raise ValueError(
                f"Ambiguous GIS files for stem {layer_stem!r}: both .json and .geojson exist"
            )
        if has_json:
            return json_path
        if has_geojson:
            return geojson_path
        raise FileNotFoundError(
            f"No GIS file {layer_stem}.json or {layer_stem}.geojson under {gis_dir}"
        )

    def _merge_wmts_layers_from_source(
        self, pack_id: str, gis_dir: Path, layers_by_id: Dict[str, Dict[str, Any]]
    ) -> None:
        for wmts_path in sorted(gis_dir.glob("*.wmts.json")):
            try:
                with open(wmts_path, "r", encoding="utf-8") as f:
                    wmts_data = json.load(f)
                layer_id = wmts_data.get("id", wmts_path.stem)
                name = wmts_data.get("name", layer_id.replace("_", " ").title())
                wmts_config = wmts_data.get("wmts")
                mask_config = wmts_data.get("mask")
                if wmts_config:
                    entry = LayerEntry.create_wmts_layer(
                        layer_id=layer_id,
                        name=name,
                        wmts_config=wmts_config,
                        mask=mask_config,
                    )
                    layers_by_id[layer_id] = entry.to_dict()
                    logger.info(
                        "WMTS layer from %s: %s.%s", wmts_path.name, pack_id, layer_id
                    )
            except Exception as e:
                logger.warning("Could not load WMTS %s: %s", wmts_path, e)

    def process_single_layer_merged(
        self, pack_id: str, layer_stem: str, stuck_timeout: Optional[int] = None
    ) -> None:
        snapshot = self._begin_output_snapshot([pack_id])
        try:
            self._process_single_layer_merged_impl(pack_id, layer_stem, stuck_timeout)
        except Exception:
            self._restore_output_snapshot(snapshot)
            raise
        finally:
            self._finish_output_snapshot(snapshot)

    def _process_single_layer_merged_impl(
        self, pack_id: str, layer_stem: str, stuck_timeout: Optional[int] = None
    ) -> None:
        """
        Process one GIS layer and merge it into existing pack + root manifests.
        Does not run a full pack scan. stuck_timeout is accepted for CLI parity
        but is unused (single task runs synchronously).
        """
        _ = stuck_timeout
        source_root = self._source_layers_root()
        pack_dir = source_root / pack_id
        if not pack_dir.is_dir():
            logger.error("Pack not found: %s (under %s)", pack_id, source_root)
            return

        logger.info(
            "Single-layer mode: pack=%s (not scanning all source packs)",
            pack_id,
        )
        try:
            geo_file = self._resolve_geo_file_for_layer_stem(pack_dir, layer_stem)
        except (FileNotFoundError, ValueError) as e:
            logger.error("%s", e)
            return

        if geo_file.name.endswith(".wmts.json"):
            logger.error("WMTS config is not a processable GeoJSON layer: %s", geo_file)
            return
        if layer_stem.endswith(MASK_ASSET_STEM_SUFFIX):
            logger.error(
                "Layer stem %r is a boundary/mask asset, not a regular layer",
                layer_stem,
            )
            return

        gis_dir = pack_dir / "gis" if (pack_dir / "gis").exists() else pack_dir
        styles_dir = pack_dir / "styles"
        pack_output = self.output_dir / pack_id
        pack_output.mkdir(parents=True, exist_ok=True)

        task = {
            "pack_id": pack_id,
            "geo_file": geo_file,
            "styles_dir": styles_dir,
            "pack_output": pack_output,
        }
        log_level = logger.getEffectiveLevel()
        result = self.process_single_layer(task, log_level)
        if not result:
            logger.error("Single-layer processing failed for %s/%s", pack_id, layer_stem)
            return
        layer_entry, style_entry, cache_key, cache_val = result
        self.cache[cache_key] = cache_val
        # 1 — GeoJSON (and pmtiles if any) is written inside process_single_layer
        # 2 — Pack cache
        if not self.no_cache:
            self.save_cache()
        # 3 — Merged pack styles (temp+replace before manifest so manifest ref style entry)
        styles_path = pack_output / "styles.json"
        merged_styles: Dict[str, Any] = {}
        if styles_path.exists():
            try:
                with open(styles_path, "r", encoding="utf-8") as f:
                    merged_styles = json.load(f)
            except Exception as e:
                logger.warning("Could not read existing styles.json: %s", e)
        if style_entry is not None:
            merged_styles[layer_stem] = style_entry
        else:
            merged_styles.pop(layer_stem, None)
        self._atomic_write_json(styles_path, dict(sorted(merged_styles.items())))

        # 4 — Merged pack manifest
        manifest_path = pack_output / "manifest.json"
        layers_by_id: Dict[str, Dict[str, Any]] = {}
        pack_display_name = pack_id.title().replace("_", " ")
        if manifest_path.exists():
            try:
                with open(manifest_path, "r", encoding="utf-8") as f:
                    old = json.load(f)
                pack_display_name = old.get("name", pack_display_name)
                for d in old.get("layers", []):
                    if d.get("id"):
                        layers_by_id[d["id"]] = d
            except Exception as e:
                logger.warning("Could not read existing manifest.json: %s", e)
        self._merge_wmts_layers_from_source(pack_id, gis_dir, layers_by_id)
        layers_by_id[layer_stem] = layer_entry.to_dict()
        layer_dicts = sorted(layers_by_id.values(), key=_layer_render_sort_key)
        manifest_dict = {
            "id": pack_id,
            "name": pack_display_name,
            "layers": layer_dicts,
        }
        self._atomic_write_json(manifest_path, manifest_dict)
        # 5 — Root layers-manifest.json (scan; last writer)
        root_payload = {"packs": self._discover_packs_having_manifest()}
        self._atomic_write_json(
            self.output_dir / "layers-manifest.json", root_payload
        )
        logger.info("Single-layer merge complete: pack=%s", pack_id)

    def process_single_image(self, task: Dict, log_level: int) -> Optional[Any]:
        """
        Process a single image file (copy to output directory).
        Returns: (LayerEntry, StyleConfig or None, cache_key, cache_value)
        """
        # Configure logging for worker process
        logging.basicConfig(
            level=log_level, format="%(asctime)s - %(levelname)s - %(message)s"
        )

        pack_id = task["pack_id"]
        image_file = task["image_file"]
        pack_output = task["pack_output"]

        logger.info("Processing: %s/%s", pack_id, image_file.name)
        # Use model_base for model.png so manifest matches backend/frontend expectations
        layer_id = "model_base" if image_file.stem == "model" else image_file.stem
        name = (
            "Model base"
            if image_file.stem == "model"
            else image_file.stem.replace("_", " ").title()
        )
        filename = image_file.name
        cache_key = f"{pack_id}/{filename}"
        file_hash = compute_file_hash(image_file)

        needed = self.no_cache or self.cache.get(cache_key, {}).get("hash") != file_hash

        output_file = pack_output / filename

        if needed:
            try:
                # Publish through a sibling temporary path so pack snapshots
                # remain independent of image updates during later rollback.
                _atomic_copy_file(image_file, output_file)
                logger.info(f"Copied image: {layer_id} -> {output_file}")
            except Exception as e:
                logger.error(f"Error copying image {layer_id}: {e}")
                return None

        # Create LayerEntry for image
        entry = LayerEntry.create_image_layer(
            layer_id=layer_id, name=name, filename=filename
        )

        # Create default style for image type
        style_config = {
            "type": "image",
            "renderer": "image",
            "defaultStyle": {"opacity": 1.0},
            "labels": None,
            "scaleRange": None,
        }

        return (
            entry,
            style_config,
            cache_key,
            {"hash": file_hash, "geometry_type": "image", "style": style_config},
        )

    def _resolve_style_for_geo_file(
        self, geo_file: Path, styles_dir: Path
    ) -> Tuple[Optional[Dict], str]:
        """
        Resolve style config (including advanced symbol IR) and geometry type from
        source .lyrx. Shared by process_single_layer and update_metadata_only so
        metadata is always built the same way.
        """
        lyrx_file, _ = find_lyrx_file(geo_file, styles_dir)
        style_config = None
        geom_type = "unknown"
        if lyrx_file:
            style_obj = parse_lyrx_style(lyrx_file)
            if style_obj:
                style_config = style_obj.to_dict()
                geom_type = style_obj.geometry_type
        return (style_config, geom_type)

    def _get_popup_config_for_layer(
        self, pack_id: str, layer_id: str
    ) -> Optional[Dict]:
        """
        Get popup config for a layer, trying exact match then fuzzy match.
        """
        config_root = self.popup_config.get(pack_id, {})
        pack_layers = config_root.get("layers", {})

        # 1. Exact match
        if layer_id in pack_layers:
            return pack_layers[layer_id]

        # Strip all separators to handle variations like:
        # "name-type" vs "name_-_type" vs "name _type"
        def clean(s):
            return s.replace("_", "").replace("-", "").replace(" ", "").lower()

        target = clean(layer_id)

        for key, config in pack_layers.items():
            candidate = clean(key)
            if candidate == target:
                return config

        return None

    def update_metadata_only(self):
        """
        Updates styles.json and manifest.json for all layers without touching geojson/pmtiles.
        Uses existing processed files or source files to determine metadata.
        """
        packs = self.scan_packs()
        if not packs:
            logger.warning("No layer packs found to process.")
            return

        processed_pack_ids = []

        logger.info(f"Updating metadata for {len(packs)} packs...")

        for pack_dir in packs:
            pack_id = pack_dir.name
            processed_pack_ids.append(pack_id)

            gis_dir = pack_dir / "gis" if (pack_dir / "gis").exists() else pack_dir
            images_dir = pack_dir / "images"
            styles_dir = pack_dir / "styles"

            pack_output = self.output_dir / pack_id
            pack_output.mkdir(parents=True, exist_ok=True)  # Ensure it exists

            # Load existing manifest to preserve data if needed
            existing_layers = {}
            manifest_path = pack_output / "manifest.json"
            if manifest_path.exists():
                try:
                    with open(manifest_path, "r", encoding="utf-8") as f:
                        data = json.load(f)
                        for l in data.get("layers", []):
                            existing_layers[l["id"]] = l
                except Exception:
                    pass

            new_layers = []
            new_styles = {}

            # --- Process Geo Layers ---
            geo_files = [
                f
                for f in list(gis_dir.glob("*.json")) + list(gis_dir.glob("*.geojson"))
                if not f.name.endswith(".wmts.json")
            ]
            for geo_file in geo_files:
                layer_id = geo_file.stem
                processed_geo = pack_output / f"{layer_id}.geojson"
                pmtiles_path = pack_output / f"{layer_id}.pmtiles"

                # Styles (same resolution as process_single_layer for advanced/complexity)
                style_config, geom_type = self._resolve_style_for_geo_file(
                    geo_file, styles_dir
                )
                style_config = self._apply_animation_style_overrides(
                    pack_id, layer_id, style_config
                )

                if geom_type == "unknown":
                    # Try to guess from existing processed file or manifest
                    if processed_geo.exists():
                        geom_type = get_geometry_type(processed_geo)
                    elif layer_id in existing_layers:
                        geom_type = existing_layers[layer_id].get(
                            "geometryType", "unknown"
                        )

                pmtiles_lifecycle = resolve_pmtiles_lifecycle(
                    pack_id,
                    layer_id,
                    geom_type,
                    style_config,
                    processed_geo,
                    pmtiles_path,
                )

                resources = None
                if pack_id == "nli" and layer_id == "investigation_polygons":
                    sidecar_path = pack_output / BUFFERED_GRADIENT_SIDECAR
                    prior_resources = (existing_layers.get(layer_id) or {}).get(
                        "resources"
                    )
                    if sidecar_path.is_file():
                        if isinstance(prior_resources, dict) and prior_resources.get(
                            "bufferedGradient"
                        ):
                            resources = prior_resources
                        elif has_buffered_gradient(style_config or {}):
                            resources = {
                                "bufferedGradient": {
                                    "file": BUFFERED_GRADIENT_SIDECAR,
                                    "format": "geojson",
                                }
                            }

                # Popup and legend overrides
                layer_popup_cfg = self._get_popup_config_for_layer(pack_id, layer_id)
                if not layer_popup_cfg and layer_id in existing_layers:
                    existing_ui = existing_layers[layer_id].get("ui", {})
                    layer_popup_cfg = existing_ui.get("popup") or {}
                    if existing_ui.get("legendLabel"):
                        layer_popup_cfg = dict(layer_popup_cfg or {}, legendLabel=existing_ui["legendLabel"])
                layer_popup = (
                    {k: v for k, v in (layer_popup_cfg or {}).items() if k != "legendLabel"}
                    if layer_popup_cfg
                    else None
                )
                if layer_popup and len(layer_popup) == 0:
                    layer_popup = None
                ui_legend_label = (layer_popup_cfg or {}).get("legendLabel")

                entry_kwargs = {
                    "id": layer_id,
                    "name": layer_id,
                    "file": f"{layer_id}.geojson",
                    "geometry_type": geom_type,
                    "pmtiles_file": pmtiles_lifecycle.pmtiles_file,
                    "tiling_preset": pmtiles_lifecycle.tiling_preset,
                    "processing": pmtiles_lifecycle.metadata,
                    "ui_popup": layer_popup,
                    "ui_legend_label": ui_legend_label,
                }
                if resources:
                    entry = _ResourceLayerEntry(**entry_kwargs, resources=resources)
                else:
                    entry = LayerEntry(**entry_kwargs)
                new_layers.append(entry)
                if style_config:
                    new_styles[layer_id] = style_config

            # --- Process Image Layers ---
            image_files = (
                list(images_dir.glob("*.png"))
                + list(images_dir.glob("*.jpg"))
                + list(images_dir.glob("*.jpeg"))
                if images_dir.exists()
                else []
            )
            for image_file in image_files:
                # Logic must match process_single_image
                layer_id = (
                    "model_base" if image_file.stem == "model" else image_file.stem
                )
                name = (
                    "Model base"
                    if image_file.stem == "model"
                    else image_file.stem.replace("_", " ").title()
                )
                filename = image_file.name

                # Image layers don't have popups usually, but check anyway
                layer_popup = self._get_popup_config_for_layer(pack_id, layer_id)

                entry = LayerEntry.create_image_layer(
                    layer_id=layer_id, name=name, filename=filename
                )

                # Default Image Style
                style_config = {
                    "type": "image",
                    "renderer": "image",
                    "defaultStyle": {"opacity": 1.0},
                    "labels": None,
                    "scaleRange": None,
                }

                new_layers.append(entry)
                new_styles[layer_id] = style_config

            # --- Discover WMTS layers from gis/*.wmts.json (mirror process_all) ---
            for wmts_path in sorted(gis_dir.glob("*.wmts.json")):
                try:
                    with open(wmts_path, "r", encoding="utf-8") as f:
                        wmts_data = json.load(f)
                    layer_id = wmts_data.get("id", wmts_path.stem)
                    name = wmts_data.get("name", layer_id.replace("_", " ").title())
                    wmts_config = wmts_data.get("wmts")
                    mask_config = wmts_data.get("mask")
                    if wmts_config:
                        entry = LayerEntry.create_wmts_layer(
                            layer_id=layer_id,
                            name=name,
                            wmts_config=wmts_config,
                            mask=mask_config,
                        )
                        new_layers.append(entry)
                        logger.info(f"WMTS layer from {wmts_path.name}: {pack_id}.{layer_id}")
                except Exception as e:
                    logger.warning(f"Could not load WMTS {wmts_path}: {e}")

            # Write changes
            if new_layers:
                new_layers.sort(key=lambda x: x.id)
                manifest = PackManifest(
                    id=pack_id,
                    name=pack_id.title().replace("_", " "),
                    layers=new_layers,
                )
                manifest_dict = manifest.to_dict()

                self._atomic_write_json(pack_output / "manifest.json", manifest_dict)

                # Merge styles with existing
                styles_path = pack_output / "styles.json"
                current_styles = {}
                if styles_path.exists():
                    try:
                        with open(styles_path, "r", encoding="utf-8") as f:
                            current_styles = json.load(f)
                    except:
                        pass

                current_styles.update(new_styles)

                self._atomic_write_json(styles_path, current_styles)

        self.generate_root_manifest(processed_pack_ids)
        logger.info("Metadata update complete.")
