import json
import hashlib
import tempfile
from pathlib import Path
from django.test import SimpleTestCase

from backend.projection_warp_assets import load_trusted_projection_asset, read_projection_baseline_manifest
from backend.projection_warp_geometry import create_full_frame_projection_mesh, evaluate_warp_mesh, evaluate_warp_point, interpolate_grid_offset, validate_warp_mesh
from backend.projection_warp_schema import migrate_projection_config_to_v2, validate_projection_config_v2, validate_projection_warp
from backend.projection_config_schema import validate_projection_config


GOLDEN = json.loads((Path(__file__).parent / 'fixtures' / 'projection-warp-golden.json').read_text())
V1 = json.loads((Path(__file__).parent / 'fixtures/projection-config-v1.json').read_text())['valid']


class ProjectionWarpTests(SimpleTestCase):
    def test_migrates_v1_framing_losslessly(self):
        migrated = migrate_projection_config_to_v2(V1)
        self.assertEqual(migrated['schemaVersion'], 2)
        self.assertEqual(migrated['pre'], V1['pre'])
        self.assertEqual(migrated['outputs']['left']['crop'], V1['outputs']['left']['crop'])
        self.assertEqual(migrated['outputs']['left']['presentationEffect'], {'enabled': False, 'mode': 'passthrough'})
        self.assertTrue(migrated['outputs']['left']['warp']['enabled'])
        self.assertEqual(migrated['outputs']['left']['warp']['baseline'], {'type': 'identity', 'width': 1920, 'height': 1080, 'origin': 'top-left'})
        self.assertEqual(validate_projection_config_v2(migrated), {})
        self.assertEqual(validate_projection_config(V1), {})

    def test_geometry_golden_cases(self):
        warp = GOLDEN['identity']['warp']
        for point in GOLDEN['samples']['identityCorners']:
            self.assertEqual(evaluate_warp_point(*point, warp), point)
        grid = json.loads(json.dumps(warp['grid']))
        sample = GOLDEN['samples']['oneCell']
        grid['offsets'][0], grid['offsets'][1], grid['offsets'][7], grid['offsets'][8] = sample['cornerOffsets']
        self.assertAlmostEqual(interpolate_grid_offset(*sample['point'], grid)[0], sample['offset'][0])
        self.assertAlmostEqual(interpolate_grid_offset(*sample['point'], grid)[1], sample['offset'][1])

    def test_mesh_preserves_uv_and_topology(self):
        mesh = GOLDEN['identity']['mesh']
        warp = json.loads(json.dumps(GOLDEN['identity']['warp']))
        sample = GOLDEN['samples']['bilinearCenter']
        warp['grid']['offsets'][sample['index']] = [0.01, 0]
        result = evaluate_warp_mesh(mesh, warp)
        self.assertEqual(result['triangles'], mesh['triangles'])
        self.assertEqual([[p['u'], p['v']] for p in result['vertices']], [[p['u'], p['v']] for p in mesh['vertices']])
        self.assertEqual([result['vertices'][sample['index']]['x'], result['vertices'][sample['index']]['y']], [0.51, 0.5])
        self.assertIs(validate_warp_mesh(result), result)

    def test_identity_baseline_supplies_fixed_left_and_right_topologies(self):
        left = evaluate_warp_mesh(None, GOLDEN['identity']['warp'])
        right = evaluate_warp_mesh(None, GOLDEN['rightIdentity']['warp'])
        self.assertEqual(left['vertices'], GOLDEN['identity']['mesh']['vertices'])
        self.assertEqual(left['triangles'], GOLDEN['identity']['mesh']['triangles'])
        self.assertEqual(right['vertices'], GOLDEN['rightIdentity']['mesh']['vertices'])
        self.assertEqual(right['triangles'], GOLDEN['rightIdentity']['mesh']['triangles'])
        changed = json.loads(json.dumps(GOLDEN['identity']['warp']))
        changed['grid']['offsets'][GOLDEN['samples']['bilinearCenter']['index']] = [0.01, 0]
        moved = evaluate_warp_mesh(None, changed)
        self.assertAlmostEqual(moved['vertices'][GOLDEN['samples']['bilinearCenter']['index']]['x'], 0.51)

    def test_projective_corner_samples_use_shared_fixture(self):
        warp = json.loads(json.dumps(GOLDEN['identity']['warp']))
        warp['keystone']['corners'] = GOLDEN['samples']['projectiveCorners']['corners']
        for sample in GOLDEN['samples']['projectiveCorners']['points']:
            result = evaluate_warp_point(*sample['point'], warp)
            self.assertAlmostEqual(result[0], sample['expected'][0])
            self.assertAlmostEqual(result[1], sample['expected'][1])

    def test_trusted_manifest_requires_requested_side(self):
        value = json.loads(json.dumps(GOLDEN['identity']['warp']))
        value['baseline'] = {'type': 'tdMesh', 'assetId': 'fixture-right', 'sha256': 'b' * 64, 'width': 1920, 'height': 1080, 'origin': 'top-left'}
        errors = validate_projection_warp(value, 'right', {'assets': {'left': {'assetId': 'fixture-left', 'sha256': 'a' * 64}}})
        self.assertIn('baseline.assetId', errors)
        self.assertIn('baseline.sha256', errors)

    def test_manifest_metadata_and_loader_errors_are_controlled(self):
        manifest = {'schemaVersion': 1, 'width': 1920, 'height': 1080, 'assets': [], 'framing': []}
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / 'manifest.json').write_text(json.dumps(manifest))
            _, errors = read_projection_baseline_manifest(root)
            self.assertIn('assets', errors)
            self.assertIn('framing', errors)

        manifest = {'schemaVersion': 1, 'width': 1920, 'height': 1080, 'assets': {}, 'framing': {'path': 'framing.json', 'sha256': 'invalid'}}
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / 'manifest.json').write_text(json.dumps(manifest))
            _, errors = read_projection_baseline_manifest(root)
            self.assertIn('framing.sha256', errors)

        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / 'manifest.json').write_text(json.dumps({'schemaVersion': 1, 'width': 1920, 'height': 1080, 'assets': {'left': {'assetId': 'left', 'path': 'left.json', 'sha256': 'a' * 64, 'logicalGrid': {'columns': 7, 'rows': 7}}, 'right': {'assetId': 'right', 'path': 'right.json', 'sha256': 'b' * 64, 'logicalGrid': {'columns': 8, 'rows': 7}}}, 'framing': {'path': 'framing.json', 'sha256': 'c' * 64}}))
            (root / 'left.json').write_text('{}')
            (root / 'right.json').write_text('{}')
            (root / 'framing.json').write_text('{}')
            with self.assertRaisesRegex(ValueError, 'hash mismatch'):
                load_trusted_projection_asset(root, 'left')

    def test_loader_accepts_case_insensitive_sha256_prefix_with_local_manifest_bytes(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            left_payload = json.dumps(GOLDEN['identity']['mesh']).encode()
            right_payload = json.dumps(GOLDEN['rightIdentity']['mesh']).encode()
            (root / 'left.json').write_bytes(left_payload)
            (root / 'right.json').write_bytes(right_payload)
            left_hash = hashlib.sha256(left_payload).hexdigest()
            right_hash = hashlib.sha256(right_payload).hexdigest()
            manifest = {
                'schemaVersion': 1,
                'width': 1920,
                'height': 1080,
                'assets': {
                    'left': {'assetId': 'left', 'path': 'left.json', 'sha256': f'SHA256:{left_hash}', 'logicalGrid': {'columns': 7, 'rows': 7}},
                    'right': {'assetId': 'right', 'path': 'right.json', 'sha256': f'Sha256:{right_hash}', 'logicalGrid': {'columns': 8, 'rows': 7}},
                },
                'framing': {'path': 'framing.json', 'sha256': 'c' * 64},
            }
            (root / 'manifest.json').write_text(json.dumps(manifest))
            mesh, loaded_manifest, asset = load_trusted_projection_asset(root, 'left')
            self.assertEqual(mesh, GOLDEN['identity']['mesh'])
            self.assertEqual(loaded_manifest['assets']['left']['assetId'], 'left')
            self.assertEqual(asset['sha256'], f'SHA256:{left_hash}')

    def test_malformed_non_object_baseline_without_mesh_is_a_controlled_error(self):
        for baseline in (None, 'identity', []):
            warp = json.loads(json.dumps(GOLDEN['identity']['warp']))
            warp['baseline'] = baseline
            with self.assertRaises(ValueError):
                evaluate_warp_mesh(None, warp)

    def test_structural_errors_are_precise(self):
        warp = json.loads(json.dumps(GOLDEN['identity']['warp']))
        warp['grid']['columns'] = 8
        self.assertIn('grid.columns', validate_projection_warp(warp, 'left'))
        warp = json.loads(json.dumps(GOLDEN['identity']['warp']))
        warp['grid']['offsets'][0][0] = True
        self.assertIn('grid.offsets[0][0]', validate_projection_warp(warp, 'left'))

    def test_disabled_warp_returns_fixed_full_frame_quad(self):
        warp = json.loads(json.dumps(GOLDEN['identity']['warp']))
        warp['enabled'] = False
        self.assertEqual(evaluate_warp_mesh(None, warp), create_full_frame_projection_mesh('left'))

        right = json.loads(json.dumps(GOLDEN['rightIdentity']['warp']))
        right['enabled'] = False
        self.assertEqual(evaluate_warp_mesh(None, right), create_full_frame_projection_mesh('right'))
