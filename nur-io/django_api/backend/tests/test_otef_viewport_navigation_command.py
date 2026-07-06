from unittest.mock import AsyncMock, patch

from django.test import TestCase
from rest_framework.test import APIClient

from backend.models import OTEFViewportState, Table


class OTEFPlaceNavigationCommandTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.table = Table.objects.create(name="otef")

    @patch("channels.layers.get_channel_layer")
    def test_navigate_to_place_broadcasts_command_without_overwriting_viewport(
        self, get_channel_layer
    ):
        layer = get_channel_layer.return_value
        layer.group_send = AsyncMock()
        state = OTEFViewportState.objects.create(
            table=self.table,
            viewport={"bbox": [1, 2, 3, 4], "corners": None, "zoom": 12},
        )

        response = self.client.post(
            "/api/otef_viewport/by-table/otef/command/",
            {
                "action": "navigate_to_place",
                "placeId": "yeshuv-0067",
                "cameraHint": {"center": {"lng": 34.6, "lat": 31.5}, "zoom": 15},
                "transition": {"animate": True, "durationMs": 1600},
                "sourceId": "remote-a",
                "timestamp": 123,
            },
            format="json",
        )

        self.assertEqual(response.status_code, 200)
        state.refresh_from_db()
        self.assertEqual(state.viewport["bbox"], [1, 2, 3, 4])
        body = response.json()
        self.assertEqual(body["command"]["placeId"], "yeshuv-0067")
        self.assertNotIn("viewport", body["command"])
        self.assertNotIn("bbox", body["command"])
        self.assertTrue(layer.group_send.called)

    @patch("channels.layers.get_channel_layer")
    def test_stale_viewport_patch_does_not_overwrite_newer_canonical_viewport(
        self, get_channel_layer
    ):
        layer = get_channel_layer.return_value
        layer.group_send = AsyncMock()
        state = OTEFViewportState.objects.create(
            table=self.table,
            viewport={
                "bbox": [100, 100, 300, 300],
                "corners": None,
                "zoom": 15,
                "timestamp": 2_000,
                "sourceId": "gis-newer",
            },
        )

        response = self.client.patch(
            "/api/otef_viewport/by-table/otef/",
            {
                "viewport": {
                    "bbox": [125, 0, 175, 500],
                    "corners": None,
                    "zoom": 15,
                    "timestamp": 1_000,
                    "sourceId": "gis-stale",
                },
                "sourceId": "gis-stale",
                "timestamp": 1_000,
            },
            format="json",
        )

        self.assertEqual(response.status_code, 200)
        state.refresh_from_db()
        self.assertEqual(state.viewport["bbox"], [100, 100, 300, 300])
        self.assertEqual(response.json()["viewport"]["bbox"], [100, 100, 300, 300])
        layer.group_send.assert_not_called()

    @patch("channels.layers.get_channel_layer")
    def test_untimestamped_viewport_patch_merges_into_timestamped_canonical_viewport(
        self, get_channel_layer
    ):
        layer = get_channel_layer.return_value
        layer.group_send = AsyncMock()
        state = OTEFViewportState.objects.create(
            table=self.table,
            viewport={
                "bbox": [100, 100, 300, 300],
                "corners": None,
                "zoom": 15,
                "timestamp": 2_000,
                "sourceId": "gis-canonical",
            },
        )

        response = self.client.patch(
            "/api/otef_viewport/by-table/otef/",
            {
                "viewport": {
                    "bbox": [125, 0, 175, 500],
                    "corners": None,
                    "zoom": 14,
                },
                "sourceId": "legacy-client",
            },
            format="json",
        )

        self.assertEqual(response.status_code, 200)
        state.refresh_from_db()
        self.assertEqual(state.viewport["bbox"], [125, 0, 175, 500])
        self.assertEqual(state.viewport["zoom"], 14)
        self.assertEqual(state.viewport["timestamp"], 2_000)
        self.assertEqual(response.json()["viewport"]["bbox"], [125, 0, 175, 500])
        layer.group_send.assert_called_once()

    @patch("channels.layers.get_channel_layer")
    def test_viewport_patch_broadcast_uses_nested_source_metadata(self, get_channel_layer):
        layer = get_channel_layer.return_value
        layer.group_send = AsyncMock()
        OTEFViewportState.objects.create(
            table=self.table,
            viewport={"bbox": [1, 2, 3, 4], "corners": None, "zoom": 12},
        )

        response = self.client.patch(
            "/api/otef_viewport/by-table/otef/",
            {
                "viewport": {
                    "bbox": [10, 20, 30, 40],
                    "corners": None,
                    "zoom": 15,
                    "sourceId": "gis-client",
                    "timestamp": 1234,
                    "traceId": "place-nav-test",
                },
            },
            format="json",
        )

        self.assertEqual(response.status_code, 200)
        layer.group_send.assert_called_once()
        message = layer.group_send.call_args.args[1]["message"]
        self.assertEqual(message["type"], "otef_viewport_changed")
        self.assertEqual(message["sourceId"], "gis-client")
        self.assertEqual(message["timestamp"], 1234)
        self.assertEqual(message["traceId"], "place-nav-test")
