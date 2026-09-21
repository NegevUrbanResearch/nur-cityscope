import copy

from django.test import SimpleTestCase

from backend.projection_config_migration import convert_projection_calibration_payload
from backend.projection_config_schema import legacy_projection_config_defaults


class ProjectionConfigMigrationTests(SimpleTestCase):
    def test_mixed_versions_convert_without_changing_preset_metadata(self):
        legacy = legacy_projection_config_defaults()
        presets = [{'id': 'original', 'name': 'Original calibration', 'config': legacy, 'readOnly': True}]
        original = copy.deepcopy(presets)
        working, converted = convert_projection_calibration_payload(legacy, presets, 'original', 7)
        self.assertEqual(working['schemaVersion'], 2)
        self.assertEqual(converted[0]['id'], 'original')
        self.assertEqual(converted[0]['name'], 'Original calibration')
        self.assertEqual(converted[0]['readOnly'], True)
        self.assertEqual(presets, original)

    def test_malformed_input_fails_before_returning_partial_conversion(self):
        legacy = legacy_projection_config_defaults()
        malformed = copy.deepcopy(legacy)
        del malformed['outputs']['right']['crop']['x1']
        presets = [{'id': 'original', 'name': 'Original calibration', 'config': legacy, 'readOnly': True}]
        with self.assertRaises(ValueError):
            convert_projection_calibration_payload(malformed, presets, 'original', 0)
        self.assertEqual(presets[0]['config'], legacy)
