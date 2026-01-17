#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Simplify GeoJSON geometries for better web performance.

This script reduces the number of vertices in geometries while maintaining
visual appearance. Uses the Douglas-Peucker algorithm.
"""

import json
import sys
from pathlib import Path

# Try to import simplification libraries
try:
    from simplification.cutil import simplify_coords
    SIMPLIFICATION_AVAILABLE = True
except ImportError:
    print("WARNING: simplification library not installed")
    print("Install with: pip install simplification")
    SIMPLIFICATION_AVAILABLE = False


class GeometrySimplifier:
    """Simplify GeoJSON geometries"""
    
    def __init__(self, project_root, tolerance=1.0):
        self.project_root = Path(project_root)
        self.tolerance = tolerance
        self.stats = {
            'original_vertices': 0,
            'simplified_vertices': 0,
            'features_processed': 0
        }
    
    def simplify_coords(self, coords, depth=0):
        """
        Recursively simplify coordinates using Douglas-Peucker algorithm.
        """
        if not SIMPLIFICATION_AVAILABLE:
            return coords
        
        if depth > 10:  # Safety limit
            return coords
        
        # Check if this is a coordinate pair [x, y]
        if isinstance(coords[0], (int, float)):
            return coords
        
        # Check if this is a list of coordinate pairs
        if len(coords) > 0 and isinstance(coords[0], list) and len(coords[0]) >= 2 and isinstance(coords[0][0], (int, float)):
            # This is a list of coordinates - simplify it
            if len(coords) < 4:  # Too few points to simplify
                return coords
            
            # Convert to list of tuples for simplification
            coords_tuples = [(c[0], c[1]) for c in coords]
            
            # Track original count
            self.stats['original_vertices'] += len(coords)
            
            try:
                # Apply Douglas-Peucker simplification
                simplified = simplify_coords(coords_tuples, self.tolerance)
                
                # Convert back to list format
                result = [[x, y] for x, y in simplified]
                
                # Track simplified count
                self.stats['simplified_vertices'] += len(result)
                
                return result
            except Exception as e:
                print(f"    Warning: Could not simplify coordinates: {e}")
                self.stats['simplified_vertices'] += len(coords)
                return coords
        else:
            # Recurse into nested structure
            return [self.simplify_coords(c, depth + 1) for c in coords]
    
    def simplify_geometry(self, geometry):
        """Simplify a GeoJSON geometry"""
        if not geometry or 'coordinates' not in geometry:
            return geometry
        
        simplified = geometry.copy()
        simplified['coordinates'] = self.simplify_coords(geometry['coordinates'])
        return simplified
    
    def simplify_geojson(self, input_file, output_file, tolerance=1.0):
        """Simplify a GeoJSON file"""
        self.tolerance = tolerance
        self.stats = {
            'original_vertices': 0,
            'simplified_vertices': 0,
            'features_processed': 0
        }
        
        print(f"\nSimplifying: {input_file.name}")
        print(f"Tolerance: {tolerance} meters")
        
        # Load
        with open(input_file, 'r', encoding='utf-8') as f:
            data = json.load(f)
        
        features = data.get('features', [])
        print(f"Features: {len(features)}")
        
        # Simplify each feature
        for feature in features:
            if 'geometry' in feature:
                feature['geometry'] = self.simplify_geometry(feature['geometry'])
                self.stats['features_processed'] += 1
        
        # Save
        output_file.parent.mkdir(parents=True, exist_ok=True)
        with open(output_file, 'w', encoding='utf-8') as f:
            json.dump(data, f, ensure_ascii=False)
        
        # Report
        original_size = input_file.stat().st_size / (1024 * 1024)
        simplified_size = output_file.stat().st_size / (1024 * 1024)
        reduction = ((original_size - simplified_size) / original_size) * 100
        
        vertex_reduction = 0
        if self.stats['original_vertices'] > 0:
            vertex_reduction = ((self.stats['original_vertices'] - self.stats['simplified_vertices']) / 
                              self.stats['original_vertices']) * 100
        
        print(f"Output: {output_file.name}")
        print(f"File size: {original_size:.2f} MB -> {simplified_size:.2f} MB ({reduction:.1f}% reduction)")
        if vertex_reduction > 0:
            print(f"Vertices: {self.stats['original_vertices']:,} -> {self.stats['simplified_vertices']:,} ({vertex_reduction:.1f}% reduction)")
        print(f"Features processed: {self.stats['features_processed']}")


def main():
    script_dir = Path(__file__).parent
    project_root = script_dir.parent
    
    if not SIMPLIFICATION_AVAILABLE:
        print("\n" + "!" * 80)
        print("ERROR: simplification library not available")
        print("Install with: pip install simplification")
        print("!" * 80)
        return
    
    simplifier = GeometrySimplifier(project_root)
    
    print("=" * 80)
    print("GEOMETRY SIMPLIFICATION")
    print("=" * 80)
    print(f"Project root: {project_root}\n")
    
    # Simplify parcels (aggressive - for web display)
    parcels_input = project_root / "public" / "layers" / "migrashim.json"
    parcels_output = project_root / "public" / "layers-simplified" / "migrashim_simplified.json"
    
    if parcels_input.exists():
        # Use 5-meter tolerance for parcels (won't be visually noticeable)
        simplifier.simplify_geojson(parcels_input, parcels_output, tolerance=5.0)
    else:
        print(f"WARNING: {parcels_input} not found")
    
    # Simplify roads (moderate - need more detail for roads)
    roads_input = project_root / "public" / "layers-fixed" / "small_roads_fixed.json"
    roads_output = project_root / "public" / "layers-simplified" / "small_roads_simplified.json"
    
    if roads_input.exists():
        # Use 2-meter tolerance for roads
        simplifier.simplify_geojson(roads_input, roads_output, tolerance=2.0)
    else:
        print(f"WARNING: {roads_input} not found")
    
    print("\n" + "=" * 80)
    print("SIMPLIFICATION COMPLETE!")
    print("=" * 80)
    print("\nTo use simplified layers, update your frontend code:")
    print("- Use '../public/layers-simplified/migrashim_simplified.json'")
    print("- Use '../public/layers-simplified/small_roads_simplified.json'")
    print("\nNote: Always keep original files as backup!")


if __name__ == '__main__':
    main()

