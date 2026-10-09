"""Validation for the reviewed, deterministic NLI route curation recipe."""
from __future__ import annotations

import copy
import hashlib
import json
import math
from typing import Any

from pyproj import Transformer
from shapely.geometry import LineString, Point, shape
from shapely.ops import nearest_points, transform, unary_union

EXPECTED_NEW_PARENTS = {1013: 23, 1014: 29, 1015: 40, 1016: 42, 1017: 44, 1018: 51, 1019: 61, 1020: 30, 1021: 32}
EXPECTED_EXISTING = {1001: (64, "trim_first_crossing"), 1002: (66, "trim_first_crossing"), 1005: (59, "trim_first_crossing"), 1006: (57, "trim_first_crossing"), 1008: (7, "trim_first_crossing"), 1009: (1, "trim_first_crossing"), 1010: (10, "trim_first_crossing"), 1011: (43, "extend_origin_direction"), 1012: (34, "extend_origin_direction")}
EXPECTED_BASE_IDS = set(range(1, 69)) | set(range(1001, 1013))
EXPECTED_UNCONFIRMED_IDS = set(range(1001, 1013))
EXPECTED_OPERATION_DIRECTIONS = {fid: "forward" for fid in set(EXPECTED_NEW_PARENTS) | set(EXPECTED_EXISTING)}
EXPECTED_ROAD_SHA256 = "db6a72f9b5361089f75564de8a198cf5df2514023588aacb5d6dbe0a6ed1a8af"
EXPECTED_CRS = "+proj=tmerc +lat_0=31.73439361111111 +lon_0=35.20451694444445 +k=1.0000067 +x_0=219529.584 +y_0=626907.39 +ellps=GRS80 +towgs84=-48,55,52,0,0,0,0 +units=m +no_defs"
EXPECTED_ROAD_FEATURE_SHA256 = "c5fe1b8ac6274a2f260f6d5fc119a6444035db23e091cfd2320ce33a49b58a9d"


def _feature_id(feature: dict[str, Any]) -> int:
    props = feature.get("properties")
    if not isinstance(props, dict) or "OBJECTID" not in props:
        raise ValueError("feature is missing OBJECTID")
    try:
        return int(props["OBJECTID"])
    except (TypeError, ValueError) as exc:
        raise ValueError("feature OBJECTID must be an integer") from exc


def _validate_collection(collection: dict[str, Any], count: int | None = None) -> dict[int, dict[str, Any]]:
    if not isinstance(collection, dict) or collection.get("type") != "FeatureCollection" or not isinstance(collection.get("features"), list):
        raise ValueError("expected a GeoJSON FeatureCollection")
    if count is not None and len(collection["features"]) != count:
        raise ValueError(f"expected {count} baseline features")
    indexed: dict[int, dict[str, Any]] = {}
    for feature in collection["features"]:
        if not isinstance(feature, dict) or feature.get("type") != "Feature":
            raise ValueError("invalid GeoJSON feature")
        fid = _feature_id(feature)
        if fid in indexed:
            raise ValueError(f"duplicate feature ID {fid}")
        geometry = feature.get("geometry")
        if not isinstance(geometry, dict) or geometry.get("type") not in {"LineString", "MultiLineString"}:
            raise ValueError(f"unsupported geometry for feature {fid}")
        indexed[fid] = feature
    return indexed


def validate_recipe(recipe: dict) -> None:
    if not isinstance(recipe, dict) or recipe.get("schema_version") != 1:
        raise ValueError("recipe schema_version must be 1")
    if recipe.get("base_feature_count") != 80:
        raise ValueError("recipe must pin the 80-feature baseline")
    if recipe.get("construction_crs") != EXPECTED_CRS or recipe.get("output_crs") != "EPSG:4326":
        raise ValueError("recipe construction/output CRS does not match reviewed CRS")
    directions = recipe.get("confirmed_directions")
    if not isinstance(directions, dict) or len(directions) != 68 or any(v not in {"forward", "reverse"} for v in directions.values()):
        raise ValueError("recipe must pin directions for all 68 confirmed features")
    if directions.get("4") != "reverse" or directions.get("16") != "reverse":
        raise ValueError("reviewed reverse directions for #4 and #16 must be preserved")
    if any(v != "forward" for k, v in directions.items() if k not in {"4", "16"}):
        raise ValueError("unexpected confirmed route direction")
    operations = recipe.get("operations")
    if not isinstance(operations, list) or len(operations) != 18:
        raise ValueError("recipe must contain exactly 18 accepted operations")
    ids = [op.get("feature_id") for op in operations if isinstance(op, dict)]
    if len(ids) != 18 or len(set(ids)) != 18 or set(ids) != set(EXPECTED_NEW_PARENTS) | set(EXPECTED_EXISTING):
        raise ValueError("recipe operation IDs do not match the accepted stable IDs")
    by_id = {op["feature_id"]: op for op in operations}
    for fid, parent in EXPECTED_NEW_PARENTS.items():
        op = by_id[fid]
        expected_shape = "road_polyline" if parent == 32 else "origin_direction"
        if op.get("kind") != "new_approach" or op.get("parent_id") != parent or op.get("shape") != expected_shape:
            raise ValueError(f"new approach {fid} does not match reviewed parent/shape")
    for fid, (parent, kind) in EXPECTED_EXISTING.items():
        if by_id[fid].get("kind") != kind or by_id[fid].get("parent_id") != parent:
            raise ValueError(f"existing feature operation {fid} has wrong parent or kind")
    for op in operations:
        if op.get("direction") != EXPECTED_OPERATION_DIRECTIONS[op["feature_id"]] or not isinstance(op.get("source_feature_sha256"), str) or len(op["source_feature_sha256"]) != 64:
            raise ValueError("each operation must preserve its reviewed direction and source feature SHA-256")
    road = recipe.get("road_operation")
    if not isinstance(road, dict) or set(road) != {"sha256", "feature_fid", "road_num", "start_vertex", "direction"} or road.get("feature_fid") != 0 or road.get("road_num") != "4" or road.get("start_vertex") != 0 or road.get("direction") != "forward" or road.get("sha256") != EXPECTED_ROAD_SHA256:
        raise ValueError("road operation must pin reviewed road 4 identity and direction")


def validate_base_pair(source: dict, runtime: dict, recipe: dict) -> dict:
    validate_recipe(recipe)
    source_by_id = _validate_collection(source, recipe["base_feature_count"])
    runtime_by_id = _validate_collection(runtime, recipe["base_feature_count"])
    if set(source_by_id) != set(runtime_by_id):
        raise ValueError("source/runtime feature identities differ")
    if set(source_by_id) != EXPECTED_BASE_IDS:
        raise ValueError("baseline feature IDs must be confirmed 1-68 and unconfirmed 1001-1012")
    confirmed_ids = EXPECTED_BASE_IDS - EXPECTED_UNCONFIRMED_IDS
    for collection_name, indexed in (("source", source_by_id), ("runtime", runtime_by_id)):
        for fid, feature in indexed.items():
            props = feature["properties"]
            classified_unconfirmed = props.get("route_confidence") == "unconfirmed"
            if (fid in EXPECTED_UNCONFIRMED_IDS) != classified_unconfirmed:
                raise ValueError(f"{collection_name} feature {fid} has incorrect confidence classification")
    for op in recipe["operations"]:
        target_id = op["feature_id"]
        parent_id = op["parent_id"]
        if op["kind"] == "new_approach":
            if target_id in source_by_id or parent_id not in confirmed_ids:
                raise ValueError(f"new approach {target_id} has missing or invalid confirmed parent {parent_id}")
        elif target_id not in source_by_id or parent_id not in source_by_id:
            raise ValueError(f"operation {target_id} target or parent is absent from the baseline")
    directions = recipe["confirmed_directions"]
    normalized = copy.deepcopy(source)
    normalized_by_id = { _feature_id(f): f for f in normalized["features"] }
    for fid, sf in source_by_id.items():
        rf = runtime_by_id[fid]
        sp = sf.get("properties", {})
        rp = rf.get("properties", {})
        is_unconfirmed = sp.get("route_confidence") == "unconfirmed" or rp.get("route_confidence") == "unconfirmed"
        direction = directions.get(str(fid))
        if is_unconfirmed:
            direction = rp.get("flow_direction")
            if direction not in {"forward", "reverse"}:
                raise ValueError(f"missing valid runtime direction for unconfirmed feature {fid}")
        elif direction is None:
            raise ValueError(f"missing reviewed direction for confirmed feature {fid}")
        source_direction = sp.get("flow_direction")
        if source_direction is not None and source_direction != direction:
            raise ValueError(f"source flow_direction conflicts with reviewed direction for feature {fid}")
        expected = copy.deepcopy(sf)
        expected["properties"]["flow_direction"] = direction
        if expected != rf:
            raise ValueError(f"source/runtime discrepancy beyond reviewed direction for feature {fid}")
        normalized_by_id[fid]["properties"]["flow_direction"] = direction
    return normalized


def _finite_coords(coords: Any) -> None:
    if not isinstance(coords, (list, tuple)) or len(coords) < 2:
        raise ValueError("a route must contain at least two coordinates")
    for point in coords:
        if not isinstance(point, (list, tuple)) or len(point) < 2 or not all(math.isfinite(float(v)) for v in point[:2]):
            raise ValueError("route contains a non-finite coordinate")


def _line_parts(feature: dict) -> list[list[list[float]]]:
    geometry = feature.get("geometry") or {}
    if geometry.get("type") == "LineString":
        return [geometry.get("coordinates", [])]
    if geometry.get("type") == "MultiLineString":
        return geometry.get("coordinates", [])
    raise ValueError("route geometry must be a line")


def _flatten_line(feature: dict, reverse: bool = False) -> list[list[float]]:
    parts = _line_parts(feature)
    coords = [list(c) for part in parts for c in part]
    if reverse:
        coords.reverse()
    _finite_coords(coords)
    return coords


def _set_line(feature: dict, coords: list[list[float]]) -> None:
    _finite_coords(coords)
    feature["geometry"] = {"type": "LineString", "coordinates": coords}


def _to_xy(coords: list[list[float]], forward: Transformer) -> list[tuple[float, float]]:
    return [forward.transform(float(c[0]), float(c[1])) for c in coords]


def _from_xy(coords: list[tuple[float, float]], backward: Transformer) -> list[list[float]]:
    return [[float(x), float(y)] for x, y in (backward.transform(x, y) for x, y in coords)]


def _first_border_hit(origin: tuple[float, float], ahead: tuple[float, float], border_xy: Any) -> tuple[float, float]:
    dx, dy = ahead[0] - origin[0], ahead[1] - origin[1]
    norm = math.hypot(dx, dy)
    if norm < 1e-9:
        raise ValueError("origin direction has zero length")
    ray = LineString([origin, (origin[0] - dx / norm * 20000, origin[1] - dy / norm * 20000)])
    hits = ray.intersection(border_xy)
    if hits.is_empty:
        raise ValueError("saved origin direction has no border intersection")
    points = [hits] if isinstance(hits, Point) else [g for g in getattr(hits, "geoms", []) if isinstance(g, Point)]
    if not points:
        # A coincident border segment is not a unique first crossing.
        raise ValueError("border intersection is not a point")
    distances = [(p.distance(Point(origin)), (p.x, p.y)) for p in points]
    return min((item for item in distances if item[0] >= 0), default=(None, None))[1]


def _border_contact_points(geometry: Any, border_xy: Any) -> list[tuple[float, float]]:
    # A 1 cm corridor absorbs projection round-trip noise while keeping distinct
    # border crossings far enough apart to identify re-entry.
    intersections = geometry.intersection(border_xy.buffer(0.01))
    if intersections.is_empty:
        return []
    if intersections.geom_type == "Point":
        return [(intersections.x, intersections.y)]
    if intersections.geom_type in {"MultiPoint", "GeometryCollection", "MultiLineString"}:
        points = []
        for part in intersections.geoms:
            if part.geom_type == "LineString":
                if part.length > 0.05:
                    raise ValueError("route overlaps the border")
                closest = nearest_points(part, border_xy)[0]
                points.append((closest.x, closest.y))
            else:
                points.extend(_border_contact_points(part, border_xy))
        unique = []
        for point in points:
            if not any(math.dist(point, existing) <= 0.01 for existing in unique):
                unique.append(point)
        return unique
    if intersections.geom_type in {"LineString", "MultiLineString"}:
        if intersections.length > 0.05:
            raise ValueError("route overlaps the border")
        closest = nearest_points(intersections, border_xy)[0]
        return [(closest.x, closest.y)]
    return []


def _require_single_border_contact(line: LineString, border_xy: Any, start: tuple[float, float], label: str) -> None:
    contacts = _border_contact_points(line, border_xy)
    if len(contacts) != 1 or math.dist(contacts[0], start) > 0.1:
        raise ValueError(f"{label} has an additional border crossing or re-entry")


def _feature_sha(feature: dict) -> str:
    encoded = json.dumps(feature, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")
    return hashlib.sha256(encoded).hexdigest()


def build_curated_routes(base_runtime: dict, border: dict, recipe: dict, road_layers: dict) -> tuple[dict, dict]:
    """Build the reviewed route collection in full-precision WGS84 coordinates."""
    validate_recipe(recipe)
    baseline = _validate_collection(base_runtime, 80)
    if len({_feature_id(f) for f in base_runtime["features"]}) != 80:
        raise ValueError("duplicate baseline feature IDs")
    directions = recipe["confirmed_directions"]
    forward = Transformer.from_crs("EPSG:4326", recipe["construction_crs"], always_xy=True)
    backward = Transformer.from_crs(recipe["construction_crs"], "EPSG:4326", always_xy=True)
    try:
        if border.get("type") == "FeatureCollection":
            border_geom = unary_union([shape(f["geometry"]) for f in border.get("features", [])])
        elif border.get("type") == "Feature":
            border_geom = shape(border["geometry"])
        else:
            border_geom = shape(border.get("geometry", border))
    except Exception as exc:
        raise ValueError("invalid canonical border geometry") from exc
    border_xy = transform(forward.transform, border_geom)
    if border_xy.is_empty:
        raise ValueError("border geometry is empty")
    result = copy.deepcopy(base_runtime)
    indexed = { _feature_id(f): f for f in result["features"] }
    baseline_indexed = { _feature_id(f): f for f in base_runtime["features"] }
    additions, edits = [], []
    for op in recipe["operations"]:
        if op["kind"] == "new_approach" and op["feature_id"] in indexed:
            raise ValueError(f"duplicate approach ID {op['feature_id']}")
    for fid, direction in directions.items():
        feature = indexed[int(fid)]
        feature.setdefault("properties", {})["flow_direction"] = direction
    road_op = recipe["road_operation"]
    road_collection = road_layers.get("collection", road_layers)
    road_features = road_collection.get("features", [])
    road_feature = next((f for f in road_features if f.get("properties", {}).get("FID") == road_op["feature_fid"] and str(f.get("properties", {}).get("NUM")) == road_op["road_num"]), None)
    if road_feature is None:
        raise ValueError("pinned road FID/NUM feature is missing")
    provided_road_hash = road_layers.get("sha256", road_layers.get("_sha256"))
    if provided_road_hash != road_op["sha256"]:
        raise ValueError("pinned road layer hash changed")
    if _feature_sha(road_feature) != EXPECTED_ROAD_FEATURE_SHA256:
        raise ValueError("pinned road feature geometry changed")
    road_coords = road_feature["geometry"].get("coordinates", [])
    _finite_coords(road_coords)
    road_xy = _to_xy(road_coords, forward)
    for op in recipe["operations"]:
        fid, parent_id = op["feature_id"], op["parent_id"]
        parent = indexed[parent_id]
        exact_wgs_coords = None
        if op["kind"] == "new_approach":
            if fid in indexed:
                raise ValueError(f"duplicate approach ID {fid}")
            oriented = _flatten_line(parent, directions[str(parent_id)] == "reverse")
            origin = oriented[0]
            origin_xy = _to_xy([origin], forward)[0]
            if op["shape"] == "road_polyline":
                road_line = LineString(road_xy)
                origin_point = Point(origin_xy)
                projected = road_line.interpolate(road_line.project(origin_point))
                # The reviewed route follows road vertices from vertex zero to the projection.
                cutoff = road_line.project(projected)
                distances = [0.0]
                for a, b in zip(road_xy, road_xy[1:]): distances.append(distances[-1] + math.dist(a, b))
                kept = [p for p, d in zip(road_xy, distances) if d < cutoff - 1e-8]
                road_path = kept + [(projected.x, projected.y)]
                if not kept: road_path.insert(0, road_xy[0])
                border_join = nearest_points(Point(road_xy[0]), border_xy)[1]
                xy_path = [(border_join.x, border_join.y)] + road_path + [origin_xy]
                exact_wgs_coords = [_from_xy([(border_join.x, border_join.y)], backward)[0]]
                exact_wgs_coords.extend([list(c) for c in road_coords[:max(1, len(kept))]])
                exact_wgs_coords.append(_from_xy([(projected.x, projected.y)], backward)[0])
                exact_wgs_coords.append(list(origin))
            else:
                following = next((p for p in _to_xy(oriented[1:], forward) if math.dist(origin_xy, p) >= 80), _to_xy(oriented[1:], forward)[-1])
                hit = _first_border_hit(origin_xy, following, border_xy)
                xy_path = [hit, origin_xy]
            gap = Point(origin_xy).distance(border_xy)
            maximum = max(300.0, min(1000.0, 2.5 * gap + 100.0))
            addition = LineString(xy_path if op["shape"] == "road_polyline" else [xy_path[0], origin_xy])
            if addition.length <= 1e-6 or addition.length > maximum:
                raise ValueError(f"approach {fid} has invalid added length {addition.length:.3f} m")
            if not addition.is_simple:
                raise ValueError(f"approach {fid} contains a loop or re-entry")
            if Point(xy_path[0]).distance(border_xy) > 0.1:
                raise ValueError(f"approach {fid} misses border")
            _require_single_border_contact(LineString(xy_path), border_xy, xy_path[0], f"approach {fid}")
            if exact_wgs_coords is not None:
                coords = [exact_wgs_coords[0]]
                for point in exact_wgs_coords[1:]:
                    if math.dist(_to_xy([coords[-1]], forward)[0], _to_xy([point], forward)[0]) > 1e-7:
                        coords.append(point)
                coords[-1] = list(origin)
            else:
                coords = [_from_xy([xy_path[0]], backward)[0], list(origin)]
            props = {"Name": None, "NoteType": None, "Notes": None, "created_date": None,
                     "OBJECTID": fid, "Shape_Length": float(LineString(xy_path).length),
                     "flow_direction": "forward", "parent_objectid": parent_id,
                     "route_confidence": "unconfirmed", "route_role": "approach",
                     "timeline": parent["properties"].get("timeline"),
                     "timeline_minutes": parent["properties"].get("timeline_minutes")}
            feature = {"type": "Feature", "id": fid, "geometry": {"type": "LineString", "coordinates": coords}, "properties": props}
            result["features"].append(feature); indexed[fid] = feature; additions.append(fid)
        elif op["kind"] == "trim_first_crossing":
            target = indexed[fid]
            coords = _flatten_line(target)
            coords_xy = _to_xy(coords, forward)
            line = LineString(coords_xy)
            intersections = line.intersection(border_xy)
            points = [intersections] if isinstance(intersections, Point) else [g for g in getattr(intersections, "geoms", []) if isinstance(g, Point)]
            if not points:
                raise ValueError(f"route {fid} has no border crossing")
            hit = min(points, key=lambda p: line.project(p))
            measure = line.project(hit)
            # The feature is oriented from its remote start toward the event. Keep
            # the suffix after its first crossing so every retained vertex stays exact.
            hit_vertex = next((list(original) for original, projected in zip(coords, coords_xy) if math.dist(projected, (hit.x, hit.y)) <= 1e-7), None)
            kept = [hit_vertex or _from_xy([(hit.x, hit.y)], backward)[0]] + [list(original) for original, projected in zip(coords, coords_xy) if line.project(Point(projected)) > measure + 1e-7]
            if len(kept) < 2: raise ValueError(f"trim {fid} would produce zero length")
            _set_line(target, kept); edits.append(fid)
        elif op["kind"] == "extend_origin_direction":
            target = indexed[fid]
            oriented = _flatten_line(target, op["direction"] == "reverse")
            origin = oriented[0]
            origin_xy = _to_xy([origin], forward)[0]
            target_xy = _to_xy(oriented[1:], forward)
            following = next((p for p in target_xy if math.dist(origin_xy, p) >= 80), target_xy[-1])
            hit = _first_border_hit(origin_xy, following, border_xy)
            gap = Point(origin_xy).distance(border_xy)
            maximum = max(300.0, min(1000.0, 2.5 * gap + 100.0))
            join_length = LineString([hit, origin_xy]).length
            if join_length <= 1e-6 or join_length > maximum or Point(hit).distance(border_xy) > 0.1:
                raise ValueError(f"extension {fid} has invalid border join")
            extension_line = LineString([hit, origin_xy, *target_xy])
            _require_single_border_contact(extension_line, border_xy, hit, f"extension {fid}")
            if not extension_line.is_simple:
                raise ValueError(f"extension {fid} contains a loop")
            _set_line(target, [*_from_xy([hit], backward), *oriented]); edits.append(fid)
    audit = {"feature_count": len(result["features"]), "confirmed_count": sum(f["properties"].get("route_confidence") != "unconfirmed" for f in result["features"]), "unconfirmed_count": sum(f["properties"].get("route_confidence") == "unconfirmed" for f in result["features"]), "added_ids": additions, "edited_ids": edits, "road_sha256": provided_road_hash, "unchanged_confirmed": False, "direction_ids": sorted(map(int, directions))}
    # Confirmed baseline geometry and properties are copied exactly, with reviewed flow metadata.
    audit["unchanged_confirmed"] = all(indexed[i] == baseline_indexed[i] for i in baseline if i < 1001)
    if audit["feature_count"] != 89 or audit["confirmed_count"] != 68 or audit["unconfirmed_count"] != 21:
        raise ValueError("curated route collection failed expected feature counts")
    return result, audit
