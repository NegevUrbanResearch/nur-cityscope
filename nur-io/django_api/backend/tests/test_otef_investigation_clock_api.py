import json

from backend.models import OTEFViewportState, Table
from django.test import TestCase
from django.test.utils import override_settings


@override_settings(
    CHANNEL_LAYERS={
        "default": {
            "BACKEND": "channels.layers.InMemoryChannelLayer",
        }
    }
)
class OTEFInvestigationClockApiTests(TestCase):
    def setUp(self):
        self.table = Table.objects.create(name="otef")
        OTEFViewportState.objects.create(
            table=self.table,
            viewport=OTEFViewportState.DEFAULT_VIEWPORT.copy(),
            layers=OTEFViewportState.DEFAULT_LAYERS.copy(),
            animations={},
        )

    def test_get_by_table_includes_investigation_clock(self):
        res = self.client.get("/api/otef_viewport/by-table/otef/")
        self.assertEqual(res.status_code, 200)
        body = res.json()
        self.assertIn("investigation_clock", body)
        clock = body["investigation_clock"]
        self.assertEqual(clock["phase"], "idle")
        self.assertEqual(clock["membership"], [])
        self.assertEqual(clock["beats"], [])
        self.assertFalse(clock["loop"])
        self.assertEqual(clock["beatIndex"], -1)
        self.assertEqual(clock["beatElapsedMs"], 0)
        self.assertIsNone(clock["playEpochMs"])
        self.assertEqual(clock["seekKind"], "none")
        self.assertEqual(clock["revision"], 0)
        self.assertIn("serverNowMs", clock)
        self.assertIsInstance(clock["serverNowMs"], int)

    def test_patch_playing_clock_stores_membership_beats_and_revision(self):
        res = self.client.patch(
            "/api/otef_viewport/by-table/otef/",
            data=json.dumps(
                {
                    "investigation_clock": {
                        "phase": "playing",
                        "membership": ["nli.lines", "nli.alarms"],
                        "beats": [400, 420],
                        "loop": False,
                        "beatIndex": 0,
                        "beatElapsedMs": 0,
                        "playEpochMs": 1,
                        "seekKind": "none",
                        "clientOnly": True,
                    }
                }
            ),
            content_type="application/json",
        )
        self.assertEqual(res.status_code, 200)
        clock = res.json()["investigation_clock"]
        self.assertEqual(clock["phase"], "playing")
        self.assertEqual(clock["membership"], ["nli.lines", "nli.alarms"])
        self.assertEqual(clock["beats"], [400, 420])
        self.assertEqual(clock["revision"], 1)
        self.assertEqual(clock["playEpochMs"], 1)
        self.assertNotIn("clientOnly", clock)
        self.assertIn("serverNowMs", clock)
        self.assertIsInstance(clock["serverNowMs"], int)

        state = OTEFViewportState.objects.get(table=self.table)
        self.assertEqual(state.investigation_clock["revision"], 1)
        self.assertEqual(
            state.investigation_clock["membership"],
            ["nli.lines", "nli.alarms"],
        )
        self.assertEqual(state.investigation_clock["beats"], [400, 420])

    def test_patch_rejects_unknown_phase(self):
        res = self.client.patch(
            "/api/otef_viewport/by-table/otef/",
            data=json.dumps({"investigation_clock": {"phase": "rewinding"}}),
            content_type="application/json",
        )
        self.assertNotEqual(res.status_code, 200)

    def test_patch_rejects_non_playable_membership(self):
        res = self.client.patch(
            "/api/otef_viewport/by-table/otef/",
            data=json.dumps(
                {
                    "investigation_clock": {
                        "phase": "playing",
                        "membership": ["nli.people"],
                        "beats": [400],
                        "loop": False,
                        "beatIndex": 0,
                        "beatElapsedMs": 0,
                        "playEpochMs": 1,
                        "seekKind": "none",
                    }
                }
            ),
            content_type="application/json",
        )
        self.assertNotEqual(res.status_code, 200)

    def test_patch_rejects_unknown_seek_kind(self):
        res = self.client.patch(
            "/api/otef_viewport/by-table/otef/",
            data=json.dumps(
                {
                    "investigation_clock": {
                        "phase": "paused",
                        "membership": ["nli.investigation_polygons"],
                        "beats": [400],
                        "loop": False,
                        "beatIndex": 0,
                        "beatElapsedMs": 0,
                        "playEpochMs": None,
                        "seekKind": "scrub",
                    }
                }
            ),
            content_type="application/json",
        )
        self.assertNotEqual(res.status_code, 200)

    def test_patch_preserves_loop_on_idle(self):
        self.client.patch(
            "/api/otef_viewport/by-table/otef/",
            data=json.dumps({
                "investigation_clock": {
                    "phase": "playing",
                    "membership": ["nli.lines"],
                    "beats": [400],
                    "loop": True,
                    "beatIndex": 0,
                    "beatElapsedMs": 0,
                    "playEpochMs": 1,
                    "seekKind": "none",
                }
            }),
            content_type="application/json",
        )
        res = self.client.patch(
            "/api/otef_viewport/by-table/otef/",
            data=json.dumps({"investigation_clock": {"phase": "idle", "loop": True}}),
            content_type="application/json",
        )
        clock = res.json()["investigation_clock"]
        self.assertEqual(clock["phase"], "idle")
        self.assertTrue(clock["loop"])
        self.assertIn("serverNowMs", clock)

    def test_patch_round_trips_seek_kind_jump(self):
        res = self.client.patch(
            "/api/otef_viewport/by-table/otef/",
            data=json.dumps({
                "investigation_clock": {
                    "phase": "paused",
                    "membership": ["nli.investigation_polygons"],
                    "beats": [400, 420],
                    "loop": False,
                    "beatIndex": 1,
                    "beatElapsedMs": 0,
                    "playEpochMs": None,
                    "seekKind": "jump",
                }
            }),
            content_type="application/json",
        )
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.json()["investigation_clock"]["seekKind"], "jump")

    def test_patch_paused_jump_keeps_play_epoch_ms(self):
        res = self.client.patch(
            "/api/otef_viewport/by-table/otef/",
            data=json.dumps({
                "investigation_clock": {
                    "phase": "paused",
                    "membership": ["nli.investigation_polygons"],
                    "beats": [400, 420],
                    "loop": False,
                    "beatIndex": 1,
                    "beatElapsedMs": 0,
                    "playEpochMs": 123,
                    "seekKind": "jump",
                }
            }),
            content_type="application/json",
        )
        self.assertEqual(res.status_code, 200)
        clock = res.json()["investigation_clock"]
        self.assertEqual(clock["phase"], "paused")
        self.assertEqual(clock["seekKind"], "jump")
        self.assertEqual(clock["playEpochMs"], 123)

        state = OTEFViewportState.objects.get(table=self.table)
        self.assertEqual(state.investigation_clock["playEpochMs"], 123)
