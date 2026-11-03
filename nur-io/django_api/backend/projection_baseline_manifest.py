import re
import math


SIDES = ('left', 'right')
_HASH = re.compile(r'^[0-9a-f]{64}$', re.IGNORECASE)


def normalize_projection_baseline_hash(value):
    if not isinstance(value, str):
        return ''
    return (value[7:] if value.lower().startswith('sha256:') else value).lower()


def is_safe_projection_baseline_path(value):
    if (not isinstance(value, str) or not value or value.startswith('/') or
            any(char in value for char in ':\\?#%') or any(ord(char) < 32 or ord(char) == 127 for char in value)):
        return False
    parts = value.split('/')
    return all(part and part not in ('.', '..') for part in parts)


def _valid_logical_grid(value):
    if not isinstance(value, dict):
        return False
    columns, rows = value.get('columns'), value.get('rows')
    def count(number):
        if isinstance(number, bool) or not isinstance(number, (int, float)):
            return False
        if isinstance(number, float) and not math.isfinite(number):
            return False
        return 2 <= number <= 65536 and int(number) == number and number <= 9007199254740991
    return count(columns) and count(rows) and columns * rows <= 65536


def _validate_asset(asset, path, errors):
    if not isinstance(asset, dict):
        errors[path] = 'must be an object'
        return
    if not isinstance(asset.get('assetId'), str) or not asset['assetId']:
        errors[f'{path}.assetId'] = 'must be a non-empty string'
    if not is_safe_projection_baseline_path(asset.get('path')):
        errors[f'{path}.path'] = 'must be a safe relative mesh path'
    if not _HASH.fullmatch(normalize_projection_baseline_hash(asset.get('sha256'))):
        errors[f'{path}.sha256'] = 'must be a 64-character SHA-256 hex digest'
    if not _valid_logical_grid(asset.get('logicalGrid')):
        errors[f'{path}.logicalGrid'] = 'must contain integer columns/rows >= 2 with at most 65536 points'
    if 'width' in asset and asset['width'] != 1920:
        errors[f'{path}.width'] = 'must equal 1920'
    if 'height' in asset and asset['height'] != 1080:
        errors[f'{path}.height'] = 'must equal 1080'
    if 'origin' in asset and asset['origin'] != 'top-left':
        errors[f'{path}.origin'] = 'must equal top-left'


def validate_projection_baseline_manifest(manifest):
    errors = {}
    if not isinstance(manifest, dict):
        return {'manifest': 'must be an object'}
    if manifest.get('schemaVersion') != 1 or isinstance(manifest.get('schemaVersion'), bool):
        errors['schemaVersion'] = 'must equal 1'
    if manifest.get('width') != 1920 or isinstance(manifest.get('width'), bool):
        errors['width'] = 'must equal 1920'
    if manifest.get('height') != 1080 or isinstance(manifest.get('height'), bool):
        errors['height'] = 'must equal 1080'
    assets = manifest.get('assets')
    if not isinstance(assets, dict):
        errors['assets'] = 'must be an object'
    else:
        for side in SIDES:
            if side not in assets:
                errors[f'assets.{side}'] = 'is required'
            else:
                _validate_asset(assets[side], f'assets.{side}', errors)
    if 'catalog' in manifest:
        catalog = manifest['catalog']
        if not isinstance(catalog, dict) or set(catalog) != set(SIDES):
            errors['catalog'] = 'must contain exactly left and right arrays'
        else:
            for side in SIDES:
                if not isinstance(catalog[side], list):
                    errors[f'catalog.{side}'] = 'must be an array'
                    continue
                for index, asset in enumerate(catalog[side]):
                    _validate_asset(asset, f'catalog.{side}[{index}]', errors)
    framing = manifest.get('framing')
    if not isinstance(framing, dict):
        errors['framing'] = 'must be an object'
    else:
        if not isinstance(framing.get('path'), str) or not framing['path']:
            errors['framing.path'] = 'is required'
        if not _HASH.fullmatch(normalize_projection_baseline_hash(framing.get('sha256'))):
            errors['framing.sha256'] = 'must be a 64-character SHA-256 hex digest'
    if isinstance(assets, dict):
        catalog = manifest.get('catalog', {})
        for side in SIDES:
            ids = set()
            entries = [assets.get(side)]
            if isinstance(catalog, dict) and isinstance(catalog.get(side), list):
                entries.extend(catalog[side])
            for asset in entries:
                if not isinstance(asset, dict) or not isinstance(asset.get('assetId'), str) or not asset['assetId']:
                    continue
                if asset['assetId'] in ids:
                    errors[f'catalog.{side}'] = 'contains a duplicate asset ID'
                ids.add(asset['assetId'])
    return errors


def resolve_projection_baseline_asset(manifest, side, baseline=None):
    if side not in SIDES:
        raise ValueError('projection baseline side must be left or right')
    errors = validate_projection_baseline_manifest(manifest)
    if errors:
        raise ValueError('invalid projection baseline manifest: ' + '; '.join(f'{path} {message}' for path, message in errors.items()))
    if baseline is None:
        return manifest['assets'][side]
    if (not isinstance(baseline, dict) or not isinstance(baseline.get('assetId'), str) or not baseline['assetId'] or
            not _HASH.fullmatch(normalize_projection_baseline_hash(baseline.get('sha256')))):
        raise ValueError(f'projection {side} baseline reference is malformed')
    entries = [manifest['assets'][side], *manifest.get('catalog', {}).get(side, [])]
    for asset in entries:
        if (asset['assetId'] == baseline['assetId'] and
                normalize_projection_baseline_hash(asset['sha256']) == normalize_projection_baseline_hash(baseline['sha256'])):
            return asset
    raise ValueError(f'projection {side} baseline is not present in the trusted manifest')
