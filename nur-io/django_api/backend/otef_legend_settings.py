"""Normalization and merge helpers for shared OTEF legend settings."""

import math

from .otef_nli_clock_layout import clamp_nli_explainer_layout

LEGEND_LANGUAGES = ("he", "en")
LEGEND_SPANS = ("full", "left", "right")
LEGEND_LAYOUT_FIELDS = ("leftPct", "topPct", "widthPct", "heightPct", "fontPx", "rotateDeg", "dwellSeconds")


def validate_legend_slot_layout(raw):
    if not isinstance(raw, dict) or set(raw) != set(LEGEND_LAYOUT_FIELDS):
        return None
    if any(
        type(value) not in (int, float)
        or (type(value) is float and not math.isfinite(value))
        for value in raw.values()
    ):
        return None
    return normalize_legend_slot(raw)


def normalize_legend_slot(raw):
    if not isinstance(raw, dict):
        return None
    slot = clamp_nli_explainer_layout(raw)
    raw_dwell = raw.get("dwellSeconds", 8)
    if type(raw_dwell) is int:
        dwell = min(30.0, max(4.0, raw_dwell))
    else:
        try:
            dwell = float(raw_dwell)
        except (TypeError, ValueError, OverflowError):
            dwell = 8.0
    if dwell != dwell or dwell in (float("inf"), float("-inf")):
        dwell = 8.0
    slot["dwellSeconds"] = min(30.0, max(4.0, dwell))
    return slot


def normalize_legend_settings(raw):
    src = raw if isinstance(raw, dict) else {}
    language = src.get("language") if src.get("language") in LEGEND_LANGUAGES else "he"
    projection_src = src.get("projection") if isinstance(src.get("projection"), dict) else {}
    projection = {}
    for span in LEGEND_SPANS:
        slot = normalize_legend_slot(projection_src.get(span))
        if slot is not None:
            projection[span] = slot
    ids = src.get("summarizedGroupIds")
    summarized = []
    if isinstance(ids, list):
        for value in ids:
            if isinstance(value, str) and value and value not in summarized:
                summarized.append(value)
    return {"language": language, "projection": projection, "summarizedGroupIds": summarized}
