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
    try:
        # Detect source CRS
        meta = pyogrio.read_info(input_path)
        source_crs = meta.get('crs')

        # If CRS is not found in metadata, try to infer it
        if not source_crs:
            source_crs = infer_crs(input_path)

        # High performance read/reproject/write
        df = pyogrio.read_dataframe(input_path)

        # Only reproject if necessary
        is_already_wgs84 = source_crs and ("4326" in str(source_crs) or "WGS 84" in str(source_crs))

        if not is_already_wgs84:
            if df.crs is None:
                df.set_crs(source_crs, inplace=True, allow_override=True)

            logger.debug(f"Reprojecting {input_path.name} from {source_crs} to EPSG:4326")
            df = df.to_crs("EPSG:4326")

        # Write silently if possible
        pyogrio.write_dataframe(df, output_path, driver="GeoJSON")
        return True

    except Exception as e:
        logger.error(f"Failed to transform {input_path}: {e}")
        return False

def infer_crs(file_path: Path) -> str:
    """
    Infer the CRS from coordinate ranges if it's not explicitly defined.
    """
    try:
        # We only need a small sample to infer the CRS
        df = pyogrio.read_dataframe(file_path, max_features=10)
        bounds = df.total_bounds # (minx, miny, maxx, maxy)

        # Check if it's within Israel TM Grid (EPSG:2039) ranges
        # Approx ITM bounds: 130,000-280,000 X, 380,000-800,000 Y
        if 100000 < bounds[0] < 300000 and 300000 < bounds[1] < 900000:
            return "EPSG:2039"

        # Default to WGS84 if it looks like degrees
        if -180 <= bounds[0] <= 180 and -90 <= bounds[1] <= 90:
            return "EPSG:4326"

        return "EPSG:2039" # Default fallback for this project
    except:
        return "EPSG:2039"

def get_geometry_type(file_path: Path) -> str:
    """
    Get the predominant geometry type of a GeoJSON file.
    Uses pyogrio for speed, falls back to manual JSON parsing if needed.
    """
    try:
        meta = pyogrio.read_info(file_path)
        geom_type = meta.get('geometry_type', 'unknown').lower()

        # Map to our standard types
        if 'polygon' in geom_type:
            return 'polygon'
        if 'line' in geom_type:
            return 'line'
        if 'point' in geom_type:
            return 'point'
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
            for feat in features[:100]: # Sample 100
                geom = feat.get("geometry")
                if geom:
                    types[geom.get("type", "unknown").lower()] += 1

            if not types:
                return "unknown"

            top_type = types.most_common(1)[0][0]
            if 'polygon' in top_type: return 'polygon'
            if 'line' in top_type: return 'line'
            if 'point' in top_type: return 'point'
    except Exception:
        pass

    return "unknown"
