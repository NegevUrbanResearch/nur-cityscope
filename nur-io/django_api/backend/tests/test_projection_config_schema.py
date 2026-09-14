import json
from pathlib import Path
from django.test import SimpleTestCase
from backend.projection_config_schema import validate_projection_config


class ProjectionConfigSchemaTests(SimpleTestCase):
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
