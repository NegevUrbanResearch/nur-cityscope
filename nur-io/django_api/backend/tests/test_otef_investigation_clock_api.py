import json
from unittest.mock import AsyncMock, patch

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

    def canonical_clock(self, **overrides):
        clock = {
            "phase": "playing",
            "membership": ["nli.lines", "nli.alarms"],
            "beats": [400, 420],
            "loop": False,
            "positionMs": 125.5,
            "anchorMs": 1000.25,
            "seekKind": "none",
        }
        clock.update(overrides)
        return clock

    def test_patch_persists_full_canonical_semantics_verbatim(self):
        payload = self.canonical_clock(
            phase="paused",
            positionMs=3325.5,
            anchorMs=5000.25,
            seekKind="jump",
            alarmOnsetOriginMs=5000.25,
            revision=999,
            serverNowMs=999999,
        )
        response = self.client.patch(
            "/api/otef_viewport/by-table/otef/",
            data=json.dumps({"investigation_clock": payload}),
            content_type="application/json",
        )

        self.assertEqual(response.status_code, 200)
        state = OTEFViewportState.objects.get(table=self.table)
        self.assertEqual(
            state.investigation_clock,
            {
                key: value
                for key, value in payload.items()
                if key not in ("revision", "serverNowMs")
            }
            | {"revision": 1},
        )
        self.assertNotIn("serverNowMs", state.investigation_clock)
        self.assertIsInstance(response.json()["investigation_clock"]["serverNowMs"], int)

    def test_patch_rejects_partial_and_expanded_non_idle_clocks(self):
        for clock in (
            {"phase": "playing", "membership": ["nli.lines"], "beats": [400]},
            self.canonical_clock(beatIndex=0),
        ):
            with self.subTest(clock=clock):
                response = self.client.patch(
                    "/api/otef_viewport/by-table/otef/",
                    data=json.dumps({"investigation_clock": clock}),
                    content_type="application/json",
                )
                self.assertEqual(response.status_code, 400)

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
        self.assertEqual(clock["positionMs"], 0)
        self.assertIsNone(clock["anchorMs"])
        self.assertEqual(clock["seekKind"], "none")
        self.assertEqual(clock["revision"], 0)
        self.assertIn("serverNowMs", clock)
        self.assertIsInstance(clock["serverNowMs"], int)

    def test_patch_playing_clock_stores_membership_beats_and_revision(self):
        res = self.client.patch(
            "/api/otef_viewport/by-table/otef/",
            data=json.dumps(
                {
                    "investigation_clock": self.canonical_clock()
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
        self.assertEqual(clock["positionMs"], 125.5)
        self.assertEqual(clock["anchorMs"], 1000.25)
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
        for membership in (["nli.people"], [{"id": "nli.lines"}]):
            with self.subTest(membership=membership):
                res = self.client.patch(
                    "/api/otef_viewport/by-table/otef/",
                    data=json.dumps({
                        "investigation_clock": self.canonical_clock(
                            membership=membership, beats=[400]
                        )
                    }),
                    content_type="application/json",
                )
                self.assertEqual(res.status_code, 400)

    def test_patch_rejects_unknown_seek_kind(self):
        res = self.client.patch(
            "/api/otef_viewport/by-table/otef/",
            data=json.dumps(
                {
                    "investigation_clock": self.canonical_clock(
                        phase="paused",
                        membership=["nli.investigation_polygons"],
                        beats=[400],
                        seekKind="scrub",
                    )
                }
            ),
            content_type="application/json",
        )
        self.assertNotEqual(res.status_code, 200)

    def test_patch_preserves_loop_on_idle(self):
        self.client.patch(
            "/api/otef_viewport/by-table/otef/",
            data=json.dumps({
                "investigation_clock": self.canonical_clock(
                    membership=["nli.lines"], beats=[400], loop=True
                )
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

    def test_idle_patch_uses_locked_clock_revision(self):
        state = OTEFViewportState.objects.get(table=self.table)
        state.investigation_clock = self.canonical_clock(revision=4)
        state.save(update_fields=["investigation_clock"])

        def newer_locked_state(stale):
            locked = OTEFViewportState.objects.get(pk=stale.pk)
            locked.investigation_clock = self.canonical_clock(revision=7)
            return locked

        with patch(
            "backend.views.lock_person_selection_state",
            side_effect=newer_locked_state,
        ) as lock_state:
            response = self.client.patch(
                "/api/otef_viewport/by-table/otef/",
                data=json.dumps({
                    "viewport": {"zoom": 13},
                    "investigation_clock": {"phase": "idle", "loop": True},
                }),
                content_type="application/json",
            )

        lock_state.assert_called_once()
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["investigation_clock"]["revision"], 8)
        self.assertEqual(response.json()["viewport"]["zoom"], 13)
        state.refresh_from_db()
        self.assertEqual(state.investigation_clock["revision"], 8)

    def test_patch_round_trips_seek_kind_jump(self):
        res = self.client.patch(
            "/api/otef_viewport/by-table/otef/",
            data=json.dumps({
                "investigation_clock": self.canonical_clock(
                    phase="paused",
                    membership=["nli.investigation_polygons"],
                    positionMs=3200,
                    anchorMs=123,
                    seekKind="jump",
                )
            }),
            content_type="application/json",
        )
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.json()["investigation_clock"]["seekKind"], "jump")

    def test_patch_paused_jump_keeps_anchor_ms(self):
        res = self.client.patch(
            "/api/otef_viewport/by-table/otef/",
            data=json.dumps({
                "investigation_clock": self.canonical_clock(
                    phase="paused",
                    membership=["nli.investigation_polygons"],
                    positionMs=3200,
                    anchorMs=123,
                    seekKind="jump",
                )
            }),
            content_type="application/json",
        )
        self.assertEqual(res.status_code, 200)
        clock = res.json()["investigation_clock"]
        self.assertEqual(clock["phase"], "paused")
        self.assertEqual(clock["seekKind"], "jump")
        self.assertEqual(clock["anchorMs"], 123)

        state = OTEFViewportState.objects.get(table=self.table)
        self.assertEqual(state.investigation_clock["anchorMs"], 123)

    def test_patch_round_trips_semantic_clock_fields(self):
        res = self.client.patch(
            "/api/otef_viewport/by-table/otef/",
            data=json.dumps(
                {
                    "investigation_clock": self.canonical_clock(
                        phase="paused",
                        membership=["nli.alarms"],
                        loop=True,
                        positionMs=27400.25,
                        anchorMs=30000.5,
                        alarmOnsetOriginMs=1400.25,
                    )
                }
            ),
            content_type="application/json",
        )

        self.assertEqual(res.status_code, 200)
        clock = res.json()["investigation_clock"]
        self.assertEqual(
            {
                key: clock.get(key)
                for key in ("positionMs", "anchorMs", "alarmOnsetOriginMs")
            },
            {
                "positionMs": 27400.25,
                "anchorMs": 30000.5,
                "alarmOnsetOriginMs": 1400.25,
            },
        )

    def test_patch_rejects_removed_parallel_semantic_fields(self):
        res = self.client.patch(
            "/api/otef_viewport/by-table/otef/",
            data=json.dumps(
                {
                    "investigation_clock": {
                        "phase": "playing",
                        "membership": ["nli.lines"],
                        "beats": [400],
                        "cycleIndex": 2.9,
                        "cycleKey": -3.9,
                        "narrativeElapsedMs": -12.75,
                        "alarmOnsetCycleIndex": -4.5,
                        "seekKind": "none",
                    }
                }
            ),
            content_type="application/json",
        )

        self.assertEqual(res.status_code, 400)

    def test_patch_rejects_invalid_optional_and_unknown_fields(self):
        res = self.client.patch(
            "/api/otef_viewport/by-table/otef/",
            data=json.dumps(
                {
                    "investigation_clock": {
                        "phase": "paused",
                        "membership": ["nli.alarms"],
                        "beats": [400],
                        "narrativeEpochMs": "not-a-number",
                        "alarmOnsetBeat": "not-a-number",
                        "alarmOnsetOriginMs": "not-a-number",
                        "alarmOnsetCycleIndex": "not-a-number",
                        "alarmOnsetCycleOrdinal": 3,
                        "clientOnly": True,
                        "seekKind": "none",
                    }
                }
            ),
            content_type="application/json",
        )

        self.assertEqual(res.status_code, 400)

    def test_patch_idle_resets_semantic_clock_state_and_onset_metadata(self):
        self.client.patch(
            "/api/otef_viewport/by-table/otef/",
            data=json.dumps(
                {
                    "investigation_clock": self.canonical_clock(
                        membership=["nli.alarms"],
                        beats=[400],
                        loop=True,
                        alarmOnsetOriginMs=1000,
                    )
                }
            ),
            content_type="application/json",
        )
        res = self.client.patch(
            "/api/otef_viewport/by-table/otef/",
            data=json.dumps({"investigation_clock": {"phase": "idle", "loop": True}}),
            content_type="application/json",
        )

        self.assertEqual(res.status_code, 200)
        clock = res.json()["investigation_clock"]
        self.assertEqual(clock["phase"], "idle")
        self.assertTrue(clock["loop"])
        self.assertEqual(clock["positionMs"], 0)
        self.assertIsNone(clock["anchorMs"])
        self.assertNotIn("alarmOnsetOriginMs", clock)

    @patch("channels.layers.get_channel_layer")
    def test_patch_active_clock_clears_person_before_clock_broadcast(self, get_layer):
        get_layer.return_value.group_send = AsyncMock()
        self.client.post(
            "/api/otef_viewport/by-table/otef/command/",
            data=json.dumps(
                {
                    "action": "select_person",
                    "personId": "11",
                    "datasetVersion": "v1",
                    "expectedRevision": 0,
                }
            ),
            content_type="application/json",
        )
        get_layer.return_value.group_send.reset_mock()
        with self.captureOnCommitCallbacks(execute=True):
            response = self.client.patch(
                "/api/otef_viewport/by-table/otef/",
                data=json.dumps(
                    {
                        "investigation_clock": self.canonical_clock(
                            membership=["nli.lines"], beats=[400]
                        )
                    }
                ),
                content_type="application/json",
            )
        self.assertEqual(response.status_code, 200)
        messages = [call.args[1]["message"]["type"] for call in get_layer.return_value.group_send.call_args_list]
        self.assertEqual(
            messages,
            ["otef_person_selection_changed", "otef_investigation_clock_changed"],
        )
        self.assertIsNone(response.json()["person_selection"]["personId"])

    def test_mixed_active_clock_patch_preserves_all_partial_fields(self):
        state = OTEFViewportState.objects.get(table=self.table)
        state.person_selection = {"personId": "11", "datasetVersion": "v1", "revision": 1}
        state.save(update_fields=["person_selection"])
        response = self.client.patch(
            "/api/otef_viewport/by-table/otef/",
            data=json.dumps(
                {
                    "viewport": {"bbox": [1, 2, 3, 4], "corners": None, "zoom": 12},
                    "layers": {"roads": False},
                    "basemap": "satellite",
                    "projection_slideshow": {"type": "start", "payload": {"intervalMs": 1000}},
                    "investigation_clock": self.canonical_clock(
                        membership=["nli.lines"], beats=[400]
                    ),
                }
            ),
            content_type="application/json",
        )
        self.assertEqual(response.status_code, 200)
        state.refresh_from_db()
        self.assertEqual(state.viewport["bbox"], [1, 2, 3, 4])
        self.assertEqual(state.layers, {"roads": False})
        self.assertEqual(state.basemap, "satellite")
        self.assertEqual(state.projection_slideshow["type"], "start")
        self.assertEqual(state.investigation_clock["phase"], "playing")
        self.assertIsNone(state.person_selection["personId"])
