"""Normalize durable NLI clock parks (GIS slots + projection spans)."""

PROJECTION_SPAN_KEYS = ("full", "left", "right")


def _finite(value, fallback, missing_zero=False):
    try:
        number = float(value)
    except (TypeError, ValueError):
        number = None
    if number is not None and number == number and number not in (float("inf"), float("-inf")):
        return number
    if missing_zero:
        return 0.0
    try:
        fallback_number = float(fallback)
    except (TypeError, ValueError):
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


def _is_flat_gis_layout(value):
    return isinstance(value, dict) and not isinstance(value.get("leftPct"), dict) and (
        "leftPct" in value or "topPct" in value
    )


def normalize_gis_clock_layout(raw):
    if not isinstance(raw, dict):
        return {}
    if _is_flat_gis_layout(raw):
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


def normalize_nli_clock_layout(raw):
    src = raw if isinstance(raw, dict) else {}
    return {
        "gis": normalize_gis_clock_layout(src.get("gis")),
        "projection": normalize_projection_clock_layout(src.get("projection")),
    }


def merge_nli_clock_layout_surface(current, surface, layout):
    doc = normalize_nli_clock_layout(current)
    if surface == "gis":
        doc["gis"] = normalize_gis_clock_layout(layout)
    elif surface == "projection":
        doc["projection"] = normalize_projection_clock_layout(layout)
    else:
        return None
    return doc
