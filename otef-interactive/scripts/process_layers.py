#!/usr/bin/env python3
"""
OTEF Layer Processing Wrapper

If called without explicit --source/--output arguments, this script will
automatically resolve the default source and output layer directories,
similar to reprocess_metadata.py, so it can be run without parameters.
"""
import sys
from pathlib import Path

# Add current directory to path so the package can be imported
sys.path.append(str(Path(__file__).parent))


def _resolve_default_paths():
    """
    Resolve default source/output directories for layer processing.

    This mirrors the logic in reprocess_metadata.py so the script works both
    in-place in the repo and when installed elsewhere.
    """
    base_dir = Path(__file__).resolve().parent.parent
    source = base_dir / "public" / "source" / "layers"
    output = base_dir / "public" / "processed" / "layers"

    if not source.exists():
        source = Path("otef-interactive/public/source/layers")
        output = Path("otef-interactive/public/processed/layers")

    return source, output


def main_wrapper():
    # Import here after sys.path modification
    try:
        from otef_layer_processing.cli import main
    except ImportError as e:
        print(f"Error: Could not import otef_layer_processing package: {e}")
        sys.exit(1)

    argv = sys.argv[1:]
    has_explicit_paths = any(
        arg == "--source"
        or arg.startswith("--source=")
        or arg == "--output"
        or arg.startswith("--output=")
        for arg in argv
    )

    if not has_explicit_paths:
        source, output = _resolve_default_paths()
        if not source.exists():
            print(f"Error: Source directory not found: {source}", file=sys.stderr)
            sys.exit(1)
        sys.argv = [
            sys.argv[0],
            "--source",
            str(source),
            "--output",
            str(output),
            *argv,
        ]

    main()


if __name__ == "__main__":
    main_wrapper()
