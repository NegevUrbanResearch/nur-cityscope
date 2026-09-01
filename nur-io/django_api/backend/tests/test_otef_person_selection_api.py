import json
from unittest import IsolatedAsyncioTestCase
from unittest.mock import AsyncMock, patch

from django.test import TestCase
from django.test.utils import override_settings

from backend.models import OTEFViewportState, Table
from backend.otef_person_selection import build_person_selection_event
from websocket_app.consumers import GeneralConsumer


@override_settings(
    CHANNEL_LAYERS={
        "default": {"BACKEND": "channels.layers.InMemoryChannelLayer"}
    }
)
class OTEFPersonSelectionApiTests(TestCase):
    def setUp(self):
        self.table = Table.objects.create(name="otef")
        OTEFViewportState.objects.create(table=self.table)

    def command(self, action, **payload):
        with self.captureOnCommitCallbacks(execute=True):
            return self.client.post(
                "/api/otef_viewport/by-table/otef/command/",
                json.dumps({"action": action, **payload}),
                content_type="application/json",
            )

    def select_person(self, expected_revision=0):
        return self.command(
            "select_person",
            personId="11",
            datasetVersion="v1",
            expectedRevision=expected_revision,
        )

    def navigate(self):
        return self.command(
            "navigate_to_place",
            placeId="p",
            cameraHint={"center": {"lng": 1, "lat": 2}, "zoom": 15},
        )

    def selection(self):
        return self.client.get("/api/otef_viewport/by-table/otef/").json()["person_selection"]

    @patch("channels.layers.get_channel_layer")
    def test_get_normalizes_legacy_without_write_or_broadcast(self, layer):
        state = OTEFViewportState.objects.get(table=self.table)
        state.person_selection = {}
        state.save(update_fields=["person_selection"])
        with patch.object(OTEFViewportState, "save", wraps=state.save) as save:
            response = self.client.get("/api/otef_viewport/by-table/otef/")
        self.assertEqual(response.json()["person_selection"], {"personId": None, "datasetVersion": None, "revision": 0})
        save.assert_not_called()
        layer.return_value.group_send.assert_not_called()
    @patch("channels.layers.get_channel_layer")
    def test_select_broadcasts_immutable_snapshot(self, get_layer):
        get_layer.return_value.group_send = AsyncMock()
        response = self.command(
            "select_person",
            personId="11",
            datasetVersion="sha256:abc",
            expectedRevision=0,
            sourceId="remote-a",
            timestamp=123,
        )
        expected = {"personId": "11", "datasetVersion": "sha256:abc", "revision": 1}
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["person_selection"], expected)
        message = get_layer.return_value.group_send.call_args.args[1]["message"]
        self.assertEqual(message["type"], "otef_person_selection_changed")
        self.assertEqual(message["personSelection"], expected)
        self.assertEqual(message["sourceId"], "remote-a")
    @patch("channels.layers.get_channel_layer")
    def test_replacement_and_same_person_noop(self, get_layer):
        get_layer.return_value.group_send = AsyncMock()
        self.assertEqual(
            self.select_person().status_code,
            200,
        )
        get_layer.return_value.group_send.reset_mock()
        same = self.command(
            "select_person",
            personId="11",
            datasetVersion="v1",
            expectedRevision=1,
        )
        self.assertEqual(same.json()["person_selection"]["revision"], 1)
        get_layer.return_value.group_send.assert_not_called()
        replaced = self.command(
            "select_person",
            personId="12",
            datasetVersion="v1",
            expectedRevision=1,
        )
        self.assertEqual(replaced.json()["person_selection"]["revision"], 2)
        self.assertEqual(get_layer.return_value.group_send.call_count, 1)
    def test_malformed_selection_is_rejected(self):
        malformed = (
            {"personId": "", "datasetVersion": "v", "expectedRevision": 0},
            {"personId": 11, "datasetVersion": "v", "expectedRevision": 0},
            {"personId": "11", "datasetVersion": "", "expectedRevision": 0},
            {"personId": "11", "datasetVersion": "v", "expectedRevision": "0"},
            {"personId": "x" * 129, "datasetVersion": "v", "expectedRevision": 0},
        )
        for payload in malformed:
            self.assertEqual(self.command("select_person", **payload).status_code, 400)
        self.assertEqual(self.selection()["revision"], 0)

    @patch("channels.layers.get_channel_layer")
    def test_active_clock_rejects_select_and_clear_handles_stale_and_repeat(self, get_layer):
        get_layer.return_value.group_send = AsyncMock()
        state = OTEFViewportState.objects.get(table=self.table)
        state.investigation_clock = {"phase": "playing"}
        state.save(update_fields=["investigation_clock"])
        active = self.select_person()
        self.assertEqual(active.status_code, 409)
        self.assertEqual(active.json()["reason"], "clock_active")
        state.investigation_clock = {"phase": "idle"}
        state.save(update_fields=["investigation_clock"])
        self.select_person()
        get_layer.return_value.group_send.reset_mock()
        stale = self.command("clear_person", expectedRevision=0)
        self.assertEqual(stale.status_code, 409)
        self.assertEqual(stale.json()["reason"], "stale")
        cleared = self.command("clear_person", expectedRevision=1)
        self.assertEqual(cleared.json()["person_selection"]["revision"], 2)
        get_layer.return_value.group_send.reset_mock()
        self.assertEqual(self.command("clear_person", expectedRevision=2).status_code, 200)
        get_layer.return_value.group_send.assert_not_called()

    @patch("channels.layers.get_channel_layer")
    def test_navigation_clears_before_navigation_broadcast(self, get_layer):
        get_layer.return_value.group_send = AsyncMock()
        self.command("select_person", personId="11", datasetVersion="v1", expectedRevision=0)
        get_layer.return_value.group_send.reset_mock()
        response = self.command(
            "navigate_to_place",
            placeId="yeshuv-0067",
            cameraHint={"center": {"lng": 34.6, "lat": 31.5}, "zoom": 15},
        )
        self.assertEqual(response.status_code, 200)
        message_types = [
            call.args[1]["message"]["type"]
            for call in get_layer.return_value.group_send.call_args_list
        ]
        self.assertEqual(
            message_types,
            ["otef_person_selection_changed", "otef_place_navigation_command"],
        )
        self.assertIsNone(self.selection()["personId"])

    @patch("channels.layers.get_channel_layer")
    @patch("backend.views.transaction.on_commit")
    def test_navigation_publishes_before_later_selection_after_empty_decision(
        self, on_commit, get_layer
    ):
        get_layer.return_value.group_send = AsyncMock()
        callbacks = []
        on_commit.side_effect = callbacks.append
        response = self.navigate()
        self.assertEqual(response.status_code, 200)
        self.select_person()
        self.assertEqual(len(callbacks), 2)
        for callback in callbacks:
            callback()
        message_types = [call.args[1]["message"]["type"] for call in get_layer.return_value.group_send.call_args_list]
        self.assertEqual(message_types, ["otef_place_navigation_command", "otef_person_selection_changed"])

    @patch("channels.layers.get_channel_layer")
    def test_navigation_locks_before_deciding_after_a_concurrent_select(self, get_layer):
        get_layer.return_value.group_send = AsyncMock()
        state = OTEFViewportState.objects.get(table=self.table)
        manager = OTEFViewportState.objects
        real_select_for_update = manager.select_for_update

        def select_after_stale_read():
            OTEFViewportState.objects.filter(pk=state.pk).update(
                person_selection={"personId": "11", "datasetVersion": "v1", "revision": 1}
            )
            return real_select_for_update()

        with patch.object(manager, "select_for_update", side_effect=select_after_stale_read) as lock:
            response = self.navigate()
        self.assertEqual(response.status_code, 200)
        self.assertIsNone(OTEFViewportState.objects.get(pk=state.pk).person_selection["personId"])
        self.assertEqual(get_layer.return_value.group_send.call_count, 2)
        lock.assert_called_once()
    @patch(
        "backend.views.normalize_person_selection",
        side_effect=[
            {"personId": "11", "datasetVersion": "v1", "revision": 1},
            {"personId": None, "datasetVersion": None, "revision": 1},
        ],
    )
    @patch("channels.layers.get_channel_layer")
    def test_navigation_schedules_after_a_concurrent_clear_check(self, get_layer, normalize):
        get_layer.return_value.group_send = AsyncMock()
        state = OTEFViewportState.objects.get(table=self.table)
        state.person_selection = {"personId": "11", "datasetVersion": "v1", "revision": 1}
        state.save(update_fields=["person_selection"])
        response = self.navigate()
        self.assertEqual(response.status_code, 200)
        self.assertEqual(get_layer.return_value.group_send.call_count, 2)
        self.assertEqual(normalize.call_count, 1)
    def test_generic_serializer_patch_cannot_mutate_selection(self):
        response = self.client.patch(
            "/api/otef_viewport/1/",
            json.dumps({"person_selection": {"personId": "11", "datasetVersion": "v1", "revision": 99}}),
            content_type="application/json",
        )
        self.assertIn(response.status_code, (200, 404, 405))
        self.assertIsNone(self.selection()["personId"])

    def test_event_builder_captures_an_immutable_selection_snapshot(self):
        snapshot = {"personId": "11", "datasetVersion": "v1", "revision": 1}
        event = build_person_selection_event(
            "otef",
            snapshot,
            {"sourceId": "remote-a", "timestamp": 123, "traceId": "trace-a"},
        )

        snapshot["revision"] = 99

        self.assertEqual(
            event,
            {
                "type": "otef_person_selection_changed",
                "table": "otef",
                "personSelection": {
                    "personId": "11",
                    "datasetVersion": "v1",
                    "revision": 1,
                },
                "sourceId": "remote-a",
                "timestamp": 123,
                "traceId": "trace-a",
            },
        )

class OTEFPersonSelectionWebSocketTests(IsolatedAsyncioTestCase):
    async def test_consumer_rejects_forged_and_unknown_otef_events(self):
        consumer = GeneralConsumer()
        consumer.channel_layer = AsyncMock()
        consumer.room_group_name = "otef_channel"
        await consumer.handle_otef_message(
            {"type": "otef_person_selection_changed", "personSelection": {"personId": "11"}}
        )
        await consumer.handle_otef_message({"type": "otef_unknown_command"})
        consumer.channel_layer.group_send.assert_not_called()

    async def test_consumer_rejects_unknown_viewport_action(self):
        consumer = GeneralConsumer()
        consumer.channel_layer = AsyncMock()
        consumer.room_group_name = "otef_channel"
        await consumer.handle_otef_message(
            {"type": "otef_viewport_control", "action": "select_person"}
        )
        consumer.channel_layer.group_send.assert_not_called()
