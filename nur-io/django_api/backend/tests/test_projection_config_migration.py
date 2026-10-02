import copy
import importlib

from django.apps import apps
from django.db import connection, transaction
from django.test import SimpleTestCase, TestCase

from backend.projection_config_migration import convert_projection_calibration_payload, convert_projection_calibration_payload_to_v3, convert_projection_calibration_payload_to_v4, convert_projection_calibration_payload_to_v5, convert_projection_calibration_payload_to_v7
from backend.projection_config_schema import legacy_projection_config_defaults
from backend.projection_warp_schema import migrate_projection_config_to_v2, migrate_projection_config_to_v3, migrate_projection_config_to_v7
from backend.models import OTEFProjectionCalibration, Table


class ProjectionConfigMigrationTests(SimpleTestCase):
    def test_v7_conversion_preserves_row_envelope_and_axes(self):
        legacy = legacy_projection_config_defaults()
        v7 = migrate_projection_config_to_v7(legacy)
        selected = '00000000-0000-4000-8000-000000000001'
        presets = [
            {'id': 'original', 'name': 'Original calibration', 'config': legacy, 'readOnly': True},
            {'id': selected, 'name': 'Desk', 'config': v7, 'readOnly': False},
        ]
        before = copy.deepcopy((legacy, presets))
        working, converted = convert_projection_calibration_payload_to_v7(legacy, presets, selected, 19)
        self.assertEqual((legacy, presets), before)
        self.assertEqual(working['schemaVersion'], 7)
        self.assertEqual([preset['config']['schemaVersion'] for preset in converted], [7, 7])
        self.assertEqual(working['outputs']['left']['warp']['grid']['columnPositions'], [i / 6 for i in range(7)])
        self.assertEqual([(p['id'], p['name'], p['readOnly']) for p in converted], [(p['id'], p['name'], p['readOnly']) for p in presets])
        self.assertEqual(convert_projection_calibration_payload_to_v7(working, converted, selected, 19), (working, converted))

    def test_historical_wrappers_preserve_validated_future_config_without_downcasting(self):
        v7 = migrate_projection_config_to_v7(legacy_projection_config_defaults())
        working, presets = convert_projection_calibration_payload_to_v4(v7, [
            {'id': 'original', 'name': 'Original calibration', 'config': v7, 'readOnly': True},
        ], 'original', 2)
        self.assertEqual(working, v7)
        self.assertEqual(presets[0]['config'], v7)

    def test_0030_does_not_guess_a_heading(self):
        import importlib
        migration = importlib.import_module('backend.migrations.0030_otefviewportstate_settlement_names').Migration
        self.assertFalse(any(operation.__class__.__name__ == 'RunPython' for operation in migration.operations))
        self.assertEqual(migration.dependencies, [('backend', '0029_otefviewportstate_clock_legend_layout_revisions')])

    def test_v5_conversion_preserves_envelope_and_historical_v4(self):
        legacy = legacy_projection_config_defaults()
        original = {'id': 'original', 'name': 'Original calibration', 'config': legacy, 'readOnly': True}
        writable = {'id': '00000000-0000-4000-8000-000000000001', 'name': 'Desk',
                    'config': migrate_projection_config_to_v2(legacy), 'readOnly': False}
        working, presets = convert_projection_calibration_payload_to_v4(legacy, [original, writable], writable['id'], 17)
        before = copy.deepcopy((working, presets))
        converted, upgraded = convert_projection_calibration_payload_to_v5(working, presets, writable['id'], 17)
        self.assertEqual((working, presets), before)
        self.assertEqual(converted['schemaVersion'], 5)
        self.assertEqual(converted['pre'], working['pre'])
        self.assertEqual(converted['outputs'], working['outputs'])
        self.assertEqual(converted['namesWall']['profiles']['wall']['inwardShiftPercent'], 0)
        self.assertEqual([(p['id'], p['name'], p['readOnly']) for p in upgraded],
                         [(p['id'], p['name'], p['readOnly']) for p in presets])
        self.assertEqual(convert_projection_calibration_payload_to_v5(converted, upgraded, writable['id'], 17), (converted, upgraded))
        self.assertEqual(convert_projection_calibration_payload_to_v4(working, presets, writable['id'], 17), before)

    def test_v4_conversion_preserves_envelope_and_reports_old_gap(self):
        legacy = legacy_projection_config_defaults()
        v3 = convert_projection_calibration_payload_to_v3(legacy, [
            {'id': 'original', 'name': 'Original calibration', 'config': legacy, 'readOnly': True},
            {'id': '00000000-0000-4000-8000-000000000001', 'name': 'Desk', 'config': migrate_projection_config_to_v2(legacy), 'readOnly': False},
        ], 'original', 17)
        working, presets = v3
        working['namesWall']['profiles']['wall']['seamGapPx'] = 7
        before = copy.deepcopy(v3)
        warnings = []
        converted, upgraded = convert_projection_calibration_payload_to_v4(working, presets, 'original', 17, warnings)
        self.assertEqual(v3, before)
        self.assertEqual(converted['schemaVersion'], 4)
        self.assertEqual(converted['pre'], working['pre'])
        self.assertEqual(converted['outputs'], working['outputs'])
        self.assertEqual(converted['namesWall']['innerEdgeInsetPx'], {'left': 0, 'right': 0})
        self.assertNotIn('minimumFontPx', converted['namesWall']['profiles']['wall'])
        self.assertEqual([p['id'] for p in upgraded], [p['id'] for p in presets])
        self.assertEqual(len(warnings), 1)

    def test_v3_converter_preserves_pre_output_values_and_preset_metadata(self):
        legacy = legacy_projection_config_defaults()
        v2 = migrate_projection_config_to_v2(legacy)
        v2['pre']['tx'] = .37
        v2['outputs']['left']['warp']['grid']['offsets'][0] = [.01, -.02]
        presets = [
            {'id': 'original', 'name': 'Original calibration', 'config': legacy, 'readOnly': True},
            {'id': '6b6f2e4d-2c67-4df2-9d7e-1a7bb4ef3b2c', 'name': 'TD migration baseline', 'config': v2, 'readOnly': True},
            {'id': '00000000-0000-4000-8000-000000000001', 'name': 'Desk', 'config': v2, 'readOnly': False},
        ]
        original = copy.deepcopy((v2, presets))
        working, upgraded = convert_projection_calibration_payload_to_v3(v2, presets, presets[-1]['id'], 17)
        self.assertEqual((v2, presets), original)
        self.assertEqual(working['schemaVersion'], 3)
        self.assertEqual(working['pre'], v2['pre'])
        self.assertEqual(working['outputs'], v2['outputs'])
        self.assertEqual([p['id'] for p in upgraded], [p['id'] for p in presets])
        self.assertEqual([(p['name'], p['readOnly']) for p in upgraded], [(p['name'], p['readOnly']) for p in presets])
        self.assertEqual(convert_projection_calibration_payload_to_v3(working, upgraded, presets[-1]['id'], 17), (working, upgraded))

    def test_v3_converter_rejects_invalid_preset_without_partial_conversion(self):
        legacy = legacy_projection_config_defaults()
        presets = [{'id': 'original', 'name': 'Original calibration', 'config': legacy, 'readOnly': True},
                   {'id': '00000000-0000-4000-8000-000000000001', 'name': 'Desk', 'config': {}, 'readOnly': False}]
        before = copy.deepcopy(presets)
        with self.assertRaises(ValueError):
            convert_projection_calibration_payload_to_v3(legacy, presets, 'original', 2)
        self.assertEqual(presets, before)
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


class ProjectionConfigInstalledMigrationTests(TestCase):
    def setUp(self):
        self.migration = importlib.import_module('backend.migrations.0025_projection_config_v3')
        self.assertEqual(self.migration.Migration.dependencies, [('backend', '0024_projection_config_v2')])

    def run_migration(self):
        schema_editor = type('SchemaEditor', (), {'connection': connection})()
        self.migration.migrate_projection_configs(apps, schema_editor)

    def make_row(self, table_name, config):
        table = Table.objects.create(name=table_name)
        return OTEFProjectionCalibration.objects.create(
            table=table, working_config=config, revision=17,
            presets=[{'id': 'original', 'name': 'Original calibration', 'config': migrate_projection_config_to_v2(legacy_projection_config_defaults()), 'readOnly': True},
                     {'id': '00000000-0000-4000-8000-000000000001', 'name': 'Desk', 'config': config, 'readOnly': False}],
            selected_preset_id='00000000-0000-4000-8000-000000000001',
        )

    def test_installed_v2_row_upgrades_without_touching_revision_or_selection(self):
        config = migrate_projection_config_to_v2(legacy_projection_config_defaults())
        config['outputs']['left']['warp']['grid']['offsets'][0] = [.01, -.02]
        row = self.make_row('otef', config)
        old_presets = copy.deepcopy(row.presets)
        with transaction.atomic(): self.run_migration()
        row.refresh_from_db()
        self.assertEqual(row.revision, 17)
        self.assertEqual(row.selected_preset_id, old_presets[1]['id'])
        self.assertEqual(row.working_config['schemaVersion'], 3)
        self.assertEqual(row.working_config['pre'], config['pre'])
        self.assertEqual(row.working_config['outputs'], config['outputs'])
        self.assertEqual([(p['id'], p['name'], p['readOnly']) for p in row.presets], [(p['id'], p['name'], p['readOnly']) for p in old_presets])
        first = copy.deepcopy((row.working_config, row.presets))
        with transaction.atomic(): self.run_migration()
        row.refresh_from_db()
        self.assertEqual((row.working_config, row.presets), first)

    def test_invalid_later_row_prevents_any_update(self):
        config = migrate_projection_config_to_v2(legacy_projection_config_defaults())
        valid = self.make_row('first', config)
        bad = self.make_row('second', config)
        bad.presets[1]['config']['pre']['scale'] = True
        bad.save(update_fields=['presets'])
        with self.assertRaises(ValueError):
            with transaction.atomic(): self.run_migration()
        valid.refresh_from_db(); bad.refresh_from_db()
        self.assertEqual(valid.working_config['schemaVersion'], 2)
        self.assertEqual(bad.working_config['schemaVersion'], 2)


class ProjectionConfigV4InstalledMigrationTests(TestCase):
    def test_installed_v3_row_upgrades_every_config_without_changing_envelope(self):
        migration = importlib.import_module('backend.migrations.0026_projection_config_v4')
        self.assertEqual(migration.Migration.dependencies, [('backend', '0025_projection_config_v3')])
        original = migrate_projection_config_to_v3(legacy_projection_config_defaults())
        working = copy.deepcopy(original)
        working['pre']['tx'] = .37
        working['namesWall']['profiles']['wall']['seamGapPx'] = 5
        table = Table.objects.create(name='v4-row')
        selected = '00000000-0000-4000-8000-000000000001'
        presets = [
            {'id': 'original', 'name': 'Original calibration', 'config': original, 'readOnly': True},
            {'id': selected, 'name': 'Desk', 'config': working, 'readOnly': False},
        ]
        row = OTEFProjectionCalibration.objects.create(
            table=table, working_config=working, revision=17, presets=presets, selected_preset_id=selected,
        )
        schema_editor = type('SchemaEditor', (), {'connection': connection})()
        with self.assertLogs('backend.migrations.0026_projection_config_v4', level='WARNING') as notices:
            with transaction.atomic(): migration.migrate_projection_configs(apps, schema_editor)
        self.assertTrue(any('working_config' in notice and 'seam gap' in notice for notice in notices.output))
        row.refresh_from_db()
        self.assertEqual(row.revision, 17)
        self.assertEqual(row.selected_preset_id, selected)
        self.assertEqual(row.working_config['schemaVersion'], 4)
        self.assertEqual(row.working_config['pre'], working['pre'])
        self.assertEqual(row.working_config['outputs'], working['outputs'])
        self.assertEqual(row.working_config['namesWall']['innerEdgeInsetPx'], {'left': 0, 'right': 0})
        self.assertNotIn('seamGapPx', row.working_config['namesWall']['profiles']['wall'])
        self.assertEqual([preset['config']['schemaVersion'] for preset in row.presets], [4, 4])
        self.assertEqual([(preset['id'], preset['name'], preset['readOnly']) for preset in row.presets],
                         [(preset['id'], preset['name'], preset['readOnly']) for preset in presets])


class ProjectionConfigV5InstalledMigrationTests(TestCase):
    def test_v5_migration_converts_working_and_presets_without_revising_calibration(self):
        migration = importlib.import_module('backend.migrations.0027_projection_config_v5')
        self.assertEqual(migration.Migration.dependencies, [('backend', '0026_projection_config_v4')])
        v4 = convert_projection_calibration_payload_to_v4(legacy_projection_config_defaults(), [
            {'id': 'original', 'name': 'Original calibration', 'config': legacy_projection_config_defaults(), 'readOnly': True},
            {'id': '00000000-0000-4000-8000-000000000001', 'name': 'Desk', 'config': migrate_projection_config_to_v2(legacy_projection_config_defaults()), 'readOnly': False},
        ], '00000000-0000-4000-8000-000000000001', 17)
        working, presets = copy.deepcopy(v4)
        working['pre']['tx'] = .37
        row = OTEFProjectionCalibration.objects.create(table=Table.objects.create(name='v5-row'),
            working_config=working, presets=presets, selected_preset_id=presets[1]['id'], revision=17)
        schema_editor = type('SchemaEditor', (), {'connection': connection})()
        with transaction.atomic(): migration.migrate_projection_configs(apps, schema_editor)
        row.refresh_from_db()
        self.assertEqual((row.revision, row.selected_preset_id), (17, presets[1]['id']))
        self.assertEqual(row.working_config['pre'], working['pre'])
        self.assertEqual(row.working_config['outputs'], working['outputs'])
        self.assertEqual(row.working_config['namesWall']['profiles']['wall']['inwardShiftPercent'], 0)
        self.assertEqual([preset['config']['schemaVersion'] for preset in row.presets], [5, 5])
        self.assertEqual([(p['id'], p['name'], p['readOnly']) for p in row.presets],
                         [(p['id'], p['name'], p['readOnly']) for p in presets])
        first = copy.deepcopy((row.working_config, row.presets))
        with transaction.atomic(): migration.migrate_projection_configs(apps, schema_editor)
        row.refresh_from_db()
        self.assertEqual((row.working_config, row.presets), first)


class ProjectionConfigV7InstalledMigrationTests(TestCase):
    def test_v7_migration_preflights_and_converts_all_configs_without_envelope_changes(self):
        migration = importlib.import_module('backend.migrations.0031_projection_config_v7')
        self.assertEqual(migration.Migration.dependencies, [('backend', '0030_otefviewportstate_settlement_names')])
        original = legacy_projection_config_defaults()
        selected = '00000000-0000-4000-8000-000000000001'
        presets = [
            {'id': 'original', 'name': 'Original calibration', 'config': original, 'readOnly': True},
            {'id': selected, 'name': 'Desk', 'config': migrate_projection_config_to_v2(original), 'readOnly': False},
        ]
        row = OTEFProjectionCalibration.objects.create(table=Table.objects.create(name='v7-row'),
            working_config=original, presets=copy.deepcopy(presets), selected_preset_id=selected, revision=19)
        schema_editor = type('SchemaEditor', (), {'connection': connection})()
        with transaction.atomic(): migration.upgrade_projection_config_rows(apps, schema_editor)
        row.refresh_from_db()
        self.assertEqual((row.revision, row.selected_preset_id), (19, selected))
        self.assertEqual([item['config']['schemaVersion'] for item in row.presets], [7, 7])
        self.assertEqual([(item['id'], item['name'], item['readOnly']) for item in row.presets], [(item['id'], item['name'], item['readOnly']) for item in presets])
        self.assertEqual(row.working_config['outputs']['right']['warp']['grid']['columnPositions'], [i / 7 for i in range(8)])
        first = copy.deepcopy((row.working_config, row.presets))
        with transaction.atomic(): migration.upgrade_projection_config_rows(apps, schema_editor)
        row.refresh_from_db()
        self.assertEqual((row.working_config, row.presets), first)

    def test_invalid_later_preset_preflight_preserves_earlier_row_and_invalid_row(self):
        migration = importlib.import_module('backend.migrations.0031_projection_config_v7')
        legacy = legacy_projection_config_defaults()
        first = OTEFProjectionCalibration.objects.create(table=Table.objects.create(name='v7-preflight-valid'),
            working_config=copy.deepcopy(legacy), presets=[{'id': 'original', 'name': 'Original calibration', 'config': copy.deepcopy(legacy), 'readOnly': True}], revision=4)
        bad = copy.deepcopy(legacy); bad['pre']['scale'] = True
        second = OTEFProjectionCalibration.objects.create(table=Table.objects.create(name='v7-preflight-invalid'),
            working_config=copy.deepcopy(legacy), presets=[{'id': 'original', 'name': 'Original calibration', 'config': copy.deepcopy(legacy), 'readOnly': True},
                {'id': 'bad', 'name': 'Bad later preset', 'config': bad, 'readOnly': False}], revision=9)
        before_first = (copy.deepcopy(first.working_config), copy.deepcopy(first.presets), first.revision, first.selected_preset_id)
        before_second = (copy.deepcopy(second.working_config), copy.deepcopy(second.presets), second.revision, second.selected_preset_id)
        schema_editor = type('SchemaEditor', (), {'connection': connection})()
        with self.assertRaises(ValueError):
            with transaction.atomic(): migration.upgrade_projection_config_rows(apps, schema_editor)
        first.refresh_from_db(); second.refresh_from_db()
        self.assertEqual((first.working_config, first.presets, first.revision, first.selected_preset_id), before_first)
        self.assertEqual((second.working_config, second.presets, second.revision, second.selected_preset_id), before_second)
