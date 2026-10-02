import copy
import hashlib
import json
import math
import uuid
from pathlib import Path

from django.conf import settings
from django.db import transaction

from .models import OTEFProjectionCalibration, OTEFViewportState, Table
from .projection_config_schema import validate_projection_snapshot
from .projection_warp_schema import migrate_projection_config_to_v7, validate_projection_config_v7

SAFE_REVISION = 2**53 - 1
OUTPUTS = ("left", "right")
INIT_KEYS = {
    "action", "sourceId", "captureId", "captureDigest", "baseRevision",
    "calibrationRevision", "calibrationConfigDigest", "calibrationConfigJson",
    "processedSourceDigest", "catalogDigest", "catalogJson", "wallRotateDeg",
    "baselinePositions", "style",
}


class InitializationRejected(Exception):
    def __init__(self, error="invalid"):
        self.error = error
        self.conflict = False
        self.snapshots = {}
        super().__init__(error)


class InitializationConflict(InitializationRejected):
    def __init__(self, snapshots):
        super().__init__("conflict")
        self.conflict = True
        self.snapshots = snapshots


def trusted_settlement_source_path():
    return Path(settings.BASE_DIR) / "public" / "processed" / "layers" / "projector_base" / "שמות_יישובים.geojson"


def digest_text(value):
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def digest_bytes(value):
    return hashlib.sha256(value).hexdigest()


def compact_json(value):
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"), allow_nan=False)


def parse_strict_json(text):
    if not isinstance(text, str):
        raise ValueError("invalid json")

    def pairs(items):
        parsed = {}
        for key, value in items:
            if key in parsed:
                raise ValueError("duplicate key")
            parsed[key] = value
        return parsed

    def banned(name):
        raise ValueError(name)

    return json.loads(text, object_pairs_hook=pairs, parse_constant=banned)


def semantically_equal(left, right):
    if isinstance(left, bool) or isinstance(right, bool):
        return isinstance(left, bool) and isinstance(right, bool) and left is right
    if isinstance(left, (int, float)) and isinstance(right, (int, float)):
        return math.isfinite(left) and math.isfinite(right) and left == right
    if isinstance(left, str) or isinstance(right, str):
        return left == right
    if isinstance(left, list) and isinstance(right, list):
        return len(left) == len(right) and all(semantically_equal(a, b) for a, b in zip(left, right))
    if isinstance(left, dict) and isinstance(right, dict):
        return set(left) == set(right) and all(semantically_equal(left[key], right[key]) for key in left)
    return left == right


def _finite(value):
    return not isinstance(value, bool) and isinstance(value, (int, float)) and math.isfinite(value)


def catalog_from_feature_collection(document):
    if not isinstance(document, dict) or document.get("type") != "FeatureCollection" or not isinstance(document.get("features"), list):
        raise InitializationRejected("invalid catalog")
    if len(document["features"]) > 512:
        raise InitializationRejected("invalid catalog")
    entries = []
    seen = set()
    for feature in document["features"]:
        properties = feature.get("properties") if isinstance(feature, dict) else None
        citycode = properties.get("citycode") if isinstance(properties, dict) else None
        if not isinstance(citycode, str) or not citycode or citycode in seen:
            raise InitializationRejected("invalid catalog")
        seen.add(citycode)
        geometry = feature.get("geometry") if isinstance(feature, dict) else None
        coordinates = geometry.get("coordinates") if isinstance(geometry, dict) and geometry.get("type") == "Point" else None
        if not isinstance(coordinates, list) or len(coordinates) < 2 or not _finite(coordinates[0]) or not _finite(coordinates[1]):
            raise InitializationRejected("invalid catalog")
        text = properties.get("cityname", properties.get("citylabel", ""))
        if text is None:
            text = ""
        if not isinstance(text, str):
            raise InitializationRejected("invalid catalog")
        entries.append({"citycode": citycode, "text": text, "lng": coordinates[0], "lat": coordinates[1]})
    return entries


def load_trusted_settlement_catalog():
    path = trusted_settlement_source_path()
    try:
        raw = path.read_bytes()
        document = parse_strict_json(raw.decode("utf-8"))
    except (OSError, UnicodeError, ValueError) as error:
        raise InitializationRejected("invalid catalog") from error
    return raw, catalog_from_feature_collection(document)


def _uuid(value):
    if not isinstance(value, str):
        return False
    try:
        uuid.UUID(value)
    except (ValueError, AttributeError):
        return False
    return True


def _digest_field(value):
    return isinstance(value, str) and len(value) == 64 and all(character in "0123456789abcdef" for character in value)


def _safe_int(value):
    return not isinstance(value, bool) and isinstance(value, int) and 0 <= value <= SAFE_REVISION


def _position(value):
    return (
        isinstance(value, dict) and set(value) == {"x", "y"}
        and _finite(value["x"]) and -1920 <= value["x"] <= 3840
        and _finite(value["y"]) and -1080 <= value["y"] <= 2160
    )


def _style(value):
    return (
        isinstance(value, dict) and set(value) == {"fontFamily", "fontPx", "rotateDeg"}
        and value.get("fontFamily") in ("Guttman Hatzvi", "Arial")
        and _finite(value.get("fontPx")) and 8 <= value["fontPx"] <= 64
        and _finite(value.get("rotateDeg")) and -180 <= value["rotateDeg"] <= 180
    )


def _catalog_entries(value):
    if not isinstance(value, list) or not value or len(value) > 512:
        raise InitializationRejected("invalid catalog")
    seen = set()
    for entry in value:
        if not isinstance(entry, dict) or set(entry) != {"citycode", "text", "lng", "lat"}:
            raise InitializationRejected("invalid catalog")
        citycode = entry["citycode"]
        if not isinstance(citycode, str) or not citycode or citycode in seen or not isinstance(entry["text"], str):
            raise InitializationRejected("invalid catalog")
        if not _finite(entry["lng"]) or not _finite(entry["lat"]):
            raise InitializationRejected("invalid catalog")
        seen.add(citycode)
    return value


def _require_payload(payload):
    if not isinstance(payload, dict) or set(payload) != INIT_KEYS or payload.get("action") != "initialize_projection_name_settings":
        raise InitializationRejected("invalid request")
    if not _uuid(payload.get("sourceId")) or not _uuid(payload.get("captureId")) or payload.get("baseRevision") != 0 or isinstance(payload.get("baseRevision"), bool):
        raise InitializationRejected("invalid request")
    if not _safe_int(payload.get("calibrationRevision")) or not _digest_field(payload.get("captureDigest")):
        raise InitializationRejected("invalid request")
    for field in ("calibrationConfigDigest", "processedSourceDigest", "catalogDigest"):
        if not _digest_field(payload.get(field)):
            raise InitializationRejected("invalid digest")
    if not isinstance(payload.get("calibrationConfigJson"), str) or payload["calibrationConfigDigest"] != digest_text(payload["calibrationConfigJson"]):
        raise InitializationRejected("digest mismatch")
    if not isinstance(payload.get("catalogJson"), str) or payload["catalogDigest"] != digest_text(payload["catalogJson"]):
        raise InitializationRejected("digest mismatch")
    if not _finite(payload.get("wallRotateDeg")) or not _style(payload.get("style")):
        raise InitializationRejected("invalid style")
    try:
        config = parse_strict_json(payload["calibrationConfigJson"])
        catalog = _catalog_entries(parse_strict_json(payload["catalogJson"]))
    except (ValueError, InitializationRejected) as error:
        raise InitializationRejected("invalid request") from error
    positions = payload.get("baselinePositions")
    if not isinstance(positions, dict) or set(positions) != set(OUTPUTS):
        raise InitializationRejected("invalid positions")
    codes = [entry["citycode"] for entry in catalog]
    for output in OUTPUTS:
        side = positions.get(output)
        if not isinstance(side, dict) or set(side) != set(codes):
            raise InitializationRejected("invalid positions")
        for citycode in codes:
            if not _position(side[citycode]):
                raise InitializationRejected("invalid positions")
    return config, catalog


def _snapshot(viewport, calibration):
    settings = viewport.settlement_name_settings if isinstance(viewport.settlement_name_settings, dict) else {}
    return {
        "settlementNameSettings": copy.deepcopy(settings) if settings else {},
        "settlementNameRevision": int(viewport.settlement_name_revision or 0),
        "projectionState": {
            "revision": int(calibration.revision),
            "config": copy.deepcopy(calibration.working_config),
            "presets": copy.deepcopy(calibration.presets),
            "selectedPresetId": calibration.selected_preset_id,
        },
    }


def _v7(config):
    return isinstance(config, dict) and config.get("schemaVersion") == 7 and not validate_projection_config_v7(config)


def _current_v7_envelopes(calibration):
    presets = calibration.presets
    if not isinstance(presets, list) or not presets:
        return False
    for preset in presets:
        if not isinstance(preset, dict) or not _v7(preset.get("config")):
            return False
    if not _v7(calibration.working_config):
        return False
    revision = calibration.revision
    if isinstance(revision, bool) or not isinstance(revision, int):
        return False
    return not validate_projection_snapshot({
        "revision": revision,
        "config": calibration.working_config,
        "presets": presets,
        "selectedPresetId": calibration.selected_preset_id,
    })


def _positions_subset(requested, stored):
    if not isinstance(requested, dict) or not isinstance(stored, dict):
        return False
    for output in OUTPUTS:
        incoming, saved = requested.get(output), stored.get(output)
        if not isinstance(incoming, dict) or not isinstance(saved, dict):
            return False
        for citycode, position in incoming.items():
            if saved.get(citycode) != position:
                return False
    return True


def _position_map(value):
    if not isinstance(value, dict):
        return False
    for citycode, position in value.items():
        if not isinstance(citycode, str) or not citycode or not _position(position):
            return False
    return True


def _provenance(value):
    return (
        isinstance(value, dict) and set(value) == {"revision", "configDigest"}
        and _safe_int(value["revision"]) and _digest_field(value["configDigest"])
    )


def _settlement_snapshot_complete(settings):
    if not isinstance(settings, dict) or not _style(settings.get("style")):
        return False
    outputs = settings.get("outputs")
    if not isinstance(outputs, dict) or set(outputs) != set(OUTPUTS) or any(not _position_map(outputs[output]) for output in OUTPUTS):
        return False
    baseline = settings.get("baseline")
    required = {"captureId", "captureDigest", "sourceDigest", "catalogDigest", "predecessor", "successor", "outputs"}
    if not isinstance(baseline, dict) or not required <= set(baseline) or not _uuid(baseline.get("captureId")):
        return False
    if any(not _digest_field(baseline.get(field)) for field in ("captureDigest", "sourceDigest", "catalogDigest")):
        return False
    if not _provenance(baseline.get("predecessor")) or not _provenance(baseline.get("successor")):
        return False
    baseline_outputs = baseline.get("outputs")
    if not isinstance(baseline_outputs, dict) or set(baseline_outputs) != set(OUTPUTS):
        return False
    if any(not _position_map(baseline_outputs[output]) for output in OUTPUTS):
        return False
    retained = baseline.get("retained")
    if "retained" in baseline:
        if not isinstance(retained, dict) or not set(retained) <= set(OUTPUTS):
            return False
        if any(not _position_map(retained[output]) for output in retained):
            return False
    for output in OUTPUTS:
        identities = set(baseline_outputs[output])
        retained_side = retained.get(output) if isinstance(retained, dict) else None
        if isinstance(retained_side, dict):
            identities.update(retained_side)
        if any(citycode not in identities for citycode in outputs[output]):
            return False
    return True


def _retry(viewport, calibration, payload, parsed_config):
    settings = viewport.settlement_name_settings if isinstance(viewport.settlement_name_settings, dict) else {}
    baseline = settings.get("baseline") if isinstance(settings, dict) else None
    current = _snapshot(viewport, calibration)
    try:
        converted = migrate_projection_config_to_v7(parsed_config, payload["wallRotateDeg"])
        successor_digest = digest_text(compact_json(converted))
    except (TypeError, ValueError) as error:
        raise InitializationConflict(current) from error
    predecessor = baseline.get("predecessor") if isinstance(baseline, dict) else None
    successor = baseline.get("successor") if isinstance(baseline, dict) else None
    matches = (
        isinstance(baseline, dict)
        and baseline.get("captureId") == payload["captureId"]
        and baseline.get("captureDigest") == payload["captureDigest"]
        and baseline.get("sourceDigest") == payload["processedSourceDigest"]
        and baseline.get("catalogDigest") == payload["catalogDigest"]
        and isinstance(predecessor, dict)
        and predecessor.get("revision") == payload["calibrationRevision"]
        and predecessor.get("configDigest") == payload["calibrationConfigDigest"]
        and isinstance(successor, dict)
        and successor.get("configDigest") == successor_digest
        and successor.get("revision") == predecessor.get("revision", -1) + 1
        and int(calibration.revision) >= successor["revision"]
        and _safe_int(viewport.settlement_name_revision)
        and viewport.settlement_name_revision >= 1
        and _current_v7_envelopes(calibration)
        and _settlement_snapshot_complete(settings)
        and _positions_subset(payload["baselinePositions"], baseline.get("outputs"))
    )
    if not matches:
        raise InitializationConflict(current)
    return {
        "status": "ok",
        "action": "initialize_projection_name_settings",
        "initialization": {
            "captureId": baseline["captureId"],
            "captureDigest": baseline["captureDigest"],
            "predecessor": copy.deepcopy(predecessor),
            "successor": copy.deepcopy(successor),
        },
        "settlementNameSettings": copy.deepcopy(settings),
        "settlementNameRevision": int(viewport.settlement_name_revision),
        "projectionState": current["projectionState"],
    }


def _convert_presets(presets, angle, selected_preset_id, working_config, revision):
    if not isinstance(presets, list) or not presets:
        raise InitializationRejected("invalid calibration")
    converted = []
    for preset in presets:
        if not isinstance(preset, dict) or set(preset) != {"id", "name", "config", "readOnly"}:
            raise InitializationRejected("invalid calibration")
        try:
            config = migrate_projection_config_to_v7(preset["config"], angle)
        except (TypeError, ValueError) as error:
            raise InitializationRejected("invalid calibration") from error
        converted.append({"id": preset["id"], "name": preset["name"], "config": config, "readOnly": preset["readOnly"]})
    if validate_projection_snapshot({
        "revision": revision,
        "config": working_config,
        "presets": converted,
        "selectedPresetId": selected_preset_id,
    }):
        raise InitializationRejected("invalid calibration")
    return converted


def initialize_projection_name_settings(table_name, payload):
    parsed_config, catalog = _require_payload(payload)
    with transaction.atomic():
        try:
            table = Table.objects.select_for_update().get(name=table_name)
            viewport = OTEFViewportState.objects.select_for_update().get(table=table)
            calibration = OTEFProjectionCalibration.objects.select_for_update().get(table=table)
        except (Table.DoesNotExist, OTEFViewportState.DoesNotExist, OTEFProjectionCalibration.DoesNotExist) as error:
            raise InitializationRejected("not_found") from error
        settings = viewport.settlement_name_settings if isinstance(viewport.settlement_name_settings, dict) else {}
        if int(viewport.settlement_name_revision or 0) > 0 or settings:
            return _retry(viewport, calibration, payload, parsed_config)
        if int(viewport.settlement_name_revision or 0) != 0 or int(calibration.revision) != payload["calibrationRevision"]:
            raise InitializationConflict(_snapshot(viewport, calibration))
        if int(calibration.revision) >= SAFE_REVISION:
            raise InitializationRejected("revision overflow")
        raw, entries = load_trusted_settlement_catalog()
        if digest_bytes(raw) != payload["processedSourceDigest"] or not semantically_equal(entries, catalog):
            raise InitializationRejected("catalog mismatch")
        if not semantically_equal(parsed_config, calibration.working_config):
            raise InitializationRejected("config mismatch")
        try:
            working = migrate_projection_config_to_v7(parsed_config, payload["wallRotateDeg"])
        except (TypeError, ValueError) as error:
            raise InitializationRejected("invalid calibration") from error
        presets = _convert_presets(
            calibration.presets,
            payload["wallRotateDeg"],
            calibration.selected_preset_id,
            working,
            int(calibration.revision) + 1,
        )
        predecessor = {"revision": int(calibration.revision), "configDigest": payload["calibrationConfigDigest"]}
        successor = {"revision": int(calibration.revision) + 1, "configDigest": digest_text(compact_json(working))}
        stored = {
            "baseline": {
                "captureId": payload["captureId"],
                "captureDigest": payload["captureDigest"],
                "sourceDigest": payload["processedSourceDigest"],
                "catalogDigest": payload["catalogDigest"],
                "predecessor": predecessor,
                "successor": successor,
                "outputs": copy.deepcopy(payload["baselinePositions"]),
            },
            "style": copy.deepcopy(payload["style"]),
            "outputs": {"left": {}, "right": {}},
        }
        viewport.settlement_name_settings = stored
        viewport.settlement_name_revision = 1
        viewport.save(update_fields=["settlement_name_settings", "settlement_name_revision", "updated_at"])
        calibration.working_config = working
        calibration.presets = presets
        calibration.revision = int(calibration.revision) + 1
        calibration.save(update_fields=["working_config", "presets", "revision", "updated_at"])
        return {
            "status": "ok",
            "action": "initialize_projection_name_settings",
            "initialization": {
                "captureId": payload["captureId"],
                "captureDigest": payload["captureDigest"],
                "predecessor": predecessor,
                "successor": successor,
            },
            "settlementNameSettings": copy.deepcopy(stored),
            "settlementNameRevision": 1,
            "projectionState": _snapshot(viewport, calibration)["projectionState"],
        }
