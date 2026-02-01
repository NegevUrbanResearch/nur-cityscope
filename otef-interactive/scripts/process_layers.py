#!/usr/bin/env python3
"""
OTEF Layer Processing Wrapper
This script points to the modularized otef_layer_processing package.
"""
import sys
import os
from pathlib import Path

# Add current directory to path so the package can be imported
sys.path.append(str(Path(__file__).parent))

try:
    from otef_layer_processing.cli import main
except ImportError as e:
    print(f"Error: Could not import otef_layer_processing package: {e}")
    sys.exit(1)

if __name__ == "__main__":
    main()
