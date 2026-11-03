import hashlib
import json

from backend.projection_config_schema import legacy_projection_config_defaults
from backend.projection_warp_schema import migrate_projection_config_to_v5

SOURCE_ID = "11111111-1111-4111-8111-111111111111"
CAPTURE_ID = "22222222-2222-4222-8222-222222222222"
CAPTURE_DIGEST = "ab" * 32
DESK_PRESET_ID = "33333333-3333-4333-8333-333333333333"
TIMESTAMP = "2026-09-29T00:00:00Z"
CALIBRATION_REVISION = 12

SOURCE_GEOJSON = (
    '{"type":"FeatureCollection","features":['
    '{"type":"Feature","properties":{"citycode":"0067","cityname":"עזה"},'
    '"geometry":{"type":"Point","coordinates":[34.5,31.5]}},'
    '{"type":"Feature","properties":{"citycode":"0099","cityname":"שדרות"},'
    '"geometry":{"type":"Point","coordinates":[34.0,31.0]}}]}'
)
CATALOG_JSON = (
    '[{"citycode":"0067","text":"עזה","lng":34.5,"lat":31.5},'
    '{"citycode":"0099","text":"שדרות","lng":34.0,"lat":31.0}]'
)
ADDED_SOURCE_GEOJSON = (
    '{"type":"FeatureCollection","features":['
    '{"type":"Feature","properties":{"citycode":"0067","cityname":"עזה"},'
    '"geometry":{"type":"Point","coordinates":[34.5,31.5]}},'
    '{"type":"Feature","properties":{"citycode":"0099","cityname":"שדרות"},'
    '"geometry":{"type":"Point","coordinates":[34.0,31.0]}},'
    '{"type":"Feature","properties":{"citycode":"0100","cityname":"נחל עוז"},'
    '"geometry":{"type":"Point","coordinates":[34.25,31.25]}}]}'
)
ADDED_CATALOG_JSON = (
    '[{"citycode":"0067","text":"עזה","lng":34.5,"lat":31.5},'
    '{"citycode":"0099","text":"שדרות","lng":34.0,"lat":31.0},'
    '{"citycode":"0100","text":"נחל עוז","lng":34.25,"lat":31.25}]'
)

BASELINE_POSITIONS = {
    "left": {"0067": {"x": 510, "y": 350}, "0099": {"x": -100, "y": 2000}},
    "right": {"0067": {"x": 1200, "y": 350}, "0099": {"x": 3000, "y": -50}},
}
STYLE = {"fontFamily": "Guttman Hatzvi", "fontPx": 14, "rotateDeg": 35}
WALL_ROTATE_DEG = 70


def sha256_text(value):
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def sha256_bytes(value):
    return hashlib.sha256(value).hexdigest()


def working_v5_config():
    config = migrate_projection_config_to_v5(legacy_projection_config_defaults())
    config["pre"]["tx"] = 0.0
    return config


def canonical_v5_config():
    return migrate_projection_config_to_v5(legacy_projection_config_defaults())


CALIBRATION_CONFIG_JSON = json.dumps(
    working_v5_config(), ensure_ascii=False, separators=(",", ":"), allow_nan=False
)
PROCESSED_SOURCE_DIGEST = sha256_text(SOURCE_GEOJSON)
CATALOG_DIGEST = sha256_text(CATALOG_JSON)
CALIBRATION_CONFIG_DIGEST = sha256_text(CALIBRATION_CONFIG_JSON)
ADDED_CATALOG_DIGEST = sha256_text(ADDED_CATALOG_JSON)


def initialization_payload(**overrides):
    payload = {
        "action": "initialize_projection_name_settings",
        "sourceId": SOURCE_ID,
        "captureId": CAPTURE_ID,
        "captureDigest": CAPTURE_DIGEST,
        "baseRevision": 0,
        "calibrationRevision": CALIBRATION_REVISION,
        "calibrationConfigDigest": CALIBRATION_CONFIG_DIGEST,
        "calibrationConfigJson": CALIBRATION_CONFIG_JSON,
        "processedSourceDigest": PROCESSED_SOURCE_DIGEST,
        "catalogDigest": CATALOG_DIGEST,
        "catalogJson": CATALOG_JSON,
        "wallRotateDeg": WALL_ROTATE_DEG,
        "baselinePositions": json.loads(json.dumps(BASELINE_POSITIONS)),
        "style": dict(STYLE),
    }
    payload.update(overrides)
    return payload
