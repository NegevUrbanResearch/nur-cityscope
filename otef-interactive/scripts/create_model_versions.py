#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Create two versions of model:
1. model.png - for projection (keep white background)
2. model-transparent.png - for interactive (transparent white background)
3. model-bounds.json - georeferencing bounds from TFW file
"""

from PIL import Image
import numpy as np
import json
from pathlib import Path

def create_model_versions():
    project_root = Path(__file__).parent.parent
    tif_path = project_root / "data-source" / "model" / "Model.tif"
    tfw_path = project_root / "data-source" / "model" / "Model.tfw"
    output_proj = project_root / "frontend" / "data" / "model.png"
    output_interactive = project_root / "frontend" / "data" / "model-transparent.png"
    output_bounds = project_root / "frontend" / "data" / "model-bounds.json"
    
    print(f"Loading {tif_path}...")
    img = Image.open(tif_path)
    width, height = img.width, img.height
    
    # Read TFW file for georeferencing
    print(f"Reading georeferencing from {tfw_path}...")
    try:
        with open(tfw_path, 'r') as f:
            lines = [line.strip() for line in f.readlines() if line.strip()]
        
        if len(lines) >= 6:
            pixel_size_x = float(lines[0])
            pixel_size_y = float(lines[3])
            x_coord = float(lines[4])
            y_coord = float(lines[5])
            
            # Calculate bounds (TFW gives upper-left corner)
            west = x_coord
            north = y_coord
            east = x_coord + (width * pixel_size_x)
            south = y_coord + (height * pixel_size_y)
            
            # Calculate average pixel size
            pixel_size = abs((pixel_size_x + pixel_size_y) / 2)
            
            bounds = {
                "west": round(west, 2),
                "south": round(south, 2),
                "east": round(east, 2),
                "north": round(north, 2),
                "crs": "EPSG:2039",
                "pixel_size": round(pixel_size, 2),
                "image_width": width,
                "image_height": height
            }
            
            with open(output_bounds, 'w') as f:
                json.dump(bounds, f, indent=2)
            print(f"Updated: {output_bounds}")
        else:
            print(f"Warning: TFW file has insufficient data, skipping bounds update")
    except Exception as e:
        print(f"Warning: Could not read/update bounds from TFW: {e}")
    
    # For projection: keep as-is, convert to RGB PNG
    print(f"Creating projection version (with white background)...")
    img_rgb = img.convert('RGB')
    img_rgb.save(output_proj, 'PNG', optimize=True)
    print(f"Saved: {output_proj}")
    
    # For interactive: make white background transparent
    print(f"Creating interactive version (transparent white background)...")
    if img.mode != 'RGBA':
        img = img.convert('RGBA')
    
    data = np.array(img)
    r, g, b, a = data[:,:,0], data[:,:,1], data[:,:,2], data[:,:,3]
    
    # Make white/near-white pixels transparent
    white_threshold = 245
    white_mask = (r > white_threshold) & (g > white_threshold) & (b > white_threshold)
    data[white_mask, 3] = 0  # Set alpha to 0 (transparent)
    
    white_count = np.sum(white_mask)
    print(f"Made {white_count:,} white pixels transparent")
    
    interactive_img = Image.fromarray(data, 'RGBA')
    interactive_img.save(output_interactive, 'PNG', optimize=True)
    print(f"Saved: {output_interactive}")
    
    print("\nDone!")
    print("- model.png: Original with white background (for projection)")
    print("- model-transparent.png: White background transparent (for interactive)")
    print("- model-bounds.json: Georeferencing bounds updated")

if __name__ == '__main__':
    create_model_versions()

