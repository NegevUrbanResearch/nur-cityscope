import json
import re
import logging
from pathlib import Path
from typing import Dict, List, Optional, Tuple
from .models import StyleConfig

logger = logging.getLogger(__name__)

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
            style["radius"] = size  # Use size directly as radius for better visibility

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
                stroke_width = layer.get("width", 1.0)

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
                            }
                            # Only set fallback if no solid fill found YET
                            break

    # Final pass to ensure fallback fill_color if we only have a hatch
    if fill_color is None and "hatch" in style:
        fill_color = style["hatch"]["color"]
        fill_opacity = 0.5

    style.update({
        "fillColor": fill_color or "#808080",
        "fillOpacity": fill_opacity,
        "strokeColor": stroke_color or "#000000",
        "strokeWidth": stroke_width,
    })
    # Ensure radius is preserved if found
    if "radius" not in style:
        style["radius"] = 5  # Default
    return style

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
            style.unique_values = {
                "field": fields[0],
                "classes": []
            }

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

                    style.unique_values["classes"].append({
                        "value": value,
                        "label": cls.get("label", ""),
                        "style": extract_simplified_style(all_layers),
                        "fullSymbolLayers": all_layers,
                    })

            # If we didn't find any classes, default to simple renderer
            if not style.unique_values["classes"]:
                style.renderer = "simple"

    # Try to extract a default style from the renderer if available
    default_symbol_ref = renderer.get("defaultSymbol", {})
    if default_symbol_ref:
        default_symbol = default_symbol_ref.get("symbol", {})
        all_layers = extract_symbol_layers_recursive(default_symbol)
        style.default_style = extract_simplified_style(all_layers)
    elif renderer_type == "CIMSimpleRenderer":
        symbol_ref = renderer.get("symbol", {})
        actual_symbol = symbol_ref.get("symbol", {}) if symbol_ref else {}
        all_layers = extract_symbol_layers_recursive(actual_symbol)
        style.full_symbol_layers = all_layers
        style.default_style = extract_simplified_style(all_layers)

    if not style.default_style:
        # Absolute fallback
        style.default_style = {
            "fillColor": "#808080",
            "fillOpacity": 0.7,
            "strokeColor": "#000000",
            "strokeWidth": 1.0
        }

    return style
