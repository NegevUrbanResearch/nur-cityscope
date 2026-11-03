import copy
import json
from pathlib import Path
from django.test import SimpleTestCase

try:
    from backend.projection_grid_topology import (
        uniform_axis, grid_interval, sample_grid_offset, resample_grid,
        insert_grid_line, remove_grid_line, move_grid_line, uniform_grid,
    )
except ModuleNotFoundError:
    uniform_axis = grid_interval = sample_grid_offset = resample_grid = None
    insert_grid_line = remove_grid_line = move_grid_line = uniform_grid = None

FIXTURE = json.loads((Path(__file__).parent / 'fixtures/projection-grid-parity.json').read_text(encoding='utf-8'))


class ProjectionGridTopologyTests(SimpleTestCase):
    def require_api(self):
        self.assertTrue(callable(uniform_axis), 'projection_grid_topology APIs have not been implemented')

    def test_grid_interval_and_nonuniform_sampling_match_shared_fixture(self):
        self.require_api()
        self.assertEqual(uniform_axis(4), [0, 1 / 3, 2 / 3, 1])
        self.assertEqual(grid_interval(FIXTURE['grid']['columnPositions'], .25), {'index': 1, 'fraction': 0})
        self.assertEqual(grid_interval(FIXTURE['grid']['columnPositions'], 1), {'index': 1, 'fraction': 1})
        self.assertEqual(grid_interval(FIXTURE['grid']['columnPositions'], -5), {'index': 0, 'fraction': 0})
        for sample in FIXTURE['gridSamples']:
            actual = sample_grid_offset(*sample['point'], FIXTURE['grid'])
            for axis in (0, 1): self.assertAlmostEqual(actual[axis], sample['offset'][axis], places=14)
        legacy = {'columns': 2, 'rows': 2, 'offsets': [[0, 0], [1, 0], [0, 1], [1, 1]]}
        self.assertEqual(sample_grid_offset(.5, .5, legacy), [.5, .5])

    def test_nested_insertions_preserve_the_residual_field_off_knots(self):
        self.require_api()
        original = copy.deepcopy(FIXTURE['grid'])
        inserted = insert_grid_line(insert_grid_line(original, 'column', .5), 'row', .3)
        self.assertEqual(inserted['columnPositions'], [0, .25, .5, 1])
        self.assertEqual(inserted['rowPositions'], [0, .3, .6, 1])
        for s, t in ((.1, .1), (.4, .5), (.8, .9)):
            before = sample_grid_offset(s, t, original)
            after = sample_grid_offset(s, t, inserted)
            for axis in (0, 1): self.assertAlmostEqual(after[axis], before[axis], places=14)
        self.assertEqual(original, FIXTURE['grid'])

    def test_remove_move_and_uniform_redistribution_return_independent_grids(self):
        self.require_api()
        original = copy.deepcopy(FIXTURE['grid'])
        removed = remove_grid_line(original, 'column', 1)
        self.assertEqual(removed['columnPositions'], [0, 1])
        self.assertEqual(len(removed['offsets']), 6)
        moved = move_grid_line(original, 'row', 1, .4)
        self.assertEqual(moved['rowPositions'], [0, .4, 1])
        self.assertNotEqual(sample_grid_offset(.4, .5, moved), sample_grid_offset(.4, .5, original))
        redistributed = uniform_grid(original, 4, 5)
        self.assertEqual(redistributed['columns'], 4)
        self.assertEqual(redistributed['rows'], 5)
        self.assertEqual(redistributed['columnPositions'], [0, 1 / 3, 2 / 3, 1])
        self.assertEqual(redistributed['rowPositions'], [0, .25, .5, .75, 1])
        self.assertEqual(len(redistributed['offsets']), 20)
        self.assertEqual(original, FIXTURE['grid'])
        self.assertIsNot(removed['offsets'], original['offsets'])

    def test_invalid_axes_edits_and_bool_or_oversized_counts_are_rejected_safely(self):
        self.require_api()
        for count in (True, 1, 17, 2.5, float('inf'), float('nan'), 10 ** 400):
            with self.subTest(count=repr(count)), self.assertRaises((TypeError, ValueError)):
                uniform_axis(count)
        for axis in ([0, .5, .5, 1], [.1, 1], [0, 1.1], [0, float('nan'), 1]):
            with self.subTest(axis=axis), self.assertRaises((TypeError, ValueError)):
                grid_interval(axis, .2)
        with self.assertRaises((TypeError, ValueError)): grid_interval([0, 1], float('inf'))
        with self.assertRaises((TypeError, ValueError)): sample_grid_offset(True, .5, FIXTURE['grid'])
        with self.assertRaises((TypeError, ValueError)): sample_grid_offset(.5, .5, dict(FIXTURE['grid'], columnPositions=None))
        with self.assertRaises((TypeError, ValueError)): insert_grid_line(FIXTURE['grid'], 'column', .25)
        full = {'columns': 16, 'rows': 3, 'columnPositions': [i / 15 for i in range(16)], 'rowPositions': [0, .5, 1], 'offsets': [[0, 0] for _ in range(48)]}
        with self.assertRaises((TypeError, ValueError)): insert_grid_line(full, 'column', .45)
        with self.assertRaises((TypeError, ValueError)): remove_grid_line(FIXTURE['grid'], 'row', 0)
        minimum = {'columns': 3, 'rows': 2, 'columnPositions': [0, .5, 1], 'rowPositions': [0, 1], 'offsets': [[0, 0] for _ in range(6)]}
        with self.assertRaises((TypeError, ValueError)): remove_grid_line(minimum, 'row', 1)
        with self.assertRaises((TypeError, ValueError)): move_grid_line(FIXTURE['grid'], 'column', 0, .1)
        with self.assertRaises((TypeError, ValueError)): move_grid_line(FIXTURE['grid'], 'column', 1, 1)
        with self.assertRaises((TypeError, ValueError)): uniform_grid(FIXTURE['grid'], True, 4)
