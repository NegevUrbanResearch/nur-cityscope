from unittest.mock import AsyncMock, patch

from django.test import TestCase
from rest_framework.test import APIClient

from backend.models import OTEFViewportState, Table
from backend.views import OTEFViewportStateViewSet


class GazaBorderVisibilityApiTests(TestCase):
    def setUp(self):
        self.table = Table.objects.create(name="otef", display_name="OTEF")
        self.client = APIClient()
        self.url = "/api/otef_viewport/by-table/otef/"

    def test_defaults_hidden_and_persists_across_reload_and_scene_changes(self):
        response = self.client.get(self.url)
        self.assertEqual(response.status_code, 200)
        self.assertIs(response.data.get("gaza_border_visible"), False)
        response = self.client.patch(self.url, {"gaza_border_visible": True}, format="json")
        self.assertEqual(response.status_code, 200)
        self.assertIs(response.data.get("gaza_border_visible"), True)
        # Scene layer updates cannot change the global override.
        self.client.patch(self.url, {"layerGroups": [{"id": "gaza", "layers": [{"id": "gaza_border", "enabled": False}]}]}, format="json")
        self.assertIs(self.client.get(self.url).data.get("gaza_border_visible"), True)
        self.client.patch(self.url, {"gaza_border_visible": False}, format="json")
        self.assertIs(self.client.get(self.url).data.get("gaza_border_visible"), False)

    def test_rejects_non_boolean_visibility(self):
        for value in ("yes", 1, None, {}):
            response = self.client.patch(self.url, {"gaza_border_visible": value}, format="json")
            self.assertEqual(response.status_code, 400)

    def test_a_scene_layer_command_cannot_overwrite_a_newer_saved_visibility(self):
        stale = OTEFViewportState.objects.create(table=self.table, gaza_border_visible=False)
        OTEFViewportState.objects.filter(pk=stale.pk).update(gaza_border_visible=True)
        view = OTEFViewportStateViewSet()
        view._apply_layer_toggle_change_dicts(self.table, [{"full_layer_id": "gaza.gaza_border", "enabled": True}], stale)
        self.assertTrue(OTEFViewportState.objects.get(pk=stale.pk).gaza_border_visible)

    def test_broadcasts_saved_visibility_to_all_displays(self):
        channel = AsyncMock()
        with patch("channels.layers.get_channel_layer", return_value=channel):
            with self.captureOnCommitCallbacks(execute=True):
                response = self.client.patch(self.url, {"gaza_border_visible": True}, format="json")
        self.assertEqual(response.status_code, 200)
        messages = [call.args[1]["message"] for call in channel.group_send.call_args_list]
        message = next((item for item in messages if item["type"] == "otef_gaza_border_visibility_changed"), None)
        self.assertIsNotNone(message)
        self.assertEqual(message["table"], "otef")
        self.assertIs(message["gazaBorderVisible"], True)
        self.assertTrue(OTEFViewportState.objects.get(table=self.table).gaza_border_visible)

    def test_pan_and_zoom_cannot_overwrite_newer_saved_visibility(self):
        stale = OTEFViewportState.objects.create(table=self.table, viewport=OTEFViewportState.DEFAULT_VIEWPORT.copy())
        for command in ({"action": "pan", "direction": "north", "delta": 0.01}, {"action": "zoom", "level": 11}):
            OTEFViewportState.objects.filter(pk=stale.pk).update(gaza_border_visible=True)
            with patch.object(OTEFViewportState.objects, "get_or_create", return_value=(stale, False)):
                response = self.client.post("/api/otef_viewport/by-table/otef/command/", command, format="json")
            self.assertEqual(response.status_code, 200)
            self.assertTrue(OTEFViewportState.objects.get(pk=stale.pk).gaza_border_visible)
