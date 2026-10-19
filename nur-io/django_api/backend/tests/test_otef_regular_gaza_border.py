"""Regular border controls must not disagree with the display visibility override."""

from unittest.mock import AsyncMock, patch

from django.test import TestCase
from rest_framework.test import APIClient

from backend.models import LayerGroup, LayerState, OTEFViewportState, Table


STATE_URL = "/api/otef_viewport/by-table/otef/"


class RegularGazaBorderTests(TestCase):
    def setUp(self):
        self.table = Table.objects.create(name="otef")
        self.state = OTEFViewportState.objects.create(table=self.table, experience_revision=2)
        LayerGroup.objects.create(table=self.table, group_id="gaza", enabled=False)
        self.border = LayerState.objects.create(table=self.table, layer_id="gaza.gaza_border", enabled=False)
        self.client = APIClient()
        self.scope = {"experience": "regular", "experience_revision": 2}

    def command(self, payload):
        return self.client.post(STATE_URL + "command/", {**payload, **self.scope}, format="json")

    @patch("channels.layers.get_channel_layer")
    def test_compact_and_group_controls_sync_flag_and_broadcast_accepted_scope(self, channels):
        channels.return_value.group_send = AsyncMock()
        commands = (
            {"action": "set_layer_toggles", "changes": [{"full_layer_id": "gaza.gaza_border", "enabled": True}]},
            {"action": "set_layers_enabled", "full_layer_ids": ["gaza.gaza_border"], "enabled": False},
            {"action": "set_group_enabled", "group_id": "gaza", "enabled": True},
        )
        for command, enabled in zip(commands, (True, False, True)):
            channels.return_value.group_send.reset_mock()
            with self.captureOnCommitCallbacks(execute=True):
                response = self.command(command)
            self.assertEqual(response.status_code, 200)
            self.assertEqual(response.data.get("gaza_border_visible"), enabled)
            self.state.refresh_from_db()
            self.border.refresh_from_db()
            self.assertEqual((self.border.enabled, self.state.gaza_border_visible), (enabled, enabled))
            events = [call.args[1]["message"] for call in channels.return_value.group_send.call_args_list]
            visibility = next(event for event in events if event["type"] == "otef_gaza_border_visibility_changed")
            layers = next(event for event in events if event["type"] == "otef_layers_changed")
            self.assertEqual(layers["gazaBorderVisible"], enabled)
            self.assertEqual(visibility["gazaBorderVisible"], enabled)
            self.assertEqual({key: visibility[key] for key in self.scope}, self.scope)

    def test_nli_layer_commands_keep_independent_display_override(self):
        self.state.active_experience = "nli"
        self.state.save()
        self.scope["experience"] = "nli"
        response = self.command({"action": "set_layers_enabled", "full_layer_ids": ["gaza.gaza_border"], "enabled": True})
        self.assertEqual(response.status_code, 200)
        self.state.refresh_from_db()
        self.border.refresh_from_db()
        self.assertTrue(self.border.enabled)
        self.assertFalse(self.state.gaza_border_visible)
        response = self.client.patch(STATE_URL, {"layerGroups": [{"id": "gaza", "enabled": True,
            "layers": [{"id": "gaza_border", "enabled": True}]}], "gaza_border_visible": False, **self.scope}, format="json")
        self.assertEqual(response.status_code, 200)
        self.assertFalse(response.data["gaza_border_visible"])

    def test_fallback_patch_syncs_regular_border_and_rejects_invalid_patch_without_partial_write(self):
        groups = [{"id": "gaza", "enabled": True, "layers": [{"id": "gaza_border", "enabled": True}]}]
        invalid = self.client.patch(STATE_URL, {"layerGroups": groups, "viewer_angle_deg": "invalid", **self.scope}, format="json")
        self.assertEqual(invalid.status_code, 400)
        self.border.refresh_from_db()
        self.assertFalse(self.border.enabled)
        conflict = self.client.patch(STATE_URL, {"layerGroups": groups, "gaza_border_visible": False, **self.scope}, format="json")
        self.assertEqual(conflict.status_code, 400)
        with self.captureOnCommitCallbacks(execute=True):
            response = self.client.patch(STATE_URL, {"layerGroups": groups, **self.scope}, format="json")
        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.data["gaza_border_visible"])
        self.state.refresh_from_db()
        self.border.refresh_from_db()
        self.assertTrue(self.state.gaza_border_visible and self.border.enabled)

    def test_stale_and_unrelated_layer_writes_do_not_change_override(self):
        self.scope["experience_revision"] = 1
        response = self.command({"action": "set_layers_enabled", "full_layer_ids": ["gaza.gaza_border"], "enabled": True})
        self.assertEqual(response.status_code, 409)
        self.scope["experience_revision"] = 2
        response = self.command({"action": "set_layers_enabled", "full_layer_ids": ["gaza.Gaza_Roads"], "enabled": True})
        self.assertEqual(response.status_code, 200)
        self.state.refresh_from_db()
        self.assertFalse(self.state.gaza_border_visible)
