"""
Re-create manifest.json and styles.json for all layer packs without touching
geodata or tiles. This script is a thin shell around the same CLI used by
process_layers.py, with --metadata-only so metadata (including advanced styles)
is built by the same code path as full processing.
"""
import sys
from pathlib import Path

# Add scripts directory so otef_layer_processing can be imported
sys.path.insert(0, str(Path(__file__).resolve().parent))

# Invoke the same CLI as process_layers with fixed paths and --metadata-only
base_dir = Path(__file__).resolve().parent.parent
source = base_dir / "public" / "source" / "layers"
output = base_dir / "public" / "processed" / "layers"

if not source.exists():
    source = Path("otef-interactive/public/source/layers")
    output = Path("otef-interactive/public/processed/layers")

if not source.exists():
    print(f"Error: Source directory not found: {source}", file=sys.stderr)
    sys.exit(1)

sys.argv = [
    "reprocess_metadata.py",
    "--source",
    str(source),
    "--output",
    str(output),
    "--metadata-only",
    "--no-cache",
]

from otef_layer_processing.cli import main

if __name__ == "__main__":
    main()
