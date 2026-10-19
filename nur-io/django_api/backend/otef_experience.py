"""Experience intent and activation authority; browser cleanup stays ephemeral."""

import copy
import json
import math
import time
from pathlib import Path

from .otef_escape_overlay import normalize_escape_overlay
from .otef_investigation_clock import idle_investigation_clock
from .otef_legend_settings import normalize_legend_settings
from .otef_narrative import normalize_narrative_state
from .otef_person_selection import empty_person_selection, normalize_person_selection


EXPERIENCES = frozenset(("regular", "nli"))
SCOPED_PATCH_FIELDS = frozenset(("viewport", "layers", "layerGroups", "animations", "basemap",
    "gaza_border_visible", "projection_slideshow", "investigation_clock", "exhibit_mode", "nli_bookmark", "regular_slideshow_settings"))
NLI_ACTIONS = frozenset(("set_narrative", "set_escape_overlay", "select_person", "archive_window", "narrative_presentation"))
INSTALLATION_ACTIONS = frozenset(("set_nli_clock_layout", "set_settlement_names", "set_road_signs", "initialize_projection_name_settings"))
# Authored script bounds mirror nli-staff-script.js; media/asset metadata is not copied.
SCRIPT_LENGTHS = {"show": 8, "timeline": 3, "segev": 1, "nova": 5, "sderot": 1, "shura": 1, "hostages": 4}
HOME_IDS = frozenset(("projector_base.שמות_יישובים", "projector_base.Locations_Lines", "projector_base.ישובים",
    "nli.ציר_232", "projector_base.SEA", "gaza.Gaza_Roads", "gaza.gaza_border"))


class ExperienceError(ValueError):
    def __init__(self, reason, message, status=409):
        super().__init__(message)
        self.reason, self.status = reason, status


def experience_state(state):
    pending = state.experience_pending or {}
    receipt = state.experience_receipt or {}
    return {"active_experience": state.active_experience, "revision": state.experience_revision,
        "state_sequence": experience_sequence(state),
        "pending_transition": {key: pending[key] for key in ("request_id", "target", "from_experience", "expected_revision", "cleanup_confirmed", "cleanup_receipt") if key in pending} or None,
        "last_transition": {key: copy.deepcopy(value) for key, value in receipt.items() if key != "_state_sequence"} or None,
        "nli_bookmark": copy.deepcopy(state.nli_bookmark) or None,
        "regular_slideshow_settings": regular_slideshow_settings(state)}


def regular_slideshow_settings(state):
    saved = (state.saved_regular_context or {}).get("slideshow_settings")
    if saved is None and state.active_experience == "regular":
        saved = (state.projection_slideshow or {}).get("payload")
    result = copy.deepcopy(saved or {})
    if isinstance(result.get("packOrder"), list):
        result["packOrder"] = [pack for pack in result["packOrder"] if pack != "nli"]
    return result


def slideshow_command_for_response(state):
    command = copy.deepcopy(state.projection_slideshow) if isinstance(state.projection_slideshow, dict) else {}
    payload = command.get("payload")
    if state.active_experience == "regular" and isinstance(payload, dict) and isinstance(payload.get("packOrder"), list):
        payload["packOrder"] = [pack for pack in payload["packOrder"] if pack != "nli"]
    return command


def validate_slideshow_settings(raw, previous):
    allowed = {"packOrder", "intervalMs", "crossfadeMs", "warmupLeadMs", "keepSettlementNames"}
    if not isinstance(raw, dict) or set(raw) - allowed:
        raise ExperienceError("invalid_slideshow_settings", "Unsupported slideshow settings", 400)
    result = copy.deepcopy(previous or {})
    if "packOrder" in raw:
        order = raw["packOrder"]
        if not isinstance(order, list) or len(order) > 256 or any(not isinstance(item, str) or not item.strip() or len(item) > 128 for item in order) or len(set(order)) != len(order):
            raise ExperienceError("invalid_slideshow_settings", "packOrder must contain unique bounded pack IDs", 400)
        if "nli" in order:
            raise ExperienceError("invalid_slideshow_settings", "NLI is unavailable in the regular slideshow", 400)
        result["packOrder"] = list(order)
    for key in ("intervalMs", "crossfadeMs", "warmupLeadMs"):
        if key in raw:
            value = raw[key]
            if type(value) not in (int, float) or not math.isfinite(value) or value < 0 or value > 9007199254740991:
                raise ExperienceError("invalid_slideshow_settings", "Slideshow timing must be a finite nonnegative number", 400)
            result[key] = max(1 if key == "intervalMs" else 0, round(value))
    if "keepSettlementNames" in raw:
        if type(raw["keepSettlementNames"]) is not bool:
            raise ExperienceError("invalid_slideshow_settings", "keepSettlementNames must be a boolean", 400)
        result["keepSettlementNames"] = raw["keepSettlementNames"]
    return result


def experience_sequence(state):
    return int((state.experience_receipt or {}).get("_state_sequence", 0))


def advance_experience_sequence(state):
    state.experience_receipt = {**(state.experience_receipt or {}), "_state_sequence": experience_sequence(state) + 1}


def validate_bookmark(value, *, allow_junction=False):
    if not isinstance(value, dict) or not {"scriptId", "step"} <= set(value) or set(value) - {"scriptId", "step", "returnTo"}:
        raise ExperienceError("invalid_bookmark", "NLI bookmark must contain scriptId, step and returnTo", 400)
    script, step = value.get("scriptId"), value.get("step", 0)
    if type(step) is not int or step < 0 or (script is None and step != 0) or (script is not None and (not isinstance(script, str) or script not in SCRIPT_LENGTHS or step >= SCRIPT_LENGTHS[script])):
        raise ExperienceError("invalid_bookmark", "Unsupported authored NLI step", 400)
    if script == "show" and step in (1, 3, 4) and not allow_junction:
        raise ExperienceError("invalid_bookmark", "Authored branch junction is not a displayed scene", 400)
    parent = value.get("returnTo")
    if parent is not None:
        if not isinstance(parent, dict) or set(parent) != {"id", "step"} or not isinstance(parent["id"], str) or parent["id"] not in SCRIPT_LENGTHS:
            raise ExperienceError("invalid_bookmark", "Invalid NLI return step", 400)
        validate_bookmark({"scriptId": parent["id"], "step": parent["step"]}, allow_junction=True)
    return {"scriptId": script, "step": step, "returnTo": copy.deepcopy(parent)}


def is_cleanup(payload):
    action = payload.get("action")
    return action in ("archive_window_result", "narrative_presentation_result", "experience_cleanup_result", "clear_person", "cancel_navigation_focus") or (
        action == "archive_window" and payload.get("archiveAction") == "close") or (
        action == "narrative_presentation" and payload.get("presentationAction") == "close")


def require_experience(state, payload, *, cleanup=False, required=None):
    """Call under the same row lock as a persistent mutation or relay enqueue."""
    mode, revision = payload.get("experience"), payload.get("experience_revision")
    legacy = mode is None and revision is None and state.experience_revision == 0 and not state.experience_pending
    if not legacy and (mode not in EXPERIENCES or type(revision) is not int or mode != state.active_experience or revision != state.experience_revision):
        raise ExperienceError("experience_stale", "Output command does not match the active experience")
    if state.experience_pending and not cleanup:
        raise ExperienceError("experience_switch_pending", "Experience switch cleanup is pending")
    if not legacy and required is not None and state.active_experience != required:
        raise ExperienceError("experience_unavailable", "Command is unavailable in the active experience")
    return not legacy


def _finite(value, fallback=0):
    return value if type(value) in (int, float) and math.isfinite(value) else fallback


def _clock_intent(raw):
    clock = copy.deepcopy(raw) if isinstance(raw, dict) else idle_investigation_clock()
    if clock.get("phase") == "playing":
        clock["positionMs"] = max(0, _finite(clock.get("positionMs"))) + max(0, time.time() * 1000 - _finite(clock.get("anchorMs"), time.time() * 1000))
        clock["phase"] = "paused"
    for field in ("revision", "serverNowMs", "anchorMs", "alarmOnsetOriginMs", "presentationPendingUntilMs", "hiddenDisplays"):
        clock.pop(field, None)
    clock["seekKind"] = "none"
    return clock


def capture_context(state, groups):
    slideshow_settings = regular_slideshow_settings(state)
    return {"viewport": copy.deepcopy(state.get_viewport_with_defaults()),
        "layerGroups": [{"id": group["id"], "enabled": group.get("enabled") is True,
            "layers": [{"id": row["id"], "enabled": row.get("enabled") is True} for row in group.get("layers", [])]} for group in groups],
        "layers": copy.deepcopy(state.get_layers_with_defaults()), "animations": copy.deepcopy(state.animations),
        "basemap": state.basemap, "gaza_border_visible": state.gaza_border_visible,
        "legend_settings": normalize_legend_settings(state.legend_settings),
        "slideshow_settings": copy.deepcopy(slideshow_settings),
        "narrative_id": normalize_narrative_state(state.narrative_state)["id"],
        "clock": _clock_intent(state.investigation_clock),
        "selection": {key: value for key, value in normalize_person_selection(state.person_selection).items() if key != "revision"},
        "escape": normalize_escape_overlay(state.escape_overlay, normalize_narrative_state(state.narrative_state)["id"]),
        "bookmark": copy.deepcopy(state.nli_bookmark) or {"scriptId": None, "step": 0, "returnTo": None}}


def _baseline(state, groups, target):
    """A missing historical regular workspace must not copy an NLI cue's layers."""
    ids = HOME_IDS if target == "nli" else {key for key, enabled in state.DEFAULT_LAYERS.items() if enabled}
    result = {"viewport": copy.deepcopy(state.get_viewport_with_defaults() if target == "nli" else state.DEFAULT_VIEWPORT), "basemap": "dark" if target == "nli" else "osm",
        "layers": {key: key in ids for key in state.DEFAULT_LAYERS}, "animations": {},
        "gaza_border_visible": target == "nli", "narrative_id": None, "clock": idle_investigation_clock(),
        "selection": {}, "escape": {}, "legend_settings": normalize_legend_settings(state.legend_settings),
        "bookmark": {"scriptId": None, "step": 0, "returnTo": None}}
    result["layerGroups"] = [{"id": group["id"], "enabled": any(f'{group["id"]}.{row["id"]}' in ids for row in group.get("layers", [])),
        "layers": [{"id": row["id"], "enabled": f'{group["id"]}.{row["id"]}' in ids} for row in group.get("layers", [])]} for group in groups]
    return result


def _validated_selection(raw):
    selection = normalize_person_selection(raw)
    if selection["personId"]:
        try:
            with Path("/app/public/processed/layers/nli/people-search-index.json").open(encoding="utf-8") as source:
                index = json.load(source)
            valid = index.get("datasetVersion") == selection["datasetVersion"] and any(str(row.get("pid")) == selection["personId"] for row in index.get("people", []))
        except (OSError, ValueError, TypeError):
            valid = False
        if not valid:
            return empty_person_selection()
    return selection


def apply_context(state, intent, groups, update_groups, target):
    available = {group["id"]: group for group in groups}
    saved_groups = {group["id"]: group for group in intent.get("layerGroups", [])}
    restored = []
    for group_id, group in available.items():
        saved = saved_groups.get(group_id, {})
        saved_rows = {row["id"]: row.get("enabled") is True for row in saved.get("layers", [])}
        rows = [{"id": row["id"], "enabled": saved_rows.get(row["id"], False) and (target != "regular" or group_id != "nli")} for row in group.get("layers", [])]
        restored.append({"id": group_id, "enabled": saved.get("enabled") is True and any(row["enabled"] for row in rows), "layers": rows})
    update_groups(restored)
    state.viewport = copy.deepcopy(intent.get("viewport") or state.DEFAULT_VIEWPORT)
    state.layers = copy.deepcopy(intent.get("layers") or {})
    state.animations = copy.deepcopy(intent.get("animations") or {})
    state.basemap = intent.get("basemap") if intent.get("basemap") in ("osm", "satellite", "satellite_bw", "dark") else "osm"
    state.gaza_border_visible = intent.get("gaza_border_visible") is True
    state.legend_settings = normalize_legend_settings(intent.get("legend_settings"))
    state.legend_layout_revision += 1
    narrative_id = intent.get("narrative_id") if target == "nli" else None
    prior = normalize_narrative_state(state.narrative_state)
    state.narrative_state = {"id": narrative_id, "transition": "enter" if narrative_id else "exit", "revision": prior["revision"] + 1}
    old_clock_revision = int((state.investigation_clock or {}).get("revision") or 0)
    clock = copy.deepcopy(intent.get("clock") or idle_investigation_clock()) if target == "nli" else idle_investigation_clock()
    clock["revision"] = old_clock_revision + 1
    clock["anchorMs"] = 0 if clock.get("phase") == "paused" else None
    bookmark = validate_bookmark(intent.get("bookmark") or {"scriptId": None, "step": 0}) if target == "nli" else None
    # Reconstruct authored visibility; a copied presentation hold is never restored.
    if bookmark:
        script, step = bookmark["scriptId"], bookmark["step"]
        if (script == "nova" and step in (2, 3, 4)) or (script == "hostages" and step in (1, 2, 3)):
            clock["hiddenDisplays"] = ["gis", "projection"]
        elif script == "shura" and step == 0:
            clock["hiddenDisplays"] = ["projection"]
    state.investigation_clock = clock
    old_selection_revision = normalize_person_selection(state.person_selection)["revision"]
    state.person_selection = _validated_selection(intent.get("selection")) if target == "nli" else empty_person_selection()
    if clock.get("phase") != "idle":
        state.person_selection = empty_person_selection()
    state.person_selection["revision"] = old_selection_revision + 1
    state.escape_overlay = normalize_escape_overlay(intent.get("escape") if target == "nli" else {}, narrative_id)
    state.projection_slideshow = {"type": "stop", "payload": {}, "revision": int((state.projection_slideshow or {}).get("revision") or 0) + 1}
    if target == "nli":
        state.nli_bookmark = bookmark


def switch_experience(state, payload, get_groups, update_groups):
    target, revision, request_id, stage = (payload.get(key) for key in ("target", "expected_revision", "request_id", "stage"))
    if target not in EXPERIENCES or type(revision) is not int or revision < 0 or not isinstance(request_id, str) or not request_id.strip() or len(request_id) > 128 or stage not in ("prepare", "commit", "abort"):
        raise ExperienceError("invalid_switch", "Invalid experience transition", 400)
    receipt = state.experience_receipt or {}
    if receipt.get("request_id") == request_id:
        if receipt.get("target") != target or receipt.get("expected_revision") != revision:
            raise ExperienceError("experience_request_reused", "Transition request ID was already used")
        if receipt.get("status") == "committed" and stage in ("prepare", "commit"):
            return False
        if receipt.get("status") == "aborted" and stage == "abort":
            return False
        raise ExperienceError("experience_request_settled", "Transition request already settled")
    if revision != state.experience_revision:
        raise ExperienceError("experience_stale", "Experience revision changed")
    pending = state.experience_pending or {}
    if pending and (pending.get("request_id") != request_id or pending.get("target") != target):
        raise ExperienceError("experience_switch_pending", "Another experience switch is pending")
    if stage == "prepare":
        if target == state.active_experience:
            raise ExperienceError("experience_already_active", "Destination experience is already active")
        if not pending:
            hold = (state.investigation_clock or {}).get("presentationPendingUntilMs")
            if state.active_experience == "nli" and _finite(hold) > time.time() * 1000:
                raise ExperienceError("experience_scene_pending", "Wait for the current NLI scene to finish applying")
            state.experience_pending = {"request_id": request_id, "target": target, "from_experience": state.active_experience,
                "expected_revision": revision, "context": capture_context(state, get_groups()),
                "cleanup_confirmed": state.active_experience != "nli", "cleanup_receipt": None}
            advance_experience_sequence(state)
            state.save(update_fields=["experience_pending", "experience_receipt", "updated_at"])
        return True
    if not pending:
        raise ExperienceError("experience_switch_missing", "Prepare the experience switch first")
    if stage == "abort":
        state.experience_pending = {}
        state.experience_receipt = {"request_id": request_id, "target": target, "revision": revision, "expected_revision": revision, "status": "aborted", "_state_sequence": experience_sequence(state) + 1}
        state.save(update_fields=["experience_pending", "experience_receipt", "updated_at"])
        return True
    if pending["from_experience"] == "nli" and pending.get("cleanup_confirmed") is not True:
        raise ExperienceError("experience_cleanup_pending", "GIS has not confirmed NLI presentation and archive cleanup")
    if target != state.active_experience:
        setattr(state, f"saved_{state.active_experience}_context", pending["context"])
        groups = get_groups()
        intent = getattr(state, f"saved_{target}_context") or _baseline(state, groups, target)
        apply_context(state, intent, groups, update_groups, target)
        state.active_experience = target
        state.experience_revision += 1
    state.exhibit_mode = target == "nli"
    state.experience_pending = {}
    state.experience_receipt = {"request_id": request_id, "target": target, "revision": state.experience_revision, "expected_revision": revision, "status": "committed", "_state_sequence": experience_sequence(state) + 1}
    state.save()
    return True


def record_cleanup_result(state, payload):
    """Record a display ACK for this transition, never an archive/window lease."""
    pending = copy.deepcopy(state.experience_pending or {})
    if not pending or payload.get("request_id") != pending.get("request_id"):
        raise ExperienceError("experience_cleanup_stale", "Cleanup reply does not match the pending transition")
    if payload.get("display") != "gis" or type(payload.get("success")) is not bool:
        raise ExperienceError("invalid_cleanup_result", "Cleanup requires GIS and a boolean success", 400)
    error = payload.get("error")
    if error is not None and (not isinstance(error, str) or len(error) > 512):
        raise ExperienceError("invalid_cleanup_result", "Cleanup error must be bounded text", 400)
    receipt = {"display": "gis", "success": payload["success"]}
    if error:
        receipt["error"] = error
    pending["cleanup_receipt"] = receipt
    pending["cleanup_confirmed"] = pending["from_experience"] != "nli" or payload["success"]
    state.experience_pending = pending
    advance_experience_sequence(state)
    state.save(update_fields=["experience_pending", "experience_receipt", "updated_at"])
