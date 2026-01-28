import json
import logging
from pathlib import Path
from otef_layer_processing.styles import find_lyrx_file, parse_lyrx_style
from otef_layer_processing.models import LayerEntry, PackManifest, StyleConfig
from otef_layer_processing.geo import get_geometry_type

# Configure logging
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

def update_metadata_only(source_dir: Path, processed_dir: Path):
    """
    Updates styles.json and manifest.json for all layers without touching geojson/pmtiles.
    """
    source_layers = source_dir / "source" / "layers"
    if not source_layers.exists():
        source_layers = source_dir

    processed_packs = []

    for pack_dir in source_layers.iterdir():
        if not pack_dir.is_dir() or pack_dir.name.startswith("."):
            continue

        pack_id = pack_dir.name
        processed_pack_dir = processed_dir / pack_id
        if not processed_pack_dir.exists():
            continue

        logger.info(f"Updating metadata for pack: {pack_id}")

        gis_dir = pack_dir / "gis" if (pack_dir / "gis").exists() else pack_dir
        styles_dir = pack_dir / "styles"
        geo_files = list(gis_dir.glob("*.json")) + list(gis_dir.glob("*.geojson"))

        # Load existing manifest if possible to preserve some data
        manifest_path = processed_pack_dir / "manifest.json"
        existing_layers = {}
        if manifest_path.exists():
            try:
                with open(manifest_path, "r", encoding="utf-8") as f:
                    data = json.load(f)
                    for l in data.get("layers", []):
                        existing_layers[l["id"]] = l
            except Exception as e:
                logger.warning(f"Could not load existing manifest for {pack_id}: {e}")

        new_layers = []
        new_styles = {}

        for geo_file in geo_files:
            layer_id = geo_file.stem
            logger.info(f"  Processing layer: {layer_id}")

            # Find and parse style
            lyrx_file, _ = find_lyrx_file(geo_file, styles_dir)
            style_config = None
            geom_type = "unknown"

            if lyrx_file:
                style_obj = parse_lyrx_style(lyrx_file)
                if style_obj:
                    style_config = style_obj.to_dict()
                    geom_type = style_obj.geometry_type

            if geom_type == "unknown":
                # Check processed file for geometry type if possible, or use existing
                processed_geo = processed_pack_dir / f"{layer_id}.geojson"
                if processed_geo.exists():
                    geom_type = get_geometry_type(processed_geo)
                elif layer_id in existing_layers:
                    geom_type = existing_layers[layer_id].get("geometryType", "unknown")

            # Create layer entry
            entry = LayerEntry(
                id=layer_id,
                name=layer_id,
                file=f"{layer_id}.geojson",
                geometry_type=geom_type,
                pmtiles_file=f"{layer_id}.pmtiles" if (processed_pack_dir / f"{layer_id}.pmtiles").exists() else None,
                ui_popup=existing_layers.get(layer_id, {}).get("ui", {}).get("popup")
            )

            new_layers.append(entry)
            if style_config:
                new_styles[layer_id] = style_config

        # Write updated files
        if new_layers:
            new_layers.sort(key=lambda x: x.id)
            manifest = PackManifest(id=pack_id, name=pack_id.title().replace("_", " "), layers=new_layers)

            with open(processed_pack_dir / "manifest.json", "w", encoding="utf-8") as f:
                json.dump(manifest.to_dict(), f, indent=2)

            # Load existing styles and merge/overwrite
            styles_path = processed_pack_dir / "styles.json"
            current_styles = {}
            if styles_path.exists():
                try:
                    with open(styles_path, "r", encoding="utf-8") as f:
                        current_styles = json.load(f)
                except:
                    pass

            # Merge new styles into current ones
            current_styles.update(new_styles)

            with open(processed_pack_dir / "styles.json", "w", encoding="utf-8") as f:
                json.dump(current_styles, f, indent=2)

            processed_packs.append(pack_id)

    # Update root manifest
    root_manifest = {"packs": sorted(processed_packs)}
    with open(processed_dir / "layers-manifest.json", "w", encoding="utf-8") as f:
        json.dump(root_manifest, f, indent=2)

    logger.info("Metadata update complete.")

if __name__ == "__main__":
    import sys
    source = Path("public/source/layers")
    output = Path("public/processed/layers")
    update_metadata_only(source, output)
