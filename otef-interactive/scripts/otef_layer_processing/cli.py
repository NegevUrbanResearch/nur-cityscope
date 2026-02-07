import argparse
import sys
import logging
from pathlib import Path
from .orchestrator import ProcessingOrchestrator

import os

def main():
    default_workers = max(1, (os.cpu_count() or 1) - 1)

    parser = argparse.ArgumentParser(
        description="Process layer packs for OTEF interactive (Modularized)"
    )
    parser.add_argument("--source", required=True, help="Source layers directory")
    parser.add_argument("--output", required=True, help="Output processed layers directory")
    parser.add_argument("--no-cache", action="store_true", help="Disable caching")
    parser.add_argument(
        "--metadata-only",
        action="store_true",
        help="Only regenerate manifest.json and styles.json (no transform/tiling)",
    )
    parser.add_argument("--parallel", type=int, default=default_workers, help=f"Number of parallel processes (default: {default_workers})")
    parser.add_argument("--debug", action="store_true", help="Enable debug logging")

    args = parser.parse_args()

    log_level = logging.DEBUG if args.debug else logging.INFO
    from .orchestrator import setup_logging
    setup_logging(log_level)

    source_dir = Path(args.source)
    output_dir = Path(args.output)

    if not source_dir.exists():
        print(f"Error: Source directory does not exist: {source_dir}")
        sys.exit(1)

    orchestrator = ProcessingOrchestrator(
        source_dir=source_dir,
        output_dir=output_dir,
        no_cache=args.no_cache,
        max_workers=args.parallel,
    )

    if args.metadata_only:
        orchestrator.update_metadata_only()
    else:
        orchestrator.process_all()

if __name__ == "__main__":
    main()
