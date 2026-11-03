"""Normalize OTEF calibration payload for single-file persistence."""

import json
import os


def _is_numeric(x):
    return isinstance(x, (int, float)) and not isinstance(x, bool)


def _valid_point(pt):
    if not isinstance(pt, dict):
        return False
    x, y = pt.get("x"), pt.get("y")
    return _is_numeric(x) and _is_numeric(y)


def _filter_valid_vertices(vertices):
    out = []
    for pt in vertices or []:
        if _valid_point(pt):
            out.append({"x": float(pt["x"]), "y": float(pt["y"])})
    return out


def _synthesize_polygon(west, east, south, north):
    """Axis-aligned rectangle: SW, SE, NE, NW."""
    return [
        {"x": float(west), "y": float(south)},
        {"x": float(east), "y": float(south)},
        {"x": float(east), "y": float(north)},
        {"x": float(west), "y": float(north)},
    ]


def normalize_calibration_payload(payload):
    """
    Normalize calibration payload for single-file persistence.
    Preserves west, east, south, north (floats) when present.
    Uses bounds_polygon or fallback to polygon; validates/drops invalid vertices.
    Synthesizes axis-aligned polygon from bbox when polygon is missing.
    """
    if not isinstance(payload, dict):
        payload = {}

    result = {}
    # Bounds (only when present)
    for key in ("west", "east", "south", "north"):
        if key in payload and _is_numeric(payload[key]):
            result[key] = float(payload[key])

    # Polygon: prefer bounds_polygon, fallback to polygon
    raw_poly = payload.get("bounds_polygon") or payload.get("polygon")
    if raw_poly is not None and len(raw_poly) > 0:
        result["bounds_polygon"] = _filter_valid_vertices(raw_poly)
    elif all(k in result for k in ("west", "east", "south", "north")):
        result["bounds_polygon"] = _synthesize_polygon(
            result["west"], result["east"], result["south"], result["north"]
        )
    else:
        result["bounds_polygon"] = []

    raw_angle = payload.get("viewer_angle_deg", 0.0)
    if _is_numeric(raw_angle):
        result["viewer_angle_deg"] = float(raw_angle)
    else:
        result["viewer_angle_deg"] = 0.0
    return result


def write_model_bounds_to_storage(normalized_payload, config, file_path):
    """
    Write normalized calibration to OTEFModelConfig.model_bounds and to
    model-bounds.json on disk. Merges into existing data so keys like
    west/east/south/north/crs are preserved. Uses canonical keys
    (bounds_polygon, viewer_angle_deg); adds "polygon" alias in the file
    for backward compatibility.
    """
    if config is not None:
        existing = dict(config.model_bounds or {})
        existing.update(normalized_payload)
        config.model_bounds = existing
        config.save()

    if not file_path or not isinstance(file_path, str):
        return
    try:
        if os.path.exists(file_path):
            with open(file_path, "r", encoding="utf-8") as f:
                file_data = json.load(f)
        else:
            file_data = {}
        file_data.update(normalized_payload)
        file_data["polygon"] = file_data.get("bounds_polygon", [])
        os.makedirs(os.path.dirname(file_path), exist_ok=True)
        with open(file_path, "w", encoding="utf-8") as f:
            json.dump(file_data, f, indent=2, ensure_ascii=False)
    except Exception as e:
        print(f"Warning: failed to update model-bounds.json: {e}")
