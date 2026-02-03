
import csv
import json
import logging
from pathlib import Path

# Configure logging
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

def clean_key_for_matching(s):
    """
    Standardize string for fuzzy matching: lowercase, strip separators.
    """
    return s.strip().replace("_", "").replace("-", "").replace(" ", "").replace(",", "").lower()

def build_file_lookup_map(base_layers_dir):
    """
    Scans the layers directory and builds a map:
    cleaned_key -> { 'stem': filename_stem, 'pack_id': pack_folder_name }
    """
    lookup = {} # cleaned_key -> list of matches (to detect ambiguity)

    if not base_layers_dir.exists():
        logger.warning(f"Layers dir not found at {base_layers_dir}")
        return {}

    for pack_dir in base_layers_dir.iterdir():
        if not pack_dir.is_dir() or pack_dir.name.startswith("."):
            continue

        pack_id = pack_dir.name

        # Check gis folder and images folder
        gis_dir = pack_dir / "gis"
        images_dir = pack_dir / "images"

        files = []
        if gis_dir.exists():
            files.extend(list(gis_dir.glob("*.json")) + list(gis_dir.glob("*.geojson")))
        if images_dir.exists():
            files.extend(list(images_dir.glob("*.png")) + list(images_dir.glob("*.jpg")))

        for f in files:
            # Match orchestrator logic for ID
            if f.suffix in ['.png', '.jpg', '.jpeg'] and f.stem == 'model':
                layer_id = 'model_base'
            else:
                layer_id = f.stem

            clean_key = clean_key_for_matching(layer_id)

            if clean_key not in lookup:
                lookup[clean_key] = []

            lookup[clean_key].append({
                'actual_id': layer_id,
                'pack_id': pack_id,
                'path': str(f)
            })

    return lookup

def map_map_name_to_pack_id(map_name):
    # This mapping is still needed to categorize new unmapped layers from CSV
    # or to verify.
    mapping = {
        "בסיס - תמיד דלוק": "projector_base",
        "תחבורה ומועצות": "muniplicity_transport",
         "תחבורה ומועצות ": "muniplicity_transport",
        "ייעודי קרקע": "land_use",
        "ירוקים": "greens",
        "\"ירוקים\"": "greens",
        "7.1": "october_7th",
        "עתיד - מורשת, תקומה ופיתוח": "future_development"
    }
    return mapping.get(map_name.strip())

def update_popup_config():
    # Use relative paths or find project root
    script_path = Path(__file__).resolve()
    # Assume script is in [Root]/otef-interactive/scripts/update_popup_config.py
    # Project Root is script_path.parent.parent (otef-interactive)

    base_dir = script_path.parent.parent
    csv_path = base_dir / "scripts/outputs/layer_popup_fields_mapping.csv"
    json_path = base_dir / "public/source/popup-config.json"
    layers_dir = base_dir / "public/source/layers"

    if not csv_path.exists():
        logger.error(f"CSV not found at {csv_path}")
        return

    logger.info("Building file system lookup map...")
    file_lookup = build_file_lookup_map(layers_dir)
    logger.info(f"indexed {len(file_lookup)} unique cleaned layer keys from file system.")

    # Load existing JSON
    old_config = {}
    if json_path.exists():
        with open(json_path, "r", encoding="utf-8") as f:
            old_config = json.load(f)

    # Helper to find key from label in old config
    def find_key_for_label(pack_id, layer_id, label):
        if pack_id in old_config and "layers" in old_config[pack_id]:
             # Try exact layer_id
             if layer_id in old_config[pack_id]["layers"]:
                 fields = old_config[pack_id]["layers"][layer_id].get("fields", [])
                 for f in fields:
                     if f.get("label") == label: return f.get("key")
                     if f.get("key") == label: return f.get("key")
        return None

    new_config = {}

    with open(csv_path, "r", encoding="utf-8-sig") as f:
        reader = csv.DictReader(f)

        for row in reader:
            map_name = row.get("מפה", "")
            layer_name_he = row.get("שם שכבה", "")
            display_info = row.get("מידע להצגה", "")

            if not map_name or not layer_name_he:
                continue

            expected_pack_id = map_map_name_to_pack_id(map_name) # Guidance from CSV
            cleaned_query = clean_key_for_matching(layer_name_he)

            # Resolve Layer ID
            final_layer_id = None
            final_pack_id = expected_pack_id

            if cleaned_query in file_lookup:
                candidates = file_lookup[cleaned_query]
                # If multiple matches, try to filter by pack_id
                match = None
                if expected_pack_id:
                    for c in candidates:
                        if c['pack_id'] == expected_pack_id:
                            match = c
                            break

                # If no pack match or ambiguous, take first (or verify?)
                if not match and candidates:
                    match = candidates[0]
                    if expected_pack_id and match['pack_id'] != expected_pack_id:
                        logger.warning(f"Layer '{layer_name_he}' found in pack '{match['pack_id']}' but CSV says '{expected_pack_id}'. Using file system pack.")

                if match:
                    final_layer_id = match['actual_id']
                    final_pack_id = match['pack_id'] # Trust FS location? Or Config?
                    # Usually better to trust where the file actually IS.
            else:
                # No file found. Use normalized name as fallback, but warn.
                # logger.warning(f"Layer '{layer_name_he}' (clean: {cleaned_query}) not found on file system.")
                final_layer_id = layer_name_he.strip().replace(" ", "_").replace("\"", "")

            if not final_pack_id:
                 # Skip if we still don't know where to put it
                 continue

            # Process Fields
            fields_list = []
            if display_info:
                raw_fields = display_info.split('\n')
                for rf in raw_fields:
                    rf = rf.strip()
                    if not rf: continue
                    key = rf
                    label = rf
                    mapped_key = find_key_for_label(final_pack_id, final_layer_id, rf)
                    if mapped_key: key = mapped_key
                    fields_list.append({"label": label, "key": key})

            if final_pack_id not in new_config:
                new_config[final_pack_id] = {"layers": {}}

            layer_entry = {
                 "fields": fields_list,
                 "hideEmpty": True
            }

            # Title Field
            if final_pack_id in old_config and "layers" in old_config[final_pack_id] and final_layer_id in old_config[final_pack_id]["layers"]:
                old_layer = old_config[final_pack_id]["layers"][final_layer_id]
                if "titleField" in old_layer:
                    layer_entry["titleField"] = old_layer["titleField"]
            elif fields_list:
                layer_entry["titleField"] = fields_list[0]["key"]

            new_config[final_pack_id]["layers"][final_layer_id] = layer_entry

    # Create root structure if needed (popup-config usually just has packs at root)

    with open(json_path, "w", encoding="utf-8") as f:
        json.dump(new_config, f, indent=2, ensure_ascii=False)

    logger.info(f"Updated {json_path}")

if __name__ == "__main__":
    update_popup_config()
