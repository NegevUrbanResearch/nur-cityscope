import copy
import os
import uuid
from pathlib import Path

from asgiref.sync import async_to_sync
from channels.layers import get_channel_layer
from django.db import IntegrityError, transaction
from django.conf import settings

from .models import OTEFProjectionCalibration, Table, projection_config_defaults
from .projection_config_schema import validate_projection_config
from .projection_warp_assets import load_trusted_projection_asset
from .projection_warp_geometry import evaluate_warp_mesh
from .projection_warp_schema import validate_projection_config_v2, validate_projection_config_v3, validate_projection_config_v4, validate_projection_config_v5, validate_projection_config_v6, validate_projection_config_v7, migrate_projection_config_to_v5, migrate_projection_config_to_v6, migrate_projection_config_to_v7


class ProjectionConfigError(Exception):
    def __init__(self, error, fields=None):
        self.error = error
        self.fields = fields or {}
        super().__init__(error)


class ProjectionNotFound(ProjectionConfigError):
    pass


class ProjectionConflict(ProjectionConfigError):
    def __init__(self, state):
        self.state = state
        super().__init__("conflict")


class ProjectionSchemaChanged(ProjectionConfigError):
    def __init__(self, state):
        self.state = state
        super().__init__("schema_changed")


def projection_baseline_root():
    configured = os.environ.get('OTEF_PROJECTION_BASELINE_ROOT')
    if configured:
        return Path(configured)
    return Path(settings.BASE_DIR) / 'public' / 'projection-calibration' / 'td-baselines'


def validate_projection_config_for_persistence(config):
    errors = validate_projection_config(config)
    if errors:
        return errors
    if config.get('schemaVersion') not in (2, 3, 4, 5, 6, 7):
        return {}
    manifest = None
    for side in ('left', 'right'):
        warp = config['outputs'][side]['warp']
        if not warp.get('enabled'):
            continue
        baseline = warp['baseline']
        mesh = None
        if baseline['type'] == 'tdMesh':
            try:
                mesh, manifest, _ = load_trusted_projection_asset(projection_baseline_root(), side)
            except (OSError, ValueError, TypeError) as error:
                return {f'outputs.{side}.warp.baseline': str(error)}
        if baseline['type'] == 'tdMesh':
            validator = {2: validate_projection_config_v2, 3: validate_projection_config_v3, 4: validate_projection_config_v4, 5: validate_projection_config_v5, 6: validate_projection_config_v6, 7: validate_projection_config_v7}[config['schemaVersion']]
            errors = validator(config, trusted_manifest=manifest)
            if errors:
                return errors
        try:
            evaluate_warp_mesh(mesh, warp, side=side, schema_version=config['schemaVersion'])
        except (ValueError, TypeError, KeyError) as error:
            return {f'outputs.{side}.warp': str(error)}
    return {}


def _snapshot(row):
    config = row.working_config
    presets = row.presets
    if isinstance(config, dict) and config.get('schemaVersion') == 6:
        config = migrate_projection_config_to_v6(config, config.get('namesWall', {}).get('rotateDeg', 35))
    elif isinstance(config, dict) and config.get('schemaVersion') == 7:
        config = migrate_projection_config_to_v7(config, config.get('namesWall', {}).get('rotateDeg', 35))
        presets = [
            {**preset, 'config': migrate_projection_config_to_v7(preset['config']) if preset['config'].get('schemaVersion') == 7 else migrate_projection_config_to_v6(preset['config'], preset['config'].get('namesWall', {}).get('rotateDeg', 35))}
            if isinstance(preset, dict) and isinstance(preset.get('config'), dict) and preset['config'].get('schemaVersion') in (6, 7)
            else copy.deepcopy(preset)
            for preset in presets
        ]
    return {
        "revision": int(row.revision),
        "config": copy.deepcopy(config),
        "presets": copy.deepcopy(presets),
        "selectedPresetId": row.selected_preset_id,
    }


def _broadcast(table_name, state, source_id):
    event = {"type": "otef_projection_config_changed", "table": table_name, "sourceId": source_id, "state": state}
    channel_layer = get_channel_layer()
    async_to_sync(channel_layer.group_send)("otef_channel", {"type": "broadcast_message", "message": event})


def _locked_row(table_name):
    try:
        table = Table.objects.select_for_update().get(name=table_name)
    except Table.DoesNotExist:
        raise ProjectionNotFound("not_found")
    try:
        row, _ = OTEFProjectionCalibration.objects.get_or_create(
            table=table,
            defaults={"working_config": projection_config_defaults()},
        )
    except IntegrityError:
        row = OTEFProjectionCalibration.objects.get(table=table)
    return table, OTEFProjectionCalibration.objects.select_for_update().get(pk=row.pk)


def get_projection_state(table_name):
    with transaction.atomic():
        _, row = _locked_row(table_name)
        return _snapshot(row)


def _validate_uuid(value, path):
    if not isinstance(value, str):
        return {path: "must be a UUID"}
    try:
        uuid.UUID(value)
    except (ValueError, AttributeError):
        return {path: "must be a UUID"}
    return {}


def _stored_version(row):
    config = row.working_config
    if isinstance(config, dict) and not isinstance(config.get("schemaVersion"), bool):
        return config.get("schemaVersion")
    return None


def _accept_config(row, config):
    if not isinstance(config, dict):
        raise ProjectionConfigError("invalid", {"config": "is required"})
    incoming = config.get("schemaVersion")
    if isinstance(incoming, bool):
        incoming = None
    stored = _stored_version(row)
    if stored == 6 and incoming != 6:
        raise ProjectionSchemaChanged(_snapshot(row))
    if stored == 7 and incoming != 7:
        raise ProjectionSchemaChanged(_snapshot(row))
    if stored != 6 and incoming == 6:
        raise ProjectionConfigError("invalid", {"schemaVersion": "must match the installed schema"})
    if stored != 7 and incoming == 7:
        raise ProjectionConfigError("invalid", {"schemaVersion": "must match the installed schema"})
    try:
        accepted = migrate_projection_config_to_v7(config, config.get('namesWall', {}).get('rotateDeg', 35)) if stored == 7 else migrate_projection_config_to_v6(config, config.get('namesWall', {}).get('rotateDeg', 35)) if stored == 6 else migrate_projection_config_to_v5(config)
    except ValueError as error:
        raise ProjectionConfigError("invalid", validate_projection_config(config) or {"config": str(error)}) from error
    errors = validate_projection_config_for_persistence(accepted)
    if errors:
        raise ProjectionConfigError("invalid", errors)
    return accepted


def mutate_projection_state(table_name, base_revision, action, source_id, **payload):
    errors = {}
    if isinstance(base_revision, bool) or not isinstance(base_revision, int) or not 0 <= base_revision <= 2 ** 53 - 1:
        errors["baseRevision"] = "must be a nonnegative safe integer"
    errors.update(_validate_uuid(source_id, "sourceId"))
    if not isinstance(action, str) or action not in {"preview", "save", "load", "revert"}:
        errors["action"] = "unknown action"
    allowed = {
        "preview": {"config"},
        "save": {"config", "presetId", "name"},
        "load": {"presetId"},
        "revert": set(),
    }.get(action, set()) if isinstance(action, str) else set()
    if not isinstance(table_name, str) or not table_name.strip():
        errors["table"] = "must be a table name"
    for key in allowed:
        if key not in payload:
            errors[key] = "is required"
    for key in payload:
        if key not in allowed:
            errors[key] = "unknown field"
    if errors:
        raise ProjectionConfigError("invalid", errors)

    with transaction.atomic():
        table, row = _locked_row(table_name)
        state = _snapshot(row)
        if row.revision != base_revision:
            raise ProjectionConflict(state)
        presets = copy.deepcopy(row.presets)
        changed = False
        if action in {"preview", "save"}:
            config = _accept_config(row, payload.get("config"))
            if action == "preview":
                changed = config != row.working_config
                row.working_config = copy.deepcopy(config)
            else:
                preset_id = payload.get("presetId")
                name = payload.get("name")
                if name is None or not isinstance(name, str) or not name.strip() or len(name.strip()) > 80:
                    raise ProjectionConfigError("invalid", {"name": "must be 1-80 characters"})
                name = name.strip()
                if preset_id == "original":
                    raise ProjectionConfigError("invalid", {"presetId": "Original is immutable"})
                if preset_id is not None and _validate_uuid(preset_id, "presetId"):
                    raise ProjectionConfigError("invalid", _validate_uuid(preset_id, "presetId"))
                if preset_id is not None and preset_id != row.selected_preset_id:
                    raise ProjectionConfigError("invalid", {"presetId": "must be the selected preset"})
                target = next((p for p in presets if p["id"] == preset_id), None) if preset_id else None
                if target is not None and target.get("readOnly"):
                    raise ProjectionConfigError("invalid", {"presetId": "preset is read-only"})
                if preset_id and target is None:
                    raise ProjectionConfigError("invalid", {"presetId": "preset not found"})
                if target is None:
                    preset_id = str(uuid.uuid4())
                    presets.append({"id": preset_id, "name": name, "config": copy.deepcopy(config), "readOnly": False})
                else:
                    target.update({"name": name, "config": copy.deepcopy(config)})
                if len(presets) > 50:
                    raise ProjectionConfigError("invalid", {"presets": "maximum is 50"})
                row.working_config = copy.deepcopy(config)
                row.selected_preset_id = preset_id
                changed = True
        elif action == "load":
            preset_id = payload.get("presetId")
            if preset_id != "original":
                errors = _validate_uuid(preset_id, "presetId")
                if errors:
                    raise ProjectionConfigError("invalid", errors)
            target = next((p for p in presets if p["id"] == preset_id), None)
            if target is None:
                raise ProjectionConfigError("invalid", {"presetId": "preset not found"})
            row.working_config = _accept_config(row, target["config"])
            row.selected_preset_id = preset_id
            changed = True
        else:
            target = next((p for p in presets if p["id"] == row.selected_preset_id), None)
            if target is None:
                raise ProjectionConfigError("invalid", {"selectedPresetId": "preset not found"})
            row.working_config = _accept_config(row, target["config"])
            changed = True

        if not changed:
            return state
        if row.revision >= 2 ** 53 - 1:
            raise ProjectionConfigError("invalid", {"baseRevision": "revision limit reached"})
        row.presets = presets
        row.revision += 1
        row.save(update_fields=["working_config", "presets", "selected_preset_id", "revision", "updated_at"])
        state = _snapshot(row)
        transaction.on_commit(lambda: _broadcast(table.name, state, source_id))
        return state
