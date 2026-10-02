import json
import copy
from pathlib import Path
from django.test import SimpleTestCase
from backend.projection_config_schema import validate_projection_config, validate_projection_snapshot, legacy_projection_config_defaults
from backend.models import projection_config_defaults
from backend.projection_warp_schema import TD_MIGRATION_PRESET_ID, TD_MIGRATION_PRESET_NAME, migrate_projection_config_to_v2
from backend.projection_warp_schema import migrate_projection_config_to_v3, migrate_projection_config_to_v4, migrate_projection_config_to_v5
from backend.projection_config_schema import default_names_wall, legacy_names_wall, validate_names_wall, validate_names_wall_v3, validate_names_wall_v5


class ProjectionConfigSchemaTests(SimpleTestCase):
    def test_v5_regular_closeness_is_strict_and_v4_remains_historical(self):
        v4 = migrate_projection_config_to_v4(legacy_projection_config_defaults())
        v5 = migrate_projection_config_to_v5(v4)
        self.assertEqual(v5['schemaVersion'], 5)
        self.assertEqual(v5['namesWall']['profiles']['wall'], {**v4['namesWall']['profiles']['wall'], 'inwardShiftPercent': 0})
        self.assertEqual(v5['namesWall']['profiles']['model'], v4['namesWall']['profiles']['model'])
        self.assertEqual(migrate_projection_config_to_v5(v5), v5)
        self.assertEqual(validate_projection_config(v5), {})
        for bad in (-1, 101, 1.5, '50', None, True):
            value = json.loads(json.dumps(v5['namesWall']))
            value['profiles']['wall']['inwardShiftPercent'] = bad
            self.assertIn('namesWall.profiles.wall.inwardShiftPercent', validate_names_wall_v5(value))
        wrong_mode = json.loads(json.dumps(v5['namesWall']))
        wrong_mode['profiles']['model']['inwardShiftPercent'] = 50
        self.assertIn('namesWall.profiles.model.inwardShiftPercent', validate_names_wall_v5(wrong_mode))
        self.assertIn('namesWall.profiles.wall.inwardShiftPercent', validate_names_wall(v5['namesWall']))
    def test_shared_v4_names_wall_fixture(self):
        fixture = json.loads((Path(__file__).parent / 'fixtures' / 'names-wall-v4.json').read_text())
        self.assertEqual(fixture['valid'], default_names_wall())
        for accepted in fixture['accepted']:
            value = json.loads(json.dumps(fixture['valid']))
            target = value
            parts = accepted['path'].split('.')
            for part in parts[:-1]: target = target[part]
            target[parts[-1]] = accepted['value']
            self.assertEqual(validate_names_wall(value), {})
        for rejected in fixture['rejected']:
            value = json.loads(json.dumps(fixture['valid']))
            target = value
            parts = rejected['path'].split('.')
            for part in parts[:-1]: target = target[part]
            target[parts[-1]] = rejected['value']
            self.assertIn(rejected['error'], validate_names_wall(value))

    def test_shared_v3_names_wall_fixture(self):
        fixture = json.loads((Path(__file__).parent / 'fixtures' / 'names-wall-v3.json').read_text())
        self.assertEqual(fixture['valid'], legacy_names_wall())
        for case in fixture['cases']:
            with self.subTest(path=case['path']):
                value = json.loads(json.dumps(fixture['valid']))
                parts = case['path'].split('.')
                target = value
                for part in parts[:-1]: target = target[part]
                target[parts[-1]] = case['value']
                self.assertIn(case['error'], validate_names_wall_v3(value))
    def test_v4_defaults_and_profile_validation(self):
        defaults = migrate_projection_config_to_v4(legacy_projection_config_defaults())
        self.assertEqual(defaults['schemaVersion'], 4)
        self.assertEqual(defaults['namesWall'], default_names_wall())
        self.assertEqual(validate_projection_config(defaults), {})
        wall = default_names_wall()
        wall['profiles']['wall']['requestedFontPx'] = True
        wall['profiles']['model']['requestedFontPx'] = 0
        wall['profiles']['wall']['spacingPx'] = 33
        wall['profiles']['model']['edgeInsetPx'] = -1
        wall['innerEdgeInsetPx']['right'] = 961
        wall['profiles']['wall']['unknown'] = 1
        errors = validate_names_wall(wall, 'namesWall', {})
        for path in ('namesWall.profiles.wall.requestedFontPx', 'namesWall.profiles.model.requestedFontPx', 'namesWall.profiles.wall.spacingPx', 'namesWall.profiles.model.edgeInsetPx', 'namesWall.innerEdgeInsetPx.right', 'namesWall.profiles.wall.unknown'):
            self.assertIn(path, errors)

    def test_v3_rejects_modified_original_and_accepts_reserved_td_baseline(self):
        defaults = projection_config_defaults()
        snapshot = {'revision': 3, 'config': defaults, 'presets': [
            {'id': 'original', 'name': 'Original calibration', 'config': defaults, 'readOnly': True},
            {'id': TD_MIGRATION_PRESET_ID, 'name': TD_MIGRATION_PRESET_NAME, 'config': migrate_projection_config_to_v4(migrate_projection_config_to_v2(legacy_projection_config_defaults())), 'readOnly': True},
        ], 'selectedPresetId': TD_MIGRATION_PRESET_ID}
        self.assertEqual(validate_projection_snapshot(snapshot), {})
        snapshot['presets'][0]['config'] = json.loads(json.dumps(defaults))
        snapshot['presets'][0]['config']['namesWall']['profiles']['wall']['spacingPx'] = 3
        self.assertIn('presets[0]', validate_projection_snapshot(snapshot))
    def test_v6_names_wall_rotation_is_independent_of_geometry(self):
        from backend.projection_config_schema import validate_names_wall_v6
        from backend.projection_warp_schema import migrate_projection_config_to_v6

        v5 = migrate_projection_config_to_v5(legacy_projection_config_defaults())
        converted = migrate_projection_config_to_v6(v5, 395)
        self.assertEqual(converted['schemaVersion'], 6)
        self.assertEqual(converted['namesWall']['rotateDeg'], 35)
        self.assertEqual(converted['outputs'], v5['outputs'])
        self.assertEqual(validate_names_wall_v6(converted['namesWall']), {})
        self.assertEqual(validate_projection_config(converted), {})
        passthrough = migrate_projection_config_to_v6(converted, -20)
        self.assertEqual(passthrough['namesWall']['rotateDeg'], 35)

    def test_v6_outline_widths_are_per_profile_and_old_configs_remain_valid(self):
        from backend.projection_config_schema import validate_names_wall_v6
        from backend.projection_warp_schema import migrate_projection_config_to_v6

        converted = migrate_projection_config_to_v6(migrate_projection_config_to_v5(legacy_projection_config_defaults()), 35)
        self.assertEqual(converted['namesWall']['profiles']['wall']['strokeWidthPx'], 3)
        self.assertEqual(converted['namesWall']['profiles']['model']['strokeWidthPx'], 2)
        old_v6 = copy.deepcopy(converted)
        del old_v6['namesWall']['profiles']['wall']['strokeWidthPx']
        del old_v6['namesWall']['profiles']['model']['strokeWidthPx']
        self.assertEqual(validate_projection_config(old_v6), {})
        normalized = migrate_projection_config_to_v6(old_v6, 90)
        self.assertEqual(normalized['namesWall']['profiles']['wall']['strokeWidthPx'], 3)
        self.assertEqual(normalized['namesWall']['profiles']['model']['strokeWidthPx'], 2)
        for mode, width in (('wall', 0), ('model', 7)):
            invalid = copy.deepcopy(converted)
            invalid['namesWall']['profiles'][mode]['strokeWidthPx'] = width
            self.assertIn(f'namesWall.profiles.{mode}.strokeWidthPx', validate_names_wall_v6(invalid['namesWall']))
        interim = copy.deepcopy(converted)
        del interim['namesWall']['profiles']['wall']['strokeWidthPx']
        del interim['namesWall']['profiles']['model']['strokeWidthPx']
        interim['namesWall']['strokeWidthPx'] = 5
        migrated = migrate_projection_config_to_v6(interim, 35)
        self.assertEqual(migrated['namesWall']['profiles']['wall']['strokeWidthPx'], 5)
        self.assertEqual(migrated['namesWall']['profiles']['model']['strokeWidthPx'], 5)
        self.assertNotIn('strokeWidthPx', migrated['namesWall'])
        explicit_width = copy.deepcopy(interim)
        explicit_width['namesWall']['profiles']['wall']['strokeWidthPx'] = 4
        migrated_explicit = migrate_projection_config_to_v6(explicit_width, 35)
        self.assertEqual(migrated_explicit['namesWall']['profiles']['wall']['strokeWidthPx'], 4)
        self.assertEqual(migrated_explicit['namesWall']['profiles']['model']['strokeWidthPx'], 5)
        global_two = copy.deepcopy(converted)
        del global_two['namesWall']['profiles']['wall']['strokeWidthPx']
        del global_two['namesWall']['profiles']['model']['strokeWidthPx']
        global_two['namesWall']['strokeWidthPx'] = 2
        migrated_two = migrate_projection_config_to_v6(global_two, 35)
        self.assertEqual(migrated_two['namesWall']['profiles']['wall']['strokeWidthPx'], 2)
        self.assertEqual(migrated_two['namesWall']['profiles']['model']['strokeWidthPx'], 2)
        extra_profile = copy.deepcopy(converted['namesWall'])
        extra_profile['profiles']['extra'] = {}
        self.assertIn('namesWall.profiles.extra', validate_names_wall_v6(extra_profile))
        invalid_config = copy.deepcopy(converted)
        invalid_config['namesWall']['profiles']['extra'] = {}
        self.assertIn('namesWall.profiles.extra', validate_projection_config(invalid_config))

    def test_interim_global_width_makes_original_preset_noncanonical(self):
        from backend.projection_warp_schema import migrate_projection_config_to_v6
        defaults = projection_config_defaults()
        snapshot = {'revision': 1, 'config': defaults, 'presets': [
            {'id': 'original', 'name': 'Original calibration', 'config': copy.deepcopy(defaults), 'readOnly': True},
        ], 'selectedPresetId': 'original'}
        snapshot['presets'][0]['config']['namesWall']['strokeWidthPx'] = 5
        del snapshot['presets'][0]['config']['namesWall']['profiles']['wall']['strokeWidthPx']
        del snapshot['presets'][0]['config']['namesWall']['profiles']['model']['strokeWidthPx']
        self.assertIn('presets[0]', validate_projection_snapshot(snapshot))
        self.assertEqual(migrate_projection_config_to_v6(snapshot['presets'][0]['config'], 35)['namesWall']['profiles']['wall']['strokeWidthPx'], 5)

    def test_old_v6_original_preset_is_compared_after_outline_defaulting(self):
        snapshot = {'revision': 3, 'config': projection_config_defaults(), 'presets': [
            {'id': 'original', 'name': 'Original calibration', 'config': projection_config_defaults(), 'readOnly': True},
            {'id': TD_MIGRATION_PRESET_ID, 'name': TD_MIGRATION_PRESET_NAME,
             'config': migrate_projection_config_to_v4(migrate_projection_config_to_v2(legacy_projection_config_defaults())), 'readOnly': True},
        ], 'selectedPresetId': 'original'}
        for target in (snapshot['config'], snapshot['presets'][0]['config']):
            del target['namesWall']['profiles']['wall']['strokeWidthPx']
            del target['namesWall']['profiles']['model']['strokeWidthPx']
        self.assertEqual(validate_projection_snapshot(snapshot), {})
        snapshot['presets'][0]['config']['namesWall']['profiles']['wall']['strokeWidthPx'] = 4
        self.assertIn('presets[0]', validate_projection_snapshot(snapshot))

    def test_defaults_are_v6_identity_warp_without_changing_framing(self):
        defaults = projection_config_defaults()
        self.assertEqual(defaults['schemaVersion'], 6)
        self.assertEqual(defaults['namesWall']['rotateDeg'], 35)
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
