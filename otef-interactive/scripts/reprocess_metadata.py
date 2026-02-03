import logging
import sys
from pathlib import Path

# Add current directory to path so the package can be imported
sys.path.append(str(Path(__file__).parent))

from otef_layer_processing.orchestrator import ProcessingOrchestrator

# Configure logging
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

def main():
    # Paths are relative to the scripts directory where this is run
    # Adjust as needed based on where you run it from
    base_dir = Path(__file__).parent.parent
    source = base_dir / "public" / "source" / "layers"
    output = base_dir / "public" / "processed" / "layers"

    if not source.exists():
         # Try fallback if running from root
        source = Path("otef-interactive/public/source/layers")
        output = Path("otef-interactive/public/processed/layers")

    if not source.exists():
        logger.error(f"Source directory not found: {source.absolute()}")
        sys.exit(1)

    logger.info(f"Using source: {source}")
    logger.info(f"Using output: {output}")

    # Initialize orchestrator
    # We pass source_dir as the parent of 'layers' if possible to help it find popup-config
    # But orchestrator.scan_packs expects to find a 'source/layers' or direct layers dir.
    # Let's point it to the valid root.

    # The Orchestrator expects "source_dir" to contain "source/layers" OR be the layers dir itself.
    # But it looks for popup-config in source_dir or source_dir.parent.

    # If we pass `public/source/layers` as source_dir:
    # - scan_packs: looks for subdirs (correct)
    # - load_popup_config: looks in `public/source/layers/popup-config.json` (no) or `public/source/popup-config.json` (YES)

    orchestrator = ProcessingOrchestrator(
        source_dir=source,
        output_dir=output,
        no_cache=True, # Metadata update should be fast enough to not need cache, and we want fresh config
        max_workers=4
    )

    orchestrator.update_metadata_only()

if __name__ == "__main__":
    main()
