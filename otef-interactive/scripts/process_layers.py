#!/usr/bin/env python3
"""
Layer Processing Pipeline
Auto-discovers layer packs, parses .lyrx styles, converts large files to PMTiles,
and generates manifest files for the frontend.

Usage:
  python process_layers.py --source /path/to/source/layers --output /path/to/processed/layers

Requirements:
  - Python 3.8+ with packages: pyproj, pmtiles
  - Docker (for PMTiles conversion via tippecanoe)
"""

import json
import os
import sys
import hashlib
import subprocess
import argparse
import re
from pathlib import Path
from typing import Dict, List, Optional, Tuple

# Constants
PMTILES_SIZE_THRESHOLD_MB = 10
PMTILES_FEATURE_THRESHOLD = 10000
TIPPECANOE_IMAGE = "ingmapping/tippecanoe"
CACHE_FILE = ".layer-cache.json"
PMTILES_SKIP_LAYER_IDS = set()


def compute_file_hash(path: Path) -> str:
    """Compute SHA256 hash of file for cache invalidation."""
    sha256 = hashlib.sha256()
    with open(path, 'rb') as f:
        for chunk in iter(lambda: f.read(4096), b''):
            sha256.update(chunk)
    return sha256.hexdigest()


def load_cache(cache_path: Path) -> Dict:
    """Load hash-based cache from disk."""
    if cache_path.exists():
        try:
            with open(cache_path, 'r', encoding='utf-8') as f:
                return json.load(f)
        except Exception as e:
            print(f"Warning: Failed to load cache: {e}")
    return {}


def save_cache(cache_path: Path, cache: Dict):
    """Save hash-based cache to disk."""
    try:
        with open(cache_path, 'w', encoding='utf-8') as f:
            json.dump(cache, f, indent=2)
    except Exception as e:
        print(f"Warning: Failed to save cache: {e}")


def scan_layer_packs(source_dir: Path) -> List[Path]:
    """Discover layer pack directories in source/layers/."""
    packs = []
    if not source_dir.exists():
        return packs
    
    for item in source_dir.iterdir():
        if item.is_dir() and not item.name.startswith('.'):
            # Check if it has actual GeoJSON files (not just empty directories)
            gis_dir = item / 'gis'
            has_geojson = False
            
            # Check in gis/ subdirectory
            if gis_dir.exists():
                has_geojson = any(f.suffix in ['.json', '.geojson'] for f in gis_dir.iterdir() if f.is_file())
            
            # Also check root of pack_dir for legacy structure
            if not has_geojson:
                has_geojson = any(f.suffix in ['.json', '.geojson'] for f in item.iterdir() if f.is_file())
            
            if has_geojson:
                packs.append(item)
    
    return sorted(packs)


def scan_processed_packs(output_dir: Path) -> List[str]:
    """Discover existing processed layer packs in output directory."""
    processed_pack_ids = []
    if not output_dir.exists():
        return processed_pack_ids
    
    for item in output_dir.iterdir():
        if item.is_dir() and not item.name.startswith('.'):
            # Check if it has a manifest.json (indicates it's a processed pack)
            manifest_path = item / 'manifest.json'
            if manifest_path.exists():
                try:
                    # Include pack if manifest has 'layers' (may be empty, e.g. _legacy)
                    with open(manifest_path, 'r', encoding='utf-8') as f:
                        manifest = json.load(f)
                        if 'layers' in manifest:
                            processed_pack_ids.append(item.name)
                except Exception as e:
                    print(f"  Warning: Could not read manifest for {item.name}: {e}")
    
    return sorted(processed_pack_ids)


def get_geometry_type(geojson_path: Path) -> str:
    """Determine geometry type from GeoJSON file by checking first non-null geometry."""
    try:
        with open(geojson_path, 'r', encoding='utf-8') as f:
            data = json.load(f)
            features = data.get('features', [])
            if not features:
                return 'unknown'
            
            # Find first feature with non-null geometry
            for feature in features:
                geometry = feature.get('geometry')
                if geometry is None:
                    continue
                
                geom_type = geometry.get('type', '').lower()
                if geom_type in ['polygon', 'multipolygon']:
                    return 'polygon'
                elif geom_type in ['linestring', 'multilinestring']:
                    return 'line'
                elif geom_type in ['point', 'multipoint']:
                    return 'point'
            
            # All geometries are null
            print(f"Warning: All geometries are null in {geojson_path.name}")
            return 'unknown'
    except Exception as e:
        print(f"Warning: Could not determine geometry type for {geojson_path}: {e}")
        return 'unknown'


def count_features(geojson_path: Path) -> int:
    """Count features in GeoJSON file."""
    try:
        with open(geojson_path, 'r', encoding='utf-8') as f:
            data = json.load(f)
            return len(data.get('features', []))
    except Exception:
        return 0


def get_file_size_mb(path: Path) -> float:
    """Get file size in MB."""
    if path.exists():
        return path.stat().st_size / (1024 * 1024)
    return 0.0


def normalize_layer_id(layer_name: str) -> str:
    """Normalize a layer name to a stable ID."""
    return layer_name.lower().replace(' ', '_').replace('-', '_')


def should_convert_to_pmtiles(geojson_path: Path, layer_id: Optional[str] = None) -> bool:
    """Check if file should be converted to PMTiles based on size/feature count."""
    if layer_id and layer_id in PMTILES_SKIP_LAYER_IDS:
        return False

    size_mb = get_file_size_mb(geojson_path)
    feature_count = count_features(geojson_path)
    
    return size_mb > PMTILES_SIZE_THRESHOLD_MB or feature_count > PMTILES_FEATURE_THRESHOLD


def normalize_name(name: str) -> str:
    """Normalize a name for matching: trim, lowercase, collapse whitespace."""
    return re.sub(r'\s+', ' ', name.strip().lower())


def token_sort_name(name: str) -> str:
    """Create token-sorted key for matching (handles '232 ציר' vs 'ציר 232')."""
    tokens = re.findall(r'\w+', normalize_name(name))
    return ' '.join(sorted(tokens))


def find_lyrx_file(geojson_file: Path, styles_dir: Path) -> Tuple[Optional[Path], Optional[str]]:
    """
    Find matching .lyrx file using robust matching strategies.
    Returns (lyrx_path, match_method) where match_method is:
    - 'exact': exact filename match
    - 'token_sorted': token-sorted match
    - 'metadata': match via .lyrx internal metadata
    - None: no match found
    """
    if not styles_dir.exists():
        return None, None
    
    layer_name = geojson_file.stem
    layer_name_normalized = normalize_name(layer_name)
    layer_name_tokens = token_sort_name(layer_name)
    
    # Build index of all .lyrx files with multiple keys
    lyrx_index = {}  # key -> list of (path, original_name)
    
    for lyrx_file in styles_dir.glob('*.lyrx'):
        lyrx_stem = lyrx_file.stem
        # Exact match key
        exact_key = normalize_name(lyrx_stem)
        if exact_key not in lyrx_index:
            lyrx_index[exact_key] = []
        lyrx_index[exact_key].append((lyrx_file, lyrx_stem))
        
        # Token-sorted key
        token_key = token_sort_name(lyrx_stem)
        if token_key not in lyrx_index:
            lyrx_index[token_key] = []
        if (lyrx_file, lyrx_stem) not in lyrx_index[token_key]:
            lyrx_index[token_key].append((lyrx_file, lyrx_stem))
    
    # Try exact match first
    if layer_name_normalized in lyrx_index:
        candidates = lyrx_index[layer_name_normalized]
        if len(candidates) == 1:
            return candidates[0][0], 'exact'
        elif len(candidates) > 1:
            print(f"    Warning: Multiple .lyrx files match '{layer_name}' exactly, using first")
            return candidates[0][0], 'exact'
    
    # Try token-sorted match
    if layer_name_tokens in lyrx_index:
        candidates = lyrx_index[layer_name_tokens]
        if len(candidates) == 1:
            print(f"    Note: Using token-sorted match for '{layer_name}' -> '{candidates[0][1]}.lyrx'")
            return candidates[0][0], 'token_sorted'
        elif len(candidates) > 1:
            print(f"    Warning: Multiple .lyrx files match '{layer_name}' by token sort, using first")
            return candidates[0][0], 'token_sorted'
    
    # Try metadata-based matching
    for lyrx_file in styles_dir.glob('*.lyrx'):
        try:
            with open(lyrx_file, 'r', encoding='utf-8') as f:
                lyrx_data = json.load(f)
            
            # Check layerDefinitions[].name
            layer_defs = lyrx_data.get('layerDefinitions', [])
            for layer_def in layer_defs:
                def_name = layer_def.get('name', '')
                if normalize_name(def_name) == layer_name_normalized or token_sort_name(def_name) == layer_name_tokens:
                    print(f"    Note: Matched '{layer_name}' via .lyrx metadata name '{def_name}'")
                    return lyrx_file, 'metadata'
            
            # Check layers[] array (URI references)
            layers = lyrx_data.get('layers', [])
            for layer_uri in layers:
                # Extract filename from URI like "CIMPATH=future/roud_232.json"
                if '=' in layer_uri:
                    uri_path = layer_uri.split('=', 1)[1]
                    uri_name = Path(uri_path).stem
                    if normalize_name(uri_name) == layer_name_normalized or token_sort_name(uri_name) == layer_name_tokens:
                        print(f"    Note: Matched '{layer_name}' via .lyrx URI '{layer_uri}'")
                        return lyrx_file, 'metadata'
        except Exception:
            continue
    
    return None, None


def extract_symbol_layers_recursive(symbol_obj: Dict, depth: int = 0) -> List[Dict]:
    """
    Recursively extract all symbol layers from a symbol object.
    Handles nested structures like CIMVectorMarker → markerGraphics → symbol → symbolLayers.
    """
    if depth > 10:  # Safety limit
        return []
    
    layers = []
    symbol_layers = symbol_obj.get('symbolLayers', [])
    
    for layer in symbol_layers:
        layer_type = layer.get('type', '')
        layers.append(layer)
        
        # Handle CIMVectorMarker - extract from markerGraphics
        if layer_type == 'CIMVectorMarker':
            marker_graphics = layer.get('markerGraphics', [])
            for mg in marker_graphics:
                mg_symbol = mg.get('symbol', {})
                if mg_symbol:
                    nested_layers = extract_symbol_layers_recursive(mg_symbol, depth + 1)
                    layers.extend(nested_layers)
        
        # Handle nested symbol references
        nested_symbol = layer.get('symbol', {})
        if nested_symbol and nested_symbol != symbol_obj:
            nested_layers = extract_symbol_layers_recursive(nested_symbol, depth + 1)
            layers.extend(nested_layers)
    
    return layers


def extract_simplified_style(symbol_layers: List[Dict]) -> Dict:
    """Extract simplified fill/stroke from symbol layers (first enabled, non-transparent)."""
    fill_color = None
    fill_opacity = 1.0
    stroke_color = None
    stroke_width = 1.0
    
    for layer in symbol_layers:
        if not layer.get('enable', True):
            continue
        
        layer_type = layer.get('type', '')
        
        if layer_type == 'CIMSolidFill' and fill_color is None:
            color = layer.get('color', {}).get('values', [0, 0, 0, 100])
            if len(color) >= 3:
                fill_color = f"#{color[0]:02x}{color[1]:02x}{color[2]:02x}"
                fill_opacity = color[3] / 100.0 if len(color) > 3 else 1.0
                if fill_opacity > 0:  # Only use if not fully transparent
                    continue
        
        elif layer_type == 'CIMSolidStroke' and stroke_color is None:
            color = layer.get('color', {}).get('values', [0, 0, 0, 100])
            if len(color) >= 3:
                stroke_color = f"#{color[0]:02x}{color[1]:02x}{color[2]:02x}"
                stroke_width = layer.get('width', 1.0)
    
    return {
        'fillColor': fill_color or '#808080',
        'fillOpacity': fill_opacity,
        'strokeColor': stroke_color or '#000000',
        'strokeWidth': stroke_width
    }


def parse_lyrx_style(lyrx_path: Path) -> Optional[Dict]:
    """
    Parse .lyrx file and extract styling information.
    Returns style config with both simplified and full symbol layer stacks.
    """
    try:
        with open(lyrx_path, 'r', encoding='utf-8') as f:
            lyrx_data = json.load(f)
    except Exception as e:
        print(f"Error reading .lyrx file {lyrx_path}: {e}")
        return None
    
    # Find the layer definition
    layer_defs = lyrx_data.get('layerDefinitions', [])
    if not layer_defs:
        return None
    
    layer_def = layer_defs[0]
    renderer = layer_def.get('renderer', {})
    renderer_type = renderer.get('type', '')
    
    # Infer geometry type from renderer symbol type
    geometry_type = None
    symbol_ref = renderer.get('symbol', {})
    if symbol_ref:
        actual_symbol = symbol_ref.get('symbol', {})
        symbol_type = actual_symbol.get('type', '')
        if symbol_type == 'CIMPointSymbol':
            geometry_type = 'point'
        elif symbol_type == 'CIMLineSymbol':
            geometry_type = 'line'
        elif symbol_type == 'CIMPolygonSymbol':
            geometry_type = 'polygon'
    
    # Fallback to label class featureType
    if geometry_type is None:
        label_classes = layer_def.get('labelClasses', [])
        if label_classes:
            label_class = label_classes[0]
            maplex_props = label_class.get('maplexLabelPlacementProperties', {})
            feature_type = maplex_props.get('featureType', '')
            if feature_type:
                geometry_type = feature_type.lower()
    
    # Final fallback
    if geometry_type is None:
        geometry_type = 'polygon'
    
    # Extract label config
    label_config = None
    label_classes = layer_def.get('labelClasses', [])
    if label_classes:
        label_class = label_classes[0]
        text_symbol = label_class.get('textSymbol', {}).get('symbol', {})
        label_config = {
            'field': label_class.get('expression', '').replace('$feature.', ''),
            'font': text_symbol.get('fontFamilyName', 'Arial'),
            'size': text_symbol.get('height', 10)
        }

    min_scale = layer_def.get('minScale') or layer_def.get('minimumScale')
    max_scale = layer_def.get('maxScale') or layer_def.get('maximumScale')
    scale_range = None
    if min_scale is not None or max_scale is not None:
        scale_range = {
            'minScale': min_scale,
            'maxScale': max_scale
        }
    
    style_config = {
        'type': geometry_type,
        'renderer': 'simple',
        'defaultStyle': {},
        'fullSymbolLayers': [],
        'labels': label_config,
        'scaleRange': scale_range
    }
    
    # Parse CIMSimpleRenderer
    if renderer_type == 'CIMSimpleRenderer':
        # Access nested symbol: renderer.symbol.symbol.symbolLayers
        symbol_ref = renderer.get('symbol', {})
        actual_symbol = symbol_ref.get('symbol', {}) if symbol_ref else {}
        
        # Recursively extract all symbol layers
        all_layers = extract_symbol_layers_recursive(actual_symbol)
        style_config['fullSymbolLayers'] = all_layers
        
        # Extract simplified style
        style_config['defaultStyle'] = extract_simplified_style(all_layers)
    
    # Parse CIMUniqueValueRenderer
    elif renderer_type == 'CIMUniqueValueRenderer':
        groups = renderer.get('groups', [])
        fields = renderer.get('fields', [])
        
        if groups and fields:
            classes = []
            
            for group in groups:
                for cls in group.get('classes', []):
                    values = cls.get('values', [])
                    if not values:
                        continue
                    
                    # Extract all field values (support multi-field)
                    all_field_values = []
                    for value_obj in values:
                        field_vals = value_obj.get('fieldValues', [])
                        all_field_values.append([str(v) for v in field_vals])
                    
                    # Use first value set for simplified matching (backward compat)
                    primary_values = all_field_values[0] if all_field_values else []
                    label = cls.get('label', str(primary_values[0]) if primary_values else '')
                    
                    # Extract style from symbol
                    symbol_ref = cls.get('symbol', {})
                    actual_symbol = symbol_ref.get('symbol', {}) if symbol_ref else {}
                    
                    # Recursively extract all symbol layers
                    all_layers = extract_symbol_layers_recursive(actual_symbol)
                    simplified_style = extract_simplified_style(all_layers)
                    
                    classes.append({
                        'values': all_field_values,  # Full multi-field values
                        'value': str(primary_values[0]) if primary_values else '',  # Backward compat
                        'label': label,
                        'style': simplified_style,
                        'fullSymbolLayers': all_layers
                    })
            
            style_config['renderer'] = 'uniqueValue'
            style_config['uniqueValues'] = {
                'fields': fields,  # Full fields array
                'field': fields[0] if fields else '',  # Backward compat
                'classes': classes
            }
            
            # Set default style from first class if available
            if classes:
                style_config['defaultStyle'] = classes[0]['style']
    
    return style_config


def transform_to_wgs84(input_path: Path, output_path: Path) -> bool:
    """Transform GeoJSON from EPSG:2039 to WGS84."""
    try:
        from pyproj import Transformer
        
        transformer = Transformer.from_crs("EPSG:2039", "EPSG:4326", always_xy=True)
        
        with open(input_path, 'r', encoding='utf-8') as f:
            geojson = json.load(f)
        
        def transform_coords(coords, depth=0):
            if depth > 10:
                return coords
            if isinstance(coords[0], (int, float)):
                lon, lat = transformer.transform(coords[0], coords[1])
                return [lon, lat]
            else:
                return [transform_coords(c, depth + 1) for c in coords]
        
        count = 0
        for feature in geojson.get('features', []):
            if 'geometry' in feature and feature['geometry'] and 'coordinates' in feature['geometry']:
                feature['geometry']['coordinates'] = transform_coords(feature['geometry']['coordinates'])
                count += 1
        
        geojson['crs'] = {"type": "name", "properties": {"name": "EPSG:4326"}}
        
        output_path.parent.mkdir(parents=True, exist_ok=True)
        with open(output_path, 'w', encoding='utf-8') as f:
            json.dump(geojson, f)
        
        return True
    except Exception as e:
        print(f"Error transforming coordinates: {e}")
        return False


def to_docker_path(path: Path) -> str:
    """Convert path to Docker-compatible format (for Windows)."""
    posix = str(path).replace('\\', '/')
    if len(posix) >= 2 and posix[1] == ':':
        return '/' + posix[0].lower() + posix[2:]
    return posix


def generate_mbtiles(input_file: Path, output_file: Path) -> bool:
    """Generate MBTiles using tippecanoe Docker."""
    try:
        if output_file.exists():
            output_file.unlink()
        
        abs_input = input_file.resolve()
        abs_output_dir = output_file.parent.resolve()
        
        if sys.platform == 'win32':
            docker_input_dir = to_docker_path(abs_input.parent)
            docker_output_dir = to_docker_path(abs_output_dir)
        else:
            docker_input_dir = str(abs_input.parent)
            docker_output_dir = str(abs_output_dir)
        
        docker_cmd = [
            "docker", "run", "--rm",
            "-v", f"{docker_input_dir}:/input:ro",
            "-v", f"{docker_output_dir}:/output",
            TIPPECANOE_IMAGE,
            "tippecanoe",
            "-o", f"/output/{output_file.name}",
            "--minimum-zoom=9",
            "--maximum-zoom=18",
            "--no-feature-limit",
            "--no-tile-size-limit",
            "--detect-shared-borders",
            "--simplification=5",
            "--layer=layer",
            "--force",
            f"/input/{abs_input.name}"
        ]
        
        result = subprocess.run(docker_cmd, capture_output=True, text=True, timeout=300)
        
        if output_file.exists() and output_file.stat().st_size > 100000:
            return True
        else:
            print(f"Error: MBTiles generation failed for {input_file.name}")
            if result.stderr:
                lines = [l for l in result.stderr.strip().split('\n') if l.strip()][-10:]
                print('\n'.join(lines))
            return False
    except subprocess.TimeoutExpired:
        print(f"Error: Timed out generating MBTiles for {input_file.name}")
        return False
    except Exception as e:
        print(f"Error generating MBTiles: {e}")
        return False


def convert_to_pmtiles(mbtiles_path: Path, pmtiles_path: Path) -> bool:
    """Convert MBTiles to PMTiles using pmtiles Python module."""
    try:
        from pmtiles.convert import mbtiles_to_pmtiles
        
        if pmtiles_path.exists():
            pmtiles_path.unlink()
        
        mbtiles_to_pmtiles(str(mbtiles_path), str(pmtiles_path), maxzoom=18)
        
        if pmtiles_path.exists() and pmtiles_path.stat().st_size > 100000:
            return True
        else:
            print(f"Error: PMTiles conversion failed for {mbtiles_path.name}")
            return False
    except ImportError:
        print("Error: pmtiles module not found. Install with: pip install pmtiles")
        return False
    except Exception as e:
        print(f"Error converting to PMTiles: {e}")
        return False


def load_popup_config(source_dir: Path) -> Dict:
    """
    Load popup configuration from popup-config.json.
    Returns empty dict if file doesn't exist or is invalid.
    """
    popup_config_path = source_dir.parent / 'popup-config.json'
    if not popup_config_path.exists():
        return {}
    
    try:
        with open(popup_config_path, 'r', encoding='utf-8') as f:
            return json.load(f)
    except Exception as e:
        print(f"Warning: Failed to load popup-config.json: {e}")
        return {}


def load_existing_manifest_ui_popups(manifest_path: Path) -> Dict[str, Dict]:
    """
    Load existing ui.popup entries from a manifest file.
    Returns dict mapping layer_id -> ui.popup config.
    """
    if not manifest_path.exists():
        return {}
    
    try:
        with open(manifest_path, 'r', encoding='utf-8') as f:
            manifest = json.load(f)
            existing_popups = {}
            for layer in manifest.get('layers', []):
                layer_id = layer.get('id')
                if layer_id and 'ui' in layer and 'popup' in layer['ui']:
                    existing_popups[layer_id] = layer['ui']['popup']
            return existing_popups
    except Exception as e:
        print(f"  Warning: Could not read existing manifest for popup preservation: {e}")
        return {}


def process_pack(pack_dir: Path, output_dir: Path, cache: Dict, popup_config: Dict = None) -> bool:
    """
    Process a single layer pack:
    - Find all GeoJSON files
    - Parse corresponding .lyrx styles
    - Convert large files to PMTiles
    - Generate manifest.json and styles.json
    - Merge popup configuration from popup-config.json
    """
    if popup_config is None:
        popup_config = {}
    
    pack_id = pack_dir.name
    pack_output = output_dir / pack_id
    pack_output.mkdir(parents=True, exist_ok=True)
    
    print(f"\nProcessing pack: {pack_id}")
    
    # Load existing manifest to preserve ui.popup if popup-config is missing
    manifest_path = pack_output / 'manifest.json'
    existing_popups = load_existing_manifest_ui_popups(manifest_path)
    
    # Find all GeoJSON files
    gis_dir = pack_dir / 'gis'
    styles_dir = pack_dir / 'styles'
    
    # Also check root of pack_dir for legacy structure
    geojson_files = []
    if gis_dir.exists():
        geojson_files.extend(gis_dir.glob('*.json'))
        geojson_files.extend(gis_dir.glob('*.geojson'))
    else:
        geojson_files.extend(pack_dir.glob('*.json'))
        geojson_files.extend(pack_dir.glob('*.geojson'))
    
    if not geojson_files:
        print(f"  No GeoJSON files found in {pack_id}")
        return False
    
    layers = []
    styles = {}
    
    for geojson_file in geojson_files:
        # Get layer name (filename without extension)
        layer_name = geojson_file.stem
        layer_id = normalize_layer_id(layer_name)
        
        # Check cache
        file_hash = compute_file_hash(geojson_file)
        cache_key = f"{pack_id}/{layer_name}"
        
        # Find corresponding .lyrx file using robust matching
        lyrx_file, match_method = find_lyrx_file(geojson_file, styles_dir)
        
        # Check if .lyrx file changed
        lyrx_hash = None
        if lyrx_file and lyrx_file.exists():
            lyrx_hash = compute_file_hash(lyrx_file)
        
        cached_entry = cache.get(cache_key, {})
        needs_processing = (
            cached_entry.get('hash') != file_hash or
            (lyrx_hash and cached_entry.get('lyrx_hash') != lyrx_hash)
        )
        
        # Check if cached GeoJSON output file exists
        cached_geojson_file = pack_output / f"{layer_id}.geojson"
        cached_pmtiles_file = pack_output / f"{layer_id}.pmtiles"
        
        if not needs_processing and cached_geojson_file.exists():
            print(f"  Skipping {layer_name} (unchanged)")
            # Still add to manifest
            geometry_type = get_geometry_type(geojson_file)
            layer_entry = {
                'id': layer_id,
                'name': layer_name,
                'file': cached_geojson_file.name,
                'format': 'geojson',
                'geometryType': geometry_type
            }
            # Add PMTiles if it exists
            if cached_pmtiles_file.exists():
                layer_entry['pmtilesFile'] = cached_pmtiles_file.name
            
            # Merge popup config if available
            pack_popup_config = popup_config.get(pack_id, {}).get('layers', {})
            if layer_id in pack_popup_config:
                layer_entry['ui'] = {'popup': pack_popup_config[layer_id]}
            elif layer_id in existing_popups:
                # Preserve existing popup if no config found
                layer_entry['ui'] = {'popup': existing_popups[layer_id]}
            
            layers.append(layer_entry)
            # Load cached style if available
            if cached_entry.get('style'):
                styles[layer_id] = cached_entry['style']
            continue
        
        print(f"  Processing {layer_name}...")
        
        # Parse style
        style_config = None
        if lyrx_file and lyrx_file.exists():
            style_config = parse_lyrx_style(lyrx_file)
            if style_config:
                # Update geometry type from style if available
                geometry_type = style_config.get('type', get_geometry_type(geojson_file))
                style_config['type'] = geometry_type
        else:
            geometry_type = get_geometry_type(geojson_file)
            # Default style
            style_config = {
                'type': geometry_type,
                'renderer': 'simple',
                'defaultStyle': {
                    'fillColor': '#808080',
                    'fillOpacity': 0.7,
                    'strokeColor': '#000000',
                    'strokeWidth': 1.0
                }
            }
        
        # Transform coordinates if needed
        wgs84_file = pack_output / f"{layer_id}_wgs84.json"
        if not transform_to_wgs84(geojson_file, wgs84_file):
            print(f"    Warning: Coordinate transformation failed, using original")
            wgs84_file = geojson_file
        
        # Always keep GeoJSON for projection compatibility
        geojson_output_file = pack_output / f"{layer_id}.geojson"
        
        # Copy transformed GeoJSON file (always keep this)
        if wgs84_file != geojson_file:
            import shutil
            shutil.copy2(wgs84_file, geojson_output_file)
        else:
            import shutil
            shutil.copy2(geojson_file, geojson_output_file)
        
        # Check if should also create PMTiles (for GIS performance)
        pmtiles_file = None
        if should_convert_to_pmtiles(geojson_file, layer_id):
            pmtiles_file = pack_output / f"{layer_id}.pmtiles"
            
            # Check if PMTiles already exists and source hasn't changed
            pmtiles_exists = pmtiles_file.exists()
            source_unchanged = cached_entry.get('hash') == file_hash
            
            # Skip PMTiles generation if file exists and source is unchanged
            if pmtiles_exists and source_unchanged:
                print(f"    PMTiles already exists (source unchanged), skipping generation")
            else:
                print(f"    Also creating PMTiles (large file)...")
                temp_mbtiles = pack_output / f"{layer_id}.mbtiles"
                
                if generate_mbtiles(wgs84_file, temp_mbtiles):
                    if convert_to_pmtiles(temp_mbtiles, pmtiles_file):
                        print(f"    Created PMTiles (keeping GeoJSON for projection)")
                    else:
                        print(f"    Warning: PMTiles conversion failed, GeoJSON only")
                        pmtiles_file = None
                else:
                    print(f"    Warning: MBTiles generation failed, GeoJSON only")
                    pmtiles_file = None
                
                # Clean up temp files
                if temp_mbtiles.exists():
                    temp_mbtiles.unlink()
        
        # Add to layers list
        layer_entry = {
            'id': layer_id,
            'name': layer_name,
            'file': geojson_output_file.name,  # Always use GeoJSON as primary file
            'format': 'geojson',  # Format is always geojson for projection compatibility
            'geometryType': geometry_type
        }
        
        # Add PMTiles file reference if it exists
        if pmtiles_file and pmtiles_file.exists():
            layer_entry['pmtilesFile'] = pmtiles_file.name
        
        # Merge popup config if available
        pack_popup_config = popup_config.get(pack_id, {}).get('layers', {})
        if layer_id in pack_popup_config:
            layer_entry['ui'] = {'popup': pack_popup_config[layer_id]}
        elif layer_id in existing_popups:
            # Preserve existing popup if no config found
            layer_entry['ui'] = {'popup': existing_popups[layer_id]}
        
        layers.append(layer_entry)
        
        # Store style
        if style_config:
            styles[layer_id] = style_config
        
        # Update cache
        cache[cache_key] = {
            'hash': file_hash,
            'lyrx_hash': lyrx_hash,
            'style': style_config,
            'format': 'geojson',  # Always geojson (PMTiles is additional)
            'has_pmtiles': pmtiles_file is not None and pmtiles_file.exists()
        }
    
    # Generate manifest.json
    manifest = {
        'id': pack_id,
        'name': pack_id.replace('_', ' ').title(),
        'layers': layers
    }
    
    manifest_path = pack_output / 'manifest.json'
    with open(manifest_path, 'w', encoding='utf-8') as f:
        json.dump(manifest, f, indent=2, ensure_ascii=False)
    
    # Generate styles.json
    styles_path = pack_output / 'styles.json'
    with open(styles_path, 'w', encoding='utf-8') as f:
        json.dump(styles, f, indent=2, ensure_ascii=False)
    
    print(f"  Processed {len(layers)} layers")
    return True


def main():
    parser = argparse.ArgumentParser(description='Process layer packs for OTEF interactive')
    parser.add_argument('--source', required=True, help='Source layers directory')
    parser.add_argument('--output', required=True, help='Output processed layers directory')
    parser.add_argument('--no-cache', action='store_true', help='Disable caching')
    
    args = parser.parse_args()
    
    source_dir = Path(args.source)
    output_dir = Path(args.output)
    cache_path = output_dir / CACHE_FILE
    
    if not source_dir.exists():
        print(f"Error: Source directory does not exist: {source_dir}")
        sys.exit(1)
    
    output_dir.mkdir(parents=True, exist_ok=True)
    
    # Load cache
    cache = {} if args.no_cache else load_cache(cache_path)
    
    # Load popup configuration
    popup_config = load_popup_config(source_dir)
    
    # Discover packs from source directory
    packs = scan_layer_packs(source_dir)
    newly_processed_packs = []
    
    if not packs:
        print(f"No layer packs found in {source_dir}")
    else:
        print(f"Found {len(packs)} layer pack(s) in source directory")
        
        # Process each pack and track which ones have layers
        for pack_dir in packs:
            if process_pack(pack_dir, output_dir, cache, popup_config):
                # Only include packs that have at least one layer
                newly_processed_packs.append(pack_dir.name)
        
        # Save cache
        if not args.no_cache:
            save_cache(cache_path, cache)
    
    # Discover existing processed packs (that weren't just processed)
    print(f"\nScanning for existing processed packs...")
    existing_processed_packs = scan_processed_packs(output_dir)
    
    # Combine newly processed and existing processed packs (avoid duplicates)
    all_pack_ids = set(newly_processed_packs)
    all_pack_ids.update(existing_processed_packs)
    
    if existing_processed_packs:
        print(f"Found {len(existing_processed_packs)} existing processed pack(s)")
    
    # Always generate root manifest - include both newly processed and existing packs
    root_manifest = {
        'packs': sorted(list(all_pack_ids))
    }
    root_manifest_path = output_dir / 'layers-manifest.json'
    with open(root_manifest_path, 'w', encoding='utf-8') as f:
        json.dump(root_manifest, f, indent=2, ensure_ascii=False)
    
    print(f"\nProcessing complete. Output: {output_dir}")


if __name__ == '__main__':
    main()
