import copy
import hashlib
import json
import tempfile
import uuid
from concurrent.futures import ThreadPoolExecutor
from threading import Barrier
from pathlib import Path
from unittest.mock import patch

from django.db import connection, connections, transaction
from django.test import Client, TestCase, TransactionTestCase

from backend.models import OTEFProjectionCalibration, Table
from backend.projection_config_service import get_projection_state, mutate_projection_state, ProjectionConflict
from backend.projection_config_schema import legacy_projection_config_defaults
from backend.projection_warp_assets import read_projection_baseline_manifest
from backend.projection_warp_schema import migrate_projection_config_to_v2, migrate_projection_config_to_v5, migrate_projection_config_to_v6, migrate_projection_config_to_v7


class ProjectionConfigApiTests(TestCase):
    def test_rename_preserves_working_config_and_saved_checkpoint(self):
        initial = self.state()
        saved = self.post_action('save', initial['revision'], config=initial['config'], presetId=None, name='Desk').json()
        working = copy.deepcopy(saved['config'])
        working['pre']['tx'] = 0.17
        before = self.post_action('preview', saved['revision'], config=working).json()
        response = self.post_action('rename', before['revision'], presetId=saved['selectedPresetId'], name='  NLI setup  ')
        self.assertEqual(response.status_code, 200, response.content)
        after = response.json()
        expected = copy.deepcopy(before)
        expected['revision'] += 1
        expected['presets'][-1]['name'] = 'NLI setup'
        self.assertEqual(after, expected)
        repeated = self.post_action('rename', after['revision'], presetId=saved['selectedPresetId'], name='NLI setup')
        self.assertEqual(repeated.json(), after)

    def test_rename_rejects_invalid_names_readonly_missing_and_stale_presets(self):
        initial = self.state()
        saved = self.post_action('save', initial['revision'], config=initial['config'], presetId=None, name='Desk').json()
        for name in ['', '   ', 'x' * 81, None, 12]:
            with self.subTest(name=name):
                response = self.post_action('rename', saved['revision'], presetId=saved['selectedPresetId'], name=name)
                self.assertEqual(response.status_code, 400)
                self.assertIn('name', response.json()['fields'])
                self.assertEqual(self.state(), saved)
        for preset_id in ['original', str(uuid.uuid4()), 'invalid-id']:
            with self.subTest(preset_id=preset_id):
                response = self.post_action('rename', saved['revision'], presetId=preset_id, name='NLI setup')
                self.assertEqual(response.status_code, 400)
                self.assertIn('presetId', response.json()['fields'])
                self.assertEqual(self.state(), saved)
        response = self.post_action('rename', initial['revision'], presetId=saved['selectedPresetId'], name='NLI setup')
        self.assertEqual(response.status_code, 409)
        self.assertEqual(self.state(), saved)

    @patch('backend.projection_config_service.load_trusted_projection_asset', side_effect=AssertionError('disabled warp must not load an asset'))
    def test_disabled_td_warp_skips_asset_trust_lookup(self, _loader):
        initial = self.state()
        config = copy.deepcopy(initial['config'])
        config['outputs']['left']['warp'].update({
            'enabled': False,
            'baseline': {'type': 'tdMesh', 'assetId': 'removed-capture', 'sha256': 'd' * 64,
                         'width': 1920, 'height': 1080, 'origin': 'top-left'},
        })
        response = self.post_action('preview', initial['revision'], config=config)
        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual(response.json()['config']['outputs']['left']['warp']['baseline']['assetId'], 'removed-capture')

    def test_v6_rejects_unknown_names_wall_profile(self):
        current = self.state()
        config = copy.deepcopy(current['config'])
        config['namesWall']['profiles']['extra'] = {}
        response = self.post_action('preview', current['revision'], config=config)
        self.assertEqual(response.status_code, 400)
        self.assertIn('namesWall.profiles.extra', response.json()['fields'])
        self.assertEqual(self.state(), current)

    def test_installed_v6_rejects_stale_v5_write_before_mutation(self):
        self.state()
        row = OTEFProjectionCalibration.objects.get(table__name='otef')
        v6 = migrate_projection_config_to_v6(legacy_projection_config_defaults(), 35)
        row.working_config = v6
        row.presets[0]['config'] = copy.deepcopy(v6)
        row.save(update_fields=['working_config', 'presets'])
        current = get_projection_state('otef')
        stale = migrate_projection_config_to_v5(legacy_projection_config_defaults())
        response = self.post_action('preview', current['revision'], config=stale)
        self.assertEqual(response.status_code, 409)
        self.assertEqual(response.json()['error'], 'schema_changed')
        self.assertEqual(response.json()['requiredSchemaVersion'], 6)
        self.assertEqual(response.json()['state']['config']['schemaVersion'], 6)
        self.assertEqual(response.json()['state']['revision'], current['revision'])
        row = OTEFProjectionCalibration.objects.get(table__name='otef')
        self.assertEqual(row.revision, current['revision'])
        self.assertEqual(row.working_config, current['config'])

    def test_installed_v7_rejects_stale_writer_with_authoritative_snapshot(self):
        current = self.state()
        stale = migrate_projection_config_to_v6(legacy_projection_config_defaults(), 35)
        response = self.post_action('preview', current['revision'], config=stale)
        self.assertEqual(response.status_code, 409)
        self.assertEqual(response.json()['error'], 'schema_changed')
        self.assertEqual(response.json()['requiredSchemaVersion'], 7)
        self.assertEqual(response.json()['state']['config']['schemaVersion'], 7)

    def test_older_install_rejects_incoming_v7_until_upgrade(self):
        self.state()
        row = OTEFProjectionCalibration.objects.get(table__name='otef')
        old = migrate_projection_config_to_v5(legacy_projection_config_defaults())
        row.working_config = old
        row.presets[0]['config'] = copy.deepcopy(old)
        row.save(update_fields=['working_config', 'presets'])
        incoming = migrate_projection_config_to_v7(old)
        response = self.post_action('preview', row.revision, config=incoming)
        self.assertEqual(response.status_code, 400)
        self.assertIn('schemaVersion', response.json()['fields'])

    def test_v5_geometry_write_before_initialization_preserves_schema(self):
        self.state()
        row = OTEFProjectionCalibration.objects.get(table__name='otef')
        v5 = migrate_projection_config_to_v5(legacy_projection_config_defaults())
        row.working_config = v5
        row.presets[0]['config'] = v5
        row.revision = 4
        row.save()
        edited = copy.deepcopy(v5)
        edited['pre']['tx'] = 0.2
        response = self.post_action('preview', 4, config=edited)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()['config']['schemaVersion'], 5)
        self.assertNotIn('rotateDeg', response.json()['config']['namesWall'])
        self.assertEqual(response.json()['config']['pre']['tx'], 0.2)

    def test_legacy_preview_is_normalized_to_v3_before_persistence(self):
        self.state()
        row = OTEFProjectionCalibration.objects.get(table__name='otef')
        v5 = migrate_projection_config_to_v5(legacy_projection_config_defaults())
        row.working_config = v5
        row.presets = copy.deepcopy(row.presets)
        row.presets[0]['config'] = copy.deepcopy(v5)
        row.revision = 4
        row.save()
        for legacy in (legacy_projection_config_defaults(), migrate_projection_config_to_v2(legacy_projection_config_defaults())):
            response = self.post_action('preview', revision=self.state()['revision'], config=legacy)
            self.assertEqual(response.status_code, 200)
            self.assertEqual(response.json()['config']['schemaVersion'], 5)
            self.assertEqual(response.json()['config']['pre'], legacy['pre'])
            self.assertEqual(response.json()['config']['outputs']['left']['crop'], legacy['outputs']['left']['crop'])
            self.assertEqual(OTEFProjectionCalibration.objects.get(table__name='otef').working_config, response.json()['config'])

    @patch('backend.projection_config_service.load_trusted_projection_asset')
    def test_v3_td_baseline_still_checks_trusted_manifest(self, loader):
        original = self.state()
        config = copy.deepcopy(original['config'])
        config['outputs']['left']['warp']['baseline'] = {
            'type': 'tdMesh', 'assetId': 'untrusted', 'sha256': 'a' * 64,
            'width': 1920, 'height': 1080, 'origin': 'top-left',
        }
        loader.return_value = (None, {'assets': {'left': {'assetId': 'trusted', 'sha256': 'b' * 64}}}, None)
        response = self.post_action('preview', config=config)
        self.assertEqual(response.status_code, 400)
        self.assertIn('outputs.left.baseline.assetId', response.json()['fields'])
        self.assertIn('outputs.left.baseline.sha256', response.json()['fields'])
        self.assertEqual(self.state(), original)

    def test_variable_fixture_hashes_load_through_preview_and_save_without_changing_calibration_fields(self):
        fixture_path = Path(__file__).parents[4] / 'otef-interactive/tests/fixtures/td-variable-grid.json'
        fixture = json.loads(fixture_path.read_text(encoding='utf-8'))
        initial = self.state()
        config = copy.deepcopy(initial['config'])
        original_pre = copy.deepcopy(config['pre'])
        original_names = copy.deepcopy(config['namesWall'])
        original_outputs = {side: copy.deepcopy(config['outputs'][side]) for side in ('left', 'right')}
        grids = {
            'left': {'columns': 3, 'rows': 3, 'columnPositions': [0.0, 0.42, 1.0], 'rowPositions': [0.0, 0.57, 1.0]},
            'right': {'columns': 4, 'rows': 3, 'columnPositions': [0.0, 0.25, 0.68, 1.0], 'rowPositions': [0.0, 0.6, 1.0]},
        }
        for side in ('left', 'right'):
            grid = grids[side]
            grid['offsets'] = [[0.0, 0.0] for _ in range(grid['columns'] * grid['rows'])]
            grid['offsets'][grid['columns'] + 1] = [0.012 if side == 'left' else -0.006, -0.009 if side == 'left' else 0.008]
            config['outputs'][side]['warp']['grid'] = grid
            config['outputs'][side]['post']['tx'] = 0.08 if side == 'left' else -0.07
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            assets = {}
            catalog = {'left': [], 'right': []}
            for side in ('left', 'right'):
                payload = json.dumps(fixture[side]['expectedMesh'], separators=(',', ':')).encode()
                (root / f'legacy-{side}.json').write_bytes(payload)
                (root / 'captures').mkdir(exist_ok=True)
                (root / 'captures' / f'{side}.json').write_bytes(payload)
                assets[side] = {'assetId': f'legacy-{side}', 'path': f'legacy-{side}.json',
                                'sha256': hashlib.sha256(payload).hexdigest(),
                                'logicalGrid': fixture[side]['expectedMesh']['logicalGrid']}
                catalog[side].append({'assetId': f'variable-{side}', 'path': f'captures/{side}.json',
                                      'sha256': hashlib.sha256(payload).hexdigest(),
                                      'logicalGrid': fixture[side]['expectedMesh']['logicalGrid']})
                config['outputs'][side]['warp']['baseline'] = {
                    'type': 'tdMesh', 'assetId': catalog[side][0]['assetId'], 'sha256': catalog[side][0]['sha256'],
                    'width': 1920, 'height': 1080, 'origin': 'top-left',
                }
            (root / 'framing.json').write_text(json.dumps({'schemaVersion': 1}), encoding='utf-8')
            (root / 'manifest.json').write_text(json.dumps({
                'schemaVersion': 1, 'width': 1920, 'height': 1080, 'assets': assets, 'catalog': catalog,
                'framing': {'path': 'framing.json', 'sha256': 'c' * 64},
            }), encoding='utf-8')
            with patch('backend.projection_config_service.projection_baseline_root', return_value=root):
                with patch('backend.projection_config_service.read_projection_baseline_manifest', wraps=read_projection_baseline_manifest) as manifest_reader:
                    preview = self.post_action('preview', initial['revision'], config=config)
                    self.assertEqual(manifest_reader.call_count, 1)
                self.assertEqual(preview.status_code, 200, preview.content)
                self.assertEqual(preview.json()['config'], config)
                self.assertEqual(preview.json()['config']['pre'], original_pre)
                self.assertEqual(preview.json()['config']['namesWall'], original_names)
                for side in ('left', 'right'):
                    self.assertEqual(preview.json()['config']['outputs'][side]['crop'], original_outputs[side]['crop'])
                    self.assertEqual(preview.json()['config']['outputs'][side]['post'], config['outputs'][side]['post'])
                    self.assertEqual(preview.json()['config']['outputs'][side]['warp']['grid'], grids[side])
                    self.assertEqual(preview.json()['config']['outputs'][side]['warp']['baseline']['sha256'], assets[side]['sha256'])

                single_side_edit = copy.deepcopy(config)
                single_side_edit['outputs']['left']['warp']['grid']['offsets'][4][0] += 0.004
                edited = self.post_action('preview', preview.json()['revision'], config=single_side_edit)
                self.assertEqual(edited.status_code, 200, edited.content)
                self.assertEqual(edited.json()['config'], single_side_edit)
                self.assertEqual(edited.json()['config']['outputs']['right'], config['outputs']['right'])
                self.assertEqual(edited.json()['config']['pre'], original_pre)
                self.assertEqual(edited.json()['config']['namesWall'], original_names)
                saved = self.post_action('save', edited.json()['revision'], config=single_side_edit, presetId=None, name='Variable fixture')
                self.assertEqual(saved.status_code, 200, saved.content)
                self.assertEqual(saved.json()['config'], single_side_edit)
                self.assertEqual(saved.json()['presets'][-1]['name'], 'Variable fixture')
                self.assertEqual(saved.json()['presets'][-1]['config'], single_side_edit)
                self.assertEqual(saved.json()['presets'][-1]['config']['outputs']['left']['warp']['grid'], single_side_edit['outputs']['left']['warp']['grid'])
                self.assertEqual(saved.json()['presets'][-1]['config']['outputs']['right'], config['outputs']['right'])
                loaded = self.post_action('load', saved.json()['revision'], presetId=saved.json()['selectedPresetId'])
                self.assertEqual(loaded.status_code, 200, loaded.content)
                self.assertEqual(loaded.json()['config'], saved.json()['presets'][-1]['config'])
                self.assertEqual(self.state()['config'], saved.json()['presets'][-1]['config'])

                changed = copy.deepcopy(config)
                changed['outputs']['left']['warp']['baseline']['sha256'] = '0' * 64
                rejected = self.post_action('preview', loaded.json()['revision'], config=changed)
                self.assertEqual(rejected.status_code, 400)
                self.assertIn('is not present in the trusted manifest', str(rejected.json()['fields']))
                self.assertEqual(self.state(), loaded.json())
                rejected_save = self.post_action('save', loaded.json()['revision'], config=changed, presetId=loaded.json()['selectedPresetId'], name='Invalid catalog')
                self.assertEqual(rejected_save.status_code, 400)
                self.assertEqual(self.state(), loaded.json())

                trusted_manifest = json.loads((root / 'manifest.json').read_text(encoding='utf-8'))
                trusted_manifest['catalog']['left'] = []
                (root / 'manifest.json').write_text(json.dumps(trusted_manifest), encoding='utf-8')
                rejected_load = self.post_action('load', loaded.json()['revision'], presetId=loaded.json()['selectedPresetId'])
                self.assertEqual(rejected_load.status_code, 400)
                self.assertEqual(self.state(), loaded.json())

    def setUp(self):
        Table.objects.create(name="otef")
        self.source = str(uuid.uuid4())

    def state(self):
        return self.client.get("/api/otef/projection-config/?table=otef").json()

    def post_action(self, action, revision=0, **fields):
        return self.client.post("/api/otef/projection-config/", {
            "table": "otef", "baseRevision": revision, "action": action,
            "sourceId": self.source, **fields,
        }, content_type="application/json")

    def test_lazy_initialization_returns_original(self):
        state = self.state()
        self.assertEqual(state["revision"], 0)
        self.assertEqual(state["selectedPresetId"], "original")
        self.assertEqual(state["presets"][0]["id"], "original")

    def test_stale_preview_preserves_first_writer(self):
        config = self.state()["config"]
        config["pre"]["tx"] = 0.02
        payload = {"table": "otef", "baseRevision": 0, "action": "preview", "sourceId": self.source, "config": config}
        first = self.client.post("/api/otef/projection-config/", payload, content_type="application/json")
        self.assertEqual(first.status_code, 200)
        payload["sourceId"] = str(uuid.uuid4())
        second = self.client.post("/api/otef/projection-config/", payload, content_type="application/json")
        self.assertEqual(second.status_code, 409)
        self.assertEqual(second.json()["state"]["revision"], 1)

    def test_save_and_load_preset(self):
        state = self.state()
        config = copy.deepcopy(state["config"])
        config["pre"]["tx"] = 0.3
        response = self.client.post("/api/otef/projection-config/", {"table": "otef", "baseRevision": 0, "action": "save", "sourceId": self.source, "config": config, "presetId": None, "name": "Desk"}, content_type="application/json")
        self.assertEqual(response.status_code, 200)
        saved = response.json()
        self.assertEqual(saved["selectedPresetId"], saved["presets"][-1]["id"])
        self.assertEqual(OTEFProjectionCalibration.objects.get(table__name="otef").revision, 1)

    def test_preview_and_save_accept_per_profile_outline_widths(self):
        state = self.state()
        config = copy.deepcopy(state['config'])
        config['namesWall']['profiles']['wall']['strokeWidthPx'] = 5
        config['namesWall']['profiles']['model']['strokeWidthPx'] = 1
        preview = self.post_action('preview', state['revision'], config=config)
        self.assertEqual(preview.status_code, 200, preview.content)
        self.assertEqual(preview.json()['config']['namesWall']['profiles']['wall']['strokeWidthPx'], 5)
        self.assertEqual(preview.json()['config']['namesWall']['profiles']['model']['strokeWidthPx'], 1)
        saved = self.post_action('save', preview.json()['revision'], config=config, presetId=None, name='Outline widths')
        self.assertEqual(saved.status_code, 200, saved.content)
        self.assertEqual(saved.json()['presets'][-1]['config']['namesWall']['profiles']['wall']['strokeWidthPx'], 5)
        self.assertEqual(saved.json()['presets'][-1]['config']['namesWall']['profiles']['model']['strokeWidthPx'], 1)

    def test_preview_normalizes_pre_outline_v6_configs_before_accepting_edits(self):
        self.state()
        row = OTEFProjectionCalibration.objects.get(table__name='otef')
        old_config = migrate_projection_config_to_v6(legacy_projection_config_defaults(), 35)
        del old_config['namesWall']['profiles']['wall']['strokeWidthPx']
        del old_config['namesWall']['profiles']['model']['strokeWidthPx']
        row.working_config = copy.deepcopy(old_config)
        row.presets[0]['config'] = copy.deepcopy(old_config)
        row.save(update_fields=['working_config', 'presets'])
        state = get_projection_state('otef')
        response = self.post_action('preview', state['revision'], config=old_config)
        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual(response.json()['config']['namesWall']['profiles']['wall']['strokeWidthPx'], 3)
        self.assertEqual(response.json()['config']['namesWall']['profiles']['model']['strokeWidthPx'], 2)

    def test_invalid_config_does_not_create_or_change_state(self):
        response = self.client.post("/api/otef/projection-config/", {"table": "otef", "baseRevision": 0, "action": "preview", "sourceId": self.source, "config": {}}, content_type="application/json")
        self.assertEqual(response.status_code, 409)
        self.assertEqual(response.json()["error"], "schema_changed")
        self.assertEqual(self.state()["revision"], 0)

    def test_v7_zero_count_with_empty_axis_is_a_validation_error_without_state_change(self):
        initial = self.state()
        invalid = copy.deepcopy(initial['config'])
        grid = invalid['outputs']['left']['warp']['grid']
        grid['columns'] = 0
        grid['columnPositions'] = []
        response = self.post_action('preview', initial['revision'], config=invalid)
        self.assertEqual(response.status_code, 400, response.content)
        self.assertIn('outputs.left.grid.columns', response.json()['fields'])
        self.assertEqual(self.state(), initial)

    def test_v7_oversized_axis_integer_is_a_validation_error_without_state_change(self):
        initial = self.state()
        invalid = copy.deepcopy(initial['config'])
        invalid['outputs']['left']['warp']['grid']['columnPositions'][1] = 10 ** 400
        response = self.post_action('preview', initial['revision'], config=invalid)
        self.assertEqual(response.status_code, 400, response.content)
        self.assertIn('outputs.left.grid.columnPositions[1]', response.json()['fields'])
        self.assertEqual(self.state(), initial)

    def test_invalid_action_shapes_preserve_state(self):
        initial = self.state()
        cases = [
            {"action": []}, {"action": {}}, {"action": "unknown"},
            {"action": "preview"}, {"action": "revert", "config": initial["config"]},
            {"action": "load"}, {"action": "save", "config": initial["config"], "name": "Desk"},
            {"action": "save", "config": initial["config"], "presetId": "bad", "name": "Desk"},
            {"action": "save", "config": initial["config"], "presetId": None, "name": "  "},
        ]
        for fields in cases:
            with self.subTest(fields=fields):
                response = self.client.post("/api/otef/projection-config/", {
                    "table": "otef", "baseRevision": 0, "sourceId": self.source, **fields,
                }, content_type="application/json")
                self.assertEqual(response.status_code, 400)
                self.assertEqual(self.state(), initial)

    def test_reserved_service_argument_names_are_invalid_fields(self):
        initial = self.state()
        for key in ("table_name", "base_revision", "source_id"):
            with self.subTest(key=key):
                response = self.client.post("/api/otef/projection-config/", {
                    "table": "otef", "baseRevision": 0, "action": "revert",
                    "sourceId": self.source, key: "unexpected",
                }, content_type="application/json")
                self.assertEqual(response.status_code, 400)
                self.assertEqual(response.json()["fields"][key], "unknown field")
                self.assertEqual(self.state(), initial)

    def test_safe_revision_and_table_validation(self):
        config = self.state()["config"]
        for revision in (-1, True, 2 ** 53, 1.5, "0"):
            with self.subTest(revision=revision):
                self.assertEqual(self.post_action("preview", revision, config=config).status_code, 400)
        self.assertEqual(self.client.get("/api/otef/projection-config/?table=missing").status_code, 404)
        response = self.client.post("/api/otef/projection-config/", {
            "table": [], "baseRevision": 0, "action": "revert", "sourceId": self.source,
        }, content_type="application/json")
        self.assertEqual(response.status_code, 400)

    def test_revision_cannot_advance_beyond_safe_integer(self):
        initial = self.state()
        row = OTEFProjectionCalibration.objects.get(table__name="otef")
        row.revision = 2 ** 53 - 1
        row.save(update_fields=["revision"])
        response = self.post_action("revert", 2 ** 53 - 1)
        self.assertEqual(response.status_code, 400)
        row.refresh_from_db()
        self.assertEqual(row.revision, 2 ** 53 - 1)
        self.assertEqual(row.working_config, initial["config"])
        self.assertEqual(self.post_action("preview", 2 ** 53 - 1, config=initial["config"]).status_code, 200)

    def test_save_requires_selected_id_and_preserves_original(self):
        config = self.state()["config"]
        saved = self.post_action("save", config=config, presetId=None, name="Desk").json()
        preset_id = saved["selectedPresetId"]
        response = self.post_action("save", 1, config=config, presetId=str(uuid.uuid4()), name="Other")
        self.assertEqual(response.status_code, 400)
        response = self.post_action("save", 1, config=config, presetId="original", name="Original calibration")
        self.assertEqual(response.status_code, 400)
        self.assertEqual(self.state(), saved)
        self.assertEqual(saved["presets"][0]["config"], config)
        self.assertEqual(saved["presets"][1]["id"], preset_id)

    def test_noop_preview_and_revert_revision(self):
        config = self.state()["config"]
        self.assertEqual(self.post_action("preview", config=config).json()["revision"], 0)
        self.assertEqual(self.post_action("revert").json()["revision"], 1)

    @patch("backend.projection_config_service.get_channel_layer")
    @patch("backend.projection_config_service.async_to_sync")
    def test_broadcast_after_commit_matches_response(self, sync, channel_layer):
        config = self.state()["config"]
        config["pre"]["tx"] = 0.04
        with self.captureOnCommitCallbacks(execute=True) as callbacks:
            response = self.post_action("preview", config=config)
            self.assertEqual(sync.call_count, 0)
        self.assertEqual(len(callbacks), 1)
        sync.assert_called_once_with(channel_layer.return_value.group_send)
        sync.return_value.assert_called_once_with("otef_channel", {
            "type": "broadcast_message", "message": {
                "type": "otef_projection_config_changed", "table": "otef",
                "sourceId": self.source, "state": response.json(),
            },
        })

    def test_rollback_does_not_send_message_or_persist(self):
        original = self.state()
        config = copy.deepcopy(original["config"])
        config["pre"]["tx"] = 0.07
        with patch("backend.projection_config_service._broadcast") as broadcast:
            with self.assertRaises(RuntimeError):
                with transaction.atomic():
                    mutate_projection_state("otef", 0, "preview", self.source, config=config)
                    raise RuntimeError("rollback")
            self.assertEqual(self.state(), original)
            broadcast.assert_not_called()

    @patch("backend.projection_config_service._broadcast")
    def test_semantically_invalid_warp_does_not_persist_or_broadcast(self, broadcast):
        original = self.state()
        config = copy.deepcopy(original["config"])
        config["outputs"]["left"]["warp"]["keystone"]["corners"] = [[0, 0], [1, 0], [0, 0], [1, 1]]
        response = self.post_action("preview", config=config)
        self.assertEqual(response.status_code, 400)
        self.assertEqual(self.state(), original)
        broadcast.assert_not_called()

    def test_selected_checkpoint_survives_reload(self):
        original = self.state()
        config = copy.deepcopy(original["config"])
        config["pre"]["tx"] = 0.31
        saved = self.post_action("save", config=config, presetId=None, name="Desk").json()
        draft = copy.deepcopy(config)
        draft["pre"]["tx"] = 0.4
        preview = self.post_action("preview", 1, config=draft).json()
        self.assertEqual(preview["selectedPresetId"], saved["selectedPresetId"])
        self.assertEqual(self.state(), preview)
        reverted = self.post_action("revert", 2).json()
        self.assertEqual(reverted["config"], config)
        self.assertEqual(reverted["revision"], 3)
        self.assertEqual(reverted["presets"][0], original["presets"][0])

    def test_cap_counts_original_and_duplicate_names_use_identity(self):
        config = self.state()["config"]
        for revision in range(49):
            response = self.post_action("save", revision, config=config, presetId=None, name="Same")
            self.assertEqual(response.status_code, 200)
        self.assertEqual(len(self.state()["presets"]), 50)
        response = self.post_action("save", 49, config=config, presetId=None, name="One more")
        self.assertEqual(response.status_code, 400)
        self.assertEqual(self.state()["revision"], 49)

    def test_lan_post_accepts_without_csrf_cookie(self):
        client = Client(enforce_csrf_checks=True)
        response = client.post("/api/otef/projection-config/", {
            "table": "otef", "baseRevision": 0, "action": "revert", "sourceId": self.source,
        }, content_type="application/json")
        self.assertEqual(response.status_code, 200)

    @patch("backend.projection_config_service._broadcast")
    def test_each_changed_action_broadcasts_committed_snapshot(self, broadcast):
        config = self.state()["config"]
        config["pre"]["tx"] = 0.32
        actions = [
            ("save", {"config": config, "presetId": None, "name": "Desk"}),
            ("load", {"presetId": "original"}),
            ("revert", {}),
        ]
        for revision, (action, fields) in enumerate(actions):
            with self.captureOnCommitCallbacks(execute=True) as callbacks:
                state = self.post_action(action, revision, **fields).json()
            self.assertEqual(len(callbacks), 1)
            self.assertEqual(state["revision"], revision + 1)
            broadcast.assert_called_with("otef", state, self.source)
        self.assertEqual(broadcast.call_count, 3)


class ProjectionConfigConcurrencyTests(TransactionTestCase):
    def test_two_postgresql_connections_cannot_both_apply_base_revision(self):
        self.assertEqual(connection.vendor, "postgresql")
        Table.objects.create(name="otef")
        original = get_projection_state("otef")
        barrier = Barrier(2)

        def writer(value):
            connections.close_all()
            config = copy.deepcopy(original["config"])
            config["pre"]["tx"] = value
            barrier.wait()
            try:
                return ("ok", mutate_projection_state("otef", 0, "preview", str(uuid.uuid4()), config=config))
            except ProjectionConflict as exc:
                return ("conflict", exc.state)
            finally:
                connections.close_all()

        with patch("backend.projection_config_service._broadcast"):
            with ThreadPoolExecutor(max_workers=2) as executor:
                results = list(executor.map(writer, (0.21, 0.22)))
        self.assertEqual(sorted(result[0] for result in results), ["conflict", "ok"])
        self.assertEqual(get_projection_state("otef")["revision"], 1)
        self.assertEqual(results[0][1]["revision"], 1)
        self.assertEqual(results[1][1]["revision"], 1)
