import copy
import math
import uuid

from django.db import transaction

from .models import OTEFViewportState
from .projection_name_initialization import (
    InitializationRejected,
    digest_text,
    load_trusted_settlement_catalog,
    parse_strict_json,
    semantically_equal,
)

SAFE_REVISION = 2**53 - 1
OUTPUTS = ("left", "right")
FONTS = ("Guttman Hatzvi", "Arial")
X_MIN, X_MAX = -1920, 3840
Y_MIN, Y_MAX = -1080, 2160


class SettlementNameRejected(Exception):
    def __init__(self, error="invalid"):
        self.error = error
        super().__init__(error)


class SettlementNameConflict(Exception):
    def __init__(self, settings, revision):
        self.settings = settings
        self.revision = revision
        super().__init__("conflict")


class SettlementNameInitializationRequired(Exception):
    pass


def normalize_settlement_name_settings(value):
    if not isinstance(value, dict) or not value:
        return {}
    return copy.deepcopy(value)


def _uuid(value):
    if not isinstance(value, str):
        return False
    try:
        uuid.UUID(value)
    except (ValueError, AttributeError):
        return False
    return True


def _exact(payload, keys):
    return isinstance(payload, dict) and set(payload) == set(keys)


def _revision(value):
    return not isinstance(value, bool) and isinstance(value, int) and 0 <= value <= SAFE_REVISION


def _finite(value):
    return not isinstance(value, bool) and isinstance(value, (int, float)) and math.isfinite(value)


def _position(value):
    if not _exact(value, ("x", "y")):
        return False
    return _finite(value["x"]) and X_MIN <= value["x"] <= X_MAX and _finite(value["y"]) and Y_MIN <= value["y"] <= Y_MAX


def _style(value):
    if not _exact(value, ("fontFamily", "fontPx", "rotateDeg")):
        return False
    return (
        value["fontFamily"] in FONTS
        and _finite(value["fontPx"]) and 8 <= value["fontPx"] <= 64
        and _finite(value["rotateDeg"]) and -180 <= value["rotateDeg"] <= 180
    )


def _initialized(settings):
    return isinstance(settings, dict) and isinstance(settings.get("baseline"), dict) and isinstance(settings.get("outputs"), dict)


def _baseline_identities(settings, output):
    baseline = settings.get("baseline") if isinstance(settings, dict) else None
    if not isinstance(baseline, dict):
        return {}
    identities = {}
    for key in ("outputs", "retained"):
        side = baseline.get(key)
        current = side.get(output) if isinstance(side, dict) else None
        if isinstance(current, dict):
            identities.update(current)
    return identities


def _known(settings, output, citycode):
    return citycode in _baseline_identities(settings, output)


def _metadata(payload):
    if payload.get("action") != "set_settlement_names":
        raise SettlementNameRejected("invalid action")
    if not _uuid(payload.get("sourceId")):
        raise SettlementNameRejected("invalid source")
    timestamp = payload.get("timestamp")
    if not isinstance(timestamp, str) or not timestamp.strip() or len(timestamp) > 128:
        raise SettlementNameRejected("invalid timestamp")
    if not _revision(payload.get("baseRevision")):
        raise SettlementNameRejected("invalid revision")


def _validate_shape(payload):
    _metadata(payload)
    kind = payload.get("operation")
    if kind == "position":
        if not _exact(payload, ("action", "operation", "output", "citycode", "position", "baseRevision", "sourceId", "timestamp")):
            raise SettlementNameRejected("invalid operation")
        if payload.get("output") not in OUTPUTS or not isinstance(payload.get("citycode"), str) or not payload["citycode"]:
            raise SettlementNameRejected("invalid target")
        if not _position(payload.get("position")):
            raise SettlementNameRejected("invalid position")
    elif kind == "reset_position":
        if not _exact(payload, ("action", "operation", "output", "citycode", "baseRevision", "sourceId", "timestamp")):
            raise SettlementNameRejected("invalid operation")
        if payload.get("output") not in OUTPUTS or not isinstance(payload.get("citycode"), str) or not payload["citycode"]:
            raise SettlementNameRejected("invalid target")
    elif kind == "style":
        if not _exact(payload, ("action", "operation", "style", "baseRevision", "sourceId", "timestamp")):
            raise SettlementNameRejected("invalid operation")
        if not _style(payload.get("style")):
            raise SettlementNameRejected("invalid style")
    elif kind == "append_baseline":
        if not _exact(payload, ("action", "operation", "catalogJson", "catalogDigest", "positions", "baseRevision", "sourceId", "timestamp")):
            raise SettlementNameRejected("invalid operation")
        _validate_append_shape(payload)
    else:
        raise SettlementNameRejected("invalid operation")


def _validate_append_shape(payload):
    catalog_json = payload.get("catalogJson")
    digest = payload.get("catalogDigest")
    if not isinstance(catalog_json, str) or not isinstance(digest, str) or digest != digest_text(catalog_json):
        raise SettlementNameRejected("invalid catalog")
    try:
        parsed = parse_strict_json(catalog_json)
    except ValueError as error:
        raise SettlementNameRejected("invalid catalog") from error
    if not isinstance(parsed, list) or not parsed or len(parsed) > 512:
        raise SettlementNameRejected("invalid catalog")
    positions = payload.get("positions")
    if not _exact(positions, OUTPUTS):
        raise SettlementNameRejected("invalid positions")
    left, right = positions["left"], positions["right"]
    if not isinstance(left, dict) or not isinstance(right, dict) or set(left) != set(right) or not left:
        raise SettlementNameRejected("invalid positions")
    for citycode in left:
        if not isinstance(citycode, str) or not citycode or not _position(left[citycode]) or not _position(right[citycode]):
            raise SettlementNameRejected("invalid positions")
    return parsed


def _apply(settings, payload, catalog):
    kind = payload["operation"]
    if kind in ("position", "reset_position"):
        output, citycode = payload["output"], payload["citycode"]
        if not _known(settings, output, citycode):
            raise SettlementNameRejected("unknown citycode")
        branch = settings["outputs"].setdefault(output, {})
        if not isinstance(branch, dict):
            raise SettlementNameRejected("invalid settings")
        if kind == "position":
            branch[citycode] = {"x": payload["position"]["x"], "y": payload["position"]["y"]}
        else:
            branch.pop(citycode, None)
        return
    if kind == "style":
        settings["style"] = {"fontFamily": payload["style"]["fontFamily"], "fontPx": payload["style"]["fontPx"], "rotateDeg": payload["style"]["rotateDeg"]}
        return
    _append(settings, payload, catalog)


def _append(settings, payload, supplied_catalog):
    try:
        _raw, entries = load_trusted_settlement_catalog()
    except InitializationRejected as error:
        raise SettlementNameRejected("catalog mismatch") from error
    if not semantically_equal(entries, supplied_catalog):
        raise SettlementNameRejected("catalog mismatch")
    catalog_ids = {entry["citycode"] for entry in entries}
    baseline = settings.get("baseline")
    outputs = baseline.get("outputs") if isinstance(baseline, dict) else None
    if not isinstance(outputs, dict):
        raise SettlementNameRejected("invalid settings")
    positions = payload["positions"]
    for citycode in positions["left"]:
        if citycode not in catalog_ids:
            raise SettlementNameRejected("unknown citycode")
        for output in OUTPUTS:
            side = outputs.get(output)
            if not isinstance(side, dict) or citycode in side:
                raise SettlementNameRejected("baseline change")
    for output in OUTPUTS:
        side = outputs.get(output)
        for citycode, position in positions[output].items():
            side[citycode] = {"x": position["x"], "y": position["y"]}


def write_settlement_name_settings(table_name, operation, base_revision, source_id, timestamp):
    payload = dict(operation) if isinstance(operation, dict) else {}
    payload.setdefault("baseRevision", base_revision)
    payload.setdefault("sourceId", source_id)
    payload.setdefault("timestamp", timestamp)
    _validate_shape(payload)
    catalog = _validate_append_shape(payload) if payload.get("operation") == "append_baseline" else None
    with transaction.atomic():
        locked = OTEFViewportState.objects.select_for_update().get(table__name=table_name)
        raw = copy.deepcopy(locked.settlement_name_settings) if isinstance(locked.settlement_name_settings, dict) else {}
        if not _initialized(raw) or locked.settlement_name_revision < 1:
            raise SettlementNameInitializationRequired()
        if locked.settlement_name_revision != payload["baseRevision"]:
            raise SettlementNameConflict(normalize_settlement_name_settings(raw), int(locked.settlement_name_revision))
        if locked.settlement_name_revision >= SAFE_REVISION:
            raise SettlementNameRejected("revision overflow")
        _apply(raw, payload, catalog)
        locked.settlement_name_settings = raw
        locked.settlement_name_revision = int(locked.settlement_name_revision) + 1
        locked.save(update_fields=["settlement_name_settings", "settlement_name_revision", "updated_at"])
        return normalize_settlement_name_settings(raw), int(locked.settlement_name_revision)
