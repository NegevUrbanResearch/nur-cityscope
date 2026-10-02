import json
import math
from pathlib import Path
from django.test import SimpleTestCase

from backend.projection_warp_assets import load_trusted_projection_asset
try:
    from backend.projection_baseline_sampler import create_baseline_sampler
except ModuleNotFoundError:
    create_baseline_sampler = None

FIXTURE = json.loads((Path(__file__).parent / 'fixtures/projection-grid-parity.json').read_text(encoding='utf-8'))
_asset_roots = [parent / 'otef-interactive/public/projection-calibration/td-baselines' for parent in Path(__file__).resolve().parents]
_asset_roots += [parent / 'public/projection-calibration/td-baselines' for parent in Path(__file__).resolve().parents]
BASELINE_ROOT = next((path for path in _asset_roots if path.is_dir()), _asset_roots[0])


class ProjectionBaselineSamplerTests(SimpleTestCase):
    def require_api(self):
        self.assertTrue(callable(create_baseline_sampler), 'projection_baseline_sampler API has not been implemented')

    def test_fixture_samples_triangle_interiors_and_lowest_id_shared_edge(self):
        self.require_api()
        sample = create_baseline_sampler(FIXTURE['mesh'])
        for item in FIXTURE['baselineSamples']:
            point = sample(*item['point'])
            self.assertEqual(point['triangleId'], item['triangleId'])
            for key, expected in item['expected'].items(): self.assertAlmostEqual(point[key], expected, places=14)
        self.assertEqual(sample(.8, .8, 1)['triangleId'], 1)

    def test_sampler_rejects_uncovered_source_and_does_not_mutate_mesh(self):
        self.require_api()
        mesh = json.loads(json.dumps(FIXTURE['mesh']))
        original = json.loads(json.dumps(mesh))
        sample = create_baseline_sampler(mesh)
        with self.assertRaisesRegex(ValueError, 'outside|covered'): sample(-.01, .2)
        with self.assertRaises((TypeError, ValueError)): sample(.5, .5, 99)
        hole = dict(mesh, triangles=[0, 1, 2])
        with self.assertRaisesRegex(ValueError, 'cover'): create_baseline_sampler(hole)(.8, .8)
        reversed_mesh = dict(mesh, triangles=[0, 2, 1, 2, 1, 3])
        with self.assertRaisesRegex(ValueError, 'orientation'): create_baseline_sampler(reversed_mesh)
        self.assertEqual(mesh, original)

    def test_new_sampler_reflects_same_identity_mesh_replacements_after_warming(self):
        self.require_api()
        mutations = ('vertex-object', 'vertex-array', 'source-coordinates', 'triangle-indices')
        for mutation in mutations:
            with self.subTest(mutation=mutation):
                mesh = json.loads(json.dumps(FIXTURE['mesh']))
                create_baseline_sampler(mesh)(.2, .2)
                if mutation == 'vertex-object': mesh['vertices'][0] = dict(mesh['vertices'][0], u=mesh['vertices'][0]['u'] + .01)
                if mutation == 'vertex-array': mesh['vertices'] = [dict(point, **({'x': point['x'] + .01} if index == 1 else {})) for index, point in enumerate(mesh['vertices'])]
                if mutation == 'source-coordinates':
                    mesh['vertices'][1] = dict(mesh['vertices'][1], s=.99)
                    mesh['vertices'][3] = dict(mesh['vertices'][3], s=.99)
                if mutation == 'triangle-indices': mesh['triangles'] = [2, 1, 3, 0, 1, 2]
                point = (.8, .8) if mutation == 'triangle-indices' else (.2, .2)
                actual = create_baseline_sampler(mesh)(*point)
                expected = create_baseline_sampler(json.loads(json.dumps(mesh)))(*point)
                self.assertEqual(actual, expected)
                if mutation == 'triangle-indices': self.assertEqual(actual['triangleId'], 0)

    def test_unchanged_same_identity_mesh_reuses_its_built_index(self):
        self.require_api()
        from backend.projection_baseline_sampler import _mesh_index
        mesh = json.loads(json.dumps(FIXTURE['mesh']))
        create_baseline_sampler(mesh)(.2, .2)
        first_index = _mesh_index(mesh)
        create_baseline_sampler(mesh)(.8, .8)
        self.assertIs(_mesh_index(mesh), first_index)

    def test_tolerance_containing_triangles_across_vertical_and_horizontal_bin_boundaries(self):
        self.require_api()
        cases = (
            ('vertical', (.5 - 1e-14, .25), (.5 - 1e-10, .25), (.5, .25)),
            ('horizontal', (.25, .5 - 1e-14), (.25, .5 - 1e-10), (.25, .5)),
        )
        for axis, near, outside, exact in cases:
            with self.subTest(axis=axis):
                coordinates = ((.5, 0), (1, 0), (.5, 1), (0, 0)) if axis == 'vertical' else ((0, .5), (1, .5), (.5, 1), (.5, 0))
                triangles = [0, 1, 2, 3, 0, 2] if axis == 'vertical' else [0, 1, 2, 0, 3, 1]
                mesh = {'vertices': [{'s': s, 't': t, 'x': s, 'y': t, 'u': s, 'v': t} for s, t in coordinates], 'triangles': triangles}
                sample = create_baseline_sampler(mesh)
                self.assertEqual(sample(*exact)['triangleId'], 0)
                self.assertEqual(sample(*near)['triangleId'], 0)
                self.assertEqual(sample(*near, 0)['triangleId'], 0)
                self.assertEqual(sample(*outside)['triangleId'], 1)
                with self.assertRaisesRegex(ValueError, 'does not contain'):
                    sample(*outside, 0)

    def test_actual_td_baselines_sample_off_vertex_on_both_outputs(self):
        self.require_api()
        for side in ('left', 'right'):
            with self.subTest(side=side):
                mesh, _, _ = load_trusted_projection_asset(BASELINE_ROOT, side)
                sampled = create_baseline_sampler(mesh)(.123456, .234567)
                self.assertEqual((sampled['s'], sampled['t']), (.123456, .234567))
                self.assertFalse(any(point['s'] == sampled['s'] and point['t'] == sampled['t'] for point in mesh['vertices']))
                self.assertTrue(all(math.isfinite(sampled[key]) for key in ('x', 'y', 'u', 'v')))
                self.assertTrue(sampled['x'] != sampled['s'] or sampled['y'] != sampled['t'])
