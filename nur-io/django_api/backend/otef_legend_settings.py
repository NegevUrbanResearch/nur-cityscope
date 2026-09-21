"""Normalization and merge helpers for shared OTEF legend settings."""

from .otef_nli_clock_layout import clamp_nli_explainer_layout

LEGEND_LANGUAGES = ("he", "en")
LEGEND_SPANS = ("full", "left", "right")


def normalize_legend_slot(raw):
    if not isinstance(raw, dict):
        return None
    slot = clamp_nli_explainer_layout(raw)
    try:
        dwell = float(raw.get("dwellSeconds", 8))
    except (TypeError, ValueError):
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


def merge_legend_settings(current, *, language=None, span=None, layout=None, summarized_group_ids=None):
    merged = normalize_legend_settings(current)
    if language is not None:
        if language not in LEGEND_LANGUAGES:
            return None
        merged["language"] = language
    if span is not None:
        if span not in LEGEND_SPANS or not isinstance(layout, dict):
            return None
        slot = normalize_legend_slot(layout)
        if slot is None:
            return None
        merged["projection"][span] = slot
    if summarized_group_ids is not None:
        if not isinstance(summarized_group_ids, list) or any(not isinstance(value, str) or not value for value in summarized_group_ids):
            return None
        merged["summarizedGroupIds"] = list(dict.fromkeys(summarized_group_ids))
    return merged
