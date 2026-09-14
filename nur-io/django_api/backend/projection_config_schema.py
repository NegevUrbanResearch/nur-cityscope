import math

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
