import hashlib
import json
from pathlib import Path
from tempfile import TemporaryDirectory

from django.core.management import call_command, CommandError
from django.test import TestCase

from backend.models import OTEFProjectionCalibration, Table
from backend.projection_warp_geometry import create_identity_projection_mesh
from backend.projection_warp_schema import TD_MIGRATION_PRESET_ID


class ProjectionBaselineInstallerTests(TestCase):
    def setUp(self):
        self.table = Table.objects.create(name='otef')

    def asset_root(self):
        temp = TemporaryDirectory()
        self.addCleanup(temp.cleanup)
        root = Path(temp.name) / 'td-baselines'
        root.mkdir()
        framing = {
            'schemaVersion': 1,
            'pre': {'scale': 1.25, 'rotateDeg': -50, 'tx': 0.01, 'ty': 0},
            'outputs': {
                side: {'crop': crop, 'post': {'scale': 2, 'tx': 0, 'ty': -0.049}}
                for side, crop in {
                    'left': {'x0': 0, 'x1': 0.6, 'y0': 0, 'y1': 1},
                    'right': {'x0': 0.4, 'x1': 1, 'y0': 0, 'y1': 1},
                }.items()
            },
        }
        framing_bytes = json.dumps(framing, separators=(',', ':')).encode()
        (root.parent / 'td-source-config.json').write_bytes(framing_bytes)
        assets = {}
        for side in ('left', 'right'):
            payload = json.dumps(create_identity_projection_mesh(side), separators=(',', ':')).encode()
            (root / f'{side}.json').write_bytes(payload)
            assets[side] = {
                'assetId': f'test-{side}', 'path': f'{side}.json',
                'sha256': hashlib.sha256(payload).hexdigest(),
                'logicalGrid': {'columns': 7 if side == 'left' else 8, 'rows': 7},
            }
        manifest = {'schemaVersion': 1, 'width': 1920, 'height': 1080, 'assets': assets,
                    'framing': {'path': '../td-source-config.json', 'sha256': hashlib.sha256(framing_bytes).hexdigest()}}
        (root / 'manifest.json').write_text(json.dumps(manifest), encoding='utf-8')
        return root

    def test_install_is_idempotent_and_preserves_working_state(self):
        root = self.asset_root()
        row = OTEFProjectionCalibration.objects.create(table=self.table)
        row.revision = 4
        row.selected_preset_id = 'original'
        row.save(update_fields=['revision', 'selected_preset_id'])
        working = row.working_config
        call_command('install_otef_td_baseline', table='otef', asset_root=str(root))
        row.refresh_from_db()
        self.assertEqual(row.revision, 4)
        self.assertEqual(row.selected_preset_id, 'original')
        self.assertEqual(row.working_config, working)
        installed = next(p for p in row.presets if p['id'] == TD_MIGRATION_PRESET_ID)
        call_command('install_otef_td_baseline', table='otef', asset_root=str(root))
        row.refresh_from_db()
        self.assertEqual(next(p for p in row.presets if p['id'] == TD_MIGRATION_PRESET_ID), installed)

    def test_name_collision_does_not_overwrite(self):
        root = self.asset_root()
        row = OTEFProjectionCalibration.objects.create(table=self.table)
        row.presets.append({'id': '9d9e4c16-42e3-4f1b-a116-9c9a8e74f2b3', 'name': 'TD migration baseline', 'config': row.working_config, 'readOnly': False})
        row.save(update_fields=['presets'])
        with self.assertRaises(CommandError):
            call_command('install_otef_td_baseline', table='otef', asset_root=str(root))
        row.refresh_from_db()
        self.assertEqual(len(row.presets), 2)

    def test_wrong_mesh_grid_with_matching_hash_is_rejected_without_row_change(self):
        root = self.asset_root()
        row = OTEFProjectionCalibration.objects.create(table=self.table)
        row.revision = 4
        row.selected_preset_id = 'original'
        row.save(update_fields=['revision', 'selected_preset_id'])
        working = row.working_config
        presets = row.presets

        mesh = json.loads((root / 'left.json').read_text(encoding='utf-8'))
        mesh['logicalGrid'] = {'columns': 8, 'rows': 7}
        payload = json.dumps(mesh, separators=(',', ':')).encode()
        (root / 'left.json').write_bytes(payload)
        manifest = json.loads((root / 'manifest.json').read_text(encoding='utf-8'))
        manifest['assets']['left']['sha256'] = hashlib.sha256(payload).hexdigest()
        (root / 'manifest.json').write_text(json.dumps(manifest), encoding='utf-8')

        with self.assertRaisesRegex(ValueError, 'logical grid mismatch'):
            call_command('install_otef_td_baseline', table='otef', asset_root=str(root))

        row.refresh_from_db()
        self.assertEqual(row.revision, 4)
        self.assertEqual(row.selected_preset_id, 'original')
        self.assertEqual(row.working_config, working)
        self.assertEqual(row.presets, presets)
