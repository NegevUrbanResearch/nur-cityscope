import copy
import uuid
from concurrent.futures import ThreadPoolExecutor
from threading import Barrier
from unittest.mock import patch

from django.db import connection, connections, transaction
from django.test import Client, TestCase, TransactionTestCase

from backend.models import OTEFProjectionCalibration, Table
from backend.projection_config_service import get_projection_state, mutate_projection_state, ProjectionConflict


class ProjectionConfigApiTests(TestCase):
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

    def test_invalid_config_does_not_create_or_change_state(self):
        response = self.client.post("/api/otef/projection-config/", {"table": "otef", "baseRevision": 0, "action": "preview", "sourceId": self.source, "config": {}}, content_type="application/json")
        self.assertEqual(response.status_code, 400)
        self.assertEqual(self.state()["revision"], 0)

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
