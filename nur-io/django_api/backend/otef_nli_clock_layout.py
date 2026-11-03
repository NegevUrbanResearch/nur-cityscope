"""Normalize durable NLI clock parks (GIS slots + projection spans)."""

import math
import re

PROJECTION_SPAN_KEYS = ("full", "left", "right")
_NOVA_EXPLAINER_ID = re.compile(r"^[1-9][0-9]*$")
_MAX_NOVA_EXPLAINER_ENTRIES = 32
GIS_SLOT_KEYS = ("start", "segev", "nova", "sderot", "hostages", "hostages_all")
CLOCK_LAYOUT_FIELDS = ("leftPct", "topPct", "widthPct", "heightPct", "fontPx", "rotateDeg")


def _finite(value, fallback, missing_zero=False):
    try:
        number = float(value)
    except OverflowError:
        return float("inf") if value > 0 else float("-inf")
    except (TypeError, ValueError):
        number = None
    if number is not None and number == number and number not in (float("inf"), float("-inf")):
        return number
    if missing_zero:
        return 0.0
    try:
        fallback_number = float(fallback)
    except (TypeError, ValueError, OverflowError):
        return 0.0
    if fallback_number != fallback_number or fallback_number in (float("inf"), float("-inf")):
        return 0.0
    return fallback_number


def clamp_nli_explainer_layout(raw, fallback=None):
    src = raw if isinstance(raw, dict) else {}
    fb = fallback if isinstance(fallback, dict) else {}
    width_pct = min(100.0, max(2.0, _finite(src.get("widthPct"), fb.get("widthPct"))))
    height_pct = min(100.0, max(2.0, _finite(src.get("heightPct"), fb.get("heightPct"))))
    left_pct = min(100.0 - width_pct, max(0.0, _finite(src.get("leftPct"), fb.get("leftPct"))))
    top_pct = min(100.0 - height_pct, max(0.0, _finite(src.get("topPct"), fb.get("topPct"))))
    font_px = min(64.0, max(8.0, _finite(src.get("fontPx"), fb.get("fontPx"))))
    rotate_missing = src.get("rotateDeg") in (None, "")
    rotate_deg = min(
        180.0,
        max(-180.0, _finite(src.get("rotateDeg"), fb.get("rotateDeg"), rotate_missing)),
    )
    return {
        "leftPct": left_pct,
        "topPct": top_pct,
        "widthPct": width_pct,
        "heightPct": height_pct,
        "fontPx": font_px,
        "rotateDeg": rotate_deg,
    }


def validate_clock_slot_layout(raw):
    if not isinstance(raw, dict) or set(raw) != set(CLOCK_LAYOUT_FIELDS):
        return None
    if any(
        type(value) not in (int, float)
        or (type(value) is float and not math.isfinite(value))
        for value in raw.values()
    ):
        return None
    return clamp_nli_explainer_layout(raw)


def is_flat_gis_clock_layout(value):
    return isinstance(value, dict) and not isinstance(value.get("leftPct"), dict) and (
        "leftPct" in value or "topPct" in value
    )


def normalize_gis_clock_layout(raw):
    if not isinstance(raw, dict):
        return {}
    if is_flat_gis_clock_layout(raw):
        return {"start": clamp_nli_explainer_layout(raw)}
    out = {}
    for key, value in raw.items():
        if not isinstance(key, str) or not key or not isinstance(value, dict):
            continue
        out[key] = clamp_nli_explainer_layout(value)
    return out


def normalize_projection_clock_layout(raw):
    if not isinstance(raw, dict):
        return {}
    out = {}
    for key in PROJECTION_SPAN_KEYS:
        value = raw.get(key)
        if isinstance(value, dict):
            out[key] = clamp_nli_explainer_layout(value)
    return out


def _json_number(value):
    if type(value) not in (int, float):
        return None
    if type(value) is float and not math.isfinite(value):
        return None
    return value


def _nova_explainer_position(raw):
    if not isinstance(raw, dict) or set(raw) != {"leftPct", "topPct"}:
        return None
    left = _json_number(raw.get("leftPct"))
    top = _json_number(raw.get("topPct"))
    if left is None or top is None:
        return None
    return {
        "leftPct": min(100.0, max(0.0, left)),
        "topPct": min(100.0, max(0.0, top)),
    }


def _nova_explainer_camera(raw, strict):
    if not isinstance(raw, dict):
        return None if strict else {}
    if strict and len(raw) > _MAX_NOVA_EXPLAINER_ENTRIES:
        return None
    out = {}
    for key, value in raw.items():
        if not isinstance(key, str) or _NOVA_EXPLAINER_ID.fullmatch(key) is None:
            if strict:
                return None
            continue
        position = _nova_explainer_position(value)
        if position is None:
            if strict:
                return None
            continue
        if len(out) >= _MAX_NOVA_EXPLAINER_ENTRIES:
            break
        out[key] = position
    return out


def validate_nova_explainer_layout(raw):
    if not isinstance(raw, dict) or set(raw) != {"close", "wide"}:
        return None
    close = _nova_explainer_camera(raw.get("close"), True)
    wide = _nova_explainer_camera(raw.get("wide"), True)
    if close is None or wide is None:
        return None
    return {"close": close, "wide": wide}


def normalize_nova_explainer_maps(raw):
    src = raw if isinstance(raw, dict) else {}
    return {
        "close": _nova_explainer_camera(src.get("close"), False),
        "wide": _nova_explainer_camera(src.get("wide"), False),
    }


def normalize_nli_clock_layout(raw):
    src = raw if isinstance(raw, dict) else {}
    overlays = src.get("gisOverlays")
    nova = overlays.get("novaExplainers") if isinstance(overlays, dict) else None
    return {
        "gis": normalize_gis_clock_layout(src.get("gis")),
        "projection": normalize_projection_clock_layout(src.get("projection")),
        "gisOverlays": {"novaExplainers": normalize_nova_explainer_maps(nova)},
    }
