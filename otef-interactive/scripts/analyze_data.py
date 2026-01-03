#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Analyze OTEF model and layer files to understand their structure and content.
This script provides detailed breakdowns of:
- Model TIF/TFW files (georeferencing, dimensions, coordinate system)
- GeoJSON layer files (geometry types, properties, bounds, feature counts)
"""

import json
import os
import sys
from pathlib import Path
from collections import Counter, defaultdict

# Set UTF-8 encoding for console output (Windows fix)
if sys.platform == 'win32':
    try:
        import io
        sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')
        sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding='utf-8', errors='replace')
    except Exception:
        pass  # Fallback to default encoding

try:
    from PIL import Image
except ImportError:
    print("WARNING: Pillow not installed. Model image analysis will be limited.")
    Image = None


class DataAnalyzer:
    """Analyzes OTEF data files"""
    
    def __init__(self, project_root):
        self.project_root = Path(project_root)
        self.data_source = self.project_root / "data-source"
        self.model_dir = self.data_source / "model"
        self.layers_dir = self.data_source / "layers"
        
    def analyze_all(self):
        """Run all analyses"""
        print("=" * 80)
        print("OTEF DATA ANALYSIS")
        print("=" * 80)
        print()
        
        # Analyze model
        self.analyze_model()
        print()
        
        # Analyze layers
        self.analyze_layers()
        print()
        
        print("=" * 80)
        print("ANALYSIS COMPLETE")
        print("=" * 80)
    
    def analyze_model(self):
        """Analyze the model TIF and TFW files"""
        print("-" * 80)
        print("MODEL ANALYSIS")
        print("-" * 80)
        
        tif_path = self.model_dir / "Model.tif"
        tfw_path = self.model_dir / "Model.tfw"
        
        # Check if files exist
        if not tif_path.exists():
            print(f"ERROR: Model TIF not found at {tif_path}")
            return
        if not tfw_path.exists():
            print(f"ERROR: Model TFW not found at {tfw_path}")
            return
        
        # Analyze TIF
        print("\n[MODEL IMAGE - Model.tif]")
        print(f"  File size: {tif_path.stat().st_size / (1024*1024):.2f} MB")
        
        if Image:
            try:
                img = Image.open(tif_path)
                print(f"  Dimensions: {img.width} x {img.height} pixels")
                print(f"  Mode: {img.mode}")
                print(f"  Format: {img.format}")
                
                # Get additional info
                if hasattr(img, 'info'):
                    if 'dpi' in img.info:
                        print(f"  DPI: {img.info['dpi']}")
                
                img.close()
            except Exception as e:
                print(f"  ERROR reading image: {e}")
        
        # Analyze TFW (world file)
        print("\n[GEOREFERENCING - Model.tfw]")
        try:
            with open(tfw_path, 'r') as f:
                lines = [line.strip() for line in f.readlines() if line.strip()]
            
            if len(lines) >= 6:
                pixel_size_x = float(lines[0])
                rotation_y = float(lines[1])
                rotation_x = float(lines[2])
                pixel_size_y = float(lines[3])
                x_coord = float(lines[4])
                y_coord = float(lines[5])
                
                print(f"  Pixel size X: {pixel_size_x:.6f} meters")
                print(f"  Pixel size Y: {pixel_size_y:.6f} meters")
                print(f"  Rotation X: {rotation_x}")
                print(f"  Rotation Y: {rotation_y}")
                print(f"  Upper-left X: {x_coord:.2f}")
                print(f"  Upper-left Y: {y_coord:.2f}")
                print(f"  Coordinate System: EPSG:2039 (Israel TM Grid)")
                
                # Calculate bounds if we have image dimensions
                if Image:
                    try:
                        img = Image.open(tif_path)
                        width, height = img.width, img.height
                        img.close()
                        
                        # Calculate bounds
                        west = x_coord
                        north = y_coord
                        east = x_coord + (width * pixel_size_x)
                        south = y_coord + (height * pixel_size_y)
                        
                        print(f"\n  Calculated Bounds (EPSG:2039):")
                        print(f"    West:  {west:.2f}")
                        print(f"    East:  {east:.2f}")
                        print(f"    South: {south:.2f}")
                        print(f"    North: {north:.2f}")
                        print(f"    Width: {east - west:.2f} meters")
                        print(f"    Height: {north - south:.2f} meters")
                        
                    except Exception as e:
                        print(f"  Could not calculate bounds: {e}")
                        
        except Exception as e:
            print(f"  ERROR reading TFW: {e}")
    
    def analyze_layers(self):
        """Analyze all GeoJSON layer files"""
        print("-" * 80)
        print("LAYERS ANALYSIS")
        print("-" * 80)
        
        if not self.layers_dir.exists():
            print(f"ERROR: Layers directory not found at {self.layers_dir}")
            return
        
        # Find all JSON files
        json_files = list(self.layers_dir.glob("*.json"))
        
        if not json_files:
            print(f"No JSON files found in {self.layers_dir}")
            return
        
        print(f"\nFound {len(json_files)} layer file(s)")
        
        for json_file in sorted(json_files):
            self.analyze_layer_file(json_file)
    
    def analyze_layer_file(self, file_path):
        """Analyze a single GeoJSON layer file"""
        print(f"\n{'=' * 80}")
        print(f"[LAYER: {file_path.name}]")
        print(f"{'=' * 80}")
        
        # File size
        file_size_mb = file_path.stat().st_size / (1024 * 1024)
        print(f"\nFile size: {file_size_mb:.2f} MB")
        
        # Parse JSON
        print("Parsing JSON (this may take a moment for large files)...")
        try:
            with open(file_path, 'r', encoding='utf-8') as f:
                data = json.load(f)
        except Exception as e:
            print(f"ERROR: Could not parse JSON: {e}")
            return
        
        # Basic structure
        print("\n--- STRUCTURE ---")
        print(f"Type: {data.get('type', 'UNKNOWN')}")
        
        # CRS information
        if 'crs' in data:
            crs = data['crs']
            if 'properties' in crs and 'name' in crs['properties']:
                print(f"CRS: {crs['properties']['name']}")
            else:
                print(f"CRS: {crs}")
        else:
            print("CRS: Not specified (assumed WGS84/EPSG:4326)")
        
        # Features
        features = data.get('features', [])
        print(f"Feature count: {len(features):,}")
        
        if not features:
            print("No features found.")
            return
        
        # Analyze geometry types
        print("\n--- GEOMETRY TYPES ---")
        geometry_types = Counter()
        for feature in features:
            geom = feature.get('geometry', {})
            geom_type = geom.get('type', 'UNKNOWN')
            geometry_types[geom_type] += 1
        
        for geom_type, count in geometry_types.most_common():
            percentage = (count / len(features)) * 100
            print(f"  {geom_type}: {count:,} ({percentage:.1f}%)")
        
        # Analyze properties
        print("\n--- PROPERTIES ---")
        property_keys = set()
        property_samples = defaultdict(list)
        property_types = defaultdict(Counter)
        
        # Sample first 100 features for property analysis
        sample_size = min(100, len(features))
        for feature in features[:sample_size]:
            props = feature.get('properties', {})
            for key, value in props.items():
                property_keys.add(key)
                
                # Track type
                value_type = type(value).__name__
                property_types[key][value_type] += 1
                
                # Store sample values (first 3 unique)
                if len(property_samples[key]) < 3:
                    if value not in property_samples[key]:
                        property_samples[key].append(value)
        
        if property_keys:
            print(f"Found {len(property_keys)} property field(s):")
            for key in sorted(property_keys):
                types = property_types[key]
                type_str = ", ".join([f"{t}({c})" for t, c in types.items()])
                print(f"\n  '{key}':")
                print(f"    Types: {type_str}")
                
                samples = property_samples[key]
                if samples:
                    # Handle Unicode encoding issues in console output
                    try:
                        print(f"    Samples: {samples}")
                    except UnicodeEncodeError:
                        # Fallback for non-UTF8 terminals
                        safe_samples = [str(s).encode('utf-8', errors='replace').decode('utf-8', errors='replace') for s in samples]
                        print(f"    Samples: {safe_samples}")
        else:
            print("No properties found (features have no attributes).")
        
        # Calculate bounds
        print("\n--- SPATIAL BOUNDS ---")
        try:
            bounds = self.calculate_bounds(features)
            if bounds:
                min_x, min_y, max_x, max_y = bounds
                print(f"  Min X: {min_x:.6f}")
                print(f"  Max X: {max_x:.6f}")
                print(f"  Min Y: {min_y:.6f}")
                print(f"  Max Y: {max_y:.6f}")
                print(f"  Width: {max_x - min_x:.6f}")
                print(f"  Height: {max_y - min_y:.6f}")
                
                # Check if coordinates look like EPSG:2039 or WGS84
                if min_x > 1000:
                    print("  Coordinate system appears to be: EPSG:2039 (Israel TM Grid)")
                else:
                    print("  Coordinate system appears to be: WGS84 (EPSG:4326)")
        except Exception as e:
            print(f"  Could not calculate bounds: {e}")
        
        # Complexity analysis
        print("\n--- COMPLEXITY ---")
        try:
            vertex_counts = []
            for feature in features[:100]:  # Sample first 100
                count = self.count_vertices(feature.get('geometry', {}))
                if count > 0:
                    vertex_counts.append(count)
            
            if vertex_counts:
                avg_vertices = sum(vertex_counts) / len(vertex_counts)
                max_vertices = max(vertex_counts)
                min_vertices = min(vertex_counts)
                
                print(f"  Vertices per feature (sampled {len(vertex_counts)} features):")
                print(f"    Average: {avg_vertices:.1f}")
                print(f"    Min: {min_vertices}")
                print(f"    Max: {max_vertices}")
                
                # Estimate total vertices
                total_estimate = int(avg_vertices * len(features))
                print(f"  Estimated total vertices: {total_estimate:,}")
        except Exception as e:
            print(f"  Could not analyze complexity: {e}")
    
    def calculate_bounds(self, features):
        """Calculate bounding box for features"""
        min_x = min_y = float('inf')
        max_x = max_y = float('-inf')
        
        for feature in features:
            geom = feature.get('geometry', {})
            coords = self.extract_coordinates(geom)
            
            for coord in coords:
                if len(coord) >= 2:
                    x, y = coord[0], coord[1]
                    min_x = min(min_x, x)
                    max_x = max(max_x, x)
                    min_y = min(min_y, y)
                    max_y = max(max_y, y)
        
        if min_x == float('inf'):
            return None
        
        return (min_x, min_y, max_x, max_y)
    
    def extract_coordinates(self, geometry):
        """Extract all coordinates from a geometry"""
        coords = []
        geom_type = geometry.get('type', '')
        coordinates = geometry.get('coordinates', [])
        
        if geom_type == 'Point':
            coords.append(coordinates)
        elif geom_type == 'LineString':
            coords.extend(coordinates)
        elif geom_type == 'Polygon':
            for ring in coordinates:
                coords.extend(ring)
        elif geom_type == 'MultiPoint':
            coords.extend(coordinates)
        elif geom_type == 'MultiLineString':
            for line in coordinates:
                coords.extend(line)
        elif geom_type == 'MultiPolygon':
            for polygon in coordinates:
                for ring in polygon:
                    coords.extend(ring)
        elif geom_type == 'GeometryCollection':
            for geom in geometry.get('geometries', []):
                coords.extend(self.extract_coordinates(geom))
        
        return coords
    
    def count_vertices(self, geometry):
        """Count vertices in a geometry"""
        coords = self.extract_coordinates(geometry)
        return len(coords)


def main():
    # Determine project root
    script_dir = Path(__file__).parent
    project_root = script_dir.parent
    
    print(f"Project root: {project_root}")
    print()
    
    # Create analyzer and run
    analyzer = DataAnalyzer(project_root)
    analyzer.analyze_all()


if __name__ == '__main__':
    main()

