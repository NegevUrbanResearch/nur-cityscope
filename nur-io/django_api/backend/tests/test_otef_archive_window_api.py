import json
from unittest.mock import AsyncMock, patch

from django.test import TestCase

from backend.models import OTEFViewportState, Table


class OTEFArchiveWindowCommandTests(TestCase):
    def setUp(self):
        self.table = Table.objects.create(name="otef")
        self.state = OTEFViewportState.objects.create(
            table=self.table,
            person_selection={"personId": "11", "datasetVersion": "v1", "revision": 3},
            investigation_clock={"phase": "idle", "revision": 7},
            viewport={"zoom": 12},
        )

    def command(self, archive_action, **overrides):
        payload = {
            "action": "archive_window",
            "archiveAction": archive_action,
            "personId": "11",
            "datasetVersion": "v1",
            "requestId": "request-1",
            "sourceId": "remote-a",
            **overrides,
        }
        with self.captureOnCommitCallbacks(execute=True):
            return self.client.post(
                "/api/otef_viewport/by-table/otef/command/",
                json.dumps(payload),
                content_type="application/json",
            )

    @patch("channels.layers.get_channel_layer")
    def test_open_broadcasts_ephemeral_command_without_persisting_archive_state(self, get_layer):
        get_layer.return_value.group_send = AsyncMock()
        response = self.command("open")

        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.json()["acknowledged"])
        get_layer.return_value.group_send.assert_called_once()
        group, envelope = get_layer.return_value.group_send.call_args.args
        self.assertEqual(group, "otef_channel")
        self.assertEqual(envelope["message"], {
            "type": "otef_archive_window_command",
            "table": "otef",
            "action": "open",
            "personId": "11",
            "datasetVersion": "v1",
            "requestId": "request-1",
            "sourceId": "remote-a",
            "acknowledged": True,
        })
        self.assertNotIn("url", json.dumps(envelope).lower())
        self.state.refresh_from_db()
        self.assertEqual(self.state.person_selection["revision"], 3)
        self.assertEqual(self.state.investigation_clock["revision"], 7)
        self.assertEqual(self.state.viewport, {"zoom": 12})

    @patch("channels.layers.get_channel_layer")
    def test_open_rejects_selection_mismatch_and_active_timeline(self, get_layer):
        get_layer.return_value.group_send = AsyncMock()
        self.assertEqual(self.command("open", personId="12").status_code, 409)
        self.state.investigation_clock = {"phase": "playing", "revision": 8}
        self.state.save(update_fields=["investigation_clock"])
        self.assertEqual(self.command("open").status_code, 409)
        get_layer.return_value.group_send.assert_not_called()

    @patch("channels.layers.get_channel_layer")
    def test_close_is_safe_after_selection_clears_or_timeline_starts(self, get_layer):
        get_layer.return_value.group_send = AsyncMock()
        self.state.person_selection = {"personId": None, "datasetVersion": None, "revision": 4}
        self.state.investigation_clock = {"phase": "playing", "revision": 8}
        self.state.save(update_fields=["person_selection", "investigation_clock"])

        response = self.command("close")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(get_layer.return_value.group_send.call_args.args[1]["message"]["action"], "close")

    @patch("channels.layers.get_channel_layer")
    def test_malformed_commands_fail_without_broadcast(self, get_layer):
        get_layer.return_value.group_send = AsyncMock()
        malformed = (
            ("launch", {}),
            ("open", {"personId": ""}),
            ("open", {"datasetVersion": ""}),
            ("open", {"requestId": ""}),
            ("open", {"requestId": "x" * 129}),
            ("open", {"sourceId": ""}),
            ("open", {"sourceId": "x" * 129}),
        )
        for action, overrides in malformed:
            self.assertEqual(self.command(action, **overrides).status_code, 400)
        get_layer.return_value.group_send.assert_not_called()

    @patch("channels.layers.get_channel_layer")
    def test_result_broadcasts_ephemeral_outcome_without_persisting_archive_state(self, get_layer):
        get_layer.return_value.group_send = AsyncMock()
        payload = {
            "action": "archive_window_result",
            "outcome": "navigation_attempted",
            "personId": "11",
            "datasetVersion": "v1",
            "requestId": "request-1",
            "sourceId": "gis-a",
        }
        with self.captureOnCommitCallbacks(execute=True):
            response = self.client.post(
                "/api/otef_viewport/by-table/otef/command/",
                json.dumps(payload),
                content_type="application/json",
            )
        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.json()["acknowledged"])
        get_layer.return_value.group_send.assert_called_once()
        envelope = get_layer.return_value.group_send.call_args.args[1]
        self.assertEqual(envelope["message"], {
            "type": "otef_archive_window_result",
            "table": "otef",
            "outcome": "navigation_attempted",
            "personId": "11",
            "datasetVersion": "v1",
            "requestId": "request-1",
            "sourceId": "gis-a",
            "acknowledged": True,
        })
        self.assertNotIn("url", json.dumps(envelope).lower())

    @patch("channels.layers.get_channel_layer")
    def test_result_rejects_unknown_outcome_and_missing_correlation(self, get_layer):
        get_layer.return_value.group_send = AsyncMock()
        for outcome, request_id in (("loaded", "request-1"), ("unavailable", "")):
            payload = {
                "action": "archive_window_result",
                "outcome": outcome,
                "personId": "11",
                "datasetVersion": "v1",
                "requestId": request_id,
                "sourceId": "gis-a",
            }
            response = self.client.post(
                "/api/otef_viewport/by-table/otef/command/",
                json.dumps(payload),
                content_type="application/json",
            )
            self.assertEqual(response.status_code, 400)
        get_layer.return_value.group_send.assert_not_called()

    @patch("channels.layers.get_channel_layer")
    def test_command_and_result_reject_non_string_correlation_fields(self, get_layer):
        get_layer.return_value.group_send = AsyncMock()
        for action, field, value in (
            ("archive_window", "personId", []),
            ("archive_window", "sourceId", {"id": "gis"}),
            ("archive_window_result", "requestId", 42),
            ("archive_window_result", "datasetVersion", ["v1"]),
        ):
            payload = {
                "action": action,
                "archiveAction": "open" if action == "archive_window" else None,
                "outcome": "navigation_attempted",
                "personId": "11",
                "datasetVersion": "v1",
                "requestId": "request-1",
                "sourceId": "gis-a",
            }
            payload[field] = value
            response = self.client.post(
                "/api/otef_viewport/by-table/otef/command/",
                json.dumps(payload),
                content_type="application/json",
            )
            self.assertEqual(response.status_code, 400)
        get_layer.return_value.group_send.assert_not_called()
