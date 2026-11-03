"""Offline geometry for the supported ArcGIS buffered polygon gradients."""

from __future__ import annotations

import json
import math
import os
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

from pyproj import Transformer
from shapely import make_valid
from shapely.geometry import GeometryCollection, MultiPolygon, Polygon, mapping, shape
from shapely.ops import transform, unary_union


BAND_PROPERTY = "__cim_gradient_band"
SOURCE_OBJECT_PROPERTY = "__cim_source_object_id"
SOURCE_CRS = "EPSG:4326"
WORK_CRS = "EPSG:2039"
BUFFER_QUAD_SEGS = 8
MAX_SEARCH_ITERATIONS = 32
DEPTH_STOP_METRES = 0.01
MIN_AREA_SQUARE_METRES = 0.01
RELATIVE_GRADIENT_SIZE = 75.0


def _polygon_parts(geometry: Any) -> List[Polygon]:
    """Repair a geometry and return only its polygonal parts."""

    if geometry is None or getattr(geometry, "is_empty", True):
        return []
    repaired = make_valid(geometry)
    if isinstance(repaired, Polygon):
        return [repaired] if not repaired.is_empty and repaired.area > 0 else []
    if isinstance(repaired, MultiPolygon):
        return [part for part in repaired.geoms if not part.is_empty and part.area > 0]
    if isinstance(repaired, GeometryCollection):
        parts: List[Polygon] = []
        for child in repaired.geoms:
            parts.extend(_polygon_parts(child))
        return parts
    return []


def _polygonal_geometry(geometry: Any) -> Optional[Any]:
    parts = _polygon_parts(geometry)
    if not parts:
        return None
    result = make_valid(unary_union(parts))
    result_parts = _polygon_parts(result)
    if not result_parts:
        return None
    return make_valid(unary_union(result_parts))


def _gradient_by_value(style: Dict[str, Any]) -> Tuple[Optional[str], Dict[str, Dict[str, Any]]]:
    unique = style.get("uniqueValues") if isinstance(style, dict) else None
    if not isinstance(unique, dict):
        return None, {}
    field = unique.get("field")
    gradients: Dict[str, Dict[str, Any]] = {}
    for cls in unique.get("classes") or []:
        if not isinstance(cls, dict):
            continue
        symbol = cls.get("symbol") or {}
        for layer in symbol.get("symbolLayers") or []:
            if not isinstance(layer, dict):
                continue
            if (
                layer.get("type") == "fill"
                and layer.get("fillType") == "gradient"
                and layer.get("gradientMethod") == "Buffered"
                and layer.get("gradientType") == "Discrete"
                and layer.get("gradientSizeUnits") == "Relative"
            ):
                gradients[str(cls.get("value"))] = layer
                break
    return field, gradients


def _known_renderer_values(style: Dict[str, Any]) -> set[str]:
    unique = style.get("uniqueValues") if isinstance(style, dict) else None
    if not isinstance(unique, dict):
        return set()
    return {
        str(cls.get("value"))
        for cls in unique.get("classes") or []
        if isinstance(cls, dict) and cls.get("value") is not None
    }


def has_buffered_gradient(style: Dict[str, Any]) -> bool:
    return bool(_gradient_by_value(style)[1])


def _round_coordinates(value: Any) -> Any:
    if isinstance(value, (tuple, list)):
        return [_round_coordinates(child) for child in value]
    if isinstance(value, (int, float)):
        rounded = round(float(value), 7)
        return 0.0 if rounded == 0 else rounded
    return value


def _buffered_inset(polygon: Polygon, depth: float) -> Optional[Any]:
    candidate = polygon.buffer(
        -depth,
        quad_segs=BUFFER_QUAD_SEGS,
        join_style="round",
    )
    return _polygonal_geometry(candidate)


def _surviving_inset(
    polygon: Polygon,
    depth: float,
    area_threshold: float,
) -> Optional[Any]:
    candidate = _buffered_inset(polygon, depth)
    if candidate is None or candidate.is_empty or candidate.area <= area_threshold:
        return None
    return candidate


def _maximum_inset_distance(polygon: Polygon) -> float:
    """Find the largest surviving negative-buffer depth with bounded bisection."""

    source_area = float(polygon.area)
    threshold = max(MIN_AREA_SQUARE_METRES, source_area * 1e-8)
    min_x, min_y, max_x, max_y = polygon.bounds
    high = math.hypot(max_x - min_x, max_y - min_y)
    if high <= 0 or _surviving_inset(polygon, 0.0, threshold) is None:
        return 0.0
    low = 0.0
    for _ in range(MAX_SEARCH_ITERATIONS):
        if high - low <= DEPTH_STOP_METRES:
            break
        middle = (low + high) / 2.0
        if _surviving_inset(polygon, middle, threshold) is None:
            high = middle
        else:
            low = middle
    return low


def _band_geometries(
    polygon: Polygon,
    interval: int,
    relative_size: float,
) -> List[Optional[Any]]:
    """Return bands by authored ordinal, from outside to inside."""

    if interval <= 0:
        return []
    source = _polygonal_geometry(polygon)
    if source is None:
        return [None] * interval
    parts = _polygon_parts(source)
    if len(parts) != 1:
        # Components are passed separately by the feature-collection builder.
        source = parts[0]
    depth = _maximum_inset_distance(source)
    if depth <= DEPTH_STOP_METRES or interval == 1:
        return [None] * (interval - 1) + [source]

    relative = max(0.0, min(100.0, float(relative_size))) / 100.0
    span = depth * relative
    threshold = max(MIN_AREA_SQUARE_METRES, source.area * 1e-8)
    nested: List[Any] = [source]
    for ordinal in range(1, interval):
        boundary_depth = span * ordinal / interval
        inner = _surviving_inset(source, boundary_depth, threshold)
        if inner is None:
            return [None] * (interval - 1) + [source]
        nested.append(inner)

    bands: List[Optional[Any]] = []
    for outer, inner in zip(nested, nested[1:]):
        ring = _polygonal_geometry(make_valid(outer.difference(inner)))
        bands.append(ring if ring is not None and not ring.is_empty else None)
    bands.append(nested[-1])
    return bands


def _source_object_id(feature: Dict[str, Any], properties: Dict[str, Any], index: int) -> Any:
    if feature.get("id") is not None:
        return feature["id"]
    if properties.get("OBJECTID") is not None:
        return properties["OBJECTID"]
    return index


def _feature_with_geometry(
    source_feature: Dict[str, Any],
    properties: Dict[str, Any],
    geometry: Any,
    reverse: Any,
) -> Dict[str, Any]:
    result = dict(source_feature)
    result["properties"] = properties
    wgs84 = transform(reverse, make_valid(geometry))
    geojson = mapping(wgs84)
    geojson["coordinates"] = _round_coordinates(geojson["coordinates"])
    result["geometry"] = geojson
    return result


def build_buffered_gradient_feature_collection(
    source: Dict[str, Any],
    style: Dict[str, Any],
) -> Dict[str, Any]:
    field, gradients = _gradient_by_value(style)
    if not field or not gradients:
        raise ValueError("Style has no supported buffered gradient classes")
    known_values = _known_renderer_values(style)

    forward = Transformer.from_crs(SOURCE_CRS, WORK_CRS, always_xy=True).transform
    reverse = Transformer.from_crs(WORK_CRS, SOURCE_CRS, always_xy=True).transform
    output: List[Dict[str, Any]] = []
    for index, feature in enumerate(source.get("features") or []):
        geometry_data = feature.get("geometry") or {}
        if not geometry_data:
            continue
        properties = dict(feature.get("properties") or {})
        object_id = _source_object_id(feature, properties, index)
        properties[SOURCE_OBJECT_PROPERTY] = object_id
        gradient = gradients.get(str(properties.get(field)))
        if gradient is None:
            # The processed renderer hides its default symbol. Only authored
            # classes belong in the sidecar; unknown Notes values must not
            # become accidentally visible through a copied source geometry.
            if str(properties.get(field)) not in known_values:
                continue
            unchanged = dict(properties)
            unchanged[BAND_PROPERTY] = 0
            output.append(
                _feature_with_geometry(
                    feature,
                    unchanged,
                    transform(forward, shape(geometry_data)),
                    reverse,
                )
            )
            continue

        interval = int(gradient.get("interval") or 0)
        relative_size = RELATIVE_GRADIENT_SIZE
        projected = transform(forward, shape(geometry_data))
        components = _polygon_parts(projected)
        if not components:
            continue
        bands_by_ordinal: List[List[Any]] = [[] for _ in range(interval)]
        for component in components:
            for ordinal, band in enumerate(_band_geometries(component, interval, relative_size)):
                if band is not None and not band.is_empty:
                    bands_by_ordinal[ordinal].append(band)
        for ordinal, component_bands in enumerate(bands_by_ordinal):
            if not component_bands:
                continue
            geometry = _polygonal_geometry(unary_union(component_bands))
            if geometry is None or geometry.is_empty:
                continue
            band_properties = dict(properties)
            band_properties[BAND_PROPERTY] = ordinal
            output.append(_feature_with_geometry(feature, band_properties, geometry, reverse))
    return {"type": "FeatureCollection", "features": output}


def write_buffered_gradient_geojson(
    source_path: Path,
    style: Dict[str, Any],
    output_path: Path,
) -> bool:
    """Write a gradient sidecar atomically; leave an existing output untouched on failure."""

    if not has_buffered_gradient(style):
        return False
    source = json.loads(Path(source_path).read_text(encoding="utf-8"))
    result = build_buffered_gradient_feature_collection(source, style)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    temporary = output_path.with_name(output_path.name + ".tmp")
    try:
        temporary.write_text(
            json.dumps(result, ensure_ascii=False, separators=(",", ":")),
            encoding="utf-8",
        )
        os.replace(temporary, output_path)
    finally:
        if temporary.exists():
            temporary.unlink()
    return True
