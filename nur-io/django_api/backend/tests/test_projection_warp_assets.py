import hashlib
import json
from pathlib import Path
from tempfile import TemporaryDirectory

from django.test import SimpleTestCase

from backend.projection_warp_assets import load_trusted_projection_asset, read_projection_baseline_manifest
from backend.projection_warp_geometry import create_identity_projection_mesh


class ProjectionBaselineAssetTests(SimpleTestCase):
    def asset_root(self, grids=None):
        temporary = TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        root = Path(temporary.name)
        assets = {}
        for side in ('left', 'right'):
            grid = (grids or {}).get(side, {'columns': 7 if side == 'left' else 8, 'rows': 7})
            mesh = create_identity_projection_mesh(side)
            mesh['logicalGrid'] = grid
            payload = json.dumps(mesh, separators=(',', ':')).encode()
            (root / f'{side}.json').write_bytes(payload)
            assets[side] = {
                'assetId': f'fixture-{side}', 'path': f'{side}.json',
                'sha256': hashlib.sha256(payload).hexdigest(), 'logicalGrid': grid,
            }
        manifest = {
            'schemaVersion': 1, 'width': 1920, 'height': 1080, 'assets': assets,
            'framing': {'path': 'framing.json', 'sha256': 'b' * 64},
        }
        (root / 'manifest.json').write_text(json.dumps(manifest), encoding='utf-8')
        return root

    def test_shared_variable_grid_fixture_loads_for_both_sides(self):
        repository_root = Path(__file__).resolve().parents[4]
        fixture_path = repository_root / 'otef-interactive/tests/fixtures/td-variable-grid.json'
        fixture = json.loads(fixture_path.read_text(encoding='utf-8'))
        with TemporaryDirectory() as temporary:
            root = Path(temporary)
            assets = {}
            for side in ('left', 'right'):
                mesh = fixture[side]['expectedMesh']
                payload = json.dumps(mesh, separators=(',', ':')).encode()
                (root / f'{side}.json').write_bytes(payload)
                assets[side] = {
                    'assetId': f'fixture-{side}', 'path': f'{side}.json',
                    'sha256': hashlib.sha256(payload).hexdigest(),
                    'logicalGrid': mesh['logicalGrid'],
                }
            (root / 'manifest.json').write_text(json.dumps({
                'schemaVersion': 1, 'width': 1920, 'height': 1080, 'assets': assets,
                'framing': {'path': 'framing.json', 'sha256': 'b' * 64},
            }), encoding='utf-8')

            for side, expected in (('left', {'columns': 3, 'rows': 4}), ('right', {'columns': 5, 'rows': 3})):
                mesh, _manifest, _asset = load_trusted_projection_asset(root, side)
                self.assertEqual(mesh['logicalGrid'], expected)

    def test_manifest_accepts_changed_counts_on_both_sides(self):
        root = self.asset_root({'left': {'columns': 3, 'rows': 4}, 'right': {'columns': 5, 'rows': 3}})
        _manifest, errors = read_projection_baseline_manifest(root)
        self.assertEqual(errors, {})

    def test_malformed_counts_are_rejected_on_both_sides(self):
        malformed = [
            None, [], {'columns': True, 'rows': 3}, {'columns': 2.5, 'rows': 3},
            {'columns': None, 'rows': 3}, {'columns': 1, 'rows': 3},
            {'columns': 257, 'rows': 256},
        ]
        for grid in malformed:
            with self.subTest(grid=grid):
                root = self.asset_root({'left': grid, 'right': grid})
                _manifest, errors = read_projection_baseline_manifest(root)
                self.assertEqual(errors.get('assets.left.logicalGrid'),
                                 'must contain integer columns/rows >= 2 with at most 65536 points')
                self.assertEqual(errors.get('assets.right.logicalGrid'),
                                 'must contain integer columns/rows >= 2 with at most 65536 points')

    def test_missing_logical_grid_object_is_rejected_on_both_sides(self):
        root = self.asset_root()
        manifest = json.loads((root / 'manifest.json').read_text(encoding='utf-8'))
        for side in ('left', 'right'):
            del manifest['assets'][side]['logicalGrid']
        (root / 'manifest.json').write_text(json.dumps(manifest), encoding='utf-8')
        _manifest, errors = read_projection_baseline_manifest(root)
        expected = 'must contain integer columns/rows >= 2 with at most 65536 points'
        self.assertEqual(errors.get('assets.left.logicalGrid'), expected)
        self.assertEqual(errors.get('assets.right.logicalGrid'), expected)

    def test_manifest_still_requires_both_side_asset_references(self):
        root = self.asset_root()
        manifest = json.loads((root / 'manifest.json').read_text(encoding='utf-8'))
        del manifest['assets']['right']
        (root / 'manifest.json').write_text(json.dumps(manifest), encoding='utf-8')
        _manifest, errors = read_projection_baseline_manifest(root)
        self.assertEqual(errors.get('assets.right'), 'is required')

    def test_integer_valued_json_floats_are_accepted_consistently_with_javascript(self):
        root = self.asset_root({'left': {'columns': 3.0, 'rows': 4.0}, 'right': {'columns': 5.0, 'rows': 3.0}})
        _manifest, errors = read_projection_baseline_manifest(root)
        self.assertEqual(errors, {})

    def test_trusted_load_accepts_changed_counts_and_checks_hash_and_metadata(self):
        root = self.asset_root({'left': {'columns': 3, 'rows': 4}, 'right': {'columns': 5, 'rows': 3}})
        mesh, _manifest, asset = load_trusted_projection_asset(root, 'left')
        self.assertEqual(mesh['logicalGrid'], {'columns': 3, 'rows': 4})
        self.assertEqual(asset['logicalGrid'], mesh['logicalGrid'])

        path = root / 'left.json'
        path.write_bytes(path.read_bytes() + b' ')
        with self.assertRaisesRegex(ValueError, 'hash mismatch'):
            load_trusted_projection_asset(root, 'left')

    def test_hash_valid_mesh_with_different_logical_metadata_is_rejected(self):
        root = self.asset_root({'left': {'columns': 3, 'rows': 4}})
        mesh = json.loads((root / 'left.json').read_text(encoding='utf-8'))
        mesh['logicalGrid'] = {'columns': 4, 'rows': 4}
        payload = json.dumps(mesh, separators=(',', ':')).encode()
        (root / 'left.json').write_bytes(payload)
        manifest = json.loads((root / 'manifest.json').read_text(encoding='utf-8'))
        manifest['assets']['left']['sha256'] = hashlib.sha256(payload).hexdigest()
        (root / 'manifest.json').write_text(json.dumps(manifest), encoding='utf-8')
        with self.assertRaisesRegex(ValueError, 'logical grid mismatch'):
            load_trusted_projection_asset(root, 'left')
