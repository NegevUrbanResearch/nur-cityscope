"""Validation and transitions for the persistent OTEF narrative state."""

import copy

from .otef_person_selection import (
    normalize_person_selection,
    transition_person_selection,
)
from .otef_investigation_clock import idle_investigation_clock


NARRATIVE_IDS = frozenset({"segev"})
NARRATIVE_TRANSITIONS = frozenset({"initial", "enter", "replace", "exit"})


class StaleNarrativeRevision(ValueError):
    def __init__(self, current):
        super().__init__("stale narrative revision")
        self.current = current


def empty_narrative_state(revision=0):
    revision = max(0, int(revision or 0))
    return {
        "id": None,
        "transition": "initial" if revision == 0 else "exit",
        "revision": revision,
    }


def normalize_narrative_state(raw):
    """Return a canonical narrative snapshot or the revision-zero initial state."""
    if not isinstance(raw, dict):
        return empty_narrative_state()

    narrative_id = raw.get("id")
    transition = raw.get("transition")
    revision = raw.get("revision")
    if (
        isinstance(revision, bool)
        or not isinstance(revision, int)
        or revision < 0
        or not isinstance(transition, str)
        or transition not in NARRATIVE_TRANSITIONS
    ):
        return empty_narrative_state()

    if revision == 0:
        return empty_narrative_state()

    if narrative_id is None:
        expected_transition = "initial" if revision == 0 else "exit"
        if transition != expected_transition:
            return empty_narrative_state()
    elif (
        not isinstance(narrative_id, str)
        or narrative_id not in NARRATIVE_IDS
        or transition not in ("enter", "replace")
    ):
        return empty_narrative_state()

    return {
        "id": narrative_id,
        "transition": transition,
        "revision": revision,
    }


def transition_narrative_state(locked, narrative_id, expected_revision):
    """Apply a validated transition to an already row-locked viewport state."""
    if narrative_id is not None and (
        not isinstance(narrative_id, str) or narrative_id not in NARRATIVE_IDS
    ):
        raise ValueError("unsupported narrative id")
    if (
        isinstance(expected_revision, bool)
        or not isinstance(expected_revision, int)
        or expected_revision < 0
    ):
        raise ValueError("expected revision must be a nonnegative integer")
    current = normalize_narrative_state(locked.narrative_state)
    if current["revision"] != expected_revision:
        raise StaleNarrativeRevision(current)

    if narrative_id is None:
        transition = "exit"
    elif current["id"] is None:
        transition = "enter"
    else:
        transition = "replace"

    snapshot = {
        "id": narrative_id,
        "transition": transition,
        "revision": current["revision"] + 1,
    }
    locked.narrative_state = snapshot
    return snapshot


def transition_narrative_scene(locked, narrative_id, expected_revision):
    """Mutate narrative-owned fields on a locked row and capture the final scene."""
    narrative = transition_narrative_state(
        locked, narrative_id, expected_revision
    )
    if narrative_id is not None:
        previous_clock = (
            locked.investigation_clock
            if isinstance(locked.investigation_clock, dict)
            else {}
        )
        previous_revision = previous_clock.get("revision", 0)
        if isinstance(previous_revision, bool):
            previous_revision = 0
        try:
            previous_revision = max(0, int(previous_revision or 0))
        except (TypeError, ValueError):
            previous_revision = 0
        locked.investigation_clock = idle_investigation_clock(
            revision=previous_revision + 1,
            loop=previous_clock.get("loop") is True,
        )
        selection, _changed, _error, _reason = transition_person_selection(
            locked,
            {"personId": None, "datasetVersion": None},
            normalizer=normalize_person_selection,
        )
        locked.person_selection = selection
        locked.basemap = "satellite_bw"
    else:
        locked.basemap = "dark"

    return {
        "sceneRevision": narrative["revision"],
        "narrativeState": dict(narrative),
        "basemap": locked.basemap,
        "investigationClock": copy.deepcopy(locked.investigation_clock),
        "personSelection": normalize_person_selection(locked.person_selection),
    }
