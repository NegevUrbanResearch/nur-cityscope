"""Keep reviewed settlement label additions when projector source data is rebuilt."""
import json
from pathlib import Path

ADDITIONS_PATH = Path(__file__).resolve().parents[2] / "public" / "settlement-label-additions.json"
OUTLINE_ADDITIONS_PATH = ADDITIONS_PATH.with_name("settlement-outline-additions.geojson")


def add_settlement_outlines(path: Path):
    imported = json.loads(OUTLINE_ADDITIONS_PATH.read_text(encoding="utf-8"))["features"]
    collection = json.loads(path.read_text(encoding="utf-8"))
    known = {feature["properties"]["OBJECTID"]: feature for feature in collection["features"]}
    changed = False
    for feature in imported:
        existing = known.get(feature["properties"]["OBJECTID"])
        if existing and existing["properties"].get("citycode") != feature["properties"]["citycode"]:
            raise ValueError("Imported settlement outline ID conflicts with an existing polygon")
        if existing:
            continue
        collection["features"].append(feature)
        changed = True
    if changed:
        path.write_text(json.dumps(collection, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    return [feature["properties"] for feature in imported]


def add_settlement_labels(path: Path):
    additions = json.loads(ADDITIONS_PATH.read_text(encoding="utf-8"))
    collection = json.loads(path.read_text(encoding="utf-8"))
    features = collection["features"]
    known = {f.get("properties", {}).get("citycode") for f in features}
    next_id = max((f.get("properties", {}).get("OBJECTID", 0) for f in features), default=0) + 1
    changed = False
    for item in additions:
        if item["citycode"] in known:
            for feature in features:
                if feature.get("properties", {}).get("citycode") == item["citycode"] and not feature["properties"].get("otef_supplemental_label"):
                    feature["properties"]["otef_supplemental_label"] = True
                    changed = True
            continue
        features.append({"type": "Feature", "properties": {
            "OBJECTID": next_id, "citycode": item["citycode"], "cityname": item["cityname"], "citylabel": item["cityname"],
            "otef_supplemental_label": True,
            "otef_label_rotate_deg": 0, "otef_label_offset_em_x": 0, "otef_label_offset_em_y": 0, "otef_map_text_offset_em": [0, 0],
        }, "geometry": {"type": "Point", "coordinates": item["coordinates"]}})
        known.add(item["citycode"])
        next_id += 1
        changed = True
    if changed:
        path.write_text(json.dumps(collection, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    return additions


def add_outline_matches(path: Path, additions):
    mapping = json.loads(path.read_text(encoding="utf-8"))
    known = {match["citycode"] for match in mapping["matches"]}
    for item in additions:
        if item["citycode"] not in known:
            mapping["matches"].append({key: item[key] for key in ("citycode", "cityname", "outlineObjectId")})
    path.write_text(json.dumps(mapping, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


if __name__ == "__main__":
    directory = ADDITIONS_PATH.parent / "processed" / "layers" / "projector_base"
    additions = add_settlement_labels(directory / "שמות_יישובים.geojson")
    add_outline_matches(directory / "yeshuv-outline-map.json", additions)
    outline_additions = add_settlement_outlines(directory / "ישובים.geojson")
    add_outline_matches(directory / "yeshuv-outline-map.json", outline_additions)
