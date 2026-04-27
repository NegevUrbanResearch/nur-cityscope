"""
Merge optional manual settlement label placement from JSON into processed שמות GeoJSON.

Source path (committed with the pack):
  public/source/layers/projector_base/styles/שמות_label_overrides.json

Schema:
  {
    "version": 1,
    "keyField": "citycode",
    "overrides": {
      "1031": { "rotateDeg": 90, "offsetEm": [14, -7] }
    }
  }

`rotateDeg` and `offsetEm` are optional per entry; missing means 0 / [0,0].
``offsetEm`` [x,y] are numerators stored on ``otef_label_offset_em_x`` / ``otef_label_offset_em_y``,
and a derived length-2 array ``otef_map_text_offset_em`` = ``[x/div, y/div]`` (``div`` =
``SHEMOT_LABEL_OFFSET_DIVISOR``, same as label ``size``) for MapLibre ``text-offset`` via
``["get", …]`` (see maplibre-style-bridge).
"""
from __future__ import annotations

import json
import logging
from pathlib import Path
from typing import Any, Dict, Optional

logger = logging.getLogger(__name__)

SHEMOT_LABEL_OVERRIDES_FILENAME = "שמות_label_overrides.json"
SHEMOT_LAYER_STEM = "שמות_יישובים"
# Must match `labels.size` for שמות_יישובים in styles / maplibre-style-bridge divisor.
SHEMOT_LABEL_OFFSET_DIVISOR = 14.0
OTEF_MAP_TEXT_OFFSET_EM = "otef_map_text_offset_em"


def shemot_label_overrides_path(styles_dir: Path) -> Path:
    return styles_dir / SHEMOT_LABEL_OVERRIDES_FILENAME


def merge_shemot_label_overrides_into_geojson(
    wgs84_geojson_path: Path, styles_dir: Path
) -> None:
    """
    If overrides file exists, merge rotate/offset numerators into each feature's properties
    (otef_label_rotate_deg, otef_label_offset_em_x, otef_label_offset_em_y) plus
    ``otef_map_text_offset_em`` as ``[x/div, y/div]`` for MapLibre ``text-offset`` via ``["get", …]``.
    If file is missing, no-op (MapLibre coalesce treats missing props as 0).
    """
    path = shemot_label_overrides_path(styles_dir)
    if not path.is_file():
        return
    try:
        raw = json.loads(path.read_text(encoding="utf-8"))
    except Exception as e:
        logger.warning("Invalid label overrides JSON %s: %s", path, e)
        return
    if not isinstance(raw, dict):
        logger.warning("Label overrides root must be an object: %s", path)
        return
    key_field = str(raw.get("keyField") or "citycode").strip() or "citycode"
    overrides = raw.get("overrides")
    if overrides is None:
        overrides = {}
    if not isinstance(overrides, dict):
        logger.warning("overrides must be an object in %s", path)
        return

    try:
        fc = json.loads(wgs84_geojson_path.read_text(encoding="utf-8"))
    except Exception as e:
        logger.warning("Could not read GeoJSON for merge %s: %s", wgs84_geojson_path, e)
        return
    feats = fc.get("features")
    if not isinstance(feats, list):
        return

    for feat in feats:
        if not isinstance(feat, dict):
            continue
        props = feat.get("properties")
        if not isinstance(props, dict):
            props = {}
            feat["properties"] = props
        key_val = props.get(key_field)
        key = "" if key_val is None else str(key_val).strip()
        entry: Optional[Dict[str, Any]] = overrides.get(key) if key else None
        rot = 0.0
        ox = 0.0
        oy = 0.0
        if isinstance(entry, dict):
            try:
                rot = float(entry.get("rotateDeg", 0) or 0)
            except (TypeError, ValueError):
                rot = 0.0
            em = entry.get("offsetEm")
            if isinstance(em, (list, tuple)) and len(em) >= 2:
                try:
                    ox = float(em[0] or 0)
                    oy = float(em[1] or 0)
                except (TypeError, ValueError):
                    ox, oy = 0.0, 0.0
        props["otef_label_rotate_deg"] = rot
        props["otef_label_offset_em_x"] = ox
        props["otef_label_offset_em_y"] = oy
        d = SHEMOT_LABEL_OFFSET_DIVISOR
        props[OTEF_MAP_TEXT_OFFSET_EM] = [ox / d, oy / d]

    try:
        wgs84_geojson_path.write_text(
            json.dumps(fc, ensure_ascii=False, separators=(",", ":")),
            encoding="utf-8",
        )
    except Exception as e:
        logger.warning("Failed to write merged GeoJSON %s: %s", wgs84_geojson_path, e)
