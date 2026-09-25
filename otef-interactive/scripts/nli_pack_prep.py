"""Prepare NLI GeoJSON + minimal CIM .lyrx files for the otef-interactive pack pipeline."""

from __future__ import annotations

import copy
import argparse
import hashlib
import json
import math
import re
import shutil
import subprocess
import struct
import zipfile
from collections import defaultdict
from pathlib import Path
from typing import Any, Dict, List, Optional, Sequence, Tuple

from otef_layer_processing.styles import find_lyrx_file, parse_acrossline_from_lyrx

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

    Every point gets ``source_lon`` / ``source_lat``. Only groups of 2+ that
    share rounded (lon, lat) are moved.
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
        for index in indexes:
            feature = features[index]
            lon0, lat0 = feature["geometry"]["coordinates"][:2]
            props = dict(feature.get("properties") or {})
            props["source_lon"] = float(lon0)
            props["source_lat"] = float(lat0)
            feature["properties"] = props
        if len(indexes) < 2:
            continue
        for index in indexes:
            feature = features[index]
            lon0 = feature["properties"]["source_lon"]
            lat0 = feature["properties"]["source_lat"]
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
            feature["geometry"] = {
                "type": "Point",
                "coordinates": [float(lon0) + dlon, float(lat0) + dlat],
            }
            moved += 1
    return moved


def _people_name_sort_key(feature: Dict[str, Any], index: int) -> Tuple[int, int, Any]:
    props = feature.get("properties") or {}
    for key in ("pid", "oct7_pid", "OBJECTID"):
        val = props.get(key)
        if val in (None, ""):
            continue
        try:
            return (0, 0, int(val))
        except (TypeError, ValueError):
            return (0, 1, str(val))
    return (1, 0, index)


def apply_people_name_offsets(features: List[Dict[str, Any]]) -> int:
    """Write radial ``otef_map_text_offset_em`` grouped by source lon/lat."""
    groups: Dict[Tuple[float, float], List[int]] = defaultdict(list)
    for index, feature in enumerate(features):
        geometry = feature.get("geometry") or {}
        if geometry.get("type") != "Point":
            continue
        props = feature.get("properties") or {}
        lon = props.get("source_lon")
        lat = props.get("source_lat")
        if lon is None or lat is None:
            coords = geometry.get("coordinates") or []
            if len(coords) < 2:
                continue
            lon, lat = float(coords[0]), float(coords[1])
        else:
            lon, lat = float(lon), float(lat)
        groups[(round(lon, 6), round(lat, 6))].append(index)

    written = 0
    two_pi = 2.0 * math.pi
    for indexes in groups.values():
        n = len(indexes)
        ordered = sorted(indexes, key=lambda i: _people_name_sort_key(features[i], i))
        radius = min(1.8 + 0.45 * (n - 2), 4.5) if n >= 2 else 0.0
        for i, index in enumerate(ordered):
            if n < 2:
                offset = [0.0, 0.0]
            else:
                angle = two_pi * i / n
                offset = [radius * math.cos(angle), radius * math.sin(angle)]
            feature = features[index]
            props = dict(feature.get("properties") or {})
            props["otef_map_text_offset_em"] = offset
            feature["properties"] = props
            written += 1
    return written


OCT7_STATUS_CLASSES = [
    ("Murdered", "Murdered", (180, 35, 24)),
    ("Killed on duty", "Killed on duty", (23, 92, 211)),
    ("Kidnap survivor", "Kidnap survivor", (255, 209, 0)),
    ("Murdered in captivity", "Murdered in captivity", (122, 34, 34)),
]

_LOCAL_HHMM = re.compile(r"^local\s+(\d{1,2}):(\d{2})$")
ALARM_TIME_RE = re.compile(r"^(\d{4})-(\d{2})-(\d{2})\s+(\d{2}):(\d{2}):(\d{2})$")

BIBAS_STATUS_VALUE = "Murdered in captivity (bibas)"
CANONICAL_CAPTIVITY_STATUS = "Murdered in captivity"
MURDERED_THEN_KIDNAPPED_STATUS = "Murdered then kidnapped"


def rewrite_oct7_status(value: Any) -> Any:
    if value == BIBAS_STATUS_VALUE:
        return CANONICAL_CAPTIVITY_STATUS
    if value == MURDERED_THEN_KIDNAPPED_STATUS:
        return CANONICAL_CAPTIVITY_STATUS
    return value


NLI_AUTHORITY_URL = "https://www.nli.org.il/he/authorities/{mms_id}"
DEFAULT_AUTHORITIES_PATH = Path(__file__).resolve().parent / "nli_mazal_authorities.json"
DEFAULT_PID_MMS_PATH = Path(__file__).resolve().parent / "nli_oct7_mms_by_pid.json"
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


def load_pid_mms_ids(path: Path) -> Dict[str, str]:
    if not path.is_file():
        return {}
    payload = json.loads(path.read_text(encoding="utf-8"))
    mapped: Dict[str, str] = {}
    if not isinstance(payload, dict):
        return mapped
    for raw_pid, raw_mms in payload.items():
        pid = str(raw_pid or "").strip()
        mms_id = str(raw_mms or "").strip()
        if not pid or not _MMS_ID.fullmatch(mms_id):
            continue
        mapped[pid] = mms_id
    return mapped


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
    pid_mms_ids: Optional[Dict[str, str]] = None,
) -> Dict[str, int]:
    """Attach string mms_id + NLI authority URL.

    Prefer a unique oct7 pid → mms_id map (cleaned NLI catalog / oct7database).
    Fall back to unique name matches, then old-catalog names for that pid.
    """
    index = _authority_name_index(authorities)
    pid_map = {
        str(pid).strip(): str(mms_id).strip()
        for pid, mms_id in (pid_mms_ids or {}).items()
        if str(pid).strip() and _MMS_ID.fullmatch(str(mms_id).strip())
    }
    catalog_by_pid: Dict[str, List[Dict[str, Any]]] = {}
    for feature in catalog_features or []:
        props = feature.get("properties") or {}
        pid = props.get("oct7_pid")
        if pid in (None, ""):
            continue
        catalog_by_pid.setdefault(str(pid), []).append(props)

    linked = 0
    linked_by_pid = 0
    linked_by_name = 0
    ambiguous = 0
    unmatched = 0
    for feature in collection.get("features") or []:
        props = dict(feature.get("properties") or {})
        pid = str(props.get("pid") or "").strip()
        mapped = pid_map.get(pid)
        if mapped:
            props["mms_id"] = mapped
            props["nli_url"] = nli_authority_url(mapped)
            feature["properties"] = props
            linked += 1
            linked_by_pid += 1
            continue
        hits = _lookup_mms_ids(index, props.get("hebrew_name"), props.get("name"))
        if len(hits) != 1:
            for catalog_props in catalog_by_pid.get(pid, []):
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
            linked_by_name += 1
        elif len(hits) > 1:
            ambiguous += 1
        else:
            unmatched += 1
    return {
        "linked": linked,
        "linked_by_pid": linked_by_pid,
        "linked_by_name": linked_by_name,
        "ambiguous": ambiguous,
        "unmatched": unmatched,
    }


def rewrite_nli_layer_properties(stem: str, collection: Dict[str, Any]) -> int:
    if stem != "people":
        return 0
    changed = 0
    key, rewrite = "status", rewrite_oct7_status
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


def parse_alarm_timestamp_to_minutes(value: Any) -> Optional[int]:
    if not isinstance(value, str):
        return None
    match = ALARM_TIME_RE.match(value.strip())
    if not match:
        return None
    return int(match.group(4)) * 60 + int(match.group(5))


def apply_alarm_timeline_minutes(collection: Dict[str, Any]) -> int:
    changed = 0
    for feature in collection.get("features") or []:
        props = dict(feature.get("properties") or {})
        minutes = parse_alarm_timestamp_to_minutes(props.get("time"))
        if minutes is None:
            continue
        if props.get("timeline_minutes") != minutes:
            props["timeline_minutes"] = minutes
            feature["properties"] = props
            changed += 1
    return changed


MITZPE_RAMON_LAT = 30.610
ASHKELON_NORTH_FALLBACK_LAT = 31.686


def _point_lonlat(feature: Dict[str, Any]) -> Optional[Tuple[float, float]]:
    geometry = feature.get("geometry") or {}
    coords = geometry.get("coordinates") or []
    if geometry.get("type") != "Point" or len(coords) < 2:
        return None
    return float(coords[0]), float(coords[1])


def ashkelon_north_lat(features) -> float:
    lats = []
    for feat in features or []:
        city = str((feat.get("properties") or {}).get("city") or "")
        if "אשקלון" not in city:
            continue
        lonlat = _point_lonlat(feat)
        if lonlat is not None:
            lats.append(lonlat[1])
    return max(lats) if lats else ASHKELON_NORTH_FALLBACK_LAT


def city_centroid_in_story_band(lat: float, north_lat: float) -> bool:
    return MITZPE_RAMON_LAT - 1e-9 <= float(lat) <= float(north_lat) + 1e-9


def collapse_alarms_to_cities(collection: Dict[str, Any]) -> Dict[str, Any]:
    features = list(collection.get("features") or [])
    north_lat = ashkelon_north_lat(features)
    groups: Dict[str, List[Dict[str, Any]]] = {}
    for feat in features:
        city = str((feat.get("properties") or {}).get("city") or "").strip()
        if not city:
            continue
        groups.setdefault(city, []).append(feat)
    out_features: List[Dict[str, Any]] = []
    for city, group in groups.items():
        lons: List[float] = []
        lats: List[float] = []
        minutes: List[int] = []
        for feat in group:
            lonlat = _point_lonlat(feat)
            if lonlat is None:
                continue
            lons.append(lonlat[0])
            lats.append(lonlat[1])
            raw = (feat.get("properties") or {}).get("timeline_minutes")
            if isinstance(raw, bool) or not isinstance(raw, (int, float)):
                continue
            minutes.append(int(raw))
        if not lons:
            continue
        lon = sum(lons) / len(lons)
        lat = sum(lats) / len(lats)
        if not city_centroid_in_story_band(lat, north_lat):
            continue
        minutes.sort()
        if not minutes:
            continue
        out_features.append(
            {
                "type": "Feature",
                "id": city,
                "properties": {
                    "city": city,
                    "alarm_minutes": minutes,
                    "alarm_count_total": len(minutes),
                },
                "geometry": {"type": "Point", "coordinates": [lon, lat]},
            }
        )
    return {"type": "FeatureCollection", "features": out_features}


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
    fill_alpha: int = 100,
) -> Dict[str, Any]:
    graphic: Dict[str, Any] = {
        "symbol": _cim_polygon_symbol(fill, fill_alpha, stroke, stroke_width)
    }
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


def simple_point_lyrx(
    fill: Sequence[int] = (251, 191, 36),
    size: float = 6.0,
    fill_alpha: int = 40,
    stroke: Sequence[int] = (255, 255, 255),
    stroke_width: float = 0.4,
) -> Dict[str, Any]:
    symbol = _cim_point_symbol(
        fill, size=size, stroke=stroke, stroke_width=stroke_width, fill_alpha=fill_alpha
    )
    return {
        "layerDefinitions": [
            {
                "name": "alarms",
                "renderer": {
                    "type": "CIMSimpleRenderer",
                    "symbol": _symbol_ref(symbol),
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
    field: str = "hebrew_name",
    height: float = 11.0,
    halo_size: float = 0.2,
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

# Dated Google Drive dumps put files at zip root, e.g. people_7_10_270826.geojson.
ZIP_LAYER_NAME_PREFIXES = {
    "people": ("people_7_10",),
    "investigation_polygons": ("polygons_7_10",),
    "lines": ("lines_7_10",),
}

DEFAULT_NLI_ZIP_CANDIDATES = (
    "drive-download-20260827T125810Z-1-001.zip",
    "geojson-20260823T094646Z-1-001.zip",
)


def default_nli_zip_path(repo: Path) -> Path:
    for name in DEFAULT_NLI_ZIP_CANDIDATES:
        path = repo / name
        if path.is_file():
            return path
    return repo / DEFAULT_NLI_ZIP_CANDIDATES[0]


def resolve_zip_layer_info(
    by_name: Dict[str, zipfile.ZipInfo],
    zip_name: str,
    stem: str,
) -> zipfile.ZipInfo:
    if zip_name in by_name:
        return by_name[zip_name]
    prefixes = ZIP_LAYER_NAME_PREFIXES.get(stem, ())
    matches: List[Tuple[str, zipfile.ZipInfo]] = []
    for name, info in by_name.items():
        normalized = name.replace("\\", "/")
        if "/older versions/" in f"/{normalized.lower()}":
            continue
        base = Path(normalized).name.lower()
        for prefix in prefixes:
            if base.startswith(prefix.lower()) and (
                base.endswith(".geojson") or base.endswith(".json")
            ):
                matches.append((name, info))
                break
    if len(matches) == 1:
        return matches[0][1]
    if not matches:
        raise FileNotFoundError(f"Zip is missing {zip_name}")
    raise FileNotFoundError(
        f"Zip has multiple matches for {stem}: {[name for name, _ in matches]}"
    )

# Local overlay copied from future_development (not part of the NLI zip allowlist).
# Brown corridor stroke; projection keeps GIS width (nli.ציר_232 hatch-scale exempt).
ROUTE_232_STEM = "ציר_232"
ROUTE_232_SOURCE_PACK = "future_development"
ROUTE_232_STROKE_WIDTH_PT = 2.0
ROUTE_232_STROKE_COLOR = (135, 62, 35)
ROUTE_232_STROKE_ALPHA = 100
ROUTE_232_LABEL_HEIGHT_SCALE = 1.0
ROUTE_232_LABEL_FILL = (255, 224, 210)

# Derived stems (not in the zip map) must survive obsolete-file cleanup.
# investigation_settlements is an exhibit sidecar under processed/layers/nli,
# never a source gis layer (orchestrator globs every *.geojson in gis/).
INVESTIGATION_SETTLEMENTS_STEM = "investigation_settlements"
NOVA_SITE_OUTLINE_OBJECT_ID = 100
NOVA_SITE_LOCATION = "נובה"
FLEEING_ROUTE_STEM = "fleeing_route"
FLEEING_ROUTE_OVERLAPP_STEM = "fleeing_route_overlapp"
FLEEING_ROUTE_URL = "/otef-interactive/public/processed/layers/nli/fleeing_route.geojson"
FLEEING_ROUTE_OVERLAPP_URL = (
    "/otef-interactive/public/processed/layers/nli/fleeing_route_overlapp.geojson"
)
FLEEING_GEOJSON_ZIP_SHA256 = (
    "ce3d65f86675f3b12a0ac43762350d67f739639c14852f1785e0ce2460ef5cd0"
)
FLEEING_LYRX_ZIP_SHA256 = (
    "50a1207705668552e0c02eeb98cb4fde458d9bf111aaf148aa1af6d1c6659106"
)
FLEEING_ROUTE_GEOJSON_MEMBER = "Fleeing_route.geojson"
FLEEING_ROUTE_OVERLAPP_GEOJSON_MEMBER = "fleeing_route_overlapp.geojson"
FLEEING_ROUTE_LYRX_MEMBER = "Fleeing_route.lyrx"
FLEEING_ROUTE_OVERLAPP_LYRX_MEMBER = "fleeing_route_overlapp.lyrx"
MOR_ROUTE_STEM = "mor_levy_route"
MOR_ROUTE_URL = "/otef-interactive/public/processed/layers/nli/mor_levy_route.geojson"
MOR_ROUTE_ZIP_SHA256 = "8e16adaae212a6dc47fe96599a6c8045cb45eb0c0de63023a75aff2d7dcdd93e"
MOR_ROUTE_GEOJSON_MEMBER = "Mor_levy.geojson"
NOVA_FACILITY_WGS84 = (34.46975, 31.39851)
NOVA_FLEEING_ENVELOPE = (34.36128, 31.23319, 34.60479, 31.52479)
OVERLAP_CLASS_BREAKS = (
    (13, 0.5),
    (39, 1.375),
    (100, 2.25),
    (146, 3.125),
    (235, 4.0),
)
NLI_KEEP_STEMS = set(ZIP_LAYER_MAP.values()) | {
    "people_names",
    "alarms",
    ROUTE_232_STEM,
    FLEEING_ROUTE_STEM,
    FLEEING_ROUTE_OVERLAPP_STEM,
    MOR_ROUTE_STEM,
}

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
            "alarms": {
                "titleField": "city",
                "hideEmpty": True,
                "fields": [
                    {"label": "City", "key": "city"},
                    {"label": "Alerts", "key": "alarm_count_total"},
                ],
            },
            ROUTE_232_STEM: {
                "titleField": "NAME",
                "hideEmpty": True,
                "legendLabel": "Highway 232",
                "fields": [
                    {"label": "Name", "key": "NAME"},
                    {"label": "Number", "key": "NUM"},
                    {"label": "Plan name", "key": "MAVAT_NAME"},
                ],
            },
        }
    }
}

_TIME_ONLY = re.compile(r"^(\d{2}):(\d{2}):(\d{2})$")
_WEB_MERCATOR_A = 6378137.0


UNKNOWN_HEBREW_NAME = "לא ידוע"
PEOPLE_OVERLAY_MIN_MOVE_M = 1.0


def _person_pid(value: Any) -> str:
    if value in (None, ""):
        return ""
    if isinstance(value, bool):
        return ""
    if isinstance(value, int):
        return str(value)
    if isinstance(value, float):
        return str(int(value)) if value.is_integer() else str(value)
    text = str(value).strip()
    try:
        number = float(text)
    except ValueError:
        return text
    if number.is_integer():
        return str(int(number))
    return text


def _overlay_text(props: Dict[str, Any], *keys: str) -> str:
    for key in keys:
        value = props.get(key)
        if isinstance(value, str) and value.strip():
            return value.strip()
    return ""


def _is_blank_hebrew(value: Any) -> bool:
    if not isinstance(value, str) or not value.strip():
        return True
    return value.strip() == UNKNOWN_HEBREW_NAME


def _point_lonlat(feature: Dict[str, Any]) -> Optional[Tuple[float, float]]:
    geometry = feature.get("geometry") or {}
    if geometry.get("type") != "Point":
        return None
    coords = geometry.get("coordinates") or []
    if len(coords) < 2:
        return None
    return float(coords[0]), float(coords[1])


def _planar_meters(a: Tuple[float, float], b: Tuple[float, float]) -> float:
    lon1, lat1 = a
    lon2, lat2 = b
    dy = (lat2 - lat1) * 111320.0
    dx = (lon2 - lon1) * 111320.0 * math.cos(math.radians((lat1 + lat2) / 2.0))
    return math.hypot(dx, dy)


def apply_people_source_overlay(
    collection: Dict[str, Any],
    overlay: Dict[str, Any],
    *,
    min_move_m: float = PEOPLE_OVERLAY_MIN_MOVE_M,
) -> Dict[str, int]:
    """Copy Hebrew names, English name fixes, and moved points from a shapefile export.

    Leaves long ``info`` / ``links`` fields on the Aug 27 GeoJSON untouched.
    """
    by_pid: Dict[str, Dict[str, Any]] = {}
    for feature in overlay.get("features") or []:
        pid = _person_pid((feature.get("properties") or {}).get("pid"))
        if pid:
            by_pid[pid] = feature
    stats = {"hebrew_name": 0, "name": 0, "geometry": 0, "matched": 0}
    for feature in collection.get("features") or []:
        props = dict(feature.get("properties") or {})
        pid = _person_pid(props.get("pid"))
        source = by_pid.get(pid)
        if source is None:
            continue
        stats["matched"] += 1
        overlay_props = source.get("properties") or {}
        hebrew = _overlay_text(overlay_props, "hebrew_name", "hebrew_nam")
        if hebrew and hebrew != UNKNOWN_HEBREW_NAME and (
            _is_blank_hebrew(props.get("hebrew_name")) or str(props.get("hebrew_name") or "").strip() != hebrew
        ):
            props["hebrew_name"] = hebrew
            stats["hebrew_name"] += 1
        name = _overlay_text(overlay_props, "name")
        current_name = props.get("name")
        current_stripped = current_name.strip() if isinstance(current_name, str) else ""
        if name and name != current_stripped:
            props["name"] = name
            stats["name"] += 1
        src_xy = _point_lonlat(feature)
        overlay_xy = _point_lonlat(source)
        if src_xy and overlay_xy and _planar_meters(src_xy, overlay_xy) >= min_move_m:
            feature["geometry"] = {
                "type": "Point",
                "coordinates": [overlay_xy[0], overlay_xy[1]],
            }
            stats["geometry"] += 1
        feature["properties"] = props
    return stats


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


def _restyle_line_strokes(
    layers: List[Any],
    width_pt: float,
    color: Sequence[int],
    alpha: int,
) -> List[Any]:
    out: List[Any] = []
    for layer in layers:
        if (
            not isinstance(layer, dict)
            or layer.get("type") != "CIMSolidStroke"
            or not layer.get("enable", True)
        ):
            out.append(layer)
            continue
        core = copy.deepcopy(layer)
        core["width"] = width_pt
        core["color"] = _rgb(color, alpha)
        out.append(core)
    return out


def _restyle_symbol_layer_lists(obj: Any) -> None:
    if isinstance(obj, dict):
        layers = obj.get("symbolLayers")
        if isinstance(layers, list):
            for layer in layers:
                _restyle_symbol_layer_lists(layer)
            obj["symbolLayers"] = _restyle_line_strokes(
                layers,
                ROUTE_232_STROKE_WIDTH_PT,
                ROUTE_232_STROKE_COLOR,
                ROUTE_232_STROKE_ALPHA,
            )
            for key, value in obj.items():
                if key == "symbolLayers":
                    continue
                _restyle_symbol_layer_lists(value)
            return
        for value in obj.values():
            _restyle_symbol_layer_lists(value)
        return
    if isinstance(obj, list):
        for item in obj:
            _restyle_symbol_layer_lists(item)


def _tint_text_symbol(obj: Dict[str, Any]) -> None:
    height = obj.get("height")
    if isinstance(height, (int, float)):
        obj["height"] = float(height) * ROUTE_232_LABEL_HEIGHT_SCALE
    halo = obj.get("haloSize")
    if isinstance(halo, (int, float)):
        obj["haloSize"] = max(float(halo) * ROUTE_232_LABEL_HEIGHT_SCALE, 1.2)
    else:
        obj["haloSize"] = 1.2
    obj["haloColor"] = _rgb((20, 16, 12), 80)
    fill = _rgb(ROUTE_232_LABEL_FILL)
    obj["color"] = fill
    nested = obj.get("symbol")
    if isinstance(nested, dict):
        for layer in nested.get("symbolLayers") or []:
            if isinstance(layer, dict) and layer.get("type") == "CIMSolidFill":
                layer["color"] = fill


def _scale_text_symbol_heights(obj: Any) -> None:
    if isinstance(obj, dict):
        if obj.get("type") == "CIMTextSymbol":
            _tint_text_symbol(obj)
        for value in obj.values():
            _scale_text_symbol_heights(value)
        return
    if isinstance(obj, list):
        for item in obj:
            _scale_text_symbol_heights(item)


def emphasize_copied_line_lyrx(lyrx: Dict[str, Any]) -> Dict[str, Any]:
    payload = copy.deepcopy(lyrx)
    _restyle_symbol_layer_lists(payload)
    _scale_text_symbol_heights(payload)
    return payload


def _route_232_source_geojson(source_pack: Path) -> Optional[Path]:
    gis_dir = source_pack / "gis" if (source_pack / "gis").is_dir() else source_pack
    if not gis_dir.is_dir():
        return None
    exact = gis_dir / f"{ROUTE_232_STEM}.geojson"
    if exact.is_file():
        return exact
    matches = [path for path in gis_dir.glob("*.geojson") if "232" in path.stem]
    if len(matches) == 1:
        return matches[0]
    return None


def install_nli_route_232_overlay(
    pack_dir: Path,
    overlay_source_root: Optional[Path] = None,
) -> Dict[str, Any]:
    source_root = overlay_source_root or pack_dir.parent
    src_pack = source_root / ROUTE_232_SOURCE_PACK
    src_geo = _route_232_source_geojson(src_pack)
    if src_geo is None:
        return {"installed": False, "reason": "missing_source_geojson"}
    src_styles = src_pack / "styles"
    lyrx_path, match_method = find_lyrx_file(src_geo, src_styles)
    if lyrx_path is None:
        return {"installed": False, "reason": "missing_source_lyrx"}
    gis_dir = pack_dir / "gis"
    styles_dir = pack_dir / "styles"
    gis_dir.mkdir(parents=True, exist_ok=True)
    styles_dir.mkdir(parents=True, exist_ok=True)
    dest_geo = gis_dir / f"{ROUTE_232_STEM}.geojson"
    dest_lyrx = styles_dir / f"{ROUTE_232_STEM}.lyrx"
    shutil.copy2(src_geo, dest_geo)
    lyrx = json.loads(lyrx_path.read_text(encoding="utf-8"))
    _write_json(dest_lyrx, emphasize_copied_line_lyrx(lyrx))
    return {
        "installed": True,
        "stem": ROUTE_232_STEM,
        "source_geojson": str(src_geo),
        "source_lyrx": str(lyrx_path),
        "lyrx_match": match_method,
        "stroke_width_pt": ROUTE_232_STROKE_WIDTH_PT,
    }


def _int_object_id(value: Any) -> Optional[int]:
    if value in (None, ""):
        return None
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


def _feature_object_id(feature: Dict[str, Any], *keys: str) -> Optional[int]:
    props = feature.get("properties") or {}
    for key in keys:
        oid = _int_object_id(props.get(key))
        if oid is not None:
            return oid
    return _int_object_id(feature.get("id"))


def _load_feature_collection(path: Path) -> Dict[str, Any]:
    if not path.is_file():
        return {"type": "FeatureCollection", "features": []}
    payload = json.loads(path.read_text(encoding="utf-8"))
    features = payload.get("features") if isinstance(payload, dict) else None
    return {"type": "FeatureCollection", "features": list(features or [])}


def default_processed_nli_layers_dir(pack_dir: Path) -> Path:
    """Exhibit sidecars live under public/processed/layers/nli, not source gis."""
    return pack_dir.parent.parent.parent / "processed" / "layers" / "nli"


def _investigation_settlements_seed_path(processed_layers_dir: Path) -> Optional[Path]:
    seed = processed_layers_dir / f"{INVESTIGATION_SETTLEMENTS_STEM}.geojson"
    if seed.is_file():
        return seed
    return None


def install_nova_site_investigation_settlement(
    gis_dir: Path,
    processed_layers_dir: Path,
) -> Optional[Dict[str, Any]]:
    """Copy investigation polygon 100 into the processed settlement sidecar as Nova."""
    polygons_path = gis_dir / "investigation_polygons.geojson"
    if not polygons_path.is_file():
        return None
    polygons = json.loads(polygons_path.read_text(encoding="utf-8"))
    site = next(
        (
            feature
            for feature in polygons.get("features") or []
            if _feature_object_id(feature, "OBJECTID") == NOVA_SITE_OUTLINE_OBJECT_ID
            and feature.get("geometry")
        ),
        None,
    )
    if site is None:
        return None
    seed_path = _investigation_settlements_seed_path(processed_layers_dir)
    if seed_path is None:
        return None
    settlements = _load_feature_collection(seed_path)
    kept: List[Dict[str, Any]] = []
    for feature in settlements.get("features") or []:
        oid = _feature_object_id(feature, "outlineObjectId", "outlineObjectID", "OBJECTID")
        if oid == NOVA_SITE_OUTLINE_OBJECT_ID:
            continue
        kept.append(feature)
    kept.append(
        {
            "type": "Feature",
            "id": f"nli-settlement-outline-{NOVA_SITE_OUTLINE_OBJECT_ID}",
            "properties": {
                "outlineObjectId": NOVA_SITE_OUTLINE_OBJECT_ID,
                "locations": [NOVA_SITE_LOCATION],
            },
            "geometry": copy.deepcopy(site.get("geometry")),
        }
    )
    settlements["features"] = kept
    _write_json(
        processed_layers_dir / f"{INVESTIGATION_SETTLEMENTS_STEM}.geojson",
        settlements,
    )
    return {
        "features": len(kept),
        "nova_site_outline_object_id": NOVA_SITE_OUTLINE_OBJECT_ID,
    }


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


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def haversine_m(a: Sequence[float], b: Sequence[float]) -> float:
    radius_m = 6371000.0
    lon1, lat1 = math.radians(float(a[0])), math.radians(float(a[1]))
    lon2, lat2 = math.radians(float(b[0])), math.radians(float(b[1]))
    dlon = lon2 - lon1
    dlat = lat2 - lat1
    chord = (
        math.sin(dlat / 2.0) ** 2
        + math.cos(lat1) * math.cos(lat2) * math.sin(dlon / 2.0) ** 2
    )
    return 2.0 * radius_m * math.asin(math.sqrt(chord))


def _require_sha256(path: Path, expected: Optional[str], label: str) -> None:
    if expected is None:
        return
    actual = sha256_file(path)
    wanted = expected.strip().lower()
    if actual != wanted:
        raise ValueError(f"{label} SHA-256 mismatch: expected {wanted}, got {actual}")


def _zip_member_payload(zip_path: Path, member_name: str) -> Any:
    with zipfile.ZipFile(zip_path) as archive:
        by_base: Dict[str, zipfile.ZipInfo] = {}
        for info in archive.infolist():
            if info.is_dir():
                continue
            name = zip_entry_name(info).replace("\\", "/")
            by_base[Path(name).name] = info
        if member_name not in by_base:
            raise FileNotFoundError(f"{zip_path} is missing {member_name}")
        payload = archive.read(by_base[member_name])
    return json.loads(payload.decode("utf-8"))


def _compensated_acrossline(
    *,
    from_color: str,
    to_color: str,
    width_pt: float,
    opacity: float,
    gradient_size: float,
) -> Dict[str, Any]:
    return {
        "fromColor": from_color,
        "toColor": to_color,
        "widthPt": width_pt,
        "opacity": opacity,
        "taperFromWidthPt": width_pt,
        "taperToWidthPt": 0,
        "gradientSize": gradient_size,
    }


def _default_individual_acrossline() -> Dict[str, Any]:
    return _compensated_acrossline(
        from_color="#f5f500",
        to_color="#f50000",
        width_pt=1,
        opacity=0.6,
        gradient_size=0.75,
    )


def _normalized_class_breaks(
    class_breaks: Optional[Sequence[Any]] = None,
) -> Tuple[Tuple[float, float], ...]:
    if not class_breaks:
        return OVERLAP_CLASS_BREAKS
    first = class_breaks[0]
    if isinstance(first, dict):
        return tuple(
            (float(item["max"]), float(item["widthPt"])) for item in class_breaks
        )
    return tuple((float(max_count), float(width_pt)) for max_count, width_pt in class_breaks)


def overlap_class_width_pt(
    count: Any, class_breaks: Optional[Sequence[Any]] = None
) -> float:
    breaks = _normalized_class_breaks(class_breaks)
    try:
        value = float(count)
    except (TypeError, ValueError):
        value = 0.0
    for max_count, width_pt in breaks:
        if value <= max_count:
            return float(width_pt)
    return float(breaks[-1][1])


def _reverse_line_geometry(geometry: Dict[str, Any]) -> None:
    geom_type = geometry.get("type")
    coords = geometry.get("coordinates")
    if geom_type == "LineString" and isinstance(coords, list):
        geometry["coordinates"] = list(reversed(coords))
        return
    if geom_type == "MultiLineString" and isinstance(coords, list):
        geometry["coordinates"] = [
            list(reversed(part)) if isinstance(part, list) else part for part in coords
        ]


def _line_endpoints(geometry: Dict[str, Any]) -> Optional[Tuple[Sequence[float], Sequence[float]]]:
    coords = geometry.get("coordinates")
    geom_type = geometry.get("type")
    if geom_type == "LineString" and isinstance(coords, list) and coords:
        return coords[0], coords[-1]
    if (
        geom_type == "MultiLineString"
        and isinstance(coords, list)
        and coords
        and isinstance(coords[0], list)
        and coords[0]
        and isinstance(coords[-1], list)
        and coords[-1]
    ):
        return coords[0][0], coords[-1][-1]
    return None


def _lonlat_from_vertex(vertex: Sequence[float], *, web_mercator: bool) -> List[float]:
    x, y = float(vertex[0]), float(vertex[1])
    if web_mercator:
        return _mercator_xy_to_lonlat(x, y)
    return [x, y]


def _should_reverse_toward_nova(geometry: Dict[str, Any], *, web_mercator: bool) -> bool:
    endpoints = _line_endpoints(geometry)
    if endpoints is None:
        return False
    first = _lonlat_from_vertex(endpoints[0], web_mercator=web_mercator)
    last = _lonlat_from_vertex(endpoints[1], web_mercator=web_mercator)
    return haversine_m(last, NOVA_FACILITY_WGS84) < haversine_m(
        first, NOVA_FACILITY_WGS84
    )


def _attach_acrossline(feature: Dict[str, Any], across_line: Dict[str, Any]) -> None:
    props = feature.setdefault("properties", {})
    props.pop("flow_direction", None)
    props["acrossLine"] = copy.deepcopy(across_line)


def reverse_fleeing_individuals(
    collection: Dict[str, Any],
    across_line: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    ribbon = across_line or _default_individual_acrossline()
    for feature in collection.get("features") or []:
        geometry = feature.get("geometry") or {}
        _reverse_line_geometry(geometry)
        _attach_acrossline(feature, ribbon)
    return collection


def reverse_fleeing_overlap(
    collection: Dict[str, Any],
    class_breaks: Optional[Sequence[Any]] = None,
    across_line: Optional[Dict[str, Any]] = None,
    *,
    web_mercator: bool = True,
) -> Dict[str, Any]:
    template = across_line or _compensated_acrossline(
        from_color="#f5f500",
        to_color="#f50000",
        width_pt=0.5,
        opacity=1.0,
        gradient_size=0.75,
    )
    breaks = _normalized_class_breaks(class_breaks)
    for feature in collection.get("features") or []:
        geometry = feature.get("geometry") or {}
        if _should_reverse_toward_nova(geometry, web_mercator=web_mercator):
            _reverse_line_geometry(geometry)
        props = feature.setdefault("properties", {})
        width_pt = overlap_class_width_pt(props.get("COUNT_"), breaks)
        ribbon = dict(template)
        ribbon["widthPt"] = width_pt
        ribbon["taperFromWidthPt"] = width_pt
        ribbon["taperToWidthPt"] = 0
        _attach_acrossline(feature, ribbon)
    return collection


def _acrossline_from_lyrx(lyrx_payload: Any, *, default_opacity: float) -> Dict[str, Any]:
    ir = parse_acrossline_from_lyrx(lyrx_payload)
    opacity = ir.get("opacity")
    if opacity is None:
        opacity = default_opacity
    return {
        "fromColor": ir.get("fromColor") or "#f5f500",
        "toColor": ir.get("toColor") or "#f50000",
        "opacity": float(opacity),
        "gradientSize": float(ir.get("gradientSize") or 0.75),
        "classBreaks": ir.get("classBreaks"),
    }


def _collection_wgs84_bbox(
    collection: Dict[str, Any],
) -> Optional[Tuple[float, float, float, float]]:
    lons: List[float] = []
    lats: List[float] = []
    for feature in collection.get("features") or []:
        geometry = feature.get("geometry") or {}
        coords = geometry.get("coordinates")
        if geometry.get("type") == "LineString" and isinstance(coords, list):
            points = coords
        elif geometry.get("type") == "MultiLineString" and isinstance(coords, list):
            points = [pt for part in coords if isinstance(part, list) for pt in part]
        else:
            continue
        for point in points:
            if isinstance(point, (list, tuple)) and len(point) >= 2:
                lons.append(float(point[0]))
                lats.append(float(point[1]))
    if not lons or not lats:
        return None
    return (min(lons), min(lats), max(lons), max(lats))


def install_nli_fleeing_overlays(
    processed_dir: Path,
    geojson_zip: Path,
    lyrx_zip: Path,
    expected_geojson_sha256: Optional[str] = None,
    expected_lyrx_sha256: Optional[str] = None,
) -> Dict[str, Any]:
    _require_sha256(Path(geojson_zip), expected_geojson_sha256, "Fleeing geojson zip")
    _require_sha256(Path(lyrx_zip), expected_lyrx_sha256, "Fleeing lyrx zip")
    processed_dir = Path(processed_dir)
    processed_dir.mkdir(parents=True, exist_ok=True)

    individual_ir = _acrossline_from_lyrx(
        _zip_member_payload(Path(lyrx_zip), FLEEING_ROUTE_LYRX_MEMBER),
        default_opacity=0.6,
    )
    overlap_ir = _acrossline_from_lyrx(
        _zip_member_payload(Path(lyrx_zip), FLEEING_ROUTE_OVERLAPP_LYRX_MEMBER),
        default_opacity=1.0,
    )
    individual = reverse_fleeing_individuals(
        _zip_member_payload(Path(geojson_zip), FLEEING_ROUTE_GEOJSON_MEMBER),
        _compensated_acrossline(
            from_color=individual_ir["fromColor"],
            to_color=individual_ir["toColor"],
            width_pt=1,
            opacity=individual_ir["opacity"],
            gradient_size=individual_ir["gradientSize"],
        ),
    )
    reproject_web_mercator_collection_to_wgs84(individual)
    overlap = reverse_fleeing_overlap(
        _zip_member_payload(Path(geojson_zip), FLEEING_ROUTE_OVERLAPP_GEOJSON_MEMBER),
        overlap_ir.get("classBreaks"),
        _compensated_acrossline(
            from_color=overlap_ir["fromColor"],
            to_color=overlap_ir["toColor"],
            width_pt=0.5,
            opacity=overlap_ir["opacity"],
            gradient_size=overlap_ir["gradientSize"],
        ),
    )
    reproject_web_mercator_collection_to_wgs84(overlap)
    individual_path = processed_dir / f"{FLEEING_ROUTE_STEM}.geojson"
    overlap_path = processed_dir / f"{FLEEING_ROUTE_OVERLAPP_STEM}.geojson"
    _write_json(individual_path, individual)
    _write_json(overlap_path, overlap)
    return {
        "installed": True,
        "individual": str(individual_path),
        "overlap": str(overlap_path),
        "features": {
            FLEEING_ROUTE_STEM: len(individual.get("features") or []),
            FLEEING_ROUTE_OVERLAPP_STEM: len(overlap.get("features") or []),
        },
        "bbox": _collection_wgs84_bbox(individual),
        "urls": {
            FLEEING_ROUTE_STEM: FLEEING_ROUTE_URL,
            FLEEING_ROUTE_OVERLAPP_STEM: FLEEING_ROUTE_OVERLAPP_URL,
        },
    }


def install_nli_mor_route(
    processed_dir: Path,
    route_zip: Path,
    expected_sha256: Optional[str] = None,
) -> Dict[str, Any]:
    """Install the reviewed Mor route as a hidden, projected NLI sidecar."""
    if not expected_sha256:
        raise ValueError("Mor route zip SHA-256 is required")
    _require_sha256(Path(route_zip), expected_sha256, "Mor route zip")
    collection = _zip_member_payload(Path(route_zip), MOR_ROUTE_GEOJSON_MEMBER)
    collection["metadata"] = {
        "source": "Mor_levy.zip",
        "source_member": MOR_ROUTE_GEOJSON_MEMBER,
        "source_sha256": (expected_sha256 or MOR_ROUTE_ZIP_SHA256),
    }
    for feature in collection.get("features") or []:
        geometry = feature.get("geometry") or {}
        coords = geometry.get("coordinates")
        if geometry.get("type") == "MultiLineString" and isinstance(coords, list):
            geometry["coordinates"] = [
                list(reversed(part)) if isinstance(part, list) else part
                for part in reversed(coords)
            ]
        elif geometry.get("type") == "LineString" and isinstance(coords, list):
            geometry["coordinates"] = list(reversed(coords))
        props = feature.setdefault("properties", {})
        props["flow_direction"] = "nova-outward"
    reproject_web_mercator_collection_to_wgs84(collection)
    output = Path(processed_dir) / f"{MOR_ROUTE_STEM}.geojson"
    _write_json(output, collection)
    return {"installed": True, "path": str(output), "url": MOR_ROUTE_URL, "features": len(collection.get("features") or [])}


def generate_nova_escape_index(
    routes_path: Path,
    polygons_path: Path,
    lines_path: Path,
    settlements_path: Path,
    output_path: Path,
) -> bool:
    inputs = [
        Path(routes_path),
        Path(polygons_path),
        Path(lines_path),
        Path(settlements_path),
    ]
    output = Path(output_path)
    if not all(path.is_file() for path in inputs):
        output.unlink(missing_ok=True)
        return False
    output.unlink(missing_ok=True)
    node = shutil.which("node")
    if not node:
        raise RuntimeError("Node.js is required to generate the Nova fleeing-route impact index")
    generator = Path(__file__).with_name("generate-nova-escape-index.mjs")
    try:
        subprocess.run(
            [
                node,
                "--experimental-detect-module",
                str(generator),
                *(str(path) for path in inputs),
                str(output),
            ],
            check=True,
        )
    except subprocess.CalledProcessError:
        output.unlink(missing_ok=True)
        raise
    return True


def prepare_nli_pack(
    zip_path: Path,
    pack_dir: Path,
    popup_path: Optional[Path | Sequence[Path]] = None,
    authorities_path: Optional[Path] = None,
    alarms_path: Optional[Path] = None,
    pid_mms_path: Optional[Path] = None,
    overlay_source_root: Optional[Path] = None,
    people_overlay_path: Optional[Path] = None,
    processed_layers_dir: Optional[Path] = None,
    fleeing_geojson_zip: Optional[Path] = None,
    fleeing_lyrx_zip: Optional[Path] = None,
    fleeing_geojson_sha256: Optional[str] = None,
    fleeing_lyrx_sha256: Optional[str] = None,
    mor_route_zip: Optional[Path] = None,
    mor_route_sha256: Optional[str] = None,
    investigation_polygons_lyrx: Optional[Path] = None,
    mazal_records: Optional[Dict[str, dict]] = None,
    mazal_xlsx: Optional[Path] = None,
) -> Dict[str, Any]:
    authored_polygon_lyrx = Path(investigation_polygons_lyrx) if investigation_polygons_lyrx is not None else None
    if authored_polygon_lyrx is not None and not authored_polygon_lyrx.is_file():
        raise FileNotFoundError(
            f"Investigation polygon .lyrx does not exist: {authored_polygon_lyrx}"
        )

    gis_dir = pack_dir / "gis"
    styles_dir = pack_dir / "styles"
    gis_dir.mkdir(parents=True, exist_ok=True)
    styles_dir.mkdir(parents=True, exist_ok=True)
    summary: Dict[str, Any] = {"layers": {}}
    authorities = load_nli_authorities(authorities_path or DEFAULT_AUTHORITIES_PATH)
    pid_mms_ids = load_pid_mms_ids(
        pid_mms_path if pid_mms_path is not None else DEFAULT_PID_MMS_PATH
    )
    with zipfile.ZipFile(zip_path) as archive:
        by_name = {zip_entry_name(info): info for info in archive.infolist()}
        catalog_features = _catalog_features_from_zip(by_name, archive)
        for zip_name, stem in ZIP_LAYER_MAP.items():
            info = resolve_zip_layer_info(by_name, zip_name, stem)
            collection = json.loads(archive.read(info))
            dropped = drop_null_geometries(collection)
            moved = 0
            times = sanitize_time_like_properties(collection)
            grouped = rewrite_nli_layer_properties(stem, collection)
            if stem in PROJECTED_STEMS:
                reproject_web_mercator_collection_to_wgs84(collection)
            if stem in TIMELINE_STEMS:
                apply_timeline_minutes(collection)
            overlay_stats: Optional[Dict[str, int]] = None
            aliases_by_pid: Dict[str, List[str]] = {}
            if stem == "people" and people_overlay_path and Path(people_overlay_path).is_file():
                overlay = json.loads(Path(people_overlay_path).read_text(encoding="utf-8"))
                overlay_stats = apply_people_source_overlay(collection, overlay)
            if stem == "people" and (authorities or pid_mms_ids):
                summary["nli_catalog_links"] = attach_nli_catalog_links(
                    collection, authorities, catalog_features, pid_mms_ids
                )
            if stem == "people":
                from nli_people_refresh import apply_nli_person_fields, load_mazal_records

                records = mazal_records
                if records is None:
                    workbook = Path(mazal_xlsx) if mazal_xlsx is not None else (
                        Path.home() / "Downloads" / "NLI-MAZAL-710_ALL_20260726.xlsx"
                    )
                    if workbook.is_file():
                        records = load_mazal_records(workbook)
                if records:
                    field_stats = apply_nli_person_fields(collection, records)
                    summary["nli_person_fields"] = {
                        "updated": field_stats["updated"],
                        "skipped_unmatched": field_stats["skipped_unmatched"],
                    }
                    aliases_by_pid = field_stats["aliases_by_pid"]
                moved = jitter_coincident_points(collection.get("features") or [])
            _write_json(gis_dir / f"{stem}.geojson", collection)
            if stem == "people":
                apply_people_name_offsets(collection.get("features") or [])
                _write_json(gis_dir / "people_names.geojson", collection)
                from nli_people_refresh import write_people_search_index
                from otef_layer_processing.nli_runtime_hashes import stamp_nli_runtime_artifact_hash

                sidecar = (
                    Path(processed_layers_dir)
                    if processed_layers_dir is not None
                    else default_processed_nli_layers_dir(pack_dir)
                )
                meta_path = sidecar / "release-metadata.json"
                if meta_path.is_file():
                    dataset_version = (
                        json.loads(meta_path.read_text(encoding="utf-8")).get("datasetVersion") or ""
                    )
                    if dataset_version:
                        write_people_search_index(
                            collection,
                            dataset_version,
                            sidecar / "people-search-index.json",
                            aliases_by_pid,
                        )
                        stamp_nli_runtime_artifact_hash(sidecar, "people-search-index.json")
            layer_summary: Dict[str, Any] = {
                "features": len(collection.get("features") or []),
                "dropped_null_geometry": dropped,
                "jittered": moved,
                "time_fields_rewritten": times,
                "legend_values_rewritten": grouped,
            }
            if overlay_stats is not None:
                layer_summary["overlay"] = overlay_stats
            summary["layers"][stem] = layer_summary
    sidecar_dir = (
        Path(processed_layers_dir)
        if processed_layers_dir is not None
        else default_processed_nli_layers_dir(pack_dir)
    )
    nova_sidecar = install_nova_site_investigation_settlement(gis_dir, sidecar_dir)
    if nova_sidecar:
        summary["layers"][INVESTIGATION_SETTLEMENTS_STEM] = nova_sidecar
    if alarms_path is not None and Path(alarms_path).is_file():
        alarms_collection = json.loads(Path(alarms_path).read_text(encoding="utf-8"))
        dropped = drop_null_geometries(alarms_collection)
        timed = apply_alarm_timeline_minutes(alarms_collection)
        alarms_collection = collapse_alarms_to_cities(alarms_collection)
        _write_json(gis_dir / "alarms.geojson", alarms_collection)
        _write_json(styles_dir / "alarms.lyrx", simple_point_lyrx())
        summary["layers"]["alarms"] = {
            "features": len(alarms_collection.get("features") or []),
            "dropped_null_geometry": dropped,
            "jittered": 0,
            "timeline_minutes_written": timed,
        }
    if authored_polygon_lyrx is not None:
        shutil.copyfile(authored_polygon_lyrx, styles_dir / "investigation_polygons.lyrx")
    else:
        _write_json(styles_dir / "investigation_polygons.lyrx", simple_polygon_lyrx())
    _write_json(styles_dir / "people.lyrx", unique_value_point_lyrx("status", OCT7_STATUS_CLASSES))
    _write_json(styles_dir / "lines.lyrx", simple_line_lyrx())
    _write_json(styles_dir / "people_names.lyrx", labels_only_point_lyrx())
    summary["overlays"] = {
        "route_232": install_nli_route_232_overlay(
            pack_dir, overlay_source_root=overlay_source_root or pack_dir.parent
        )
    }
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
    if fleeing_geojson_zip is not None and fleeing_lyrx_zip is not None:
        summary["fleeing_overlays"] = install_nli_fleeing_overlays(
            sidecar_dir,
            Path(fleeing_geojson_zip),
            Path(fleeing_lyrx_zip),
            expected_geojson_sha256=fleeing_geojson_sha256,
            expected_lyrx_sha256=fleeing_lyrx_sha256,
        )
    if mor_route_zip is not None:
        if mor_route_sha256 != MOR_ROUTE_ZIP_SHA256:
            raise ValueError("Mor route zip must use the pinned SHA-256")
        summary["mor_route"] = install_nli_mor_route(
            sidecar_dir, Path(mor_route_zip), expected_sha256=mor_route_sha256
        )
    impact_index_path = sidecar_dir / "fleeing_route_impacts.json"
    if generate_nova_escape_index(
        sidecar_dir / f"{FLEEING_ROUTE_STEM}.geojson",
        gis_dir / "investigation_polygons.geojson",
        gis_dir / "lines.geojson",
        sidecar_dir / f"{INVESTIGATION_SETTLEMENTS_STEM}.geojson",
        impact_index_path,
    ):
        summary.setdefault("fleeing_overlays", {})["impact_index"] = str(impact_index_path)
    written: List[str] = []
    for path in _as_popup_paths(popup_path):
        merge_popup_config(path, NLI_POPUP_CONFIG)
        written.append(str(path))
    if written:
        summary["popup_config"] = written
    return summary


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--investigation-polygons-lyrx",
        type=Path,
        help="Copy an authored investigation polygon .lyrx into the NLI source pack.",
    )
    args = parser.parse_args()
    repo = Path(__file__).resolve().parents[2]
    zip_path = default_nli_zip_path(repo)
    pack_dir = repo / "otef-interactive" / "public" / "source" / "layers" / "nli"
    processed_layers_dir = repo / "otef-interactive" / "public" / "processed" / "layers" / "nli"
    popup_paths = [
        repo / "otef-interactive" / "public" / "source" / "popup-config.json",
        repo / "otef-interactive" / "public" / "source" / "layers" / "popup-config.json",
    ]
    alarms_path = Path.home() / "Downloads" / "oct7_alarms_2023-10-07.geojson"
    people_overlay = Path.home() / "Downloads" / "people_7_10_09092026.geojson"
    downloads_zip = Path.home() / "Downloads" / "drive-download-20260827T125810Z-1-001.zip"
    fleeing_geojson_zip = Path.home() / "Downloads" / "fleeing_route_geojson.zip"
    fleeing_lyrx_zip = Path.home() / "Downloads" / "Fleeing_route_lyrx.zip"
    mor_route_zip = Path.home() / "Downloads" / "Mor_levy.zip"
    if not zip_path.is_file() and downloads_zip.is_file():
        zip_path = downloads_zip
    summary = prepare_nli_pack(
        zip_path,
        pack_dir,
        popup_paths,
        alarms_path=alarms_path,
        people_overlay_path=people_overlay if people_overlay.is_file() else None,
        processed_layers_dir=processed_layers_dir,
        fleeing_geojson_zip=fleeing_geojson_zip if fleeing_geojson_zip.is_file() else None,
        fleeing_lyrx_zip=fleeing_lyrx_zip if fleeing_lyrx_zip.is_file() else None,
        fleeing_geojson_sha256=FLEEING_GEOJSON_ZIP_SHA256,
        fleeing_lyrx_sha256=FLEEING_LYRX_ZIP_SHA256,
        mor_route_zip=mor_route_zip if mor_route_zip.is_file() else None,
        mor_route_sha256=MOR_ROUTE_ZIP_SHA256 if mor_route_zip.is_file() else None,
        investigation_polygons_lyrx=args.investigation_polygons_lyrx,
    )
    print(json.dumps(summary, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()

