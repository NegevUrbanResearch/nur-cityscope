#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Create two versions of model:
1. model.png - for projection (keep white background)
2. model-transparent.png - for interactive (transparent white background)
"""

from PIL import Image
import numpy as np
from pathlib import Path

def create_model_versions():
    project_root = Path(__file__).parent.parent
    tif_path = project_root / "data-source" / "model" / "Model.tif"
    output_proj = project_root / "frontend" / "data" / "model.png"
    output_interactive = project_root / "frontend" / "data" / "model-transparent.png"
    
    print(f"Loading {tif_path}...")
    img = Image.open(tif_path)
    
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

if __name__ == '__main__':
    create_model_versions()

