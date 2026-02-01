
import os
import hashlib
import json
import logging
import shutil
from pathlib import Path
from typing import Dict, List, Optional, Any
from concurrent.futures import ProcessPoolExecutor, as_completed
from tqdm import tqdm

from .models import LayerEntry, PackManifest
from .geo import transform_to_wgs84, get_geometry_type
from .styles import find_lyrx_file, parse_lyrx_style
from .tiling import generate_pmtiles_smart

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
    formatter = logging.Formatter('%(asctime)s - %(levelname)s - %(message)s', datefmt='%H:%M:%S')
    handler.setFormatter(formatter)
    main_logger.addHandler(handler)
    main_logger.setLevel(level)

CACHE_FILE = ".layer-cache.json"

def compute_file_hash(path: Path) -> str:
    hash_sha256 = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(4096), b""):
            hash_sha256.update(chunk)
    return hash_sha256.hexdigest()

class ProcessingOrchestrator:
    def __init__(self, source_dir: Path, output_dir: Path, no_cache: bool = False, max_workers: int = 4):
        self.source_dir = source_dir
        self.output_dir = output_dir
        self.no_cache = no_cache
        self.max_workers = max_workers
        self.cache_path = output_dir / CACHE_FILE
        self.cache = {} if no_cache else self._load_cache()
        self.popup_config = self._load_popup_config()

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
            with open(self.cache_path, "w", encoding="utf-8") as f:
                json.dump(self.cache, f, indent=2)

    def _load_popup_config(self) -> Dict:
        # source_dir is typically ".../public/source/layers" or just ".../public/source"
        # We want to find ".../public/source/popup-config.json"

        candidates = [
            self.source_dir / "popup-config.json",          # If source is root
            self.source_dir.parent / "popup-config.json",   # If source is layers/
        ]

        for path in candidates:
            if path.exists():
                try:
                    with open(path, "r", encoding="utf-8") as f:
                        logger.info(f"Loaded popup config from {path}")
                        return json.load(f).get("layers", {})
                except Exception as e:
                    logger.warning(f"Could not load popup config from {path}: {e}")

        logger.warning(f"popup-config.json not found in candidates: {[str(p) for p in candidates]}")
        return {}

    def scan_packs(self) -> List[Path]:
        packs = []
        source_layers = self.source_dir / "source" / "layers"
        if not source_layers.exists():
            source_layers = self.source_dir # Fallback

        for d in source_layers.iterdir():
            if d.is_dir() and not d.name.startswith("."):
                gis_dir = d / "gis" if (d / "gis").exists() else d
                images_dir = d / "images"
                geo_files = list(gis_dir.glob("*.json")) + list(gis_dir.glob("*.geojson"))
                image_files = list(images_dir.glob("*.png")) + list(images_dir.glob("*.jpg")) + list(images_dir.glob("*.jpeg")) if images_dir.exists() else []
                if geo_files or image_files:
                    packs.append(d)
        return sorted(packs)

    def process_all(self):
        packs = self.scan_packs()
        if not packs:
            logger.warning("No layer packs found to process.")
            return

        # 1. Collect all layer tasks
        all_layer_tasks = []
        all_image_tasks = []
        pack_manifests = {} # pack_id -> PackManifest (partial)
        styles_map = {} # pack_id -> styles_dict

        logger.info(f"Scanning {len(packs)} packs for layers...")

        for pack_dir in packs:
            pack_id = pack_dir.name
            gis_dir = pack_dir / "gis" if (pack_dir / "gis").exists() else pack_dir
            images_dir = pack_dir / "images"
            styles_dir = pack_dir / "styles"

            # Prepare output dir
            pack_output = self.output_dir / pack_id
            pack_output.mkdir(parents=True, exist_ok=True)

            geo_files = list(gis_dir.glob("*.json")) + list(gis_dir.glob("*.geojson"))
            image_files = list(images_dir.glob("*.png")) + list(images_dir.glob("*.jpg")) + list(images_dir.glob("*.jpeg")) if images_dir.exists() else []

            # Initialize containers
            pack_manifests[pack_id] = {"id": pack_id, "name": pack_id.title().replace("_", " "), "layers": []}
            styles_map[pack_id] = {}

            for geo_file in geo_files:
                task = {
                    "pack_id": pack_id,
                    "geo_file": geo_file,
                    "styles_dir": styles_dir,
                    "pack_output": pack_output
                }
                all_layer_tasks.append(task)
            
            for image_file in image_files:
                task = {
                    "pack_id": pack_id,
                    "image_file": image_file,
                    "pack_output": pack_output
                }
                all_image_tasks.append(task)

        if not all_layer_tasks and not all_image_tasks:
            logger.warning("No layers found in packs.")
            return

        logger.info(f"Buffered {len(all_layer_tasks)} layers and {len(all_image_tasks)} images. Starting global parallel processing...")

        # 2. Process all layers in a global pool
        processed_layers = []

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
                futures[executor.submit(self.process_single_image, image_task, log_level)] = image_task

            # Main Progress Bar
            total_tasks = len(all_layer_tasks) + len(all_image_tasks)
            with tqdm(total=total_tasks, desc="Total Layers", unit="lyr") as pbar:
                for future in as_completed(futures):
                    try:
                        result = future.result()
                        if result:
                            # result is (layer_entry, style_entry_or_None, cache_key, cache_value)
                            layer_entry, style_entry, cache_key, cache_val = result
                            pack_id = cache_key.split('/')[0]

                            # Update local cache in main process
                            self.cache[cache_key] = cache_val

                            # Add to appropriate pack manifest
                            if pack_id in pack_manifests:
                                pack_manifests[pack_id]["layers"].append(layer_entry)
                                if style_entry:
                                    styles_map[pack_id][layer_entry.id] = style_entry

                    except Exception as e:
                        # task = futures[future]
                        # logger.error(f"Failed to process layer {task['geo_file'].name}: {e}")
                        tqdm.write(f"Task failed: {e}")

                    pbar.update(1)

        # 3. Write Manifests
        processed_pack_ids = []
        for pack_id, manifest_data in pack_manifests.items():
            if not manifest_data["layers"]:
                 continue

            processed_pack_ids.append(pack_id)
            pack_output = self.output_dir / pack_id

            # Sort layers by ID for consistency
            manifest_data["layers"].sort(key=lambda x: x.id)

            manifest = PackManifest(**manifest_data)
            with open(pack_output / "manifest.json", "w", encoding="utf-8") as f:
                json.dump(manifest.to_dict(), f, indent=2)

            with open(pack_output / "styles.json", "w", encoding="utf-8") as f:
                json.dump(styles_map[pack_id], f, indent=2)

        self.generate_root_manifest(processed_pack_ids)
        self.save_cache()
        logger.info("Processing complete.")

    def process_single_layer(self, task: Dict, log_level: int) -> Optional[Any]:
        """
        Process a single layer fully.
        Returns: (LayerEntry, StyleConfig or None, cache_key, cache_value)
        """
        # Configure logging for worker process
        logging.basicConfig(level=log_level, format='%(asctime)s - %(levelname)s - %(message)s')

        pack_id = task["pack_id"]
        geo_file = task["geo_file"]
        styles_dir = task["styles_dir"]
        pack_output = task["pack_output"]

        layer_id = geo_file.stem
        cache_key = f"{pack_id}/{geo_file.name}"
        file_hash = compute_file_hash(geo_file)

        # We need to access cache, but self.cache is copy-on-write in process.
        # Check if we should pass needed flag or just check file hash again?
        # Re-checking hash is safe but slow if we already did it.
        # But we didn't do it in main process for all layers to save time.
        # We will check hash here.
        # But we don't have the old hash efficiently unless we pass it.
        # Let's assume we re-read the cache dict (it was passed in self).

        needed = self.no_cache or self.cache.get(cache_key, {}).get("hash") != file_hash

        wgs84_file = pack_output / f"{layer_id}.geojson"
        pmtiles_file = pack_output / f"{layer_id}.pmtiles"

        style_config = None
        geom_type = "unknown"

        if needed:
            # logger.info(f"Processing {layer_id}...")
            try:
                # 1. Transform
                # 1. Transform
                if not transform_to_wgs84(geo_file, wgs84_file):
                    logger.error(f"Transformation failed for {layer_id}, skipping.")
                    return None

                # 2. Parse Style
                lyrx_file, _ = find_lyrx_file(geo_file, styles_dir)
                if lyrx_file:
                    style_obj = parse_lyrx_style(lyrx_file)
                    if style_obj:
                        style_config = style_obj.to_dict()
                        geom_type = style_obj.geometry_type

                if geom_type == "unknown":
                    geom_type = get_geometry_type(wgs84_file)

                # 3. Tiling
                # Lower threshold to 15MB to catch complex geometries
                is_large = geo_file.stat().st_size > 15 * 1024 * 1024
                if is_large:
                    # tqmd.write(f"Tiling {layer_id}...")
                    generate_pmtiles_smart(wgs84_file, pmtiles_file, high_fidelity=True)

            except Exception as e:
                logger.error(f"Error processing {layer_id}: {e}")
                import traceback
                traceback.print_exc()
                return None
        else:
            cached = self.cache[cache_key]
            geom_type = cached.get("geometry_type", "unknown")
            style_config = cached.get("style")

        entry = LayerEntry(
            id=layer_id,
            name=geo_file.stem,
            file=f"{layer_id}.geojson",
            geometry_type=geom_type,
            pmtiles_file=f"{layer_id}.pmtiles" if pmtiles_file.exists() else None,
            ui_popup=self.popup_config.get(pack_id, {}).get(layer_id)
        )

        return entry, style_config, cache_key, {
            "hash": file_hash,
            "geometry_type": geom_type,
            "style": style_config
        }

    def generate_root_manifest(self, pack_ids: List[str]):
        root_manifest = {"packs": sorted(pack_ids)}
        with open(self.output_dir / "layers-manifest.json", "w", encoding="utf-8") as f:
            json.dump(root_manifest, f, indent=2)

    def process_single_image(self, task: Dict, log_level: int) -> Optional[Any]:
        """
        Process a single image file (copy to output directory).
        Returns: (LayerEntry, StyleConfig or None, cache_key, cache_value)
        """
        # Configure logging for worker process
        logging.basicConfig(level=log_level, format='%(asctime)s - %(levelname)s - %(message)s')

        pack_id = task["pack_id"]
        image_file = task["image_file"]
        pack_output = task["pack_output"]

        # Use model_base for model.png so manifest matches backend/frontend expectations
        layer_id = "model_base" if image_file.stem == "model" else image_file.stem
        name = "Model base" if image_file.stem == "model" else image_file.stem.replace("_", " ").title()
        filename = image_file.name
        cache_key = f"{pack_id}/{filename}"
        file_hash = compute_file_hash(image_file)

        needed = self.no_cache or self.cache.get(cache_key, {}).get("hash") != file_hash

        output_file = pack_output / filename

        if needed:
            try:
                # Simply copy the image file to the output directory
                shutil.copy2(image_file, output_file)
                logger.info(f"Copied image: {layer_id} -> {output_file}")
            except Exception as e:
                logger.error(f"Error copying image {layer_id}: {e}")
                return None

        # Create LayerEntry for image
        entry = LayerEntry.create_image_layer(
            layer_id=layer_id,
            name=name,
            filename=filename
        )

        # Create default style for image type
        style_config = {
            "type": "image",
            "renderer": "image",
            "defaultStyle": {
                "opacity": 1.0
            },
            "fullSymbolLayers": [],
            "labels": None,
            "scaleRange": None
        }

        return entry, style_config, cache_key, {
            "hash": file_hash,
            "geometry_type": "image",
            "style": style_config
        }
