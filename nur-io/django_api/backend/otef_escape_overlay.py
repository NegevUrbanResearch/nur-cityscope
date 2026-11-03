"""Normalize Nova-only fleeing-route overlay flags stored beside narrative state."""

EMPTY_ESCAPE_OVERLAY = {
    "individual": False,
    "overlap": False,
    "mor": False,
    "settled": False,
}
NOVA_ENTER_ESCAPE_OVERLAY = {
    "individual": False,
    "overlap": False,
    "mor": False,
    "settled": False,
}

FLAG_KEYS = ("individual", "overlap", "mor", "settled")


def _flag(raw, key):
    if key not in raw:
        return False
    value = raw[key]
    if not isinstance(value, bool):
        raise ValueError(f"{key} must be a boolean")
    return value


def normalize_escape_overlay(raw, narrative_id, apply_enter_defaults=False):
    if narrative_id != "nova":
        return dict(EMPTY_ESCAPE_OVERLAY)
    if not isinstance(raw, dict):
        return dict(NOVA_ENTER_ESCAPE_OVERLAY if apply_enter_defaults else EMPTY_ESCAPE_OVERLAY)
    overlay = {key: _flag(raw, key) for key in FLAG_KEYS}
    if overlay["settled"]:
        return {"individual": False, "overlap": False, "mor": False, "settled": True}
    return overlay
