import json
from dataclasses import dataclass
from pathlib import Path
from typing import Any


@dataclass(frozen=True)
class LayerStats:
    size_bytes: int
    feature_count: int
    coordinate_count: int
    property_bytes: int
    geometry_family: str


def _load_geojson(path: Path) -> dict[str, Any]:
    try:
        raw_text = path.read_text(encoding="utf-8")
    except OSError as exc:
        raise ValueError(f"Unable to read GeoJSON file: {path}") from exc

    if not raw_text.strip():
        raise ValueError(f"GeoJSON file is empty: {path}")

    try:
        data = json.loads(raw_text)
    except json.JSONDecodeError as exc:
        raise ValueError(f"GeoJSON file is malformed: {path}") from exc

    if not isinstance(data, dict) or data.get("type") != "FeatureCollection":
        raise ValueError(
            f"Unsupported GeoJSON root type in {path}: expected FeatureCollection"
        )

    features = data.get("features")
    if not isinstance(features, list):
        raise ValueError(f"GeoJSON FeatureCollection is missing a valid features list: {path}")

    return data


def _geometry_family_for_type(geometry_type: str | None) -> str | None:
    mapping = {
        "Point": "point",
        "MultiPoint": "point",
        "LineString": "line",
        "MultiLineString": "line",
        "Polygon": "polygon",
        "MultiPolygon": "polygon",
    }
    if geometry_type in mapping:
        return mapping[geometry_type]
    return None


def _count_coordinates(coordinates: Any) -> int:
    if not isinstance(coordinates, list):
        raise ValueError("Invalid GeoJSON coordinates structure")
    if not coordinates:
        return 0
    if all(not isinstance(value, list) for value in coordinates):
        return 1
    return sum(_count_coordinates(value) for value in coordinates)


def _geometry_coordinate_count(geometry: dict[str, Any] | None) -> int:
    if geometry is None:
        return 0
    if not isinstance(geometry, dict):
        raise ValueError("Feature geometry must be an object or null")

    geometry_type = geometry.get("type")
    if geometry_type == "GeometryCollection":
        geometries = geometry.get("geometries")
        if not isinstance(geometries, list):
            raise ValueError("GeometryCollection must contain a geometries list")
        return sum(_geometry_coordinate_count(item) for item in geometries)

    family = _geometry_family_for_type(geometry_type)
    if family is None:
        raise ValueError(f"Unsupported GeoJSON geometry type: {geometry_type}")

    return _count_coordinates(geometry.get("coordinates"))


def _collect_geometry_families(geometry: dict[str, Any] | None) -> set[str]:
    if geometry is None:
        return set()
    if not isinstance(geometry, dict):
        raise ValueError("Feature geometry must be an object or null")

    geometry_type = geometry.get("type")
    if geometry_type == "GeometryCollection":
        geometries = geometry.get("geometries")
        if not isinstance(geometries, list):
            raise ValueError("GeometryCollection must contain a geometries list")
        families: set[str] = set()
        for item in geometries:
            families.update(_collect_geometry_families(item))
        return families

    family = _geometry_family_for_type(geometry_type)
    if family is None:
        raise ValueError(f"Unsupported GeoJSON geometry type: {geometry_type}")
    return {family}


def _geometry_family_from_features(features: list[Any]) -> str:
    families = set()
    for feature in features:
        if not isinstance(feature, dict) or feature.get("type") != "Feature":
            raise ValueError("FeatureCollection must contain only Feature objects")
        families.update(_collect_geometry_families(feature.get("geometry")))

    if not families:
        raise ValueError("GeoJSON FeatureCollection has no supported geometries")
    if len(families) == 1:
        return next(iter(families))
    return "mixed"


def collect_geojson_stats(path: Path) -> LayerStats:
    data = _load_geojson(path)
    features = data["features"]

    coordinate_count = 0
    property_bytes = 0
    for feature in features:
        if not isinstance(feature, dict) or feature.get("type") != "Feature":
            raise ValueError("FeatureCollection must contain only Feature objects")
        coordinate_count += _geometry_coordinate_count(feature.get("geometry"))
        properties = feature.get("properties")
        if properties is None:
            properties = {}
        if not isinstance(properties, dict):
            raise ValueError("Feature properties must be an object or null")
        property_bytes += len(
            json.dumps(properties, ensure_ascii=False, separators=(",", ":")).encode(
                "utf-8"
            )
        )

    return LayerStats(
        size_bytes=path.stat().st_size,
        feature_count=len(features),
        coordinate_count=coordinate_count,
        property_bytes=property_bytes,
        geometry_family=_geometry_family_from_features(features),
    )
