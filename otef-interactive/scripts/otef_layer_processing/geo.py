import logging
from pathlib import Path
import pyogrio
import geopandas as gpd
from pyproj import Transformer
import json
import os

# Increase the max object size for OGR GeoJSON driver to support large complex geometries
os.environ["OGR_GEOJSON_MAX_OBJ_SIZE"] = "0"

logger = logging.getLogger(__name__)


def transform_to_wgs84(input_path: Path, output_path: Path) -> bool:
    """
    Transform a GeoJSON file to WGS84 (EPSG:4326) using pyogrio for high performance.
    """
    tmp_path = output_path.with_name(output_path.name + ".tmp")
    try:
        # Detect source CRS
        meta = pyogrio.read_info(input_path)
        source_crs = meta.get("crs")

        # If CRS is not found in metadata, try to infer it
        if not source_crs:
            source_crs = infer_crs(input_path)

        # High performance read/reproject/write
        df = pyogrio.read_dataframe(input_path)

        # Only reproject if necessary
        is_already_wgs84 = source_crs and (
            "4326" in str(source_crs) or "WGS 84" in str(source_crs)
        )

        if not is_already_wgs84:
            if df.crs is None:
                df.set_crs(source_crs, inplace=True, allow_override=True)

            logger.debug(
                f"Reprojecting {input_path.name} from {source_crs} to EPSG:4326"
            )
            df = df.to_crs("EPSG:4326")

        # Temp in same directory + replace so readers never see a partial GeoJSON
        output_path.parent.mkdir(parents=True, exist_ok=True)
        pyogrio.write_dataframe(df, tmp_path, driver="GeoJSON")
        os.replace(tmp_path, output_path)
        return True

    except Exception as e:
        logger.error(f"Failed to transform {input_path}: {e}")
        if tmp_path.exists():
            try:
                tmp_path.unlink()
            except OSError:
                pass
        return False


def infer_crs(file_path: Path) -> str:
    """
    Infer the CRS from coordinate ranges if it's not explicitly defined.
    """
    try:
        # We only need a small sample to infer the CRS
        df = pyogrio.read_dataframe(file_path, max_features=10)
        bounds = df.total_bounds  # (minx, miny, maxx, maxy)

        # Check if it's within Israel TM Grid (EPSG:2039) ranges
        # Approx ITM bounds: 130,000-280,000 X, 380,000-800,000 Y
        if 100000 < bounds[0] < 300000 and 300000 < bounds[1] < 900000:
            return "EPSG:2039"

        # Default to WGS84 if it looks like degrees
        if -180 <= bounds[0] <= 180 and -90 <= bounds[1] <= 90:
            return "EPSG:4326"

        return "EPSG:2039"  # Default fallback for this project
    except:
        return "EPSG:2039"


def _closest_point_on_segment(px, py, ax, ay, bx, by):
    """Project point (px, py) onto segment (ax,ay)-(bx,by). Returns (cx, cy)."""
    dx, dy = bx - ax, by - ay
    len_sq = dx * dx + dy * dy
    if len_sq == 0:
        return ax, ay
    t = max(0.0, min(1.0, ((px - ax) * dx + (py - ay) * dy) / len_sq))
    return ax + t * dx, ay + t * dy


def convert_annotation_polygons_to_anchor_points(
    names_path: Path, lines_path: Path, towns_path: Path = None
) -> bool:
    """
    Convert שמות_יישובים annotation bounding-box polygons to Point features
    anchored at the nearest Locations_Lines endpoint-to-polygon-edge projection.

    Both files must already be in WGS84. ``names_path`` is overwritten in place
    with Point geometry (all properties preserved).  Returns True on success.

    ``towns_path`` (optional but recommended) points to the ישובים.geojson file.
    When provided, the function uses town polygon centroids to reliably decide
    which line endpoint is the town side vs. the label/text side — because
    the vertex ordering is NOT consistent across all lines after WGS84 reprojection.
    """
    import math

    try:
        from scipy.optimize import linear_sum_assignment
        import numpy as np
    except ImportError:
        logger.error("scipy/numpy required for annotation anchor assignment")
        return False

    try:
        with open(names_path, "r", encoding="utf-8") as f:
            names_gj = json.load(f)
        with open(lines_path, "r", encoding="utf-8") as f:
            lines_gj = json.load(f)
    except Exception as e:
        logger.error(
            "Cannot load GeoJSON for annotation anchor conversion: %s", e
        )
        return False

    # Load town centroids for per-line endpoint disambiguation
    town_centroids = []
    if towns_path and towns_path.is_file():
        try:
            with open(towns_path, "r", encoding="utf-8") as f:
                towns_gj = json.load(f)
            for tf in towns_gj.get("features", []):
                geom = tf.get("geometry", {})
                gtype = (geom.get("type") or "").lower()
                coords = geom.get("coordinates", [])
                # Extract a representative point (centroid of first ring)
                ring = None
                if "multipolygon" in gtype and coords:
                    ring = coords[0][0] if coords[0] else None
                elif "polygon" in gtype and coords:
                    ring = coords[0]
                elif "linestring" in gtype and coords:
                    ring = coords
                elif "point" in gtype and coords:
                    town_centroids.append(tuple(coords[:2]))
                    continue
                if ring and len(ring) >= 3:
                    sx = sum(p[0] for p in ring)
                    sy = sum(p[1] for p in ring)
                    town_centroids.append((sx / len(ring), sy / len(ring)))
        except Exception as e:
            logger.warning("Could not load towns for endpoint disambiguation: %s", e)

    line_features = lines_gj.get("features", [])
    name_features = names_gj.get("features", [])
    
    if not line_features or not name_features:
        return False

    # Extract polygon rings
    poly_rings = []
    valid_name_indices = []
    for i, feat in enumerate(name_features):
        geom = feat.get("geometry", {})
        gtype = (geom.get("type") or "").lower()
        if "polygon" not in gtype:
            continue
        rings = geom.get("coordinates", [])
        if not rings or not rings[0] or len(rings[0]) < 4:
            continue
        poly_rings.append(rings[0])
        valid_name_indices.append(i)

    # Extract line endpoints
    line_endpoints = []
    valid_line_indices = []
    for i, feat in enumerate(line_features):
        geom = feat.get("geometry", {})
        coords = geom.get("coordinates", [])
        if not coords:
            continue
        line_endpoints.append((coords[0], coords[-1]))
        valid_line_indices.append(i)

    if not poly_rings or not line_endpoints:
        return False

    # Build cost matrix
    cost = np.zeros((len(poly_rings), len(line_endpoints)))
    for i, ring in enumerate(poly_rings):
        edges = list(zip(ring[:-1], ring[1:]))
        for j, (ep1, ep2) in enumerate(line_endpoints):
            # dist ep1 to poly
            d1_best = float('inf')
            for (ax, ay), (bx, by) in edges:
                cx, cy = _closest_point_on_segment(ep1[0], ep1[1], ax, ay, bx, by)
                d1_best = min(d1_best, (cx - ep1[0])**2 + (cy - ep1[1])**2)
            # dist ep2 to poly
            d2_best = float('inf')
            for (ax, ay), (bx, by) in edges:
                cx, cy = _closest_point_on_segment(ep2[0], ep2[1], ax, ay, bx, by)
                d2_best = min(d2_best, (cx - ep2[0])**2 + (cy - ep2[1])**2)
            
            cost[i, j] = min(d1_best, d2_best)

    row_ind, col_ind = linear_sum_assignment(cost)

    def _dist(a, b):
        return math.sqrt((a[0] - b[0])**2 + (a[1] - b[1])**2)

    def _find_text_endpoint(ep1, ep2):
        """Determine which endpoint is the text/label side (far from any town).
        Returns (text_ep, town_ep)."""
        if not town_centroids:
            # Fallback: use ep1 (no town data available)
            return ep1, ep2
        d1_min = min(_dist(ep1, tc) for tc in town_centroids)
        d2_min = min(_dist(ep2, tc) for tc in town_centroids)
        # The endpoint FARTHER from any town is the text side
        if d1_min > d2_min:
            return ep1, ep2   # ep1 is farther from towns → text side
        else:
            return ep2, ep1   # ep2 is farther from towns → text side

    converted = 0
    for r, c in zip(row_ind, col_ind):
        ep1, ep2 = line_endpoints[c]
        
        name_idx = valid_name_indices[r]
        feat = name_features[name_idx]

        # Use towns to determine which endpoint is the label side
        text_ep, town_ep = _find_text_endpoint(ep1, ep2)
        best_pt = text_ep
                
        dx = text_ep[0] - town_ep[0]
        dy = text_ep[1] - town_ep[1]
        lat_rad = math.radians(town_ep[1])
        angle = -math.degrees(math.atan2(dy, dx * math.cos(lat_rad)))
        # Keep text upright
        if angle > 90:
            angle -= 180
        elif angle < -90:
            angle += 180

        # Determine anchor to avoid text intersecting the line
        anchor = "left" if dx >= 0 else "right"

        feat["geometry"] = {"type": "Point", "coordinates": list(best_pt)}
        feat.setdefault("properties", {})["_ComputedAngle"] = angle
        feat.setdefault("properties", {})["_ComputedAnchor"] = anchor
        converted += 1

    if converted == 0:
        logger.warning("No polygons converted to points in %s", names_path)
        return False

    # Write back in place
    tmp_path = names_path.with_name(names_path.name + ".tmp")
    try:
        with open(tmp_path, "w", encoding="utf-8") as f:
            json.dump(names_gj, f, ensure_ascii=False)
        os.replace(tmp_path, names_path)
        logger.info(
            "Converted %d annotation polygons to anchor points in %s",
            converted,
            names_path.name,
        )
        return True
    except Exception as e:
        logger.error("Failed to write converted anchors: %s", e)
        if tmp_path.exists():
            try:
                tmp_path.unlink()
            except OSError:
                pass
        return False


def get_geometry_type(file_path: Path) -> str:
    """
    Get the predominant geometry type of a GeoJSON file.
    Uses pyogrio for speed, falls back to manual JSON parsing if needed.
    """
    try:
        meta = pyogrio.read_info(file_path)
        geom_type = meta.get("geometry_type", "unknown").lower()

        # Map to our standard types
        if "polygon" in geom_type:
            return "polygon"
        if "line" in geom_type:
            return "line"
        if "point" in geom_type:
            return "point"
    except Exception:
        pass

    # Fallback: Manual JSON scan
    try:
        with open(file_path, "r", encoding="utf-8") as f:
            data = json.load(f)
            features = data.get("features", [])
            if not features:
                return "unknown"

            from collections import Counter

            types = Counter()
            for feat in features[:100]:  # Sample 100
                geom = feat.get("geometry")
                if geom:
                    types[geom.get("type", "unknown").lower()] += 1

            if not types:
                return "unknown"

            top_type = types.most_common(1)[0][0]
            if "polygon" in top_type:
                return "polygon"
            if "line" in top_type:
                return "line"
            if "point" in top_type:
                return "point"
    except Exception:
        pass

    return "unknown"
