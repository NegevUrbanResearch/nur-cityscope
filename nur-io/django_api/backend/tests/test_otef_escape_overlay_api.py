import importlib
import json
from unittest.mock import AsyncMock, patch

from django.db import models, transaction
from django.test import SimpleTestCase, TestCase

from backend.models import OTEFViewportState, Table
from backend.otef_narrative import transition_narrative_scene


class EscapeOverlayMigrationTests(SimpleTestCase):
    def test_0021_adds_blank_json_field_after_projection_calibration(self):
        migration = importlib.import_module(
            "backend.migrations.0021_otefviewportstate_escape_overlay"
        ).Migration

        self.assertEqual(
            migration.dependencies,
            [("backend", "0020_otefprojectioncalibration")],
        )
        operation = migration.operations[0]
        self.assertEqual(operation.model_name, "otefviewportstate")
        self.assertEqual(operation.name, "escape_overlay")
        self.assertIsInstance(operation.field, models.JSONField)
        self.assertEqual(operation.field.default, dict)
        self.assertTrue(operation.field.blank)


class EscapeOverlaySceneTests(TestCase):
    def setUp(self):
        self.table = Table.objects.create(name="otef")
        self.state = OTEFViewportState.objects.create(
            table=self.table,
            narrative_state={"id": None, "transition": "exit", "revision": 3},
            basemap="osm",
            investigation_clock={"phase": "playing", "revision": 7},
            person_selection={
                "personId": "11",
                "datasetVersion": "v1",
                "revision": 2,
            },
        )

    def command(self, action, **payload):
        with self.captureOnCommitCallbacks(execute=True):
            return self.client.post(
                "/api/otef_viewport/by-table/otef/command/",
                json.dumps({"action": action, **payload}),
                content_type="application/json",
            )

    def test_enter_nova_writes_enter_defaults_and_exit_zeros(self):
        with transaction.atomic():
            locked = OTEFViewportState.objects.select_for_update().get(pk=self.state.pk)
            scene = transition_narrative_scene(locked, "nova", 3)

        self.assertEqual(
            scene["escapeOverlay"], {"individual": False, "overlap": False, "mor": False}
        )
        self.assertEqual(
            locked.escape_overlay, {"individual": False, "overlap": False, "mor": False}
        )
        self.assertEqual(
            scene["narrativeState"],
            {"id": "nova", "transition": "enter", "revision": 4},
        )

        with transaction.atomic():
            scene = transition_narrative_scene(locked, None, scene["sceneRevision"])

        self.assertEqual(
            scene["escapeOverlay"], {"individual": False, "overlap": False, "mor": False}
        )
        self.assertEqual(
            locked.escape_overlay, {"individual": False, "overlap": False, "mor": False}
        )

    def test_replace_nova_to_segev_zeros_overlay(self):
        with transaction.atomic():
            locked = OTEFViewportState.objects.select_for_update().get(pk=self.state.pk)
            scene = transition_narrative_scene(locked, "nova", 3)
            scene = transition_narrative_scene(
                locked, "segev", scene["sceneRevision"]
            )

        self.assertEqual(scene["narrativeState"]["id"], "segev")
        self.assertEqual(scene["narrativeState"]["transition"], "replace")
        self.assertEqual(
            scene["escapeOverlay"], {"individual": False, "overlap": False, "mor": False}
        )
        self.assertEqual(
            locked.escape_overlay, {"individual": False, "overlap": False, "mor": False}
        )

    @patch("channels.layers.get_channel_layer")
    def test_overlay_patch_does_not_bump_narrative_revision(self, get_layer):
        get_layer.return_value.group_send = AsyncMock()
        enter = self.command(
            "set_narrative",
            narrativeId="nova",
            expectedRevision=3,
            sourceId="remote-a",
        )
        self.assertEqual(enter.status_code, 200)
        revision = enter.json()["scene"]["narrativeState"]["revision"]
        self.assertEqual(enter.json()["scene"]["escapeOverlay"], {
            "individual": False,
            "overlap": False,
            "mor": False,
        })

        response = self.command(
            "set_escape_overlay",
            individual=False,
            overlap=True,
            mor=True,
            sourceId="remote-a",
            timestamp=123,
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(
            response.json(),
            {
                "status": "ok",
                "action": "set_escape_overlay",
                "escapeOverlay": {"individual": False, "overlap": True, "mor": True},
            },
        )

        self.state.refresh_from_db()
        self.assertEqual(self.state.narrative_state["revision"], revision)
        self.assertEqual(self.state.narrative_state["id"], "nova")
        self.assertEqual(
            self.state.escape_overlay, {"individual": False, "overlap": True, "mor": True}
        )

        listed = self.client.get("/api/otef_viewport/by-table/otef/")
        self.assertEqual(listed.status_code, 200)
        self.assertEqual(
            listed.json()["escape_overlay"],
            {"individual": False, "overlap": True, "mor": True},
        )
        self.assertEqual(listed.json()["narrative_state"]["revision"], revision)

        overlay_messages = [
            call.args[1]["message"]
            for call in get_layer.return_value.group_send.call_args_list
            if call.args[1]["message"]["type"] == "otef_escape_overlay_changed"
        ]
        self.assertEqual(len(overlay_messages), 1)
        self.assertEqual(
            overlay_messages[0],
            {
                "type": "otef_escape_overlay_changed",
                "table": "otef",
                "escapeOverlay": {"individual": False, "overlap": True, "mor": True},
                "sourceId": "remote-a",
                "timestamp": 123,
            },
        )

    @patch("channels.layers.get_channel_layer")
    def test_overlay_patch_while_segev_forces_both_false(self, get_layer):
        get_layer.return_value.group_send = AsyncMock()
        enter = self.command(
            "set_narrative",
            narrativeId="segev",
            expectedRevision=3,
        )
        self.assertEqual(enter.status_code, 200)
        revision = enter.json()["scene"]["narrativeState"]["revision"]

        response = self.command(
            "set_escape_overlay",
            individual=True,
            overlap=True,
            sourceId="remote-b",
            timestamp=456,
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(
            response.json()["escapeOverlay"],
            {"individual": False, "overlap": False, "mor": False},
        )
        self.state.refresh_from_db()
        self.assertEqual(self.state.narrative_state["id"], "segev")
        self.assertEqual(self.state.narrative_state["revision"], revision)
        self.assertEqual(
            self.state.escape_overlay, {"individual": False, "overlap": False, "mor": False}
        )
        listed = self.client.get("/api/otef_viewport/by-table/otef/")
        self.assertEqual(
            listed.json()["escape_overlay"],
            {"individual": False, "overlap": False, "mor": False},
        )

    def test_presentation_open_for_nova_is_400(self):
        enter = self.command(
            "set_narrative",
            narrativeId="nova",
            expectedRevision=3,
        )
        self.assertEqual(enter.status_code, 200)

        response = self.command(
            "narrative_presentation",
            presentationAction="open",
            narrativeId="nova",
            requestId="request-nova",
            sourceId="remote-a",
        )

        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json()["error"], "narrative has no presentation")
        self.state.refresh_from_db()
        self.assertEqual(self.state.narrative_state["id"], "nova")
