import hashlib
import json
from pathlib import Path

from .projection_warp_geometry import validate_warp_mesh
from .projection_warp_schema import SIDES


def read_projection_baseline_manifest(root):
    root = Path(root)
    manifest = json.loads((root / 'manifest.json').read_text(encoding='utf-8'))
    errors = {}
    if not isinstance(manifest, dict): return manifest, {'manifest': 'must be an object'}
    if manifest.get('schemaVersion') != 1: errors['schemaVersion'] = 'must equal 1'
    if manifest.get('width') != 1920: errors['width'] = 'must equal 1920'
    if manifest.get('height') != 1080: errors['height'] = 'must equal 1080'
    assets = manifest.get('assets')
    if not isinstance(assets, dict):
        errors['assets'] = 'must be an object'
    else:
        for side, expected in SIDES.items():
            asset = assets.get(side)
            if not isinstance(asset, dict): errors[f'assets.{side}'] = 'is required'; continue
            if not isinstance(asset.get('assetId'), str) or not asset.get('assetId'): errors[f'assets.{side}.assetId'] = 'must be a non-empty string'
            if not isinstance(asset.get('path'), str) or not asset.get('path'): errors[f'assets.{side}.path'] = 'must be a non-empty string'
            digest = str(asset.get('sha256', ''))
            digest = digest[7:] if digest.lower().startswith('sha256:') else digest
            if len(digest) != 64 or any(character not in '0123456789abcdefABCDEF' for character in digest): errors[f'assets.{side}.sha256'] = 'must be a 64-character SHA-256 hex digest'
            logical_grid = asset.get('logicalGrid')
            if not isinstance(logical_grid, dict):
                errors[f'assets.{side}.logicalGrid.columns'] = f'must equal {expected["columns"]}'
                errors[f'assets.{side}.logicalGrid.rows'] = f'must equal {expected["rows"]}'
            else:
                if logical_grid.get('columns') != expected['columns']: errors[f'assets.{side}.logicalGrid.columns'] = f'must equal {expected["columns"]}'
                if logical_grid.get('rows') != expected['rows']: errors[f'assets.{side}.logicalGrid.rows'] = f'must equal {expected["rows"]}'
    framing = manifest.get('framing')
    if not isinstance(framing, dict):
        errors['framing'] = 'must be an object'
    else:
        if not isinstance(framing.get('path'), str) or not framing.get('path'): errors['framing.path'] = 'is required'
        digest = str(framing.get('sha256', ''))
        digest = digest[7:] if digest.lower().startswith('sha256:') else digest
        if len(digest) != 64 or any(character not in '0123456789abcdefABCDEF' for character in digest): errors['framing.sha256'] = 'must be a 64-character SHA-256 hex digest'
    return manifest, errors


def load_trusted_projection_asset(root, side):
    if side not in SIDES: raise ValueError('side must be left or right')
    root = Path(root)
    manifest, errors = read_projection_baseline_manifest(root)
    if errors: raise ValueError('invalid projection baseline manifest: ' + '; '.join(f'{path} {message}' for path, message in errors.items()))
    asset = manifest['assets'][side]
    path = root / asset['path']
    payload = path.read_bytes()
    actual = hashlib.sha256(payload).hexdigest()
    expected = asset['sha256']
    expected = expected[7:] if expected.lower().startswith('sha256:') else expected
    expected = expected.lower()
    if actual != expected: raise ValueError(f'{side} projection baseline hash mismatch')
    mesh = json.loads(payload.decode('utf-8'))
    validate_warp_mesh(mesh)
    if mesh.get('side') != side: raise ValueError(f'{side} projection baseline side mismatch')
    if mesh.get('logicalGrid') != asset['logicalGrid']: raise ValueError(f'{side} projection baseline logical grid mismatch')
    return mesh, manifest, asset
