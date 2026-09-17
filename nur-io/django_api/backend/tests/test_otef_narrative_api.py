import importlib
import json
from concurrent.futures import ThreadPoolExecutor
from unittest.mock import AsyncMock, patch

from django.db import close_old_connections, models, transaction
from django.test import (
    Client,
    SimpleTestCase,
    TestCase,
    TransactionTestCase,
    skipUnlessDBFeature,
)

from backend.models import OTEFViewportState, Table
from backend.otef_escape_overlay import (
    EMPTY_ESCAPE_OVERLAY,
    NOVA_ENTER_ESCAPE_OVERLAY,
)
from backend.otef_investigation_clock import idle_investigation_clock
from backend.otef_narrative import (
    empty_narrative_state,
    normalize_narrative_state,
    transition_narrative_scene,
    transition_narrative_state,
)


class InvestigationClockStateTests(SimpleTestCase):
    def test_idle_constructor_returns_the_exact_shared_schema(self):
        self.assertEqual(
            idle_investigation_clock(loop=True, revision=7),
            {
                "phase": "idle",
                "membership": [],
                "beats": [],
                "loop": True,
                "positionMs": 0,
                "anchorMs": None,
                "seekKind": "none",
                "revision": 7,
            },
        )


class NarrativeStateNormalizationTests(SimpleTestCase):
    def test_empty_and_normalized_shapes_are_canonical(self):
        self.assertEqual(
            empty_narrative_state(),
            {"id": None, "transition": "initial", "revision": 0},
        )
        self.assertEqual(
            normalize_narrative_state(
                {"id": "segev", "transition": "enter", "revision": 4}
            ),
            {"id": "segev", "transition": "enter", "revision": 4},
        )
        self.assertEqual(
            normalize_narrative_state(
                {"id": None, "transition": "exit", "revision": 5}
            ),
            {"id": None, "transition": "exit", "revision": 5},
        )

    def test_malformed_state_and_unsupported_ids_reset_to_initial(self):
        initial = {"id": None, "transition": "initial", "revision": 0}
        for raw in (
            None,
            [],
            {},
            {"id": "unknown", "transition": "enter", "revision": 3},
            {"id": "segev", "transition": "exit", "revision": 3},
            {"id": "segev", "transition": [], "revision": 3},
            {"id": None, "transition": "enter", "revision": 3},
            {"id": "segev", "transition": "enter", "revision": True},
            {"id": "segev", "transition": "enter", "revision": -1},
        ):
            with self.subTest(raw=raw):
                self.assertEqual(normalize_narrative_state(raw), initial)

    def test_nova_is_an_allowed_narrative_id(self):
        from backend.otef_narrative import NARRATIVE_IDS, NARRATIVE_PRESENTATION_IDS

        self.assertEqual(
            NARRATIVE_IDS, frozenset({"segev", "nova", "sderot", "hostages"})
        )
        self.assertEqual(NARRATIVE_PRESENTATION_IDS, frozenset({"segev"}))

    def test_sderot_and_hostages_normalize(self):
        self.assertEqual(
            normalize_narrative_state(
                {"id": "sderot", "transition": "enter", "revision": 2}
            ),
            {"id": "sderot", "transition": "enter", "revision": 2},
        )
        self.assertEqual(
            normalize_narrative_state(
                {"id": "hostages", "transition": "replace", "revision": 3}
            ),
            {"id": "hostages", "transition": "replace", "revision": 3},
        )

    def test_normalize_still_strips_unknown_narrative_keys(self):
        self.assertEqual(
            normalize_narrative_state(
                {
                    "id": "nova",
                    "transition": "enter",
                    "revision": 2,
                    "escapeOverlay": {"individual": True},
                }
            ),
            {"id": "nova", "transition": "enter", "revision": 2},
        )

    def test_revision_zero_always_normalizes_to_inactive_initial(self):
        self.assertEqual(
            normalize_narrative_state(
                {"id": "segev", "transition": "enter", "revision": 0}
            ),
            {"id": None, "transition": "initial", "revision": 0},
        )

    def test_transition_matches_target_and_replacement_uses_replace(self):
        class LockedState:
            narrative_state = empty_narrative_state(3)

        locked = LockedState()
        entered = transition_narrative_state(locked, "segev", 3)
        self.assertEqual(
            entered,
            {"id": "segev", "transition": "enter", "revision": 4},
        )

        locked.narrative_state = entered
        replaced = transition_narrative_state(locked, "segev", 4)
        self.assertEqual(
            replaced,
            {"id": "segev", "transition": "replace", "revision": 5},
        )

        locked.narrative_state = replaced
        exited = transition_narrative_state(locked, None, 5)
        self.assertEqual(
            exited,
            {"id": None, "transition": "exit", "revision": 6},
        )

    def test_transition_rejects_invalid_target_and_revision_types(self):
        class LockedState:
            narrative_state = empty_narrative_state()

        for narrative_id, expected_revision in (
            ("unknown", 0),
            (7, 0),
            ("segev", False),
            ("segev", "0"),
            ("segev", -1),
        ):
            with self.subTest(
                narrative_id=narrative_id, expected_revision=expected_revision
            ):
                with self.assertRaises(ValueError):
                    transition_narrative_state(
                        LockedState(), narrative_id, expected_revision
                    )


class NarrativeMigrationTests(SimpleTestCase):
    def test_0019_adds_blank_json_field_after_person_selection(self):
        migration = importlib.import_module(
            "backend.migrations.0019_otefviewportstate_narrative_state"
        ).Migration

        self.assertEqual(
            migration.dependencies,
            [("backend", "0018_otefviewportstate_person_selection")],
        )
        operation = migration.operations[0]
        self.assertEqual(operation.model_name, "otefviewportstate")
        self.assertEqual(operation.name, "narrative_state")
        self.assertIsInstance(operation.field, models.JSONField)
        self.assertEqual(operation.field.default, dict)
        self.assertTrue(operation.field.blank)


class OTEFNarrativeApiTests(TestCase):
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

    def activate(self, expected_revision=3, **payload):
        return self.command(
            "set_narrative",
            narrativeId="segev",
            expectedRevision=expected_revision,
            **payload,
        )

    def test_locked_transition_helper_owns_coupled_state_and_returns_scene(self):
        with transaction.atomic():
            locked = OTEFViewportState.objects.select_for_update().get(pk=self.state.pk)
            scene = transition_narrative_scene(locked, "segev", 3)

        self.assertEqual(scene["sceneRevision"], 4)
        self.assertEqual(
            scene["narrativeState"],
            {"id": "segev", "transition": "enter", "revision": 4},
        )
        self.assertEqual(scene["basemap"], "satellite_bw")
        self.assertEqual(scene["investigationClock"]["phase"], "idle")
        self.assertEqual(scene["investigationClock"]["revision"], 8)
        self.assertEqual(
            scene["personSelection"],
            {"personId": None, "datasetVersion": None, "revision": 3},
        )

    def test_sderot_hostages_scene_enter_replace_exit(self):
        with transaction.atomic():
            locked = OTEFViewportState.objects.select_for_update().get(pk=self.state.pk)
            entered = transition_narrative_scene(locked, "sderot", 3)
            self.assertEqual(entered["narrativeState"]["transition"], "enter")
            self.assertEqual(entered["narrativeState"]["id"], "sderot")
            self.assertEqual(entered["basemap"], "satellite_bw")
            self.assertEqual(entered["investigationClock"]["phase"], "idle")
            self.assertEqual(
                entered["personSelection"]["personId"],
                None,
            )
            self.assertEqual(entered["escapeOverlay"], dict(EMPTY_ESCAPE_OVERLAY))

            locked.narrative_state = entered["narrativeState"]
            replaced = transition_narrative_scene(
                locked, "hostages", entered["narrativeState"]["revision"]
            )
            self.assertEqual(replaced["narrativeState"]["transition"], "replace")
            self.assertEqual(replaced["narrativeState"]["id"], "hostages")
            self.assertEqual(replaced["basemap"], "satellite_bw")
            self.assertEqual(replaced["escapeOverlay"], dict(EMPTY_ESCAPE_OVERLAY))

            locked.narrative_state = replaced["narrativeState"]
            exited = transition_narrative_scene(
                locked, None, replaced["narrativeState"]["revision"]
            )
            self.assertEqual(exited["narrativeState"]["id"], None)
            self.assertEqual(exited["narrativeState"]["transition"], "exit")
            self.assertEqual(exited["basemap"], "dark")
            self.assertEqual(exited["escapeOverlay"], dict(EMPTY_ESCAPE_OVERLAY))

    def test_nova_overlay_clears_on_sderot_and_restores_on_nova_replace(self):
        with transaction.atomic():
            locked = OTEFViewportState.objects.select_for_update().get(pk=self.state.pk)
            nova = transition_narrative_scene(locked, "nova", 3)
            self.assertEqual(nova["escapeOverlay"], dict(NOVA_ENTER_ESCAPE_OVERLAY))
            locked.narrative_state = nova["narrativeState"]
            sderot = transition_narrative_scene(
                locked, "sderot", nova["narrativeState"]["revision"]
            )
            self.assertEqual(sderot["escapeOverlay"], dict(EMPTY_ESCAPE_OVERLAY))
            locked.narrative_state = sderot["narrativeState"]
            back = transition_narrative_scene(
                locked, "nova", sderot["narrativeState"]["revision"]
            )
            self.assertEqual(back["escapeOverlay"], dict(NOVA_ENTER_ESCAPE_OVERLAY))

    @patch("channels.layers.get_channel_layer")
    def test_activation_persists_one_captured_scene_and_broadcasts_after_commit(
        self, get_layer
    ):
        get_layer.return_value.group_send = AsyncMock()
        response = self.activate(sourceId="remote-a", timestamp=123, traceId="trace-a")

        self.assertEqual(response.status_code, 200)
        scene = response.json()["scene"]
        self.assertEqual(scene["sceneRevision"], 4)
        self.assertEqual(
            scene["narrativeState"],
            {"id": "segev", "transition": "enter", "revision": 4},
        )
        self.assertEqual(scene["basemap"], "satellite_bw")
        self.assertEqual(scene["investigationClock"]["phase"], "idle")
        self.assertEqual(scene["investigationClock"]["revision"], 8)
        self.assertEqual(
            scene["personSelection"],
            {"personId": None, "datasetVersion": None, "revision": 3},
        )

        self.state.refresh_from_db()
        self.assertEqual(self.state.narrative_state, scene["narrativeState"])
        self.assertEqual(self.state.basemap, scene["basemap"])
        self.assertEqual(self.state.investigation_clock, scene["investigationClock"])
        self.assertEqual(self.state.person_selection, scene["personSelection"])

        get_layer.return_value.group_send.assert_called_once()
        group, envelope = get_layer.return_value.group_send.call_args.args
        self.assertEqual(group, "otef_channel")
        self.assertEqual(
            envelope,
            {
                "type": "broadcast_message",
                "message": {
                    "type": "otef_narrative_scene_changed",
                    "table": "otef",
                    "scene": scene,
                    "sourceId": "remote-a",
                    "timestamp": 123,
                    "traceId": "trace-a",
                },
            },
        )

    @patch("channels.layers.get_channel_layer")
    def test_ordinary_patch_defers_channel_io_until_after_commit(self, get_layer):
        get_layer.return_value.group_send = AsyncMock()

        with self.captureOnCommitCallbacks(execute=False) as callbacks:
            response = self.client.patch(
                "/api/otef_viewport/by-table/otef/",
                json.dumps({"basemap": "satellite"}),
                content_type="application/json",
            )
            self.assertEqual(response.status_code, 200)
            get_layer.return_value.group_send.assert_not_called()

        self.assertEqual(len(callbacks), 1)
        callbacks[0]()
        get_layer.return_value.group_send.assert_called_once()
        message = get_layer.return_value.group_send.call_args.args[1]["message"]
        self.assertEqual(message["type"], "otef_basemap_changed")
        self.assertEqual(message["basemap"], "satellite")

    @patch("channels.layers.get_channel_layer")
    def test_exit_persists_empty_state_with_next_revision_and_dark_basemap(
        self, get_layer
    ):
        get_layer.return_value.group_send = AsyncMock()
        self.state.narrative_state = {
            "id": "segev",
            "transition": "enter",
            "revision": 4,
        }
        self.state.basemap = "satellite_bw"
        self.state.investigation_clock = {"phase": "idle", "revision": 8}
        self.state.person_selection = {
            "personId": None,
            "datasetVersion": None,
            "revision": 3,
        }
        self.state.save()

        response = self.command(
            "set_narrative", narrativeId=None, expectedRevision=4
        )

        self.assertEqual(response.status_code, 200)
        scene = response.json()["scene"]
        self.assertEqual(
            scene["narrativeState"],
            {"id": None, "transition": "exit", "revision": 5},
        )
        self.assertEqual(scene["sceneRevision"], 5)
        self.assertEqual(scene["basemap"], "dark")
        self.state.refresh_from_db()
        self.assertEqual(self.state.narrative_state, scene["narrativeState"])
        self.assertEqual(self.state.basemap, "dark")
        get_layer.return_value.group_send.assert_called_once()

    @patch("channels.layers.get_channel_layer")
    def test_presentation_commands_and_results_are_ephemeral_and_correlated(
        self, get_layer
    ):
        get_layer.return_value.group_send = AsyncMock()
        self.state.narrative_state = {
            "id": "segev",
            "transition": "enter",
            "revision": 4,
        }
        self.state.save(update_fields=["narrative_state"])
        original = dict(self.state.narrative_state)

        for presentation_action in ("open", "close"):
            response = self.command(
                "narrative_presentation",
                presentationAction=presentation_action,
                narrativeId="segev",
                requestId=f"request-{presentation_action}",
                sourceId="remote-a",
            )
            self.assertEqual(response.status_code, 200)
            self.assertTrue(response.json()["acknowledged"])

        result = self.command(
            "narrative_presentation_result",
            outcome="opened",
            narrativeId="segev",
            requestId="request-open",
            sourceId="gis-a",
        )
        self.assertEqual(result.status_code, 200)
        self.assertTrue(result.json()["acknowledged"])

        messages = [
            call.args[1]["message"]
            for call in get_layer.return_value.group_send.call_args_list
        ]
        self.assertEqual(
            [message["type"] for message in messages],
            [
                "otef_narrative_presentation_command",
                "otef_narrative_presentation_command",
                "otef_narrative_presentation_result",
            ],
        )
        self.assertEqual(messages[0]["presentationAction"], "open")
        self.assertEqual(messages[0]["narrativeId"], "segev")
        self.assertEqual(messages[0]["requestId"], "request-open")
        self.assertEqual(messages[2]["outcome"], "opened")
        self.assertEqual(messages[2]["requestId"], "request-open")
        self.state.refresh_from_db()
        self.assertEqual(self.state.narrative_state, original)

    @patch("channels.layers.get_channel_layer")
    def test_presentation_validation_and_open_active_match(self, get_layer):
        get_layer.return_value.group_send = AsyncMock()
        self.assertEqual(
            self.command(
                "narrative_presentation",
                presentationAction="open",
                narrativeId="segev",
                requestId="request-1",
            ).status_code,
            409,
        )
        malformed = (
            (
                "narrative_presentation",
                {"presentationAction": "launch", "narrativeId": "segev", "requestId": "r"},
            ),
            (
                "narrative_presentation",
                {"presentationAction": "close", "narrativeId": "unknown", "requestId": "r"},
            ),
            (
                "narrative_presentation",
                {"presentationAction": "close", "narrativeId": [], "requestId": "r"},
            ),
            (
                "narrative_presentation_result",
                {"outcome": "loaded", "narrativeId": "segev", "requestId": "r"},
            ),
            (
                "narrative_presentation_result",
                {"outcome": "closed", "narrativeId": "segev", "requestId": "x" * 129},
            ),
        )
        for action, payload in malformed:
            with self.subTest(action=action, payload=payload):
                self.assertEqual(self.command(action, **payload).status_code, 400)
        get_layer.return_value.group_send.assert_not_called()

    def test_set_rejects_unknown_missing_and_stale_revision_with_current_state(self):
        unknown = self.command(
            "set_narrative", narrativeId="unknown", expectedRevision=3
        )
        self.assertEqual(unknown.status_code, 400)
        missing = self.command("set_narrative", narrativeId="segev")
        self.assertEqual(missing.status_code, 400)
        stale = self.activate(expected_revision=2)
        self.assertEqual(stale.status_code, 409)
        self.assertEqual(stale.json()["reason"], "stale")
        self.assertEqual(
            stale.json()["narrative_state"],
            {"id": None, "transition": "exit", "revision": 3},
        )

    @patch("channels.layers.get_channel_layer")
    def test_active_narrative_allows_person_selection(self, get_layer):
        get_layer.return_value.group_send = AsyncMock()
        self.state.narrative_state = {
            "id": "segev",
            "transition": "enter",
            "revision": 4,
        }
        self.state.investigation_clock = {"phase": "idle", "revision": 8}
        self.state.save(update_fields=["narrative_state", "investigation_clock"])

        selection = self.command(
            "select_person",
            personId="12",
            datasetVersion="v1",
            expectedRevision=2,
        )
        self.assertEqual(selection.status_code, 200)
        self.assertEqual(selection.json()["person_selection"]["personId"], "12")

    def test_active_narrative_accepts_non_idle_clock_without_touching_scene(self):
        self.state.narrative_state = {
            "id": "segev",
            "transition": "enter",
            "revision": 4,
        }
        self.state.basemap = "satellite_bw"
        self.state.investigation_clock = {"phase": "idle", "revision": 8}
        self.state.save(
            update_fields=["narrative_state", "basemap", "investigation_clock"]
        )
        payload = {
            "phase": "playing",
            "membership": ["nli.lines", "nli.alarms"],
            "beats": [400, 420],
            "loop": False,
            "positionMs": 0,
            "anchorMs": 1000,
            "seekKind": "none",
        }

        response = self.client.patch(
            "/api/otef_viewport/by-table/otef/",
            json.dumps({"investigation_clock": payload}),
            content_type="application/json",
        )

        self.assertEqual(response.status_code, 200)
        self.state.refresh_from_db()
        self.assertEqual(self.state.investigation_clock["phase"], "playing")
        self.assertEqual(self.state.investigation_clock["membership"], payload["membership"])
        self.assertEqual(self.state.investigation_clock["beats"], payload["beats"])
        self.assertEqual(self.state.narrative_state["id"], "segev")
        self.assertEqual(self.state.narrative_state["revision"], 4)
        self.assertEqual(self.state.basemap, "satellite_bw")

    def test_exit_leaves_playing_clock_unchanged(self):
        self.state.narrative_state = {
            "id": "segev",
            "transition": "enter",
            "revision": 4,
        }
        self.state.basemap = "satellite_bw"
        self.state.save(update_fields=["narrative_state", "basemap"])
        payload = {
            "phase": "playing",
            "membership": ["nli.lines", "nli.alarms"],
            "beats": [400, 420],
            "loop": False,
            "positionMs": 0,
            "anchorMs": 1000,
            "seekKind": "none",
        }

        clock_response = self.client.patch(
            "/api/otef_viewport/by-table/otef/",
            json.dumps({"investigation_clock": payload}),
            content_type="application/json",
        )
        self.assertEqual(clock_response.status_code, 200)

        exit_response = self.command(
            "set_narrative", narrativeId=None, expectedRevision=4
        )
        self.assertEqual(exit_response.status_code, 200)

        self.state.refresh_from_db()
        self.assertEqual(self.state.investigation_clock["phase"], payload["phase"])
        self.assertEqual(
            self.state.investigation_clock["membership"], payload["membership"]
        )
        self.assertEqual(self.state.investigation_clock["beats"], payload["beats"])
        self.assertIsNone(self.state.narrative_state["id"])
        self.assertEqual(self.state.basemap, "dark")
        self.assertGreater(self.state.narrative_state["revision"], 4)

    def test_activation_rejects_projection_start_without_partial_writes(self):
        self.state.projection_slideshow = {
            "type": "start",
            "payload": {"packOrder": ["a"]},
            "revision": 2,
        }
        self.state.save(update_fields=["projection_slideshow"])

        response = self.activate()

        self.assertEqual(response.status_code, 409)
        self.assertEqual(response.json()["reason"], "projection_active")
        self.state.refresh_from_db()
        self.assertEqual(self.state.narrative_state["revision"], 3)
        self.assertEqual(self.state.basemap, "osm")
        self.assertEqual(self.state.investigation_clock["phase"], "playing")
        self.assertEqual(self.state.person_selection["personId"], "11")

    def test_active_narrative_rejects_slideshow_start_and_generic_basemap_patch(self):
        self.state.narrative_state = {
            "id": "segev",
            "transition": "enter",
            "revision": 4,
        }
        self.state.investigation_clock = {"phase": "idle", "revision": 8}
        self.state.save(update_fields=["narrative_state", "investigation_clock"])

        slideshow = self.client.patch(
            "/api/otef_viewport/by-table/otef/",
            json.dumps(
                {
                    "projection_slideshow": {
                        "type": "start",
                        "payload": {"intervalMs": 1000},
                    }
                }
            ),
            content_type="application/json",
        )
        self.assertEqual(slideshow.status_code, 409)
        basemap = self.client.patch(
            "/api/otef_viewport/by-table/otef/",
            json.dumps({"basemap": "osm"}),
            content_type="application/json",
        )
        self.assertEqual(basemap.status_code, 409)
        self.state.refresh_from_db()
        self.assertEqual(self.state.basemap, "osm")
        self.assertEqual(self.state.projection_slideshow, {})

    def test_detail_patch_cannot_bypass_narrative_owned_state_guards(self):
        self.state.narrative_state = {
            "id": "segev",
            "transition": "enter",
            "revision": 4,
        }
        self.state.basemap = "satellite_bw"
        self.state.projection_slideshow = {"type": "stop", "revision": 2}
        self.state.investigation_clock = {"phase": "idle", "revision": 8}
        self.state.save()
        original = {
            "basemap": self.state.basemap,
            "projection_slideshow": dict(self.state.projection_slideshow),
            "investigation_clock": dict(self.state.investigation_clock),
        }

        patches = (
            {"basemap": "osm"},
            {"projection_slideshow": {"type": "start", "revision": 99}},
            {"investigation_clock": {"phase": "playing", "revision": 99}},
        )
        for payload in patches:
            with self.subTest(payload=payload):
                response = self.client.patch(
                    f"/api/otef_viewport/{self.state.pk}/",
                    json.dumps(payload),
                    content_type="application/json",
                )
                self.assertEqual(response.status_code, 405)
                self.state.refresh_from_db()
                self.assertEqual(self.state.basemap, original["basemap"])
                self.assertEqual(
                    self.state.projection_slideshow,
                    original["projection_slideshow"],
                )
                self.assertEqual(
                    self.state.investigation_clock,
                    original["investigation_clock"],
                )

    def test_generic_create_and_destroy_cannot_seed_or_reset_viewport_state(self):
        before = OTEFViewportState.objects.count()
        create = self.client.post(
            "/api/otef_viewport/",
            {"table": self.table.pk, "basemap": "dark"},
            format="json",
        )
        self.assertEqual(create.status_code, 405)
        self.assertEqual(OTEFViewportState.objects.count(), before)

        destroy = self.client.delete(f"/api/otef_viewport/{self.state.pk}/")
        self.assertEqual(destroy.status_code, 405)
        self.assertTrue(OTEFViewportState.objects.filter(pk=self.state.pk).exists())

        listed = self.client.get("/api/otef_viewport/")
        detail = self.client.get(f"/api/otef_viewport/{self.state.pk}/")
        self.assertEqual(listed.status_code, 200)
        self.assertEqual(detail.status_code, 200)

    def test_get_includes_normalized_narrative_state(self):
        self.state.narrative_state = {"id": "unknown", "revision": 99}
        self.state.save(update_fields=["narrative_state"])

        response = self.client.get("/api/otef_viewport/by-table/otef/")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(
            response.json()["narrative_state"],
            {"id": None, "transition": "initial", "revision": 0},
        )


class OTEFNarrativeConcurrencyTests(TransactionTestCase):
    reset_sequences = True

    def setUp(self):
        table = Table.objects.create(name="otef")
        OTEFViewportState.objects.create(table=table)

    @skipUnlessDBFeature("has_select_for_update")
    @patch("channels.layers.get_channel_layer")
    def test_two_concurrent_requests_on_one_revision_have_one_winner(self, get_layer):
        get_layer.return_value.group_send = AsyncMock()
        payload = json.dumps(
            {
                "action": "set_narrative",
                "narrativeId": "segev",
                "expectedRevision": 0,
            }
        )

        def request():
            close_old_connections()
            try:
                return Client().post(
                    "/api/otef_viewport/by-table/otef/command/",
                    payload,
                    content_type="application/json",
                ).status_code
            finally:
                close_old_connections()

        with ThreadPoolExecutor(max_workers=2) as pool:
            statuses = sorted(pool.map(lambda _: request(), range(2)))

        self.assertEqual(statuses, [200, 409])
        self.assertEqual(
            OTEFViewportState.objects.get(table__name="otef").narrative_state,
            {"id": "segev", "transition": "enter", "revision": 1},
        )
