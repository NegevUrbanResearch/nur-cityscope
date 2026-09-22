import re
from copy import deepcopy


SIDES = {'left': {'columns': 7, 'rows': 7}, 'right': {'columns': 8, 'rows': 7}}
BASELINE_HASHES = {
    'left': 'e625d3cac525d9b4b5c3f2eb306d89e85d104eecb26d313512cad9a6d9b9c331',
    'right': '6156d5a18dc1cc627a6085bc53939d1e1edb997992e416cb17a239b91ada52d4',
}
TD_MIGRATION_PRESET_ID = '6b6f2e4d-2c67-4df2-9d7e-1a7bb4ef3b2c'
TD_MIGRATION_PRESET_NAME = 'TD migration baseline'
HASH = re.compile(r'^[0-9a-f]{64}$', re.IGNORECASE)


def _keys(value, keys, path, errors):
    if not isinstance(value, dict):
        errors[path] = 'must be an object'
        return False
    for key in keys:
        if key not in value:
            errors[f'{path}.{key}' if path else key] = 'is required'
    for key in value:
        if key not in keys:
            errors[f'{path}.{key}' if path else key] = 'unknown field'
    return True


def _number(value, path, errors, low=-1, high=2):
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        errors[path] = 'must be a finite number'
        return False
    import math
    if not math.isfinite(value):
        errors[path] = 'must be a finite number'
        return False
    if value < low or value > high:
        errors[path] = f'must be between {low} and {high}'
        return False
    return True


def validate_projection_warp(value, side, trusted_manifest=None):
    errors = {}
    expected = SIDES.get(side)
    if expected is None:
        errors['side'] = 'must be left or right'
        return errors
    if not _keys(value, ['enabled', 'baseline', 'keystone', 'grid'], '', errors):
        return errors
    if not isinstance(value.get('enabled'), bool):
        errors['enabled'] = 'must be a boolean'
    baseline = value.get('baseline')
    baseline_keys = ['type', 'width', 'height', 'origin'] if isinstance(baseline, dict) and baseline.get('type') == 'identity' else ['type', 'assetId', 'sha256', 'width', 'height', 'origin']
    if _keys(baseline, baseline_keys, 'baseline', errors):
        if baseline.get('type') not in ('tdMesh', 'identity'): errors['baseline.type'] = 'must equal tdMesh or identity'
        if baseline.get('type') == 'tdMesh' and (not isinstance(baseline.get('assetId'), str) or not baseline['assetId']): errors['baseline.assetId'] = 'must be a non-empty string'
        if baseline.get('type') == 'tdMesh' and (not isinstance(baseline.get('sha256'), str) or not HASH.fullmatch(baseline['sha256'])): errors['baseline.sha256'] = 'must be a 64-character SHA-256 hex digest'
        if baseline.get('width') != 1920: errors['baseline.width'] = 'must equal 1920'
        if baseline.get('height') != 1080: errors['baseline.height'] = 'must equal 1080'
        if baseline.get('origin') != 'top-left': errors['baseline.origin'] = 'must equal top-left'
        assets = trusted_manifest.get('assets') if isinstance(trusted_manifest, dict) else None
        asset = assets.get(side) if isinstance(assets, dict) else None
        if baseline.get('type') == 'tdMesh' and trusted_manifest is not None and not isinstance(asset, dict):
            errors['baseline.assetId'] = 'is not present in the trusted manifest'
            errors['baseline.sha256'] = 'is not present in the trusted manifest'
        elif baseline.get('type') == 'tdMesh' and isinstance(asset, dict):
            digest = str(asset.get('sha256', ''))
            digest = digest[7:] if digest.lower().startswith('sha256:') else digest
            digest = digest.lower()
            if baseline.get('assetId') != asset.get('assetId'): errors['baseline.assetId'] = 'is not present in the trusted manifest'
            if str(baseline.get('sha256', '')).lower() != digest: errors['baseline.sha256'] = 'is not present in the trusted manifest'
            if asset.get('width') is not None and baseline.get('width') != asset['width']: errors['baseline.width'] = 'does not match the trusted manifest'
            if asset.get('height') is not None and baseline.get('height') != asset['height']: errors['baseline.height'] = 'does not match the trusted manifest'
    keystone = value.get('keystone')
    if _keys(keystone, ['corners'], 'keystone', errors):
        corners = keystone.get('corners')
        if not isinstance(corners, list) or len(corners) != 4:
            errors['keystone.corners'] = 'must contain four corners'
        else:
            for index, point in enumerate(corners):
                if not isinstance(point, list) or len(point) != 2:
                    errors[f'keystone.corners[{index}]'] = 'must contain two coordinates'
                    continue
                for axis, coordinate in enumerate(point): _number(coordinate, f'keystone.corners[{index}][{axis}]', errors)
    grid = value.get('grid')
    if _keys(grid, ['columns', 'rows', 'offsets'], 'grid', errors):
        if grid.get('columns') != expected['columns']: errors['grid.columns'] = f"must equal {expected['columns']}"
        if grid.get('rows') != expected['rows']: errors['grid.rows'] = f"must equal {expected['rows']}"
        count = expected['columns'] * expected['rows']
        offsets = grid.get('offsets')
        if not isinstance(offsets, list) or len(offsets) != count:
            errors['grid.offsets'] = f'must contain {count} offsets'
        else:
            for index, point in enumerate(offsets):
                if not isinstance(point, list) or len(point) != 2:
                    errors[f'grid.offsets[{index}]'] = 'must contain two coordinates'
                    continue
                for axis, coordinate in enumerate(point): _number(coordinate, f'grid.offsets[{index}][{axis}]', errors)
    return errors


def _legacy_fields(value, errors, options):
    from .projection_config_schema import _keys as legacy_keys, _number as legacy_number
    if legacy_keys(value.get('pre'), ['scale', 'rotateDeg', 'tx', 'ty'], 'pre', errors):
        legacy_number(value['pre'].get('scale'), 'pre.scale', .1, 8, errors)
        legacy_number(value['pre'].get('rotateDeg'), 'pre.rotateDeg', -180, 180, errors)
        legacy_number(value['pre'].get('tx'), 'pre.tx', -2, 2, errors)
        legacy_number(value['pre'].get('ty'), 'pre.ty', -2, 2, errors)
    if not legacy_keys(value.get('outputs'), ['left', 'right'], 'outputs', errors): return
    for side in ('left', 'right'):
        base = f'outputs.{side}'
        branch = value['outputs'].get(side)
        if not legacy_keys(branch, ['crop', 'post', 'presentationEffect', 'warp'], base, errors): continue
        crop = branch.get('crop')
        if legacy_keys(crop, ['x0', 'x1', 'y0', 'y1'], f'{base}.crop', errors):
            for key in ('x0', 'x1', 'y0', 'y1'): legacy_number(crop.get(key), f'{base}.crop.{key}', 0, 1, errors)
            if all(isinstance(crop.get(key), (int, float)) and not isinstance(crop.get(key), bool) for key in ('x0', 'x1')) and crop['x1'] - crop['x0'] < .01 - 1e-12: errors[f'{base}.crop'] = 'x extent must be at least 0.01'
            if all(isinstance(crop.get(key), (int, float)) and not isinstance(crop.get(key), bool) for key in ('y0', 'y1')) and crop['y1'] - crop['y0'] < .01 - 1e-12: errors[f'{base}.crop'] = 'y extent must be at least 0.01'
        post = branch.get('post')
        if legacy_keys(post, ['scale', 'tx', 'ty'], f'{base}.post', errors):
            legacy_number(post.get('scale'), f'{base}.post.scale', .1, 8, errors)
            legacy_number(post.get('tx'), f'{base}.post.tx', -2, 2, errors)
            legacy_number(post.get('ty'), f'{base}.post.ty', -2, 2, errors)
        presentation = branch.get('presentationEffect')
        if legacy_keys(presentation, ['enabled', 'mode'], f'{base}.presentationEffect', errors):
            if not isinstance(presentation.get('enabled'), bool): errors[f'{base}.presentationEffect.enabled'] = 'must be a boolean'
            if presentation.get('mode') != 'passthrough': errors[f'{base}.presentationEffect.mode'] = 'must equal passthrough'
        for path, message in validate_projection_warp(branch.get('warp'), side, options).items(): errors[f'{base}.{path}'] = message


def validate_projection_config_v2(value, trusted_manifest=None):
    errors = {}
    if not _keys(value, ['schemaVersion', 'pre', 'outputs'], '', errors): return errors
    if value.get('schemaVersion') != 2 or isinstance(value.get('schemaVersion'), bool): errors['schemaVersion'] = 'must equal 2'
    _legacy_fields(value, errors, trusted_manifest)
    return errors


def _identity_baseline(side, source):
    if not isinstance(source, dict) or not source.get('assetId'):
        return {'type': 'identity', 'width': 1920, 'height': 1080, 'origin': 'top-left'}
    return {
        'type': 'tdMesh',
        'assetId': source.get('assetId') or f'otef-{side}-td-2026-09-21',
        'sha256': source.get('sha256') or BASELINE_HASHES[side],
        'width': source.get('width') or 1920,
        'height': source.get('height') or 1080,
        'origin': source.get('origin') or 'top-left',
    }


def migrate_projection_config_to_v2(config, baselines=None):
    if not isinstance(config, dict) or config.get('schemaVersion') != 1: raise ValueError('projection config must be schema version 1')
    result = deepcopy(config)
    result['schemaVersion'] = 2
    baselines = baselines or {}
    for side, dimensions in SIDES.items():
        result['outputs'][side] = {
            **result['outputs'][side],
            'presentationEffect': {'enabled': False, 'mode': 'passthrough'},
            'warp': {
                'enabled': True,
                'baseline': _identity_baseline(side, baselines.get(side)),
                'keystone': {'corners': [[0, 0], [1, 0], [0, 1], [1, 1]]},
                'grid': {'columns': dimensions['columns'], 'rows': dimensions['rows'], 'offsets': [[0, 0] for _ in range(dimensions['columns'] * dimensions['rows'])]},
            },
        }
    return result
