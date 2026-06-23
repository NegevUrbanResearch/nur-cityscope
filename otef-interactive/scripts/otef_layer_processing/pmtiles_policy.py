from dataclasses import dataclass
from typing import Any

from .layer_stats import LayerStats

LINE_OR_POLYGON_SIZE_THRESHOLD = 1_500_000
COORDINATE_THRESHOLD = 50_000
FEATURE_THRESHOLD = 5_000


@dataclass(frozen=True)
class PmtilesDecision:
    use_pmtiles: bool
    preset: str | None
    reasons: tuple[str, ...]


def _symbol_layers_are_advanced(symbol: dict[str, Any] | None) -> bool:
    if not symbol or not isinstance(symbol, dict):
        return False

    layers = symbol.get("symbolLayers") or []
    if len(layers) > 1:
        return True

    for layer in layers:
        if not isinstance(layer, dict):
            continue
        if layer.get("type") in ("markerLine", "markerPoint"):
            return True
        if layer.get("hatch"):
            return True
        if layer.get("dash"):
            return True

    return False


def _style_config_is_advanced(style_config: dict[str, Any] | None) -> bool:
    if not style_config or not isinstance(style_config, dict):
        return False
    if style_config.get("complexity") == "advanced":
        return True
    if _symbol_layers_are_advanced(style_config.get("defaultSymbol")):
        return True

    unique_values = style_config.get("uniqueValues") or {}
    classes = unique_values.get("classes") or []
    for style_class in classes:
        if not isinstance(style_class, dict):
            continue
        if _symbol_layers_are_advanced(style_class.get("symbol")):
            return True

    return False


def _style_shape_is_present(value: Any) -> bool:
    if value is None:
        return False
    if isinstance(value, dict):
        if "symbolLayers" in value:
            symbol_layers = value.get("symbolLayers")
            if isinstance(symbol_layers, list) and symbol_layers:
                return True
            return any(
                _style_shape_is_present(item)
                for key, item in value.items()
                if key != "symbolLayers"
            )
        return any(_style_shape_is_present(item) for item in value.values())
    if isinstance(value, list):
        return any(_style_shape_is_present(item) for item in value)
    return bool(value)


def _is_label_only_point_layer(geometry_type: str | None, style_config: dict[str, Any] | None) -> bool:
    if not style_config or not isinstance(style_config, dict):
        return False
    geometry_name = str(geometry_type or "").lower()
    if geometry_name not in {"point", "multipoint"} or not style_config.get("labels"):
        return False
    if _style_shape_is_present(style_config.get("defaultSymbol")):
        return False
    if _style_shape_is_present(style_config.get("defaultStyle")):
        return False
    if _style_shape_is_present(style_config.get("style")):
        return False

    unique_values = style_config.get("uniqueValues") or {}
    if _style_shape_is_present(unique_values.get("classes")):
        return False

    return True


def _select_preset(family: str) -> str | None:
    if family == "line":
        return "roads_paths_rivers"
    if family == "polygon":
        return "large_polygons"
    if family == "point":
        return "points_thin"
    return None


def decide_pmtiles(
    pack_id: str,
    layer_id: str,
    geometry_type: str,
    style_config: dict[str, Any] | None,
    stats: LayerStats,
) -> PmtilesDecision:
    if pack_id == "projector_base":
        return PmtilesDecision(False, None, ("projector_base_opt_out",))

    if _is_label_only_point_layer(geometry_type, style_config):
        return PmtilesDecision(False, None, ("label_point_opt_out",))

    geometry_family = stats.geometry_family
    is_advanced = _style_config_is_advanced(style_config)
    reasons: list[str] = []

    if is_advanced:
        reasons.append("advanced_style")

    if geometry_family in {"line", "polygon"} and stats.size_bytes >= LINE_OR_POLYGON_SIZE_THRESHOLD:
        reasons.append("size_bytes")
    if stats.coordinate_count >= COORDINATE_THRESHOLD:
        reasons.append("coordinate_count")
    if stats.feature_count >= FEATURE_THRESHOLD:
        reasons.append("feature_count")

    if not reasons:
        return PmtilesDecision(False, None, ())

    preset = _select_preset(geometry_family)
    if preset is None:
        return PmtilesDecision(False, None, ())

    return PmtilesDecision(
        use_pmtiles=True,
        preset=preset,
        reasons=tuple(reasons),
    )
