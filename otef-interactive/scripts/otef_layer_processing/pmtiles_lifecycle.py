import logging
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Callable, Optional

from .layer_stats import LayerStats, collect_geojson_stats
from .pmtiles_policy import PmtilesDecision, decide_pmtiles
from .tiling import TILING_PRESETS

logger = logging.getLogger(__name__)

GeneratePmtiles = Callable[[Path, Path, str], bool]


@dataclass(frozen=True)
class PmtilesLifecycle:
    stats: Optional[LayerStats]
    decision: Optional[PmtilesDecision]
    metadata: Optional[dict[str, Any]]
    pmtiles_file: Optional[str]
    tiling_preset: Optional[str]


def build_processing_metadata(
    stats: Optional[LayerStats], decision: Optional[PmtilesDecision]
) -> Optional[dict[str, Any]]:
    if stats is None or decision is None:
        return None
    return {
        "featureCount": stats.feature_count,
        "coordinateCount": stats.coordinate_count,
        "propertyBytes": stats.property_bytes,
        "sizeBytes": stats.size_bytes,
        "pmtilesReasons": list(decision.reasons),
    }


def _validated_preset(
    pack_id: str, layer_id: str, decision: Optional[PmtilesDecision]
) -> Optional[str]:
    if decision is None or not decision.use_pmtiles:
        return None
    if decision.preset is None:
        logger.warning(
            "PMTiles policy recommended %s/%s without a tiling preset",
            pack_id,
            layer_id,
        )
        return None
    if decision.preset not in TILING_PRESETS:
        logger.warning(
            "PMTiles policy recommended %s/%s with unknown tiling preset %r",
            pack_id,
            layer_id,
            decision.preset,
        )
        return None
    return decision.preset


def _remove_stale_pmtiles(pack_id: str, layer_id: str, pmtiles_path: Path) -> None:
    if not pmtiles_path.exists():
        return
    try:
        pmtiles_path.unlink()
        logger.warning("Removed stale PMTiles artifact for %s/%s", pack_id, layer_id)
    except OSError as exc:
        logger.warning(
            "Could not remove stale PMTiles artifact for %s/%s: %s",
            pack_id,
            layer_id,
            exc,
        )


def resolve_pmtiles_lifecycle(
    pack_id: str,
    layer_id: str,
    geometry_type: str,
    style_config: Optional[dict[str, Any]],
    geojson_path: Path,
    pmtiles_path: Path,
    generate_pmtiles: Optional[GeneratePmtiles] = None,
    regenerate_existing: bool = False,
) -> PmtilesLifecycle:
    if not geojson_path.exists():
        return PmtilesLifecycle(None, None, None, None, None)

    try:
        stats = collect_geojson_stats(geojson_path)
        decision = decide_pmtiles(
            pack_id=pack_id,
            layer_id=layer_id,
            geometry_type=geometry_type,
            style_config=style_config,
            stats=stats,
        )
    except ValueError as exc:
        logger.warning(
            "Could not collect GeoJSON stats for %s/%s: %s", pack_id, layer_id, exc
        )
        return PmtilesLifecycle(None, None, None, None, None)

    preset = _validated_preset(pack_id, layer_id, decision)
    if preset is None:
        _remove_stale_pmtiles(pack_id, layer_id, pmtiles_path)

    should_generate = preset is not None and generate_pmtiles is not None and (
        regenerate_existing or not pmtiles_path.exists()
    )
    generation_failed = False
    if should_generate:
        generated = generate_pmtiles(geojson_path, pmtiles_path, preset)
        if not generated:
            generation_failed = True
            logger.warning("PMTiles generation failed for %s/%s", pack_id, layer_id)
            _remove_stale_pmtiles(pack_id, layer_id, pmtiles_path)

    pmtiles_file = None
    tiling_preset = None
    if preset is not None and pmtiles_path.exists() and not generation_failed:
        pmtiles_file = pmtiles_path.name
        tiling_preset = preset

    return PmtilesLifecycle(
        stats=stats,
        decision=decision,
        metadata=build_processing_metadata(stats, decision),
        pmtiles_file=pmtiles_file,
        tiling_preset=tiling_preset,
    )
