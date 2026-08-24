"""Prepare NLI GeoJSON + minimal CIM .lyrx files for the otef-interactive pack pipeline."""

from __future__ import annotations

import hashlib
import json
import math
import re
import struct
import zipfile
from collections import defaultdict
from pathlib import Path
from typing import Any, Dict, List, Optional, Sequence, Tuple

DEFAULT_JITTER_SIZE_DEG = 0.005


def zip_entry_name(info: zipfile.ZipInfo) -> str:
    extra = info.extra
    i = 0
    while i + 4 <= len(extra):
        sig, size = struct.unpack_from("<HH", extra, i)
        data = extra[i + 4 : i + 4 + size]
        i += 4 + size
        if sig == 0x7075 and len(data) >= 5:
            return data[5:].decode("utf-8")
    return info.filename


def unit_from_seed(seed: str, salt: str) -> float:
    digest = hashlib.md5(f"{seed}:{salt}".encode("utf-8")).hexdigest()
    return int(digest[:8], 16) / 0xFFFFFFFF


def _feature_seed(feature: Dict[str, Any], seed_keys: Sequence[str], fallback: str) -> str:
    props = feature.get("properties") or {}
    parts = [str(props.get(key)) for key in seed_keys if props.get(key) not in (None, "")]
    if parts:
        return ":".join(parts)
    if feature.get("id") not in (None, ""):
        return str(feature["id"])
    return fallback


def jitter_coincident_points(
    features: List[Dict[str, Any]],
    *,
    size_deg: float = DEFAULT_JITTER_SIZE_DEG,
    seed_keys: Sequence[str] = ("oct7_pid", "pid", "OBJECTID"),
) -> int:
    """
    oct7map Ww/Z1/Q1 blob: independent random polar terms, seeded per person.

        lat += rng() * size * sin(rng() * 2π)
        lon += rng() * size * cos(rng() * 2π)

    Only groups of 2+ points that share rounded (lon, lat) are moved.
    """
    groups: Dict[Tuple[float, float], List[int]] = defaultdict(list)
    for index, feature in enumerate(features):
        geometry = feature.get("geometry") or {}
        if geometry.get("type") != "Point":
            continue
        coords = geometry.get("coordinates") or []
        if len(coords) < 2:
            continue
        lon, lat = float(coords[0]), float(coords[1])
        groups[(round(lon, 6), round(lat, 6))].append(index)

    moved = 0
    two_pi = 2.0 * math.pi
    for indexes in groups.values():
        if len(indexes) < 2:
            continue
        for index in indexes:
            feature = features[index]
            lon0, lat0 = feature["geometry"]["coordinates"][:2]
            seed = _feature_seed(feature, seed_keys, str(index))
            dlat = (
                unit_from_seed(seed, "r_lat")
                * size_deg
                * math.sin(unit_from_seed(seed, "ang_lat") * two_pi)
            )
            dlon = (
                unit_from_seed(seed, "r_lon")
                * size_deg
                * math.cos(unit_from_seed(seed, "ang_lon") * two_pi)
            )
            props = dict(feature.get("properties") or {})
            props["source_lon"] = float(lon0)
            props["source_lat"] = float(lat0)
            feature["properties"] = props
            feature["geometry"] = {
                "type": "Point",
                "coordinates": [float(lon0) + dlon, float(lat0) + dlat],
            }
            moved += 1
    return moved


OCT7_STATUS_CLASSES = [
    ("Murdered", "Murdered", (180, 35, 24)),
    ("Killed on duty", "Killed on duty", (23, 92, 211)),
    ("Kidnap survivor", "Kidnap survivor", (7, 148, 85)),
    ("Murdered in captivity", "Murdered in captivity", (122, 34, 34)),
]

NLI_CATEGORY_CLASSES = [
    ("Victims of terrorism", "Victims of terrorism", (217, 119, 6)),
    ("Fallen soldiers", "Fallen soldiers", (109, 40, 217)),
    ("Kidnapping victims", "Kidnapping victims", (8, 145, 178)),
]
NLI_CATALOG_MARKER_SIZE = 10.0
NLI_CATALOG_STROKE = (15, 23, 42)
NLI_CATALOG_STROKE_WIDTH = 0.6
_LOCAL_HHMM = re.compile(r"^local\s+(\d{1,2}):(\d{2})$")

BIBAS_STATUS_VALUE = "Murdered in captivity (bibas)"
CANONICAL_CAPTIVITY_STATUS = "Murdered in captivity"
MURDERED_THEN_KIDNAPPED_STATUS = "Murdered then kidnapped"
CANONICAL_MURDERED_STATUS = "Murdered"


def rewrite_oct7_status(value: Any) -> Any:
    if value == BIBAS_STATUS_VALUE:
        return CANONICAL_CAPTIVITY_STATUS
    if value == MURDERED_THEN_KIDNAPPED_STATUS:
        return CANONICAL_MURDERED_STATUS
    return value


def group_nli_category(raw: Any) -> Any:
    if not isinstance(raw, str) or raw == "":
        return raw
    if "Kidnapping" in raw:
        return "Kidnapping victims"
    if "Fallen soldiers" in raw:
        return "Fallen soldiers"
    return "Victims of terrorism"


NLI_AUTHORITY_URL = "https://www.nli.org.il/he/authorities/{mms_id}"
DEFAULT_AUTHORITIES_PATH = Path(__file__).resolve().parent / "nli_mazal_authorities.json"
_MARC_SUBFIELD = re.compile(r"\$\$[a-z0-9]")
_MMS_ID = re.compile(r"^\d{17,19}$")
OLDER_CATALOG_ZIP_NAME = "geojson/older versions/noam_layer.geojson"


def parse_marc_name(raw: Any) -> str:
    if not isinstance(raw, str) or not raw.strip():
        return ""
    parts = re.findall(r"\$\$a([^$]*)", raw)
    name = parts[0] if parts else _MARC_SUBFIELD.sub("", raw)
    name = re.sub(r",\s*$", "", name)
    return re.sub(r"\s+", " ", name).strip(" ,")


def normalize_person_name(value: Any) -> str:
    if not value:
        return ""
    text = str(value).replace("\u05f3", "'").replace("\u05f4", '"')
    text = re.sub(r"[\"'`״׳]", "", text)
    return re.sub(r"\s+", " ", text).strip().lower()


def flip_person_name(name: str) -> str:
    if not name:
        return ""
    if "," in name:
        last, first = [part.strip() for part in name.split(",", 1)]
        return f"{first} {last}".strip()
    parts = name.split()
    if len(parts) == 2:
        return f"{parts[1]} {parts[0]}"
    return name


def person_name_keys(value: Any) -> List[str]:
    name = normalize_person_name(value)
    if not name:
        return []
    flipped = flip_person_name(name)
    keys = {name, flipped, " ".join(sorted(name.split()))}
    if flipped:
        keys.add(" ".join(sorted(flipped.split())))
    return [key for key in keys if key]


def nli_authority_url(mms_id: str) -> str:
    return NLI_AUTHORITY_URL.format(mms_id=mms_id)


def load_nli_authorities(path: Path) -> List[Dict[str, str]]:
    if not path.is_file():
        return []
    payload = json.loads(path.read_text(encoding="utf-8"))
    rows: List[Dict[str, str]] = []
    for item in payload or []:
        mms_id = str((item or {}).get("mms_id") or "").strip()
        if not _MMS_ID.fullmatch(mms_id):
            continue
        rows.append(
            {
                "mms_id": mms_id,
                "he": str((item or {}).get("he") or ""),
                "en": str((item or {}).get("en") or ""),
            }
        )
    return rows


def _authority_name_index(authorities: Sequence[Dict[str, str]]) -> Dict[str, set]:
    index: Dict[str, set] = {}
    for row in authorities:
        mms_id = row["mms_id"]
        for raw in (row.get("he"), row.get("en")):
            for key in person_name_keys(raw):
                index.setdefault(key, set()).add(mms_id)
    return index


def _lookup_mms_ids(index: Dict[str, set], *names: Any) -> set:
    hits: set = set()
    for name in names:
        for key in person_name_keys(name):
            hits |= index.get(key, set())
    return hits


def attach_nli_catalog_links(
    collection: Dict[str, Any],
    authorities: Sequence[Dict[str, str]],
    catalog_features: Optional[Sequence[Dict[str, Any]]] = None,
) -> Dict[str, int]:
    """Attach string mms_id + NLI authority URL for unique name matches."""
    index = _authority_name_index(authorities)
    catalog_by_pid: Dict[str, List[Dict[str, Any]]] = {}
    for feature in catalog_features or []:
        props = feature.get("properties") or {}
        pid = props.get("oct7_pid")
        if pid in (None, ""):
            continue
        catalog_by_pid.setdefault(str(pid), []).append(props)

    linked = 0
    ambiguous = 0
    unmatched = 0
    for feature in collection.get("features") or []:
        props = dict(feature.get("properties") or {})
        hits = _lookup_mms_ids(index, props.get("hebrew_name"), props.get("name"))
        if len(hits) != 1:
            for catalog_props in catalog_by_pid.get(str(props.get("pid") or ""), []):
                hits |= _lookup_mms_ids(
                    index,
                    catalog_props.get("name_he"),
                    catalog_props.get("name_en"),
                )
        if len(hits) == 1:
            mms_id = next(iter(hits))
            props["mms_id"] = mms_id
            props["nli_url"] = nli_authority_url(mms_id)
            feature["properties"] = props
            linked += 1
        elif len(hits) > 1:
            ambiguous += 1
        else:
            unmatched += 1
    return {"linked": linked, "ambiguous": ambiguous, "unmatched": unmatched}


def rewrite_nli_layer_properties(stem: str, collection: Dict[str, Any]) -> int:
    changed = 0
    if stem in ("oct7_database", "people"):
        key, rewrite = "status", rewrite_oct7_status
    elif stem == "nli_catalog":
        key, rewrite = "categories", group_nli_category
    else:
        return 0
    for feature in collection.get("features") or []:
        props = dict(feature.get("properties") or {})
        old = props.get(key)
        new = rewrite(old)
        if new != old:
            props[key] = new
            feature["properties"] = props
            changed += 1
    return changed


def _rgb(color: Sequence[int], alpha: int = 100) -> Dict[str, Any]:
    r, g, b = int(color[0]), int(color[1]), int(color[2])
    return {"type": "CIMRGBColor", "values": [r, g, b, int(alpha)]}


def _cim_polygon_symbol(
    fill: Sequence[int], fill_alpha: int, stroke: Sequence[int], width: float
) -> Dict[str, Any]:
    return {
        "type": "CIMPolygonSymbol",
        "symbolLayers": [
            {
                "type": "CIMSolidStroke",
                "enable": True,
                "width": width,
                "color": _rgb(stroke),
            },
            {
                "type": "CIMSolidFill",
                "enable": True,
                "color": _rgb(fill, fill_alpha),
            },
        ],
    }


def parse_local_timeline_to_minutes(value: Any) -> Optional[int]:
    if not isinstance(value, str):
        return None
    match = _LOCAL_HHMM.match(value.strip())
    if not match:
        return None
    return int(match.group(1)) * 60 + int(match.group(2))


def apply_timeline_minutes(collection: Dict[str, Any]) -> int:
    changed = 0
    for feature in collection.get("features") or []:
        props = dict(feature.get("properties") or {})
        minutes = parse_local_timeline_to_minutes(props.get("timeline"))
        if minutes is None:
            continue
        if props.get("timeline_minutes") != minutes:
            props["timeline_minutes"] = minutes
            feature["properties"] = props
            changed += 1
    return changed


def collect_timeline_beats(features: Sequence[Dict[str, Any]]) -> List[int]:
    beats = set()
    for feat in features or []:
        raw = (feat.get("properties") or {}).get("timeline_minutes")
        if isinstance(raw, bool) or not isinstance(raw, (int, float)):
            continue
        beats.add(int(raw))
    return sorted(beats)


def object_ids_active_at(features: Sequence[Dict[str, Any]], minutes: int) -> List[int]:
    active: List[int] = []
    for feat in features or []:
        props = feat.get("properties") or {}
        if props.get("timeline_minutes") == minutes:
            oid = props.get("OBJECTID")
            if oid is not None:
                active.append(oid)
    return active


def _cim_point_symbol(
    fill: Sequence[int],
    size: float = 12.0,
    stroke: Sequence[int] = (255, 255, 255),
    shape: str = "circle",
    stroke_width: float = 0.6,
) -> Dict[str, Any]:
    graphic: Dict[str, Any] = {"symbol": _cim_polygon_symbol(fill, 100, stroke, stroke_width)}
    if str(shape).lower() == "square":
        graphic["geometry"] = {"paths": [[[0, 0], [1, 0]]]}
    return {
        "type": "CIMPointSymbol",
        "symbolLayers": [
            {
                "type": "CIMVectorMarker",
                "enable": True,
                "size": size,
                "markerGraphics": [graphic],
            }
        ],
    }


def _symbol_ref(symbol: Dict[str, Any]) -> Dict[str, Any]:
    return {"type": "CIMSymbolReference", "symbol": symbol}


def unique_value_point_lyrx(
    field: str,
    classes: Sequence[Tuple[str, str, Sequence[int]]],
    default_fill: Sequence[int] = (128, 128, 128),
    size: float = 12.0,
    stroke: Sequence[int] = (255, 255, 255),
    shape: str = "circle",
    stroke_width: float = 0.6,
) -> Dict[str, Any]:
    default_symbol = _cim_point_symbol(
        default_fill, size=size, stroke=stroke, shape=shape, stroke_width=stroke_width
    )
    cim_classes = [
        {
            "type": "CIMUniqueValueClass",
            "label": label,
            "values": [{"type": "CIMUniqueValue", "fieldValues": [value]}],
            "symbol": _symbol_ref(
                _cim_point_symbol(fill, size=size, stroke=stroke, shape=shape, stroke_width=stroke_width)
            ),
        }
        for value, label, fill in classes
    ]
    return {
        "layerDefinitions": [
            {
                "name": field,
                "renderer": {
                    "type": "CIMUniqueValueRenderer",
                    "fields": [field],
                    "symbol": _symbol_ref(default_symbol),
                    "defaultSymbol": _symbol_ref(default_symbol),
                    "groups": [{"type": "CIMUniqueValueGroup", "classes": cim_classes}],
                },
            }
        ]
    }


def simple_polygon_lyrx(
    fill: Sequence[int] = (247, 144, 9),
    fill_alpha: int = 40,
    stroke: Sequence[int] = (181, 71, 8),
    width: float = 1.2,
) -> Dict[str, Any]:
    symbol = _cim_polygon_symbol(fill, fill_alpha, stroke, width)
    return {
        "layerDefinitions": [
            {
                "name": "polygons",
                "renderer": {
                    "type": "CIMSimpleRenderer",
                    "symbol": _symbol_ref(symbol),
                },
            }
        ]
    }


def _cim_line_symbol(color: Sequence[int], width: float) -> Dict[str, Any]:
    return {
        "type": "CIMLineSymbol",
        "symbolLayers": [
            {
                "type": "CIMSolidStroke",
                "enable": True,
                "capStyle": "Round",
                "joinStyle": "Round",
                "width": width,
                "color": _rgb(color),
            }
        ],
    }


# Match october_7th מאבק_וגבורה_ציר: CIM RGB (195, 31, 79), 1.5pt.
OCT7_STRUGGLE_LINE_COLOR = (195, 31, 79)
OCT7_STRUGGLE_LINE_WIDTH = 1.5


def simple_line_lyrx(
    color: Sequence[int] = OCT7_STRUGGLE_LINE_COLOR,
    width: float = OCT7_STRUGGLE_LINE_WIDTH,
) -> Dict[str, Any]:
    symbol = _cim_line_symbol(color, width)
    return {
        "layerDefinitions": [
            {
                "name": "lines",
                "renderer": {
                    "type": "CIMSimpleRenderer",
                    "symbol": _symbol_ref(symbol),
                },
            }
        ]
    }


def labels_only_point_lyrx(
    field: str = "name",
    height: float = 14.0,
    halo_size: float = 0.35,
    fill: Sequence[int] = (255, 255, 255),
    halo: Sequence[int] = (255, 255, 255),
) -> Dict[str, Any]:
    """Point layer with labels only: no unique-value marker classes."""
    return {
        "layerDefinitions": [
            {
                "name": "people_names",
                "renderer": {
                    "type": "CIMSimpleRenderer",
                    "symbol": _symbol_ref({"type": "CIMPointSymbol", "symbolLayers": []}),
                },
                "labelClasses": [
                    {
                        "type": "CIMLabelClass",
                        "expression": f'$feature["{field}"]',
                        "maplexLabelPlacementProperties": {
                            "type": "CIMMaplexLabelPlacementProperties",
                            "featureType": "Point",
                        },
                        "textSymbol": {
                            "type": "CIMSymbolReference",
                            "symbol": {
                                "type": "CIMTextSymbol",
                                "height": height,
                                "haloSize": halo_size,
                                "haloColor": _rgb(halo),
                                "fontFamilyName": "Guttman Hatzvi",
                                "fontStyleName": "Regular",
                                "horizontalAlignment": "Center",
                                "symbol": {
                                    "type": "CIMPolygonSymbol",
                                    "symbolLayers": [
                                        {
                                            "type": "CIMSolidFill",
                                            "enable": True,
                                            "color": _rgb(fill),
                                        }
                                    ],
                                },
                            },
                        },
                    }
                ],
            }
        ]
    }


ZIP_LAYER_MAP = {
    "geojson/people_7_10.json": "people",
    "geojson/polygons_7_10.geojson": "investigation_polygons",
    "geojson/lines_7_10.geojson": "lines",
}

# Derived stems (not in the zip map) must survive obsolete-file cleanup.
NLI_KEEP_STEMS = set(ZIP_LAYER_MAP.values()) | {"people_names"}

PROJECTED_STEMS = {"investigation_polygons", "lines"}
TIMELINE_STEMS = {"investigation_polygons", "lines"}

NLI_POPUP_CONFIG = {
    "nli": {
        "layers": {
            "investigation_polygons": {
                "titleField": "Name",
                "hideEmpty": True,
                "legendLabel": "Investigation polygons",
                "fields": [
                    {"label": "Name", "key": "Name"},
                    {"label": "Location", "key": "מיקום"},
                    {"label": "Timeline", "key": "timeline"},
                    {"label": "Notes", "key": "Notes"},
                ],
            },
            "people": {
                "titleField": "hebrew_name",
                "hideEmpty": True,
                "fields": [
                    {"label": "Hebrew name", "key": "hebrew_name"},
                    {"label": "Name", "key": "name"},
                    {"label": "Status", "key": "status"},
                    {"label": "Location", "key": "location"},
                    {"label": "Location class", "key": "location_class"},
                    {"label": "Type", "key": "type"},
                    {"label": "Age", "key": "age"},
                    {"label": "Info", "key": "info"},
                    {"label": "NLI catalog", "key": "nli_url", "type": "url", "linkLabel": "Open record"},
                ],
            },
            "lines": {
                "titleField": "Name",
                "hideEmpty": True,
                "legendLabel": "Infiltration routes",
                "fields": [
                    {"label": "Name", "key": "Name"},
                    {"label": "Timeline", "key": "timeline"},
                    {"label": "Notes", "key": "Notes"},
                ],
            },
        }
    }
}

_TIME_ONLY = re.compile(r"^(\d{2}):(\d{2}):(\d{2})$")
_WEB_MERCATOR_A = 6378137.0


def drop_null_geometries(collection: Dict[str, Any]) -> int:
    features = collection.get("features") or []
    kept = [f for f in features if f.get("geometry")]
    dropped = len(features) - len(kept)
    collection["features"] = kept
    return dropped


def sanitize_time_like_properties(collection: Dict[str, Any]) -> int:
    """Rewrite HH:MM:SS strings so GDAL/pyogrio will not drop them as OFTTime."""
    changed = 0
    for feature in collection.get("features") or []:
        props = feature.get("properties") or {}
        for key, value in list(props.items()):
            if isinstance(value, str) and _TIME_ONLY.match(value):
                hh, mm, _ss = _TIME_ONLY.match(value).groups()
                props[key] = f"local {hh}:{mm}"
                changed += 1
        feature["properties"] = props
    return changed


def _mercator_xy_to_lonlat(x: float, y: float) -> List[float]:
    lon = (x / _WEB_MERCATOR_A) * (180.0 / math.pi)
    lat = (2.0 * math.atan(math.exp(y / _WEB_MERCATOR_A)) - math.pi / 2.0) * (
        180.0 / math.pi
    )
    return [lon, lat]


def _walk_coords(node: Any, convert) -> Any:
    if not isinstance(node, list) or not node:
        return node
    if isinstance(node[0], (int, float)):
        lonlat = convert(float(node[0]), float(node[1]))
        return lonlat + list(node[2:])
    return [_walk_coords(child, convert) for child in node]


def reproject_web_mercator_collection_to_wgs84(collection: Dict[str, Any]) -> None:
    """EPSG:3857 FeatureCollection → lon/lat, then drop `crs` so infer_crs sees degrees."""
    for feature in collection.get("features") or []:
        geometry = feature.get("geometry") or {}
        if geometry.get("coordinates") is not None:
            geometry["coordinates"] = _walk_coords(
                geometry["coordinates"], _mercator_xy_to_lonlat
            )
    collection.pop("crs", None)


def _write_json(path: Path, data: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")


def merge_popup_config(popup_path: Path, nli_config: Dict[str, Any]) -> None:
    existing: Dict[str, Any] = {}
    if popup_path.is_file():
        existing = json.loads(popup_path.read_text(encoding="utf-8"))
    existing.update(nli_config)
    _write_json(popup_path, existing)


def _as_popup_paths(popup_path: Optional[Path | Sequence[Path]]) -> List[Path]:
    if popup_path is None:
        return []
    if isinstance(popup_path, Path):
        return [popup_path]
    return list(popup_path)


def _catalog_features_from_zip(by_name: Dict[str, Any], archive: zipfile.ZipFile) -> List[Dict[str, Any]]:
    info = by_name.get(OLDER_CATALOG_ZIP_NAME)
    if info is None:
        return []
    payload = json.loads(archive.read(info))
    return list(payload.get("features") or [])


def prepare_nli_pack(
    zip_path: Path,
    pack_dir: Path,
    popup_path: Optional[Path | Sequence[Path]] = None,
    authorities_path: Optional[Path] = None,
) -> Dict[str, Any]:
    gis_dir = pack_dir / "gis"
    styles_dir = pack_dir / "styles"
    gis_dir.mkdir(parents=True, exist_ok=True)
    styles_dir.mkdir(parents=True, exist_ok=True)
    summary: Dict[str, Any] = {"layers": {}}
    authorities = load_nli_authorities(authorities_path or DEFAULT_AUTHORITIES_PATH)
    with zipfile.ZipFile(zip_path) as archive:
        by_name = {zip_entry_name(info): info for info in archive.infolist()}
        catalog_features = _catalog_features_from_zip(by_name, archive)
        for zip_name, stem in ZIP_LAYER_MAP.items():
            info = by_name.get(zip_name)
            if info is None:
                raise FileNotFoundError(f"Zip is missing {zip_name}")
            collection = json.loads(archive.read(info))
            dropped = drop_null_geometries(collection)
            moved = 0
            times = sanitize_time_like_properties(collection)
            grouped = rewrite_nli_layer_properties(stem, collection)
            if stem in PROJECTED_STEMS:
                reproject_web_mercator_collection_to_wgs84(collection)
            if stem in TIMELINE_STEMS:
                apply_timeline_minutes(collection)
            if stem == "people" and authorities:
                summary["nli_catalog_links"] = attach_nli_catalog_links(
                    collection, authorities, catalog_features
                )
            if stem == "people":
                moved = jitter_coincident_points(collection.get("features") or [])
            _write_json(gis_dir / f"{stem}.geojson", collection)
            if stem == "people":
                _write_json(gis_dir / "people_names.geojson", collection)
            summary["layers"][stem] = {
                "features": len(collection.get("features") or []),
                "dropped_null_geometry": dropped,
                "jittered": moved,
                "time_fields_rewritten": times,
                "legend_values_rewritten": grouped,
            }
    _write_json(styles_dir / "investigation_polygons.lyrx", simple_polygon_lyrx())
    _write_json(styles_dir / "people.lyrx", unique_value_point_lyrx("status", OCT7_STATUS_CLASSES))
    _write_json(styles_dir / "lines.lyrx", simple_line_lyrx())
    _write_json(styles_dir / "people_names.lyrx", labels_only_point_lyrx())
    keep_stems = NLI_KEEP_STEMS
    removed = []
    for folder in (gis_dir, styles_dir):
        for path in folder.iterdir():
            if path.name.startswith("."):
                continue
            if path.stem not in keep_stems:
                path.unlink()
                removed.append(str(path.name))
    if removed:
        summary["removed_obsolete"] = removed
    written: List[str] = []
    for path in _as_popup_paths(popup_path):
        merge_popup_config(path, NLI_POPUP_CONFIG)
        written.append(str(path))
    if written:
        summary["popup_config"] = written
    return summary


def main() -> None:
    repo = Path(__file__).resolve().parents[2]
    zip_path = repo / "geojson-20260823T094646Z-1-001.zip"
    pack_dir = repo / "otef-interactive" / "public" / "source" / "layers" / "nli"
    popup_paths = [
        repo / "otef-interactive" / "public" / "source" / "popup-config.json",
        repo / "otef-interactive" / "public" / "source" / "layers" / "popup-config.json",
    ]
    summary = prepare_nli_pack(zip_path, pack_dir, popup_paths)
    print(json.dumps(summary, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()

