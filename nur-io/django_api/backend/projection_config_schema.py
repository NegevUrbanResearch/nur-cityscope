import math
import re


def legacy_projection_config_defaults():
    return {
        'schemaVersion': 1,
        'pre': {'scale': 1.41, 'rotateDeg': -50, 'tx': 0.01, 'ty': 0},
        'outputs': {
            'left': {'crop': {'x0': 0, 'x1': 0.6, 'y0': 0, 'y1': 1}, 'post': {'scale': 2, 'tx': 0, 'ty': -0.049}},
            'right': {'crop': {'x0': 0.4, 'x1': 1, 'y0': 0, 'y1': 1}, 'post': {'scale': 2, 'tx': 0, 'ty': -0.049}},
        },
    }

def _keys(value, keys, path, errors):
    if not isinstance(value, dict):
        errors[path] = 'must be an object'
        return False
    field_path = lambda key: f'{path}.{key}' if path else key
    for key in keys:
        if key not in value:
            errors[field_path(key)] = 'is required'
    for key in value:
        if key not in keys:
            errors[field_path(key)] = 'unknown field'
    return True

def _number(value, path, low, high, errors):
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        errors[path] = 'must be a finite number'
        return
    if isinstance(value, float) and not math.isfinite(value):
        errors[path] = 'must be a finite number'
        return
    if value < low or value > high:
        errors[path] = f'must be between {low} and {high}'

def validate_projection_config(value):
    outputs = value.get('outputs') if isinstance(value, dict) else None
    if isinstance(value, dict) and value.get('schemaVersion') == 2 and isinstance(outputs, dict) and isinstance(outputs.get('left'), dict) and isinstance(outputs.get('right'), dict) and outputs['left'].get('warp') and outputs['right'].get('warp'):
        from .projection_warp_schema import validate_projection_config_v2
        return validate_projection_config_v2(value)
    errors = {}
    if not _keys(value, ['schemaVersion', 'pre', 'outputs'], '', errors): return errors
    if value.get('schemaVersion') != 1 or isinstance(value.get('schemaVersion'), bool): errors['schemaVersion'] = 'must equal 1'
    pre = value.get('pre')
    if _keys(pre, ['scale', 'rotateDeg', 'tx', 'ty'], 'pre', errors):
        _number(pre.get('scale'), 'pre.scale', .1, 8, errors); _number(pre.get('rotateDeg'), 'pre.rotateDeg', -180, 180, errors); _number(pre.get('tx'), 'pre.tx', -2, 2, errors); _number(pre.get('ty'), 'pre.ty', -2, 2, errors)
    outputs = value.get('outputs')
    if _keys(outputs, ['left', 'right'], 'outputs', errors):
        for side in ('left', 'right'):
            base = f'outputs.{side}'; branch = outputs.get(side)
            if not _keys(branch, ['crop', 'post'], base, errors): continue
            crop = branch.get('crop')
            if _keys(crop, ['x0', 'x1', 'y0', 'y1'], f'{base}.crop', errors):
                for k in ('x0','x1','y0','y1'): _number(crop.get(k), f'{base}.crop.{k}', 0, 1, errors)
                x_paths = (f'{base}.crop.x0', f'{base}.crop.x1')
                y_paths = (f'{base}.crop.y0', f'{base}.crop.y1')
                if not any(path in errors for path in x_paths) and crop['x1'] - crop['x0'] < .01 - 1e-12:
                    errors[f'{base}.crop'] = 'x extent must be at least 0.01'
                if not any(path in errors for path in y_paths) and crop['y1'] - crop['y0'] < .01 - 1e-12:
                    errors[f'{base}.crop'] = 'y extent must be at least 0.01'
            post = branch.get('post')
            if _keys(post, ['scale', 'tx', 'ty'], f'{base}.post', errors):
                _number(post.get('scale'), f'{base}.post.scale', .1, 8, errors); _number(post.get('tx'), f'{base}.post.tx', -2, 2, errors); _number(post.get('ty'), f'{base}.post.ty', -2, 2, errors)
    return errors


def validate_projection_snapshot(value):
    """Validate the API snapshot envelope and its reserved preset rules."""
    errors = {}
    if not isinstance(value, dict):
        return {'snapshot': 'must be an object'}
    keys = {'revision', 'config', 'presets', 'selectedPresetId'}
    for key in keys - value.keys(): errors[key] = 'is required'
    for key in value.keys() - keys: errors[key] = 'unknown field'
    revision = value.get('revision')
    if isinstance(revision, bool) or not isinstance(revision, int) or revision < 0 or revision > 2 ** 53 - 1:
        errors['revision'] = 'must be a nonnegative safe integer'
    if validate_projection_config(value.get('config')):
        errors['config'] = 'is invalid'
    presets = value.get('presets')
    if not isinstance(presets, list) or not 1 <= len(presets) <= 50:
        errors['presets'] = 'must contain 1-50 presets'
        presets = []
    from .projection_warp_schema import TD_MIGRATION_PRESET_ID, TD_MIGRATION_PRESET_NAME, migrate_projection_config_to_v2
    original = legacy_projection_config_defaults()
    upgraded = migrate_projection_config_to_v2(original)
    ids = set()
    original_count = 0
    uuid_pattern = re.compile(r'^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$', re.I)
    for index, preset in enumerate(presets):
        path = f'presets[{index}]'
        if not isinstance(preset, dict):
            errors[path] = 'must be an object'; continue
        expected = {'id', 'name', 'config', 'readOnly'}
        for key in expected - preset.keys(): errors[f'{path}.{key}'] = 'is required'
        for key in preset.keys() - expected: errors[f'{path}.{key}'] = 'unknown field'
        preset_id, name, read_only = preset.get('id'), preset.get('name'), preset.get('readOnly')
        if not isinstance(preset_id, str) or not preset_id or preset_id in ids: errors[f'{path}.id'] = 'must be unique'
        if not isinstance(name, str) or not name.strip() or name != name.strip() or len(name) > 80: errors[f'{path}.name'] = 'must be 1-80 characters'
        if not isinstance(read_only, bool): errors[f'{path}.readOnly'] = 'must be a boolean'
        config_errors = validate_projection_config(preset.get('config'))
        if config_errors: errors[f'{path}.config'] = 'is invalid'
        if isinstance(preset_id, str): ids.add(preset_id)
        if preset_id == 'original':
            original_count += 1
            if read_only is not True or name != 'Original calibration' or preset.get('config') not in (original, upgraded):
                errors[f'{path}'] = 'must be the immutable Original calibration preset'
        elif preset_id == TD_MIGRATION_PRESET_ID:
            if read_only is not True or name != TD_MIGRATION_PRESET_NAME:
                errors[f'{path}'] = 'must be the immutable TD migration baseline preset'
        elif not isinstance(preset_id, str) or not uuid_pattern.fullmatch(preset_id) or read_only is not False:
            errors[f'{path}'] = 'must be a writable UUID preset'
    if original_count != 1: errors['presets.original'] = 'must contain exactly one Original calibration preset'
    selected = value.get('selectedPresetId')
    if not isinstance(selected, str) or selected not in ids: errors['selectedPresetId'] = 'must reference a preset'
    return errors
