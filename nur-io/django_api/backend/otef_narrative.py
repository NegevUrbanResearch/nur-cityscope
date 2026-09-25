"""Validation and transitions for the persistent OTEF narrative state."""

import copy
import json
import os
import re
from pathlib import Path

from .otef_escape_overlay import (
    EMPTY_ESCAPE_OVERLAY,
    NOVA_ENTER_ESCAPE_OVERLAY,
    normalize_escape_overlay,
)
from .otef_person_selection import (
    normalize_person_selection,
    transition_person_selection,
)
from .otef_investigation_clock import idle_investigation_clock


NARRATIVE_IDS = frozenset({"segev", "nova", "sderot", "hostages", "hostages_all"})
NARRATIVE_TRANSITIONS = frozenset({"initial", "enter", "replace", "exit"})
PRESENTATION_MANIFEST_PATH = Path(
    os.environ.get(
        "OTEF_NLI_PRESENTATION_MANIFEST",
        "/app/public/presentation/nli-presentation-manifest.json",
    )
)
PRESENTATION_DECK_PATH = "processed/presentations/nli/nur-model.pptx"
PRESENTATION_NARRATIVE_IDS = frozenset({"segev", "nova", "sderot", "hostages"})


def load_presentation_manifest(path=PRESENTATION_MANIFEST_PATH):
    """Load and validate the shared NLI presentation manifest."""
    with open(path, encoding="utf-8") as manifest_file:
        manifest = json.load(manifest_file)

    if (
        not isinstance(manifest, dict)
        or type(manifest.get("version")) is not int
        or manifest["version"] != 1
    ):
        raise ValueError("unsupported presentation manifest version")
    deck = manifest.get("deck")
    if not isinstance(deck, dict):
        raise ValueError("presentation manifest deck must be an object")
    deck_path = deck.get("path")
    if (
        not isinstance(deck_path, str)
        or deck_path != PRESENTATION_DECK_PATH
        or ".." in deck_path
        or deck_path.startswith("/")
    ):
        raise ValueError("invalid presentation deck path")
    if type(deck.get("slideCount")) is not int or deck["slideCount"] != 33:
        raise ValueError("presentation deck must contain 33 slides")
    if "sha256" not in deck:
        raise ValueError("presentation deck must include a SHA-256 field")
    sha256 = deck["sha256"]
    if sha256 is not None and (
        not isinstance(sha256, str)
        or re.fullmatch(r"[0-9a-f]{64}", sha256) is None
    ):
        raise ValueError("invalid presentation deck SHA-256")

    segments = manifest.get("segments")
    if not isinstance(segments, list):
        raise ValueError("presentation segments must be an array")
    ids = set()
    previous_end = 0
    for segment in segments:
        if not isinstance(segment, dict):
            raise ValueError("presentation segment must be an object")
        segment_id = segment.get("id")
        if not isinstance(segment_id, str) or not segment_id or segment_id in ids:
            raise ValueError("presentation segment IDs must be unique nonempty strings")
        ids.add(segment_id)
        if "requiredNarrative" not in segment:
            raise ValueError("presentation segment must include a requiredNarrative field")
        narrative = segment["requiredNarrative"]
        if narrative is not None and (
            not isinstance(narrative, str)
            or narrative not in PRESENTATION_NARRATIVE_IDS
        ):
            raise ValueError("unsupported required presentation narrative")
        segment_range = segment.get("range")
        if (
            not isinstance(segment_range, list)
            or len(segment_range) != 2
            or any(type(value) is not int for value in segment_range)
            or segment_range[0] < 1
            or segment_range[1] > 33
            or segment_range[0] > segment_range[1]
            or segment_range[0] <= previous_end
        ):
            raise ValueError("presentation segment ranges must be ordered, valid, and non-overlapping")
        previous_end = segment_range[1]
    return manifest


def presentation_segment(segment_id, path=PRESENTATION_MANIFEST_PATH):
    manifest = load_presentation_manifest(path)
    return next((item for item in manifest["segments"] if item["id"] == segment_id), None)


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

    if narrative_id == "nova":
        locked.escape_overlay = dict(NOVA_ENTER_ESCAPE_OVERLAY)
    else:
        locked.escape_overlay = dict(EMPTY_ESCAPE_OVERLAY)

    return {
        "sceneRevision": narrative["revision"],
        "narrativeState": dict(narrative),
        "basemap": locked.basemap,
        "investigationClock": copy.deepcopy(locked.investigation_clock),
        "personSelection": normalize_person_selection(locked.person_selection),
        "escapeOverlay": normalize_escape_overlay(locked.escape_overlay, narrative_id),
    }
