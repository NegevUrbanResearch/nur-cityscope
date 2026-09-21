from copy import deepcopy

from .projection_config_schema import validate_projection_config, validate_projection_snapshot
from .projection_warp_schema import migrate_projection_config_to_v2


def convert_projection_calibration_payload(working_config, presets, selected_preset_id, revision):
    """Preflight and convert one calibration row without mutating its inputs."""
    converted_working = _convert_config(working_config, 'working_config')
    converted_presets = []
    if not isinstance(presets, list):
        raise ValueError('presets must be a list')
    for index, preset in enumerate(presets):
        if not isinstance(preset, dict) or set(preset) != {'id', 'name', 'config', 'readOnly'}:
            raise ValueError(f'presets[{index}] has an invalid shape')
        converted = deepcopy(preset)
        converted['config'] = _convert_config(preset['config'], f'presets[{index}].config')
        converted_presets.append(converted)
    candidate = {
        'revision': revision,
        'config': converted_working,
        'presets': converted_presets,
        'selectedPresetId': selected_preset_id,
    }
    errors = validate_projection_snapshot(candidate)
    if errors:
        raise ValueError('invalid projection calibration: ' + '; '.join(f'{path} {message}' for path, message in errors.items()))
    return converted_working, converted_presets


def _convert_config(config, path):
    errors = validate_projection_config(config)
    if errors:
        raise ValueError(f'{path} is invalid: ' + '; '.join(f'{key} {message}' for key, message in errors.items()))
    if config.get('schemaVersion') == 1:
        return migrate_projection_config_to_v2(config)
    return deepcopy(config)
