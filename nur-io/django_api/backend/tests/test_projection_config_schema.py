import json
from pathlib import Path
from django.test import SimpleTestCase
from backend.projection_config_schema import validate_projection_config, validate_projection_snapshot, legacy_projection_config_defaults
from backend.models import projection_config_defaults
from backend.projection_warp_schema import TD_MIGRATION_PRESET_ID, TD_MIGRATION_PRESET_NAME, migrate_projection_config_to_v2


class ProjectionConfigSchemaTests(SimpleTestCase):
    def test_defaults_are_v2_identity_warp_without_changing_framing(self):
        defaults = projection_config_defaults()
        self.assertEqual(defaults['schemaVersion'], 2)
        self.assertEqual(defaults['pre'], {'scale': 1.41, 'rotateDeg': -50, 'tx': 0.01, 'ty': 0})
        for side, columns in (('left', 7), ('right', 8)):
            branch = defaults['outputs'][side]
            self.assertEqual(branch['presentationEffect'], {'enabled': False, 'mode': 'passthrough'})
            self.assertEqual(branch['warp']['grid']['columns'], columns)
            self.assertEqual(branch['warp']['grid']['rows'], 7)
            self.assertTrue(all(point == [0, 0] for point in branch['warp']['grid']['offsets']))
        self.assertEqual(validate_projection_config(defaults), {})

    def test_canonical_fixture_validates(self):
        fixture = json.loads((Path(__file__).parent / 'fixtures' / 'projection-config-v1.json').read_text())
        self.assertEqual(validate_projection_config(fixture['valid']), {})
        for case in fixture['cases']:
            self.assertEqual(set(validate_projection_config(case['config'])), set(case['errors']))

    def test_rejects_boolean_and_non_finite_values(self):
        fixture = json.loads((Path(__file__).parent / 'fixtures' / 'projection-config-v1.json').read_text())
        fixture = fixture['valid']
        fixture['pre']['scale'] = True
        self.assertIn('pre.scale', validate_projection_config(fixture))
        fixture['pre']['scale'] = float('nan')
        self.assertIn('pre.scale', validate_projection_config(fixture))
        fixture['pre']['scale'] = 10 ** 400
        self.assertIn('pre.scale', validate_projection_config(fixture))

    def test_rejects_structural_and_range_errors(self):
        fixture = json.loads((Path(__file__).parent / 'fixtures' / 'projection-config-v1.json').read_text())['valid']
        del fixture['outputs']['left']['crop']['y1']
        fixture['outputs']['right']['crop']['extra'] = 1
        fixture['pre']['rotateDeg'] = 181
        errors = validate_projection_config(fixture)
        self.assertIn('outputs.left.crop.y1', errors)
        self.assertIn('outputs.right.crop.extra', errors)
        self.assertIn('pre.rotateDeg', errors)

    def test_accepts_nonzero_crop_extent_of_one_percent(self):
        fixture = json.loads((Path(__file__).parent / 'fixtures' / 'projection-config-v1.json').read_text())['valid']
        fixture['outputs']['left']['crop']['x0'] = .57
        fixture['outputs']['left']['crop']['x1'] = .58
        self.assertEqual(validate_projection_config(fixture), {})

    def test_huge_invalid_crop_value_returns_field_error(self):
        fixture = json.loads((Path(__file__).parent / 'fixtures' / 'projection-config-v1.json').read_text())['valid']
        fixture['outputs']['left']['crop']['x0'] = 10 ** 400
        self.assertIn('outputs.left.crop.x0', validate_projection_config(fixture))

    def test_snapshot_accepts_legacy_original_and_reserved_baseline(self):
        legacy = legacy_projection_config_defaults()
        snapshot = {
            'revision': 2,
            'config': migrate_projection_config_to_v2(legacy),
            'presets': [
                {'id': 'original', 'name': 'Original calibration', 'config': legacy, 'readOnly': True},
                {'id': TD_MIGRATION_PRESET_ID, 'name': TD_MIGRATION_PRESET_NAME, 'config': migrate_projection_config_to_v2(legacy), 'readOnly': True},
            ],
            'selectedPresetId': 'original',
        }
        self.assertEqual(validate_projection_snapshot(snapshot), {})

    def test_snapshot_rejects_arbitrary_read_only_uuid(self):
        legacy = legacy_projection_config_defaults()
        snapshot = {
            'revision': 0, 'config': legacy,
            'presets': [
                {'id': 'original', 'name': 'Original calibration', 'config': legacy, 'readOnly': True},
                {'id': '6b6f2e4d-2c67-4df2-9d7e-1a7bb4ef3b2d', 'name': 'Imported', 'config': legacy, 'readOnly': True},
            ],
            'selectedPresetId': 'original',
        }
        self.assertIn('presets[1]', validate_projection_snapshot(snapshot))
