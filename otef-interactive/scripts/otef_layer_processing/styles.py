import json
import re
import logging
from pathlib import Path
from typing import Dict, List, Optional, Tuple, Any
from .models import StyleConfig

logger = logging.getLogger(__name__)

logger = logging.getLogger(__name__)

# Conversion factor from Points (ArcGIS) to CSS Pixels (Web)
# 1pt = 1/72 inch, 1px = 1/96 inch -> 96/72 = 1.333
PT_TO_PX = 96 / 72


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


def extract_simplified_style(symbol_layers: List[Dict]) -> Dict:
    fill_color = None
    fill_opacity = 1.0
    stroke_color = None
    stroke_width = 1.0
    style = {}

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
            color = layer.get("color", {}).get("values", [0, 0, 0, 100])
            if len(color) >= 3:
                r = normalize_color_channel(color[0])
                g = normalize_color_channel(color[1])
                b = normalize_color_channel(color[2])
                fill_color = f"#{r:02x}{g:02x}{b:02x}"
                fill_opacity = normalize_opacity(color[3]) if len(color) > 3 else 1.0

        if layer_type == "CIMSolidStroke" and stroke_color is None:
            color = layer.get("color", {}).get("values", [0, 0, 0, 100])
            if len(color) >= 3:
                r = normalize_color_channel(color[0])
                g = normalize_color_channel(color[1])
                b = normalize_color_channel(color[2])
                stroke_color = f"#{r:02x}{g:02x}{b:02x}"
                stroke_width = layer.get("width", 1.0) * PT_TO_PX  # Scale line width

            # Check for dashed effects
            effects = layer.get("effects", [])
            for effect in effects:
                if effect.get("type") == "CIMGeometricEffectDashes":
                    style["dashArray"] = effect.get("dashTemplate", [])
                    break

        # Priority 2: Hatch Fill (capture it always, but only set fill_color fallback if still None)
        if layer_type == "CIMHatchFill" and "hatch" not in style:
            line_symbol = layer.get("lineSymbol", {})
            if line_symbol:
                line_layers = extract_symbol_layers_recursive(line_symbol)
                for l_layer in line_layers:
                    if l_layer.get("type") == "CIMSolidStroke":
                        color = l_layer.get("color", {}).get("values", [0, 0, 0, 100])
                        if len(color) >= 3:
                            r = normalize_color_channel(color[0])
                            g = normalize_color_channel(color[1])
                            b = normalize_color_channel(color[2])
                            h_color = f"#{r:02x}{g:02x}{b:02x}"
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
    supported = {"CIMSolidFill", "CIMSolidStroke", "CIMHatchFill", "CIMVectorMarker"}
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

    for layer in symbol_layers:
        if not layer.get("enable", True):
            continue

        ltype = layer.get("type", "")

        if ltype == "CIMSolidFill":
            color = layer.get("color", {}).get("values", [0, 0, 0, 100])
            if len(color) >= 3:
                r = normalize_color_channel(color[0])
                g = normalize_color_channel(color[1])
                b = normalize_color_channel(color[2])
                fill_color = f"#{r:02x}{g:02x}{b:02x}"
                opacity = normalize_opacity(color[3]) if len(color) > 3 else 1.0
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
                        color = n.get("color", {}).get("values", [0, 0, 0, 100])
                        if len(color) >= 3:
                            r = normalize_color_channel(color[0])
                            g = normalize_color_channel(color[1])
                            b = normalize_color_channel(color[2])
                            hatch_color = f"#{r:02x}{g:02x}{b:02x}"
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
            color = layer.get("color", {}).get("values", [0, 0, 0, 100])
            if len(color) >= 3:
                r = normalize_color_channel(color[0])
                g = normalize_color_channel(color[1])
                b = normalize_color_channel(color[2])
                stroke_color = f"#{r:02x}{g:02x}{b:02x}"
                opacity = normalize_opacity(color[3]) if len(color) > 3 else 1.0
                width = layer.get("width", 1.0) * PT_TO_PX

                dash_array = None
                effects = layer.get("effects", [])
                for effect in effects:
                    if effect.get("type") == "CIMGeometricEffectDashes":
                        dash_array = effect.get("dashTemplate", [])
                        break

                symbol_layers_ir.append(
                    {
                        "type": "stroke",
                        "color": stroke_color,
                        "width": width,
                        "opacity": opacity,
                        "dash": {"array": dash_array} if dash_array else None,
                    }
                )

        elif ltype == "CIMVectorMarker":
            size = layer.get("size", 6) * PT_TO_PX
            placement = layer.get("markerPlacement")

            # Derive marker colors and outline from nested markerGraphics symbol, if present.
            marker_fill = None
            marker_stroke = None
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
                        color_vals = nlayer.get("color", {}).get(
                            "values", [0, 0, 0, 100]
                        )
                        if len(color_vals) >= 3:
                            r = normalize_color_channel(color_vals[0])
                            g = normalize_color_channel(color_vals[1])
                            b = normalize_color_channel(color_vals[2])
                            marker_fill = f"#{r:02x}{g:02x}{b:02x}"
                    elif ntype == "CIMSolidStroke" and marker_stroke is None:
                        color_vals = nlayer.get("color", {}).get(
                            "values", [0, 0, 0, 100]
                        )
                        if len(color_vals) >= 3:
                            r = normalize_color_channel(color_vals[0])
                            g = normalize_color_channel(color_vals[1])
                            b = normalize_color_channel(color_vals[2])
                            marker_stroke = f"#{r:02x}{g:02x}{b:02x}"
                        marker_stroke_width = nlayer.get("width", 1.0) * PT_TO_PX

            marker_entry: Dict[str, Any] = {
                "marker": {
                    "shape": inferred_shape,
                    "size": size,
                }
            }
            if marker_fill:
                marker_entry["marker"]["fillColor"] = marker_fill
            if marker_stroke:
                marker_entry["marker"]["strokeColor"] = marker_stroke
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
        label_config = {
            "field": label_class.get("expression", "").replace("$feature.", ""),
            "font": text_symbol.get("fontFamilyName", "Arial"),
            "size": text_symbol.get("height", 10),
        }

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

                    style.unique_values["classes"].append(
                        {
                            "value": value,
                            "label": cls.get("label", ""),
                            "style": class_style,
                            "fullSymbolLayers": all_layers,
                            "advancedSymbol": class_advanced_symbol or None,
                        }
                    )

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

    return style
