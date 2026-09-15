"""Normalize Nova-only fleeing-route overlay flags stored beside narrative state."""

EMPTY_ESCAPE_OVERLAY = {"individual": False, "overlap": False}
NOVA_ENTER_ESCAPE_OVERLAY = {"individual": False, "overlap": False}


def normalize_escape_overlay(raw, narrative_id, apply_enter_defaults=False):
    if narrative_id != "nova":
        return dict(EMPTY_ESCAPE_OVERLAY)
    if not isinstance(raw, dict):
        return dict(NOVA_ENTER_ESCAPE_OVERLAY if apply_enter_defaults else EMPTY_ESCAPE_OVERLAY)
    return {
        "individual": raw.get("individual") is True,
        "overlap": raw.get("overlap") is True,
    }
