import hashlib
import json
from pathlib import Path

from .projection_warp_geometry import validate_warp_mesh
from .projection_baseline_manifest import (
    SIDES, is_safe_projection_baseline_path, normalize_projection_baseline_hash,
    resolve_projection_baseline_asset, validate_projection_baseline_manifest,
)


def read_projection_baseline_manifest(root):
    root = Path(root)
    manifest = json.loads((root / 'manifest.json').read_text(encoding='utf-8'))
    return manifest, validate_projection_baseline_manifest(manifest)


def load_trusted_projection_asset(root, side, baseline=None, manifest=None):
    if side not in SIDES: raise ValueError('side must be left or right')
    root = Path(root)
    if manifest is None:
        manifest, errors = read_projection_baseline_manifest(root)
        if errors: raise ValueError('invalid projection baseline manifest: ' + '; '.join(f'{path} {message}' for path, message in errors.items()))
    asset = resolve_projection_baseline_asset(manifest, side, baseline)
    if not is_safe_projection_baseline_path(asset.get('path')): raise ValueError(f'{side} projection baseline path is invalid')
    root_path = root.resolve()
    path = (root / asset['path']).resolve(strict=True)
    if not path.is_relative_to(root_path): raise ValueError(f'{side} projection baseline path escapes the asset root')
    payload = path.read_bytes()
    actual = hashlib.sha256(payload).hexdigest()
    expected = normalize_projection_baseline_hash(asset['sha256'])
    if actual != expected: raise ValueError(f'{side} projection baseline hash mismatch')
    mesh = json.loads(payload.decode('utf-8'))
    validate_warp_mesh(mesh)
    if mesh.get('side') != side: raise ValueError(f'{side} projection baseline side mismatch')
    if mesh.get('logicalGrid') != asset['logicalGrid']: raise ValueError(f'{side} projection baseline logical grid mismatch')
    for key in ('width', 'height', 'origin'):
        if key in asset and mesh.get(key) != asset[key]: raise ValueError(f'{side} projection baseline {key} mismatch')
    return mesh, manifest, asset
