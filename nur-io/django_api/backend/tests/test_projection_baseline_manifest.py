import copy
import hashlib
import json
from pathlib import Path
from tempfile import TemporaryDirectory

from django.test import SimpleTestCase

from backend.projection_baseline_manifest import resolve_projection_baseline_asset, validate_projection_baseline_manifest


def manifest():
    digest = lambda char: char * 64
    return {
        'schemaVersion': 1, 'width': 1920, 'height': 1080,
        'assets': {
            'left': {'assetId': 'legacy-left', 'path': 'left.json', 'sha256': digest('a'), 'logicalGrid': {'columns': 7, 'rows': 7}},
            'right': {'assetId': 'legacy-right', 'path': 'right.json', 'sha256': digest('b'), 'logicalGrid': {'columns': 8, 'rows': 7}},
        }, 'framing': {'path': '../td-source-config.json', 'sha256': digest('c')},
    }


class ProjectionBaselineManifestTests(SimpleTestCase):
    def test_historical_defaults_and_mixed_catalog_references_resolve(self):
        value = manifest()
        value['catalog'] = {
            'left': [{'assetId': 'capture-left', 'path': 'captures/unique/left.json', 'sha256': 'SHA256:' + 'd' * 64,
                      'logicalGrid': {'columns': 5, 'rows': 3}, 'source': 'TD'}],
            'right': [{'assetId': 'capture-right', 'path': 'captures/unique/right.json', 'sha256': 'e' * 64,
                       'logicalGrid': {'columns': 3, 'rows': 4}}],
        }
        self.assertEqual(validate_projection_baseline_manifest(value), {})
        self.assertIs(resolve_projection_baseline_asset(value, 'left'), value['assets']['left'])
        self.assertIs(resolve_projection_baseline_asset(value, 'left', None), value['assets']['left'])
        self.assertIs(resolve_projection_baseline_asset(value, 'left', {'assetId': 'capture-left', 'sha256': 'd' * 64}), value['catalog']['left'][0])
        self.assertIs(resolve_projection_baseline_asset(value, 'right', {'assetId': 'legacy-right', 'sha256': 'b' * 64}), value['assets']['right'])
        self.assertIs(resolve_projection_baseline_asset(value, 'right', {'assetId': 'capture-right', 'sha256': 'e' * 64}), value['catalog']['right'][0])

    def test_unknown_wrong_hash_and_cross_side_references_never_fall_back(self):
        value = manifest()
        value['catalog'] = {
            'left': [{'assetId': 'capture-left', 'path': 'capture-left.json', 'sha256': 'd' * 64, 'logicalGrid': {'columns': 5, 'rows': 3}}],
            'right': [{'assetId': 'capture-right', 'path': 'capture-right.json', 'sha256': 'e' * 64, 'logicalGrid': {'columns': 3, 'rows': 4}}],
        }
        for reference in (
            {'assetId': 'missing', 'sha256': 'd' * 64},
            {'assetId': 'capture-left', 'sha256': 'f' * 64},
            {'assetId': 'capture-right', 'sha256': 'e' * 64},
        ):
            with self.subTest(reference=reference), self.assertRaisesRegex(ValueError, 'trusted|baseline|asset'):
                resolve_projection_baseline_asset(value, 'left', reference)

    def test_rejects_catalog_duplicates_malformed_entries_and_escapes(self):
        candidates = []
        duplicate = manifest()
        duplicate['catalog'] = {'left': [dict(duplicate['assets']['left'], path='copy.json')], 'right': []}
        candidates.append(duplicate)
        duplicate_hash = manifest()
        duplicate_hash['catalog'] = {'left': [dict(duplicate_hash['assets']['left'], path='copy.json', sha256='d' * 64)], 'right': []}
        candidates.append(duplicate_hash)
        missing_side = manifest(); missing_side['catalog'] = {'left': []}; candidates.append(missing_side)
        for path in ('/outside.json', 'https://outside/x.json', 'nested/%2e%2e/x.json', r'nested\x.json', 'nested/../x.json', 'nested/:x.json'):
            value = manifest()
            value['catalog'] = {'left': [{'assetId': 'extra', 'path': path, 'sha256': 'd' * 64, 'logicalGrid': {'columns': 5, 'rows': 3}}], 'right': []}
            candidates.append(value)
        for value in candidates:
            with self.subTest(catalog=value.get('catalog')):
                self.assertTrue(validate_projection_baseline_manifest(value))
                with self.assertRaises(ValueError):
                    resolve_projection_baseline_asset(value, 'left')

    def test_loader_hashes_selected_bytes_and_rejects_symlink_escape(self):
        from backend.projection_warp_assets import load_trusted_projection_asset
        from backend.projection_warp_geometry import create_identity_projection_mesh
        with TemporaryDirectory() as temporary, TemporaryDirectory() as outside:
            root = Path(temporary)
            mesh = create_identity_projection_mesh('left'); mesh['logicalGrid'] = {'columns': 7, 'rows': 7}
            payload = json.dumps(mesh, separators=(',', ':')).encode()
            (root / 'legacy-left.json').write_bytes(payload)
            extra = copy.deepcopy(mesh); extra['vertices'][0]['x'] += 0.01
            extra_payload = json.dumps(extra, separators=(',', ':')).encode()
            (root / 'nested').mkdir()
            (root / 'nested' / 'extra.json').write_bytes(extra_payload)
            value = manifest()
            value['assets']['left'].update(path='legacy-left.json', sha256=hashlib.sha256(payload).hexdigest(), logicalGrid=mesh['logicalGrid'])
            value['catalog'] = {'left': [{'assetId': 'extra-left', 'path': 'nested/extra.json', 'sha256': hashlib.sha256(extra_payload).hexdigest(), 'logicalGrid': mesh['logicalGrid']}], 'right': []}
            (root / 'manifest.json').write_text(json.dumps(value), encoding='utf-8')
            loaded, _manifest, asset = load_trusted_projection_asset(root, 'left', {'assetId': 'extra-left', 'sha256': hashlib.sha256(extra_payload).hexdigest()})
            self.assertEqual(loaded, extra)
            self.assertEqual(asset['assetId'], 'extra-left')
            (Path(outside) / 'escape.json').write_bytes(payload)
            try:
                (root / 'escape.json').symlink_to(Path(outside) / 'escape.json')
            except (OSError, NotImplementedError):
                self.skipTest('symlink creation is unavailable')
            value['catalog']['left'][0]['path'] = 'escape.json'
            value['catalog']['left'][0]['sha256'] = hashlib.sha256(payload).hexdigest()
            (root / 'manifest.json').write_text(json.dumps(value), encoding='utf-8')
            with self.assertRaisesRegex(ValueError, 'inside|escape|path'):
                load_trusted_projection_asset(root, 'left', {'assetId': 'extra-left', 'sha256': hashlib.sha256(payload).hexdigest()})

    def test_selected_mesh_metadata_mismatch_fails_even_with_its_actual_hash(self):
        from backend.projection_warp_assets import load_trusted_projection_asset
        from backend.projection_warp_geometry import create_identity_projection_mesh
        with TemporaryDirectory() as temporary:
            root = Path(temporary)
            mesh = create_identity_projection_mesh('left')
            mesh['logicalGrid'] = {'columns': 7, 'rows': 7}
            mesh['origin'] = 'bottom-left'
            payload = json.dumps(mesh, separators=(',', ':')).encode()
            (root / 'mesh.json').write_bytes(payload)
            value = manifest()
            value['catalog'] = {'left': [{'assetId': 'selected-left', 'path': 'mesh.json', 'sha256': hashlib.sha256(payload).hexdigest(), 'logicalGrid': mesh['logicalGrid'], 'origin': 'top-left'}], 'right': []}
            (root / 'manifest.json').write_text(json.dumps(value), encoding='utf-8')
            with self.assertRaisesRegex(ValueError, 'origin mismatch'):
                load_trusted_projection_asset(root, 'left', {'assetId': 'selected-left', 'sha256': hashlib.sha256(payload).hexdigest()})
