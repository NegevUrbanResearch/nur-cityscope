"""Validation, transitions, and event snapshots for OTEF person selection."""

import time

MAX_PERSON_ID_LENGTH = 128
MAX_DATASET_VERSION_LENGTH = 256


def empty_person_selection(revision=0):
    return {"personId": None, "datasetVersion": None, "revision": max(0, int(revision))}


def normalize_person_selection(raw):
    """Return a safe, three-field snapshot without mutating the stored value."""
    if not isinstance(raw, dict):
        return empty_person_selection()
    revision = raw.get("revision", 0)
    if isinstance(revision, bool):
        revision = 0
    try:
        revision = max(0, int(revision))
    except (TypeError, ValueError):
        revision = 0
    person_id = raw.get("personId")
    dataset_version = raw.get("datasetVersion")
    valid = (
        isinstance(person_id, str)
        and isinstance(dataset_version, str)
        and bool(person_id.strip())
        and bool(dataset_version.strip())
        and len(person_id) <= MAX_PERSON_ID_LENGTH
        and len(dataset_version) <= MAX_DATASET_VERSION_LENGTH
    )
    if not valid:
        person_id = dataset_version = None
    return {
        "personId": person_id.strip() if person_id is not None else None,
        "datasetVersion": dataset_version.strip() if dataset_version is not None else None,
        "revision": revision,
    }


def parse_person_selection_command(action, payload):
    expected = payload.get("expectedRevision")
    if isinstance(expected, bool) or not isinstance(expected, int) or expected < 0:
        return None, "expectedRevision must be a nonnegative integer"
    if action == "clear_person":
        target = {"personId": None, "datasetVersion": None}
    else:
        person_id, dataset_version = payload.get("personId"), payload.get("datasetVersion")
        if (not isinstance(person_id, str) or not isinstance(dataset_version, str) or not person_id.strip() or not dataset_version.strip() or len(person_id) > MAX_PERSON_ID_LENGTH or len(dataset_version) > MAX_DATASET_VERSION_LENGTH):
            return None, "personId and datasetVersion must be bounded nonempty strings"
        target = {"personId": person_id.strip(), "datasetVersion": dataset_version.strip()}
    return {"expected_revision": expected, "target": target}, None


def lock_person_selection_state(state):
    return state.__class__.objects.select_for_update().get(pk=state.pk)


def transition_person_selection(
    locked, target, expected_revision=None, normalizer=normalize_person_selection
):
    current = normalizer(locked.person_selection)
    if expected_revision is not None and current["revision"] != expected_revision:
        return current, False, "stale person selection revision", "stale"
    if target.get("personId") and isinstance(locked.investigation_clock, dict):
        if locked.investigation_clock.get("phase") not in (None, "idle"):
            return current, False, "person selection is unavailable while the investigation clock is active", "clock_active"
    if (
        current["personId"] == target.get("personId")
        and current["datasetVersion"] == target.get("datasetVersion")
    ):
        return current, False, None, None
    snapshot = {
        "personId": target.get("personId"),
        "datasetVersion": target.get("datasetVersion"),
        "revision": current["revision"] + 1,
    }
    locked.person_selection = snapshot
    locked.save(update_fields=["person_selection", "updated_at"])
    return snapshot, True, None, None


def build_person_selection_event(table_name, snapshot, metadata=None):
    meta = metadata or {}
    timestamp = meta.get("timestamp")
    if not isinstance(timestamp, (int, float)):
        timestamp = int(time.time() * 1000)
    return {"type": "otef_person_selection_changed", "table": table_name, "personSelection": dict(snapshot), "sourceId": meta.get("sourceId"), "timestamp": int(timestamp), "traceId": meta.get("traceId")}
