import json
import math
import re
import logging
from copy import deepcopy
from pathlib import Path
from typing import Dict, List, Optional, Tuple, Any
from .models import StyleConfig

logger = logging.getLogger(__name__)

# Conversion factor from Points (ArcGIS) to CSS Pixels (Web)
# 1pt = 1/72 inch, 1px = 1/96 inch -> 96/72 = 1.333
PT_TO_PX = 96 / 72


class UnsupportedCimGradientFillError(ValueError):
    """The supplied parser subset does not support this enabled CIM gradient fill."""


_POLYGON_DISPLAY_LABELS = {
    "מרחב לחימה - קרב": "מוקד קרב/טבח",
    "שריפה": "מוקד שריפה",
    "מוקד חטיפה": "מוקד חטיפה",
}


def normalize_name(name: str) -> str:
    """Normalize a name for matching: trim, lowercase, collapse whitespace."""
    return re.sub(r"\s+", " ", name.strip().lower())


def token_sort_name(name: str) -> str:
    """Create token-sorted key for matching (handles '232 ציר' vs 'ציר 232')."""
    normalized = normalize_name(name).replace("_", " ").replace("-", " ")
    tokens = re.findall(r"\w+", normalized)
    return " ".join(sorted(tokens))


def find_lyrx_file(
    geojson_file: Path, styles_dir: Path
) -> Tuple[Optional[Path], Optional[str]]:
    """
    Find matching .lyrx file using robust matching strategies.
    """
    if not styles_dir.exists():
        return None, None

    layer_name = geojson_file.stem
    layer_name_normalized = normalize_name(layer_name)
    layer_name_tokens = token_sort_name(layer_name)

    lyrx_index = {}

    for lyrx_file in styles_dir.glob("*.lyrx"):
        lyrx_stem = lyrx_file.stem
        exact_key = normalize_name(lyrx_stem)
        if exact_key not in lyrx_index:
            lyrx_index[exact_key] = []
        lyrx_index[exact_key].append((lyrx_file, lyrx_stem))

        token_key = token_sort_name(lyrx_stem)
        if token_key not in lyrx_index:
            lyrx_index[token_key] = []
        if (lyrx_file, lyrx_stem) not in lyrx_index[token_key]:
            lyrx_index[token_key].append((lyrx_file, lyrx_stem))

    if layer_name_normalized in lyrx_index:
        candidates = lyrx_index[layer_name_normalized]
        return candidates[0][0], "exact"

    if layer_name_tokens in lyrx_index:
        candidates = lyrx_index[layer_name_tokens]
        return candidates[0][0], "token_sorted"

    for lyrx_file in styles_dir.glob("*.lyrx"):
        try:
            with open(lyrx_file, "r", encoding="utf-8") as f:
                lyrx_data = json.load(f)

            layer_defs = lyrx_data.get("layerDefinitions", [])
            for layer_def in layer_defs:
                def_name = layer_def.get("name", "")
                if (
                    normalize_name(def_name) == layer_name_normalized
                    or token_sort_name(def_name) == layer_name_tokens
                ):
                    return lyrx_file, "metadata"

            layers = lyrx_data.get("layers", [])
            for layer_uri in layers:
                if "=" in layer_uri:
                    uri_path = layer_uri.split("=", 1)[1]
                    uri_name = Path(uri_path).stem
                    if (
                        normalize_name(uri_name) == layer_name_normalized
                        or token_sort_name(uri_name) == layer_name_tokens
                    ):
                        return lyrx_file, "metadata"
        except Exception:
            continue

    return None, None


def normalize_color_channel(value: object) -> int:
    try:
        channel = float(value)
    except (TypeError, ValueError):
        return 0
    if 0.0 <= channel <= 1.0:
        channel *= 255.0
    return max(0, min(255, int(round(channel))))


def normalize_opacity(value: object) -> float:
    try:
        opacity = float(value)
    except (TypeError, ValueError):
        return 1.0
    if opacity <= 1.0:
        return max(0.0, min(1.0, opacity))
    return max(0.0, min(1.0, opacity / 100.0))


def hsv_to_srgb_hex(h, s, v) -> str:
    # h in [0,360], s,v in [0,100] as ArcGIS HSV
    hue = float(h)
    sat = float(s) / 100.0
    val = float(v) / 100.0
    chroma = val * sat
    x = chroma * (1.0 - abs((hue / 60.0) % 2.0 - 1.0))
    m = val - chroma
    sector = int(hue / 60.0) % 6
    if sector == 0:
        r, g, b = chroma, x, 0.0
    elif sector == 1:
        r, g, b = x, chroma, 0.0
    elif sector == 2:
        r, g, b = 0.0, chroma, x
    elif sector == 3:
        r, g, b = 0.0, x, chroma
    elif sector == 4:
        r, g, b = x, 0.0, chroma
    else:
        r, g, b = chroma, 0.0, x
    ri = max(0, min(255, int(round((r + m) * 255.0))))
    gi = max(0, min(255, int(round((g + m) * 255.0))))
    bi = max(0, min(255, int(round((b + m) * 255.0))))
    return f"#{ri:02x}{gi:02x}{bi:02x}"


def _is_hsv_color(color: Dict) -> bool:
    color_type = str(color.get("type") or "")
    if color_type == "CIMHSVColor":
        return True
    space = color.get("colorSpace")
    if space == "HSV":
        return True
    if isinstance(space, str) and space.upper() == "HSV":
        return True
    return False


def cim_color_to_hex(color: object, default: str = "#000000") -> str:
    if not isinstance(color, dict):
        return default
    values = color.get("values") or []
    if len(values) < 3:
        return default
    if _is_hsv_color(color):
        return hsv_to_srgb_hex(values[0], values[1], values[2])
    r = normalize_color_channel(values[0])
    g = normalize_color_channel(values[1])
    b = normalize_color_channel(values[2])
    return f"#{r:02x}{g:02x}{b:02x}"


def cim_color_opacity(color: object, default: float = 1.0) -> float:
    if not isinstance(color, dict):
        return default
    values = color.get("values") or []
    if len(values) > 3:
        return normalize_opacity(values[3])
    return default


def _gradient_rgb_opacity(color: Dict[str, Any]) -> float:
    values = color.get("values") or []
    if len(values) < 4:
        return 1.0
    if isinstance(values[3], bool):
        raise _gradient_fill_error("RGB alpha must be numeric")
    try:
        alpha = float(values[3])
    except (TypeError, ValueError):
        raise _gradient_fill_error("RGB alpha must be numeric")
    if not math.isfinite(alpha) or alpha < 0 or alpha > 100:
        raise _gradient_fill_error("RGB alpha must be between 0 and 100")
    return alpha / 100.0


def _gradient_fill_error(message: str) -> UnsupportedCimGradientFillError:
    return UnsupportedCimGradientFillError(f"UnsupportedCimGradientFillError: {message}")


def _is_default_rgb_color_space(color_space: object) -> bool:
    if not isinstance(color_space, dict) or color_space.get("type") != "CIMICCColorSpace":
        return False
    return color_space.get("url") == "Default RGB" or color_space.get("name") == "Default RGB"


def _is_default_rgb_color(color: object) -> bool:
    if not isinstance(color, dict) or color.get("type") != "CIMRGBColor":
        return False
    return _is_default_rgb_color_space(color.get("colorSpace"))


def _gradient_fill_ir(layer: Dict[str, Any]) -> Dict[str, Any]:
    """Convert the supported Buffered/Discrete multipart CIM gradient fill to IR."""
    if not isinstance(layer, dict) or layer.get("type") != "CIMGradientFill":
        raise _gradient_fill_error("expected CIMGradientFill")
    if not layer.get("enable", True):
        return {}
    if (
        layer.get("gradientMethod") != "Buffered"
        or layer.get("gradientType") != "Discrete"
        or layer.get("gradientSize") != 75
        or layer.get("gradientSizeUnits") != "Relative"
    ):
        raise _gradient_fill_error("only Buffered/Discrete/Relative 75 is supported")

    ramp = layer.get("colorRamp")
    if not isinstance(ramp, dict) or ramp.get("type") != "CIMMultipartColorRamp":
        raise _gradient_fill_error("gradient fill requires a multipart color ramp")
    if not _is_default_rgb_color_space(ramp.get("colorSpace")):
        raise _gradient_fill_error("multipart ramp requires the Default RGB color space")
    ramps = ramp.get("colorRamps")
    weights = ramp.get("weights")
    if not isinstance(ramps, list) or not ramps or not isinstance(weights, list):
        raise _gradient_fill_error("multipart ramp is missing ramps or weights")
    if len(ramps) != len(weights):
        raise _gradient_fill_error("multipart ramp weights do not match ramps")
    if any(
        not isinstance(part, dict)
        or part.get("type") != "CIMLinearContinuousColorRamp"
        or not _is_default_rgb_color_space(part.get("colorSpace"))
        or not _is_default_rgb_color(part.get("fromColor"))
        or not _is_default_rgb_color(part.get("toColor"))
        or len(part["fromColor"].get("values") or []) < 3
        or len(part["toColor"].get("values") or []) < 3
        for part in ramps
    ):
        raise _gradient_fill_error("multipart ramp contains an unsupported segment")
    try:
        interval = int(layer.get("interval"))
    except (TypeError, ValueError):
        interval = 0
    if interval <= 0:
        raise _gradient_fill_error("gradient interval must be positive")
    try:
        numeric_weights = [float(weight) for weight in weights]
    except (TypeError, ValueError):
        raise _gradient_fill_error("multipart ramp weights must be numeric")
    if any(weight < 0 for weight in numeric_weights) or sum(numeric_weights) <= 0:
        raise _gradient_fill_error("multipart ramp weights must be non-negative")

    # ArcGIS's exact interpolation is not assumed here. This is the selected web
    # approximation: interpolate each RGB channel at weighted interval midpoints.
    total_weight = sum(numeric_weights)
    cumulative = []
    running = 0.0
    for weight in numeric_weights:
        running += weight / total_weight
        cumulative.append(running)

    endpoint_opacities = [
        (
            _gradient_rgb_opacity(part["fromColor"]),
            _gradient_rgb_opacity(part["toColor"]),
        )
        for part in ramps
    ]

    def interpolate(t: float) -> Tuple[str, float]:
        segment_index = next(
            (index for index, end in enumerate(cumulative) if t <= end),
            len(ramps) - 1,
        )
        start = 0.0 if segment_index == 0 else cumulative[segment_index - 1]
        span = cumulative[segment_index] - start
        local_t = 0.0 if span <= 0 else (t - start) / span
        part = ramps[segment_index]
        from_values = part["fromColor"]["values"]
        to_values = part["toColor"]["values"]
        channels = [
            int(round(float(a) + (float(b) - float(a)) * local_t))
            for a, b in zip(from_values[:3], to_values[:3])
        ]
        from_opacity, to_opacity = endpoint_opacities[segment_index]
        opacity = from_opacity + (to_opacity - from_opacity) * local_t
        return f"#{channels[0]:02x}{channels[1]:02x}{channels[2]:02x}", opacity

    samples = [interpolate((index + 0.5) / interval) for index in range(interval)]
    colors = [color for color, _ in samples]
    opacities = [opacity for _, opacity in samples]
    # Preserve the authored CIM fields alongside the renderer-facing fields.
    return {
        "type": "fill",
        "fillType": "gradient",
        "enable": True,
        "angle": layer.get("angle", 0),
        "gradientMethod": layer["gradientMethod"],
        "gradientSize": layer["gradientSize"],
        "gradientSizeUnits": layer["gradientSizeUnits"],
        "gradientType": layer["gradientType"],
        "interval": interval,
        "colorRamp": deepcopy(ramp),
        "resolvedColors": colors,
        "resolvedOpacities": opacities,
        "opacity": opacities[0],
    }


def _css_stroke_width(layer: Dict[str, Any], minimum_px: bool = False) -> float:
    try:
        width = float(layer.get("width", 1.0)) * PT_TO_PX
    except (TypeError, ValueError):
        width = PT_TO_PX
    return max(1.0, width) if minimum_px and layer.get("enable", True) else width


def extract_symbol_layers_recursive(symbol_obj: Dict, depth: int = 0) -> List[Dict]:
    if depth > 10:
        return []

    layers = []
    symbol_layers = symbol_obj.get("symbolLayers", [])

    for layer in symbol_layers:
        layer_type = layer.get("type", "")
        layers.append(layer)

        if layer_type == "CIMVectorMarker":
            marker_graphics = layer.get("markerGraphics", [])
            for mg in marker_graphics:
                mg_symbol = mg.get("symbol", {})
                if mg_symbol:
                    layers.extend(extract_symbol_layers_recursive(mg_symbol, depth + 1))

        nested_symbol = layer.get("symbol", {})
        if nested_symbol and nested_symbol != symbol_obj:
            layers.extend(extract_symbol_layers_recursive(nested_symbol, depth + 1))

    return layers


def _unwrap_cim_symbol(symbol_ref: object) -> Dict:
    if not isinstance(symbol_ref, dict):
        return {}
    nested = symbol_ref.get("symbol")
    if isinstance(nested, dict) and nested.get("symbolLayers") is not None:
        return nested
    return symbol_ref


def _symbol_layers_from_ref(symbol_ref: object) -> List[Dict]:
    symbol = _unwrap_cim_symbol(symbol_ref)
    if not symbol:
        return []
    layers = extract_symbol_layers_recursive(symbol)
    if layers:
        return layers
    nested_layers = symbol.get("symbolLayers") or []
    return [layer for layer in nested_layers if isinstance(layer, dict)]


def _line_join_cap(value: object, default: str = "round") -> str:
    if not value:
        return default
    return str(value).lower()


def _taper_from_effects(effects: object) -> Dict[str, float]:
    from_width = 0.0
    to_width = 1.0
    if not isinstance(effects, list):
        return {"fromWidthPt": from_width, "toWidthPt": to_width}
    for effect in effects:
        if not isinstance(effect, dict):
            continue
        if effect.get("type") != "CIMGeometricEffectTaperedPolygon":
            continue
        if "fromWidth" in effect:
            try:
                from_width = float(effect["fromWidth"])
            except (TypeError, ValueError):
                from_width = 0.0
        else:
            from_width = 0.0
        try:
            to_width = float(effect.get("toWidth", 1.0))
        except (TypeError, ValueError):
            to_width = 1.0
        break
    return {"fromWidthPt": from_width, "toWidthPt": to_width}


def _gradient_size_fraction(stroke: Dict) -> float:
    try:
        size = float(stroke.get("gradientSize", 75))
    except (TypeError, ValueError):
        size = 75.0
    units = str(stroke.get("gradientSizeUnits") or "Relative")
    if units.lower() == "relative" or size > 1.0:
        return size / 100.0
    return size


def _acrossline_ir_from_gradient_stroke(
    stroke: Dict, opacity: float = 1.0
) -> Dict[str, Any]:
    ramp = stroke.get("colorRamp") or {}
    if not isinstance(ramp, dict):
        ramp = {}
    return {
        "type": "acrossLine",
        "gradientMethod": stroke.get("gradientMethod") or "AcrossLine",
        "fromColor": cim_color_to_hex(ramp.get("fromColor") or {}, default="#f5f500"),
        "toColor": cim_color_to_hex(ramp.get("toColor") or {}, default="#f50000"),
        "widthPt": float(stroke.get("width", 1.0)),
        "opacity": opacity,
        "gradientSize": _gradient_size_fraction(stroke),
        "cap": _line_join_cap(stroke.get("capStyle")),
        "join": _line_join_cap(stroke.get("joinStyle")),
        "taper": _taper_from_effects(stroke.get("effects") or []),
        "classBreaks": None,
    }


def _iter_renderer_gradient_strokes(renderer: Dict) -> List[Dict]:
    strokes: List[Dict] = []
    seen = set()

    def add_from_ref(symbol_ref: object) -> None:
        for layer in _symbol_layers_from_ref(symbol_ref):
            if layer.get("type") != "CIMGradientStroke":
                continue
            marker = id(layer)
            if marker in seen:
                continue
            seen.add(marker)
            strokes.append(layer)

    add_from_ref(renderer.get("symbol") or {})
    authoring = renderer.get("authoringInfo") or {}
    if isinstance(authoring, dict):
        add_from_ref(authoring.get("templateSymbol") or {})
    for brk in renderer.get("breaks") or []:
        if isinstance(brk, dict):
            add_from_ref(brk.get("symbol") or {})
    return strokes


def _first_gradient_stroke(renderer: Dict) -> Optional[Dict]:
    strokes = _iter_renderer_gradient_strokes(renderer)
    return strokes[0] if strokes else None


def _class_breaks_from_renderer(renderer: Dict) -> Optional[List[Dict[str, Any]]]:
    if renderer.get("type") != "CIMClassBreaksRenderer":
        return None
    breaks: List[Dict[str, Any]] = []
    for brk in renderer.get("breaks") or []:
        if not isinstance(brk, dict):
            continue
        upper = brk.get("upperBound")
        width_pt = None
        for layer in _symbol_layers_from_ref(brk.get("symbol") or {}):
            if layer.get("type") == "CIMGradientStroke":
                try:
                    width_pt = float(layer.get("width", 0))
                except (TypeError, ValueError):
                    width_pt = None
                break
        if upper is None or width_pt is None:
            continue
        breaks.append({"max": upper, "widthPt": width_pt})
    return breaks or None


def _layer_opacity_from_transparency(layer_def: Dict) -> float:
    transparency = layer_def.get("transparency")
    if transparency is None:
        return 1.0
    try:
        return max(0.0, min(1.0, (100.0 - float(transparency)) / 100.0))
    except (TypeError, ValueError):
        return 1.0


def _load_lyrx_document(source) -> Dict:
    if isinstance(source, dict):
        return source
    path = Path(source)
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)


def parse_acrossline_from_lyrx(source) -> Dict[str, Any]:
    """Parse CIMGradientStroke AcrossLine lyrx into ribbon IR (no MapLibre line-gradient)."""
    data = _load_lyrx_document(source)
    layer_defs = data.get("layerDefinitions") or []
    if not layer_defs or not isinstance(layer_defs[0], dict):
        raise ValueError("lyrx has no layerDefinitions")
    layer_def = layer_defs[0]
    renderer = layer_def.get("renderer") or {}
    if not isinstance(renderer, dict):
        renderer = {}
    stroke = _first_gradient_stroke(renderer)
    if stroke is None:
        raise ValueError("no CIMGradientStroke AcrossLine in lyrx")
    ir = _acrossline_ir_from_gradient_stroke(
        stroke, opacity=_layer_opacity_from_transparency(layer_def)
    )
    ir["classBreaks"] = _class_breaks_from_renderer(renderer)
    return ir


def extract_simplified_style(symbol_layers: List[Dict]) -> Dict:
    # Validate every enabled gradient first, even when a preceding solid fill
    # would otherwise prevent this layer from being inspected below.
    for layer in symbol_layers:
        if (
            isinstance(layer, dict)
            and layer.get("type") == "CIMGradientFill"
            and layer.get("enable", True)
        ):
            _gradient_fill_ir(layer)

    fill_color = None
    fill_opacity = 1.0
    stroke_color = None
    stroke_width = 1.0
    style = {}
    buffered_gradient = any(
        isinstance(layer, dict)
        and layer.get("type") == "CIMGradientFill"
        and layer.get("enable", True)
        for layer in symbol_layers
    )

    for layer in symbol_layers:
        if not layer.get("enable", True):
            continue

        layer_type = layer.get("type", "")

        if layer_type == "CIMVectorMarker":
            size = layer.get("size", 6)
            style["radius"] = size * PT_TO_PX  # Scale point size/radius

            # If marker has internal symbols, we might need to rely on recursion results that should be in the list already.
            # But CIMVectorMarker itself is not a fill/stroke type, so it falls through.
            # We just capture the size here.

        # Priority 1: Solid Fill and Stroke
        if layer_type == "CIMSolidFill" and fill_color is None:
            color_obj = layer.get("color", {})
            fill_color = cim_color_to_hex(color_obj)
            fill_opacity = cim_color_opacity(color_obj)

        if layer_type == "CIMSolidStroke" and stroke_color is None:
            color_obj = layer.get("color", {})
            stroke_color = cim_color_to_hex(color_obj)
            stroke_width = _css_stroke_width(layer, minimum_px=buffered_gradient)

            # Check for dashed effects. Missing dashTemplate is omitted, not [].
            effects = layer.get("effects", [])
            for effect in effects:
                if effect.get("type") == "CIMGeometricEffectDashes":
                    template = effect.get("dashTemplate")
                    if template:
                        style["dashArray"] = template
                    break

        if layer_type == "CIMGradientFill" and fill_color is None:
            gradient = _gradient_fill_ir(layer)
            fill_color = gradient["resolvedColors"][0]
            fill_opacity = gradient["opacity"]

        if layer_type == "CIMGradientStroke" and stroke_color is None:
            ramp = layer.get("colorRamp") or {}
            if isinstance(ramp, dict):
                stroke_color = cim_color_to_hex(ramp.get("fromColor") or {})
            stroke_width = layer.get("width", 1.0) * PT_TO_PX

        # Priority 2: Hatch Fill (capture it always, but only set fill_color fallback if still None)
        if layer_type == "CIMHatchFill" and "hatch" not in style:
            line_symbol = layer.get("lineSymbol", {})
            if line_symbol:
                line_layers = extract_symbol_layers_recursive(line_symbol)
                for l_layer in line_layers:
                    if l_layer.get("type") == "CIMSolidStroke":
                        h_color = cim_color_to_hex(l_layer.get("color", {}))
                        style["hatch"] = {
                            "color": h_color,
                            "rotation": layer.get("rotation", 0),
                            "separation": layer.get("separation", 5),
                            "width": l_layer.get("width", 1)
                            * PT_TO_PX,  # Scale hatch line width
                        }
                        # Only set fallback if no solid fill found YET
                        break

    style.update(
        {
            "fillColor": fill_color or "#808080",
            "fillOpacity": fill_opacity,
            "strokeColor": stroke_color or "#000000",
            "strokeWidth": stroke_width,
        }
    )
    # Ensure radius is preserved if found
    if "radius" not in style:
        style["radius"] = 5  # Default
    return style


def _analyze_cim_complexity(symbol_layers: List[Dict]) -> Dict[str, Any]:
    """
    Analyze flattened CIM symbol layers and flag constructs we don't fully support.
    Mirrors logic used in generate_layer_report.analyze_cim_complexity, but kept
    local here so we can attach a simple/advanced complexity flag to StyleConfig.
    """
    if not symbol_layers:
        return {
            "multipleHatches": False,
            "multipleStrokes": False,
            "markerAlongLine": False,
            "unsupportedTypes": [],
        }

    hatch_count = sum(1 for L in symbol_layers if L.get("type") == "CIMHatchFill")
    stroke_count = sum(1 for L in symbol_layers if L.get("type") == "CIMSolidStroke")
    marker_along = any(
        L.get("type") == "CIMVectorMarker" and L.get("markerPlacement")
        for L in symbol_layers
    )
    supported = {
        "CIMSolidFill",
        "CIMSolidStroke",
        "CIMHatchFill",
        "CIMVectorMarker",
        "CIMGradientStroke",
    }
    unsupported = [
        L.get("type")
        for L in symbol_layers
        if L.get("type") and L.get("type") not in supported
    ]
    # Preserve order but ensure uniqueness
    seen = set()
    uniq_unsupported = []
    for t in unsupported:
        if t not in seen:
            uniq_unsupported.append(t)
            seen.add(t)

    return {
        "multipleHatches": hatch_count > 1,
        "multipleStrokes": stroke_count > 1,
        "markerAlongLine": marker_along,
        "unsupportedTypes": uniq_unsupported,
    }


def _build_advanced_symbol_from_layers(symbol_layers: List[Dict]) -> Dict[str, Any]:
    """
    Build a lightweight, renderer-agnostic advanced symbol IR from CIM symbol layers.

    This is intentionally conservative: we focus on the constructs we know how
    to render (solid fills, hatches, strokes, simple markers). The JS advanced
    style engine can evolve this further.
    """
    if not symbol_layers:
        return {}

    symbol_layers_ir: List[Dict[str, Any]] = []
    buffered_gradient = any(
        isinstance(layer, dict)
        and layer.get("type") == "CIMGradientFill"
        and layer.get("enable", True)
        for layer in symbol_layers
    )

    for layer in symbol_layers:
        if not layer.get("enable", True):
            continue

        ltype = layer.get("type", "")

        if ltype == "CIMSolidFill":
            color_obj = layer.get("color", {})
            fill_color = cim_color_to_hex(color_obj)
            opacity = cim_color_opacity(color_obj)
            symbol_layers_ir.append(
                {
                    "type": "fill",
                    "fillType": "solid",
                    "color": fill_color,
                    "opacity": opacity,
                }
            )

        elif ltype == "CIMHatchFill":
            # Represent hatch as a fill layer with hatch sub-structure
            line_symbol = layer.get("lineSymbol", {})
            hatch_color = "#000000"
            line_width = 1.0
            separation = layer.get("separation", 5)
            # ArcGIS hatch separation is defined in points; convert to CSS pixels
            separation_px = separation * PT_TO_PX
            if line_symbol:
                nested = extract_symbol_layers_recursive(line_symbol)
                for n in nested:
                    if n.get("type") == "CIMSolidStroke":
                        color_obj = n.get("color", {})
                        hatch_color = cim_color_to_hex(color_obj)
                        line_width = n.get("width", 1) * PT_TO_PX
                        break

            symbol_layers_ir.append(
                {
                    "type": "fill",
                    "fillType": "hatch",
                    "color": hatch_color,
                    "opacity": 1.0,
                    "hatch": {
                        "color": hatch_color,
                        "rotation": layer.get("rotation", 0),
                        "separation": separation_px,
                        "width": line_width,
                        "units": "screen",
                    },
                }
            )

        elif ltype == "CIMSolidStroke":
            color_obj = layer.get("color", {})
            stroke_color = cim_color_to_hex(color_obj)
            opacity = cim_color_opacity(color_obj)
            width = _css_stroke_width(layer, minimum_px=buffered_gradient)

            dash_array = None
            effects = layer.get("effects", [])
            for effect in effects:
                if effect.get("type") == "CIMGeometricEffectDashes":
                    template = effect.get("dashTemplate")
                    if template:
                        dash_array = template
                    break

            symbol_layers_ir.append(
                {
                    "type": "stroke",
                    "color": stroke_color,
                    "width": width,
                    "opacity": opacity,
                    "lineCap": _line_join_cap(layer.get("capStyle")),
                    "lineJoin": _line_join_cap(layer.get("joinStyle")),
                    "miterLimit": layer.get("miterLimit", 10),
                    "enable": bool(layer.get("enable", True)),
                    "dash": {"array": dash_array} if dash_array else None,
                }
            )

        elif ltype == "CIMGradientFill":
            # Validate and resolve the supported fill before the old simplifier can
            # substitute its gray fallback for an unrecognized layer.
            symbol_layers_ir.append(_gradient_fill_ir(layer))

        elif ltype == "CIMGradientStroke":
            # AcrossLine ribbon IR. Do not emit MapLibre line-gradient or empty dash arrays.
            symbol_layers_ir.append(_acrossline_ir_from_gradient_stroke(layer))

        elif ltype == "CIMVectorMarker":
            size = layer.get("size", 6) * PT_TO_PX
            placement = layer.get("markerPlacement")

            # Derive marker colors and outline from nested markerGraphics symbol, if present.
            marker_fill = None
            marker_fill_opacity = None
            marker_stroke = None
            marker_stroke_opacity = None
            marker_stroke_width = None
            # Shape hint: default to circle, but try to infer "square" or "line-tick"
            # from markerGraphics geometry when available.
            inferred_shape = "circle"

            marker_graphics = layer.get("markerGraphics", [])
            for mg in marker_graphics:
                mg_symbol = mg.get("symbol", {})
                if not mg_symbol:
                    continue
                geom = mg.get("geometry", {})
                paths = geom.get("paths") or []
                # Heuristic: a single short line segment in marker space often represents
                # a tick/rectangle marker along a line (e.g., מסלולי_רכבת). Treat that
                # as a "square" marker so the renderer can draw a rect instead of a circle.
                if isinstance(paths, list) and paths:
                    first_path = paths[0]
                    if isinstance(first_path, list) and len(first_path) == 2:
                        inferred_shape = "square"

                nested_layers = extract_symbol_layers_recursive(mg_symbol)
                for nlayer in nested_layers:
                    ntype = nlayer.get("type", "")
                    if ntype == "CIMSolidFill" and marker_fill is None:
                        color_obj = nlayer.get("color", {})
                        marker_fill = cim_color_to_hex(color_obj)
                        marker_fill_opacity = cim_color_opacity(color_obj)
                    elif ntype == "CIMSolidStroke" and marker_stroke is None:
                        color_obj = nlayer.get("color", {})
                        marker_stroke = cim_color_to_hex(color_obj)
                        marker_stroke_opacity = cim_color_opacity(color_obj)
                        marker_stroke_width = nlayer.get("width", 1.0) * PT_TO_PX

            marker_entry: Dict[str, Any] = {
                "marker": {
                    "shape": inferred_shape,
                    "size": size,
                }
            }
            if marker_fill:
                marker_entry["marker"]["fillColor"] = marker_fill
            if marker_fill_opacity is not None:
                marker_entry["marker"]["fillOpacity"] = marker_fill_opacity
            if marker_stroke:
                marker_entry["marker"]["strokeColor"] = marker_stroke
            if marker_stroke_opacity is not None:
                marker_entry["marker"]["strokeOpacity"] = marker_stroke_opacity
            if marker_stroke_width is not None:
                marker_entry["marker"]["strokeWidth"] = marker_stroke_width

            if placement:
                # Treat as markerLine
                mode = placement.get("type") or placement.get("placement", "")
                interval = 0.0
                # ArcGIS CIM uses placementTemplate / offsetAlongLine for along-line markers.
                template = placement.get("placementTemplate") or placement.get(
                    "template"
                )
                if isinstance(template, list) and template:
                    try:
                        interval = float(template[0])
                    except (TypeError, ValueError):
                        interval = 0.0
                else:
                    interval = float(placement.get("interval", 0.0) or 0.0)

                symbol_layers_ir.append(
                    {
                        "type": "markerLine",
                        "marker": marker_entry["marker"],
                        "placement": {
                            "mode": mode or "interval",
                            "interval": interval,
                            "offsetAlong": float(
                                placement.get(
                                    "offsetAlongLine", placement.get("offset", 0.0)
                                )
                                or 0.0
                            ),
                        },
                        "orientation": {
                            "alignToLine": bool(placement.get("angleToLine", False)),
                        },
                    }
                )
            else:
                # Treat as simple point marker
                symbol_layers_ir.append(
                    {
                        "type": "markerPoint",
                        "marker": marker_entry["marker"],
                    }
                )

    if not symbol_layers_ir:
        return {}

    return {"symbolLayers": symbol_layers_ir}


def _ensure_advanced_stroke_for_polygons(style: StyleConfig) -> None:
    """
    For polygon layers, ensure advanced_symbol has a visible stroke that matches
    the simplified default_style when the CIM strokes are effectively invisible.

    This keeps projector outlines consistent with GIS, while still allowing
    fully transparent strokes when both CIM and default_style agree on "no stroke".
    """
    if not style or style.geometry_type != "polygon":
        return

    advanced = style.advanced_symbol
    default_style = style.default_style or {}

    if not isinstance(advanced, dict):
        return

    symbol_layers = advanced.get("symbolLayers")
    if not isinstance(symbol_layers, list) or not symbol_layers:
        return

    stroke_layers = [
        (idx, layer)
        for idx, layer in enumerate(symbol_layers)
        if isinstance(layer, dict) and layer.get("type") == "stroke"
    ]
    if not stroke_layers and not default_style:
        return

    # Check if we already have a visible stroke (opacity > 0 and width > 0)
    has_visible_stroke = any(
        (layer.get("opacity", 1.0) > 0.0) and (layer.get("width", 1.0) > 0.0)
        for _, layer in stroke_layers
    )
    if has_visible_stroke:
        return

    stroke_color = default_style.get("strokeColor")
    stroke_width = default_style.get("strokeWidth")
    if not stroke_color or stroke_width is None or stroke_width <= 0:
        # Default style does not declare a meaningful stroke; respect that.
        return

    dash_array = default_style.get("dashArray")
    new_stroke = {
        "type": "stroke",
        "color": stroke_color,
        "width": stroke_width,
        "opacity": 1.0,
        "dash": {"array": dash_array} if dash_array else None,
    }

    if stroke_layers:
        # We only had invisible strokes; replace the first one with a visible
        # outline that matches the simplified default style.
        first_idx, _ = stroke_layers[0]
        symbol_layers[first_idx] = new_stroke
    else:
        # No stroke layers at all: insert a stroke before the first fill so
        # drawing order remains outline-under-fill.
        insert_idx = 0
        for i, layer in enumerate(symbol_layers):
            if isinstance(layer, dict) and layer.get("type") == "fill":
                insert_idx = i
                break
        symbol_layers.insert(insert_idx, new_stroke)


SHEMOT_LYRX_STEM = "שמות_יישובים"
PEOPLE_NAMES_LYRX_STEM = "people_names"
_SETTLEMENT_LABEL_NOTO_FALLBACK = "Noto Sans Regular"
# Hebrew display face for projector settlement labels when the LYRX still has a generic export font.
_SETTLEMENT_LABEL_PROJECTION_FONT = "Guttman Hatzvi"


def _maplex_label_field_from_expression(expression: str) -> str:
    """Resolve GeoJSON field name from a Maplex/Arcade expression (e.g. $feature['cityname'])."""
    s = (expression or "").strip()
    if not s:
        return "name"
    m = re.search(
        r'\$feature\[\s*["\']?([A-Za-z0-9_]+)["\']?\s*\]', s, re.IGNORECASE
    )
    if m:
        return m.group(1)
    m2 = re.search(r"\$feature\.([A-Za-z0-9_]+)\s*$", s, re.IGNORECASE)
    if m2:
        return m2.group(1)
    field = (
        s.replace("$feature.", "")
        .replace('$feature["', "")
        .replace('"]', "")
        .replace("'", "")
        .replace('"', "")
        .strip()
    ) or "name"
    return field


def _apply_shemot_settlement_label_ir(
    label_config: Optional[Dict[str, Any]], lyrx_path: Path
) -> None:
    """
    `שמות_יישובים` only: finalize labels IR (font stack, projection toggles) without
    making Guttman/Noto the default for other layers.
    """
    if not label_config or lyrx_path.stem != SHEMOT_LYRX_STEM:
        return
    raw = label_config.get("font")
    if isinstance(raw, list) and len(raw) > 0:
        primary = str(raw[0]).strip()
    elif isinstance(raw, str) and raw.strip():
        primary = raw.strip()
    else:
        primary = ""
    generic_lyrx_export = (not primary) or (primary.lower() == "arial")
    if generic_lyrx_export:
        primary = _SETTLEMENT_LABEL_PROJECTION_FONT
    label_config["font"] = [primary, _SETTLEMENT_LABEL_NOTO_FALLBACK]
    label_config.setdefault("hebrewBidiWrap", False)
    label_config.setdefault("forceVisible", True)
    # Thinner look at the same text-size: narrow MapLibre text-halo (LYRX often exports ~1).
    label_config["haloSize"] = min(float(label_config.get("haloSize") or 1.0), 0.35)
    # MapLibre: data-driven placement from processed GeoJSON (merged from שמות_label_overrides.json)
    label_config["angleFromProperties"] = True
    label_config["angleProperty"] = "otef_label_rotate_deg"
    # Layout text-offset (ems): numerators on otef_label_offset_em_*; also otef_map_text_offset_em
    # [x/size, y/size] so MapLibre can use ["get", …] (reliable) with coalesce fallback to scalars.
    label_config["offsetEmFromProperties"] = True
    label_config["offsetEmFieldX"] = "otef_label_offset_em_x"
    label_config["offsetEmFieldY"] = "otef_label_offset_em_y"
    label_config["offsetArrayProperty"] = "otef_map_text_offset_em"


def _apply_people_names_label_ir(
    label_config: Optional[Dict[str, Any]], lyrx_path: Path
) -> None:
    """
    `people_names` only: Guttman + Noto Regular, size 8, thin halo, map
    rotation, radial offsets from ``otef_map_text_offset_em``.
    """
    if not label_config or lyrx_path.stem != PEOPLE_NAMES_LYRX_STEM:
        return
    label_config["font"] = [
        _SETTLEMENT_LABEL_PROJECTION_FONT,
        _SETTLEMENT_LABEL_NOTO_FALLBACK,
    ]
    label_config["color"] = "#ffffff"
    label_config["size"] = 8.0
    label_config["haloSize"] = 0.12
    if not label_config.get("haloColor"):
        label_config["haloColor"] = "#ffffff"
    label_config["forceVisible"] = True
    label_config["hebrewBidiWrap"] = False
    label_config["offsetArrayProperty"] = "otef_map_text_offset_em"
    label_config["textRotationAlignment"] = "map"
    label_config.pop("offsetEmFromProperties", None)
    label_config.pop("angleFromProperties", None)


def _finalize_people_names_style(style: StyleConfig, lyrx_path: Path) -> None:
    """Labels-only: drop parser fill/stroke fallback so MapLibre emits no point markers."""
    if lyrx_path.stem != PEOPLE_NAMES_LYRX_STEM:
        return
    style.full_symbol_layers = []
    style.default_style = {}
    style.advanced_symbol = {"symbolLayers": []}
    style.unique_values = None
    style.renderer = "simple"


def parse_lyrx_style(lyrx_path: Path) -> Optional[StyleConfig]:
    try:
        with open(lyrx_path, "r", encoding="utf-8") as f:
            lyrx_data = json.load(f)
    except Exception as e:
        logger.error(f"Error reading .lyrx file {lyrx_path}: {e}")
        return None

    layer_defs = lyrx_data.get("layerDefinitions", [])
    if not layer_defs:
        return None

    layer_def = layer_defs[0]
    renderer = layer_def.get("renderer", {})
    renderer_type = renderer.get("type", "")

    geometry_type = None
    symbol_ref = renderer.get("symbol", {})
    if not symbol_ref and renderer_type == "CIMClassBreaksRenderer":
        breaks = renderer.get("breaks") or []
        if breaks and isinstance(breaks[0], dict):
            symbol_ref = breaks[0].get("symbol", {}) or {}
        if not symbol_ref:
            authoring = renderer.get("authoringInfo") or {}
            if isinstance(authoring, dict):
                symbol_ref = authoring.get("templateSymbol") or {}
    if symbol_ref:
        actual_symbol = symbol_ref.get("symbol", {})
        symbol_type = actual_symbol.get("type", "")
        if symbol_type == "CIMPointSymbol":
            geometry_type = "point"
        elif symbol_type == "CIMLineSymbol":
            geometry_type = "line"
        elif symbol_type == "CIMPolygonSymbol":
            geometry_type = "polygon"

    if geometry_type is None:
        label_classes = layer_def.get("labelClasses", [])
        if label_classes:
            label_class = label_classes[0]
            maplex_props = label_class.get("maplexLabelPlacementProperties", {})
            feature_type = maplex_props.get("featureType", "")
            if feature_type:
                geometry_type = feature_type.lower()

    if geometry_type is None:
        geometry_type = "polygon"

    label_config = None
    label_classes = layer_def.get("labelClasses", [])
    if label_classes:
        label_class = label_classes[0]
        text_symbol = label_class.get("textSymbol", {}).get("symbol", {})
        # Expression can be '$feature["cityname"]' or '$feature.cityname'
        expression = label_class.get("expression", "")
        field = _maplex_label_field_from_expression(str(expression or ""))
        # Text fill color from CIMPolygonSymbol -> symbolLayers[0].color (CIMRGBColor)
        color_hex = None
        color_opacity = 1.0
        fill_symbol = text_symbol.get("symbol", {})
        symbol_layers = fill_symbol.get("symbolLayers", [])
        if symbol_layers:
            color_obj = symbol_layers[0].get("color", {})
            values = color_obj.get("values", [])
            if len(values) >= 3:
                r, g, b = int(values[0]), int(values[1]), int(values[2])
                color_hex = f"#{r:02x}{g:02x}{b:02x}"
                if len(values) >= 4:
                    # ArcGIS often uses 0-100 for alpha
                    a = values[3]
                    color_opacity = (a / 100.0) if a <= 100 else (a / 255.0)
        # haloColor: convert CIMRGBColor to hex for frontend ctx.strokeStyle
        halo_color_hex = None
        halo_obj = text_symbol.get("haloColor")
        if halo_obj and isinstance(halo_obj, dict):
            h_vals = halo_obj.get("values", [])
            if len(h_vals) >= 3:
                hr, hg, hb = int(h_vals[0]), int(h_vals[1]), int(h_vals[2])
                halo_color_hex = f"#{hr:02x}{hg:02x}{hb:02x}"
        # size: ArcGIS CIM "height" is in points
        label_config = {
            "field": field,
            "font": text_symbol.get("fontFamilyName", "Arial"),
            "size": text_symbol.get("height", 10),
            "color": color_hex or "#000000",
            "colorOpacity": color_opacity,
            "haloSize": text_symbol.get("haloSize", 0),
            "haloColor": halo_color_hex,  # hex string or None; frontend uses "#ffffff" fallback
            "horizontalAlignment": text_symbol.get("horizontalAlignment", "Center"),
            "verticalAlignment": text_symbol.get("verticalAlignment", "Baseline"),
            "textDirection": text_symbol.get("textDirection", "LTR"),
            "fontStyleName": text_symbol.get("fontStyleName", "Regular"),
        }
        # Map fontStyleName to CSS-friendly fontWeight/fontStyle for frontend
        style_name = (label_config.get("fontStyleName") or "Regular").lower()
        if "bold" in style_name:
            label_config["fontWeight"] = "bold"
        else:
            label_config["fontWeight"] = "normal"
        if "italic" in style_name:
            label_config["fontStyle"] = "italic"
        else:
            label_config["fontStyle"] = "normal"
        _apply_shemot_settlement_label_ir(label_config, lyrx_path)
        _apply_people_names_label_ir(label_config, lyrx_path)

    min_scale = layer_def.get("minScale") or layer_def.get("minimumScale")
    max_scale = layer_def.get("maxScale") or layer_def.get("maximumScale")
    scale_range = None
    if min_scale is not None or max_scale is not None:
        scale_range = {"minScale": min_scale, "maxScale": max_scale}

    style = StyleConfig(
        geometry_type=geometry_type,
        renderer="simple",
        labels=label_config,
        scale_range=scale_range,
        use_default_symbol=renderer.get("useDefaultSymbol")
        if "useDefaultSymbol" in renderer
        else None,
        is_default_symbol_visible=renderer.get("isDefaultSymbolVisible")
        if "isDefaultSymbolVisible" in renderer
        else None,
    )

    if renderer_type == "CIMUniqueValueRenderer":
        groups = renderer.get("groups", [])
        fields = renderer.get("fields", [])

        if groups and fields:
            style.renderer = "uniqueValue"
            style.unique_values = {"field": fields[0], "classes": []}

            for group in groups:
                for cls in group.get("classes", []):
                    # Extract the attribute value for this class
                    values = cls.get("values", [])
                    if not values:
                        continue

                    # Usually take the first value from the first entry
                    val_obj = values[0]
                    field_values = val_obj.get("fieldValues", [])
                    if not field_values:
                        continue

                    value = field_values[0]

                    # Extract the style for this class
                    symbol_ref = cls.get("symbol", {})
                    actual_symbol = symbol_ref.get("symbol", {}) if symbol_ref else {}
                    all_layers = extract_symbol_layers_recursive(actual_symbol)

                    class_style = extract_simplified_style(all_layers)
                    class_advanced_symbol = _build_advanced_symbol_from_layers(
                        all_layers
                    )

                    class_entry = {
                        "value": value,
                        "label": cls.get("label", ""),
                        "style": class_style,
                        "advancedSymbol": class_advanced_symbol or None,
                    }
                    display_label = _POLYGON_DISPLAY_LABELS.get(str(value))
                    if display_label is not None:
                        class_entry["displayLabel"] = display_label
                    style.unique_values["classes"].append(class_entry)

            # If we didn't find any classes, default to simple renderer
            if not style.unique_values["classes"]:
                style.renderer = "simple"

    # Try to extract a default style from the renderer if available
    default_symbol_ref = renderer.get("defaultSymbol", {})
    if default_symbol_ref:
        default_symbol = default_symbol_ref.get("symbol", {})
        all_layers = extract_symbol_layers_recursive(default_symbol)
        style.default_style = extract_simplified_style(all_layers)
        style.full_symbol_layers = all_layers
        style.advanced_symbol = _build_advanced_symbol_from_layers(all_layers) or None
    elif renderer_type == "CIMSimpleRenderer":
        symbol_ref = renderer.get("symbol", {})
        actual_symbol = symbol_ref.get("symbol", {}) if symbol_ref else {}
        all_layers = extract_symbol_layers_recursive(actual_symbol)
        style.full_symbol_layers = all_layers
        style.default_style = extract_simplified_style(all_layers)
        style.advanced_symbol = _build_advanced_symbol_from_layers(all_layers) or None
    elif renderer_type == "CIMClassBreaksRenderer":
        style.renderer = "classBreaks"
        all_layers = _iter_renderer_gradient_strokes(renderer)
        if not all_layers:
            breaks = renderer.get("breaks") or []
            if breaks and isinstance(breaks[0], dict):
                break_ref = breaks[0].get("symbol", {}) or {}
                actual_symbol = break_ref.get("symbol", {}) if break_ref else {}
                all_layers = extract_symbol_layers_recursive(actual_symbol)
        style.full_symbol_layers = all_layers
        style.default_style = extract_simplified_style(all_layers)
        style.advanced_symbol = _build_advanced_symbol_from_layers(all_layers) or None

    if _first_gradient_stroke(renderer if isinstance(renderer, dict) else {}):
        across = parse_acrossline_from_lyrx(lyrx_data)
        style.advanced_symbol = {"symbolLayers": [across]}
        gradient_layers = _iter_renderer_gradient_strokes(renderer)
        if gradient_layers:
            style.full_symbol_layers = gradient_layers
        style.default_style = {
            "fillColor": across["fromColor"],
            "fillOpacity": across["opacity"],
            "strokeColor": across["fromColor"],
            "strokeWidth": across["widthPt"] * PT_TO_PX,
        }
        if renderer_type == "CIMClassBreaksRenderer":
            style.renderer = "classBreaks"

    # For polygon layers, align advanced_symbol strokes with the simplified
    # default_style when CIM-only information would otherwise drop the outline.
    _ensure_advanced_stroke_for_polygons(style)

    if not style.default_style:
        # Absolute fallback
        style.default_style = {
            "fillColor": "#808080",
            "fillOpacity": 0.7,
            "strokeColor": "#000000",
            "strokeWidth": 1.0,
        }

    # Determine complexity = simple | advanced
    complexity = "simple"

    # Check complexity from default symbol layers (if any)
    default_layers = style.full_symbol_layers or []
    if default_layers:
        comp = _analyze_cim_complexity(default_layers)
        if (
            comp["multipleHatches"]
            or comp["multipleStrokes"]
            or comp["markerAlongLine"]
            or comp["unsupportedTypes"]
            or any(L.get("type") == "CIMHatchFill" for L in default_layers)
            or any(L.get("type") == "CIMGradientStroke" for L in default_layers)
        ):
            complexity = "advanced"

    advanced = style.advanced_symbol if isinstance(style.advanced_symbol, dict) else {}
    if any(
        isinstance(layer, dict) and layer.get("type") == "acrossLine"
        for layer in (advanced.get("symbolLayers") or [])
    ):
        complexity = "advanced"

    # For unique value renderers, if any class has hatch/dash or complex symbol stack,
    # escalate to advanced.
    if style.renderer == "uniqueValue" and style.unique_values:
        for cls in style.unique_values.get("classes", []):
            cls_style = cls.get("style", {})
            cls_layers = cls.get("fullSymbolLayers", [])
            if cls_style.get("hatch") or cls_style.get("dashArray"):
                complexity = "advanced"
                break
            if cls_layers:
                comp = _analyze_cim_complexity(cls_layers)
                if (
                    comp["multipleHatches"]
                    or comp["multipleStrokes"]
                    or comp["markerAlongLine"]
                    or comp["unsupportedTypes"]
                    or any(L.get("type") == "CIMHatchFill" for L in cls_layers)
                ):
                    complexity = "advanced"
                    break

    style.complexity = complexity

    _finalize_people_names_style(style, lyrx_path)

    return style
