"""Experience activation must restore independent intent and reject old work."""

import time
from unittest.mock import AsyncMock, patch

from asgiref.sync import async_to_sync
from django.test import TestCase, TransactionTestCase
from rest_framework.test import APIClient

from backend.models import LayerGroup, LayerState, OTEFViewportState, Table


STATE_URL = "/api/otef_viewport/by-table/otef/"
COMMAND_URL = STATE_URL + "command/"


class ExperienceApiTests(TestCase):
    def setUp(self):
        self.table = Table.objects.create(name="otef", display_name="OTEF")
        self.state = OTEFViewportState.objects.create(table=self.table)
        self.client = APIClient()

    def switch(self, target, revision, request_id, stage="prepare"):
        return self.client.post(COMMAND_URL, {
            "action": "switch_experience", "stage": stage, "target": target,
            "expected_revision": revision, "request_id": request_id,
        }, format="json")

    def activate(self, target, revision, request_id):
        prepared = self.switch(target, revision, request_id)
        self.assertEqual(prepared.status_code, 200)
        if prepared.data["experience_state"]["pending_transition"]["from_experience"] == "nli":
            receipt = self.client.post(COMMAND_URL, {"action": "experience_cleanup_result", "request_id": request_id,
                "display": "gis", "success": True, "experience": "nli", "experience_revision": revision}, format="json")
            self.assertEqual(receipt.status_code, 200)
        response = self.switch(target, revision, request_id, "commit")
        self.assertEqual(response.status_code, 200, response.data)
        return response

    def test_independent_regular_context_restores_effective_rows_and_fresh_revisions(self):
        LayerGroup.objects.create(table=self.table, group_id="regular", enabled=True)
        LayerState.objects.create(table=self.table, layer_id="regular.roads", enabled=True)
        self.state.viewport = {"bbox": [1, 2, 3, 4], "zoom": 13}
        self.state.basemap = "satellite"
        self.state.viewer_angle_deg = 37
        self.state.legend_settings = {"language": "en", "projection": {}, "summarizedGroupIds": []}
        self.state.save()
        entered = self.activate("nli", 0, "enter")
        self.assertEqual(entered.data["experience_state"]["revision"], 1)
        self.assertFalse(LayerState.objects.get(table=self.table, layer_id="regular.roads").enabled)
        self.state.refresh_from_db()
        self.state.narrative_state = {"id": "nova", "transition": "enter", "revision": 21}
        self.state.investigation_clock = {"phase": "playing", "revision": 30,
            "positionMs": 200, "anchorMs": 1, "membership": [], "beats": [], "loop": False}
        self.state.person_selection = {"personId": None, "datasetVersion": None, "revision": 10}
        self.state.save()
        restored = self.activate("regular", 1, "leave")
        self.assertEqual(restored.data["viewport"]["zoom"], 13)
        self.assertEqual(restored.data["basemap"], "satellite")
        self.assertEqual(restored.data["viewer_angle_deg"], 37)
        self.assertTrue(LayerState.objects.get(table=self.table, layer_id="regular.roads").enabled)
        self.assertIsNone(restored.data["narrative_state"]["id"])
        self.assertGreater(restored.data["narrative_state"]["revision"], 21)
        self.assertGreater(restored.data["investigation_clock"]["revision"], 30)
        self.assertEqual(restored.data["investigation_clock"]["phase"], "idle")
        self.assertFalse(restored.data["exhibit_mode"])

    def test_prepare_freezes_writes_abort_unfreezes_and_commit_retry_is_idempotent(self):
        prepared = self.switch("nli", 0, "first")
        self.assertEqual(prepared.status_code, 200)
        frozen = self.client.patch(STATE_URL, {"basemap": "dark", "experience": "regular", "experience_revision": 0}, format="json")
        self.assertEqual(frozen.status_code, 409)
        self.assertEqual(frozen.data["reason"], "experience_switch_pending")
        self.assertEqual(self.switch("nli", 0, "first", "abort").status_code, 200)
        self.assertEqual(self.client.patch(STATE_URL, {"basemap": "dark"}, format="json").status_code, 200)
        committed = self.activate("nli", 0, "second")
        retried = self.switch("nli", 0, "second", "commit")
        self.assertEqual(retried.status_code, 200)
        self.assertEqual(retried.data["experience_state"], committed.data["experience_state"])

    def test_missing_and_stale_http_writes_are_rejected_after_first_activation(self):
        self.activate("nli", 0, "enter")
        for payload in ({"basemap": "dark"}, {"exhibit_mode": False},
                        {"animations": {}, "experience": "regular", "experience_revision": 0}):
            response = self.client.patch(STATE_URL, payload, format="json")
            self.assertEqual(response.status_code, 409, payload)
        response = self.client.post(COMMAND_URL, {"action": "zoom", "level": 17,
            "experience": "regular", "experience_revision": 0}, format="json")
        self.assertEqual(response.status_code, 409)

    def test_bookmark_is_scoped_validated_and_visible_on_hydrate(self):
        self.activate("nli", 0, "enter")
        bookmark = {"scriptId": "nova", "step": 2, "returnTo": {"id": "show", "step": 3}}
        response = self.client.patch(STATE_URL, {"nli_bookmark": bookmark,
            "experience": "nli", "experience_revision": 1}, format="json")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(self.client.get(STATE_URL).data["experience_state"]["nli_bookmark"], bookmark)
        invalid = self.client.patch(STATE_URL, {"nli_bookmark": {"scriptId": "nova", "step": 999},
            "experience": "nli", "experience_revision": 1}, format="json")
        self.assertEqual(invalid.status_code, 400)

    def test_experience_sequence_orders_same_activation_prepare_cleanup_abort_and_bookmark(self):
        initial = self.client.get(STATE_URL).data["experience_state"]
        self.assertEqual(initial["state_sequence"], 0)
        entered = self.activate("nli", 0, "enter").data["experience_state"]
        self.assertEqual(entered["state_sequence"], 2)
        bookmarked = self.client.patch(STATE_URL, {"nli_bookmark": {"scriptId": "nova", "step": 2},
            "experience": "nli", "experience_revision": 1}, format="json").data["experience_state"]
        prepared = self.switch("regular", 1, "leave").data["experience_state"]
        cleaned = self.client.post(COMMAND_URL, {"action": "experience_cleanup_result", "request_id": "leave",
            "display": "gis", "success": True, "experience": "nli", "experience_revision": 1}, format="json").data["experience_state"]
        aborted = self.switch("regular", 1, "leave", "abort").data["experience_state"]
        self.assertEqual([snapshot["state_sequence"] for snapshot in (bookmarked, prepared, cleaned, aborted)], [3, 4, 5, 6])
        self.assertEqual([snapshot["revision"] for snapshot in (bookmarked, prepared, cleaned, aborted)], [1, 1, 1, 1])
        self.assertNotIn("_state_sequence", aborted["last_transition"])

    def test_nli_transport_returns_paused_without_holds_or_old_anchor(self):
        self.activate("nli", 0, "enter")
        self.state.refresh_from_db()
        self.state.investigation_clock = {"phase": "playing", "revision": 3,
            "positionMs": 100, "anchorMs": 10000000000000, "membership": [], "beats": [],
            "loop": False, "presentationPendingUntilMs": 0, "hiddenDisplays": ["gis"]}
        self.state.save()
        self.activate("regular", 1, "leave")
        resumed = self.activate("nli", 2, "resume")
        clock = resumed.data["investigation_clock"]
        self.assertEqual(clock["phase"], "paused")
        self.assertEqual(clock["anchorMs"], 0)
        self.assertNotIn("presentationPendingUntilMs", clock)
        self.assertNotIn("hiddenDisplays", clock)

    def test_prepare_only_allows_scoped_ephemeral_close_and_results(self):
        self.activate("nli", 0, "enter")
        self.assertEqual(self.switch("regular", 1, "leave").status_code, 200)
        base = {"action": "archive_window", "personId": "11", "datasetVersion": "v1",
            "requestId": "archive-close", "sourceId": "remote", "experience": "nli", "experience_revision": 1}
        opened = self.client.post(COMMAND_URL, {**base, "archiveAction": "open"}, format="json")
        self.assertEqual(opened.status_code, 409)
        closed = self.client.post(COMMAND_URL, {**base, "archiveAction": "close"}, format="json")
        self.assertEqual(closed.status_code, 200)
        # Cleanup success does not commit the experience or reopen anything on abort.
        aborted = self.switch("regular", 1, "leave", "abort")
        self.assertEqual(aborted.data["experience_state"]["active_experience"], "nli")
        self.assertEqual(aborted.data["experience_state"]["revision"], 1)
        self.assertEqual(aborted.data["experience_state"]["last_transition"]["status"], "aborted")

    def test_nli_exit_requires_matching_gis_cleanup_success_even_without_remote_session(self):
        self.activate("nli", 0, "enter")
        prepared = self.switch("regular", 1, "leave")
        self.assertFalse(prepared.data["experience_state"]["pending_transition"]["cleanup_confirmed"])
        blocked = self.switch("regular", 1, "leave", "commit")
        self.assertEqual(blocked.status_code, 409)
        self.assertEqual(blocked.data["reason"], "experience_cleanup_pending")
        base = {"action": "experience_cleanup_result", "display": "gis", "experience": "nli", "experience_revision": 1}
        stale = self.client.post(COMMAND_URL, {**base, "request_id": "older", "success": True}, format="json")
        self.assertEqual(stale.status_code, 409)
        failed = self.client.post(COMMAND_URL, {**base, "request_id": "leave", "success": False, "error": "Archive close did not acknowledge"}, format="json")
        self.assertEqual(failed.status_code, 200)
        self.assertFalse(failed.data["experience_state"]["pending_transition"]["cleanup_confirmed"])
        self.assertEqual(self.switch("regular", 1, "leave", "commit").status_code, 409)
        confirmed = self.client.post(COMMAND_URL, {**base, "request_id": "leave", "success": True}, format="json")
        self.assertTrue(confirmed.data["experience_state"]["pending_transition"]["cleanup_confirmed"])
        committed = self.switch("regular", 1, "leave", "commit")
        self.assertEqual(committed.status_code, 200)
        self.assertIsNone(committed.data["experience_state"]["pending_transition"])
        self.assertEqual(self.client.post(COMMAND_URL, {**base, "request_id": "leave", "success": True}, format="json").status_code, 409)

    def test_cross_client_prepare_cannot_capture_a_scene_under_its_existing_cue_hold(self):
        self.activate("nli", 0, "enter")
        self.state.refresh_from_db()
        self.state.investigation_clock["presentationPendingUntilMs"] = time.time() * 1000 + 10000
        self.state.save()
        held = self.switch("regular", 1, "leave")
        self.assertEqual(held.status_code, 409)
        self.assertEqual(held.data["reason"], "experience_scene_pending")
        self.assertIsNone(held.data["experience_state"]["pending_transition"])
        self.state.refresh_from_db()
        self.state.investigation_clock["presentationPendingUntilMs"] = 0
        self.state.save()
        self.assertEqual(self.switch("regular", 1, "leave").status_code, 200)

    def test_competing_prepare_and_reused_request_cannot_commit_another_transition(self):
        self.assertEqual(self.switch("nli", 0, "a").status_code, 200)
        self.assertEqual(self.switch("nli", 0, "b").status_code, 409)
        self.assertEqual(self.switch("regular", 0, "a", "commit").status_code, 409)
        self.assertEqual(self.switch("nli", 0, "a", "commit").status_code, 200)
        self.assertEqual(self.switch("regular", 1, "a").status_code, 409)

    def test_snapshot_broadcast_is_complete_and_accepted_writes_keep_original_stamp(self):
        self.activate("nli", 0, "enter")
        with patch("channels.layers.get_channel_layer") as channels:
            channels.return_value.group_send = AsyncMock()
            with self.captureOnCommitCallbacks(execute=False) as callbacks:
                response = self.client.patch(STATE_URL, {"animations": {"nli.lines": True},
                    "experience": "nli", "experience_revision": 1}, format="json")
            self.assertEqual(response.status_code, 200)
            self.activate("regular", 1, "leave")
            for callback in callbacks:
                callback()
            old_event = channels.return_value.group_send.call_args.args[1]["message"]
            self.assertEqual((old_event["experience"], old_event["experience_revision"]), ("nli", 1))
            with self.captureOnCommitCallbacks(execute=True):
                self.switch("nli", 2, "return")
            snapshot = channels.return_value.group_send.call_args.args[1]["message"]
            self.assertEqual(snapshot["type"], "otef_experience_changed")
            self.assertTrue({"experience_state", "viewport", "layerGroups", "investigation_clock", "narrative_state"} <= set(snapshot["state"]))

    def test_authored_visibility_and_slideshow_preferences_survive_independently(self):
        self.state.projection_slideshow = {"type": "start", "payload": {"packOrder": ["a", "b"], "intervalMs": 7000}}
        self.state.save()
        self.activate("nli", 0, "enter")
        self.assertEqual(self.client.patch(STATE_URL, {"nli_bookmark": {"scriptId": "shura", "step": 0, "returnTo": None},
            "experience": "nli", "experience_revision": 1}, format="json").status_code, 200)
        self.activate("regular", 1, "leave")
        resumed = self.activate("nli", 2, "resume")
        self.assertEqual(resumed.data["investigation_clock"]["hiddenDisplays"], ["projection"])
        self.assertEqual(resumed.data["projection_slideshow"]["type"], "stop")
        self.assertEqual(resumed.data["experience_state"]["regular_slideshow_settings"], {"packOrder": ["a", "b"], "intervalMs": 7000})

    def test_stopped_slideshow_draft_is_saved_without_starting_and_restores_after_handoff(self):
        settings = {"packOrder": ["b", "a"], "intervalMs": 9000, "crossfadeMs": 800, "warmupLeadMs": 300, "keepSettlementNames": False}
        response = self.client.patch(STATE_URL, {"regular_slideshow_settings": settings,
            "experience": "regular", "experience_revision": 0}, format="json")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["experience_state"]["regular_slideshow_settings"], settings)
        self.assertEqual(response.data["experience_state"]["state_sequence"], 1)
        self.assertEqual(response.data["projection_slideshow"], {})
        self.activate("nli", 0, "enter")
        restored = self.activate("regular", 1, "leave")
        self.assertEqual(restored.data["experience_state"]["regular_slideshow_settings"], settings)
        self.assertEqual(restored.data["projection_slideshow"]["type"], "stop")

    def test_slideshow_draft_requires_regular_current_scope_and_valid_settings(self):
        for settings in ({"unknown": True}, {"intervalMs": -1}, {"intervalMs": "3"},
                         {"packOrder": ["a", "a"]}, {"packOrder": [1]}, {"keepSettlementNames": "yes"}):
            response = self.client.patch(STATE_URL, {"regular_slideshow_settings": settings,
                "experience": "regular", "experience_revision": 0}, format="json")
            self.assertEqual(response.status_code, 400, settings)
        self.activate("nli", 0, "enter")
        for scope in ({"experience": "nli", "experience_revision": 1}, {"experience": "regular", "experience_revision": 0}):
            response = self.client.patch(STATE_URL, {"regular_slideshow_settings": {"packOrder": ["a"]}, **scope}, format="json")
            self.assertEqual(response.status_code, 409)

    def test_regular_slideshow_rejects_nli_pack_and_sanitizes_legacy_saved_order(self):
        for field, value in (("regular_slideshow_settings", {"packOrder": ["a", "nli"]}),
                             ("projection_slideshow", {"type": "start", "payload": {"packOrder": ["nli", "a"]}})):
            response = self.client.patch(STATE_URL, {field: value,
                "experience": "regular", "experience_revision": 0}, format="json")
            self.assertEqual(response.status_code, 400, response.data)
        self.state.saved_regular_context = {"slideshow_settings": {"packOrder": ["a", "nli", "b"], "intervalMs": 5000}}
        self.state.save()
        response = self.client.get(STATE_URL)
        self.assertEqual(response.data["experience_state"]["regular_slideshow_settings"]["packOrder"], ["a", "b"])
        self.state.projection_slideshow = {"type": "start", "payload": {"packOrder": ["nli", "a"]}}
        self.state.save()
        response = self.client.get(STATE_URL)
        self.assertEqual(response.data["projection_slideshow"]["payload"]["packOrder"], ["a"])
        from backend.serializers import OTEFViewportStateSerializer
        self.assertEqual(OTEFViewportStateSerializer(self.state).data["projection_slideshow"]["payload"]["packOrder"], ["a"])
        self.activate("nli", 0, "enter")
        self.state.refresh_from_db()
        self.assertEqual(self.state.saved_regular_context["slideshow_settings"]["packOrder"], ["a", "b"])

    def test_new_draft_wins_over_a_still_running_slideshow_configuration(self):
        self.state.projection_slideshow = {"type": "start", "payload": {"packOrder": ["a", "b"]}}
        self.state.save()
        saved = self.client.patch(STATE_URL, {"regular_slideshow_settings": {"packOrder": ["b", "a"]},
            "experience": "regular", "experience_revision": 0}, format="json")
        self.assertEqual(saved.status_code, 200)
        self.assertEqual(saved.data["projection_slideshow"]["payload"]["packOrder"], ["a", "b"])
        self.activate("nli", 0, "enter")
        restored = self.activate("regular", 1, "leave")
        self.assertEqual(restored.data["experience_state"]["regular_slideshow_settings"]["packOrder"], ["b", "a"])

    def test_activated_regular_cannot_run_nli_story_and_nli_cannot_start_slideshow(self):
        self.activate("nli", 0, "enter")
        nli_slideshow = self.client.patch(STATE_URL, {"projection_slideshow": {"type": "start", "payload": {}},
            "experience": "nli", "experience_revision": 1}, format="json")
        self.assertEqual(nli_slideshow.status_code, 409)
        self.activate("regular", 1, "leave")
        regular_clock = self.client.patch(STATE_URL, {"investigation_clock": {"phase": "idle", "loop": False},
            "experience": "regular", "experience_revision": 2}, format="json")
        self.assertEqual(regular_clock.status_code, 409)
        regular_story = self.client.post(COMMAND_URL, {"action": "set_narrative", "narrativeId": "nova", "expectedRevision": 2,
            "experience": "regular", "experience_revision": 2}, format="json")
        self.assertEqual(regular_story.status_code, 409)


class ExperienceSocketTests(TransactionTestCase):
    def test_old_velocity_and_direct_socket_mutations_are_not_relayed_or_persisted(self):
        from websocket_app.consumers import GeneralConsumer
        table = Table.objects.create(name="otef", display_name="OTEF")
        OTEFViewportState.objects.create(table=table, experience_revision=2)
        consumer = GeneralConsumer()
        consumer.channel_type = "otef"
        consumer.room_group_name = "otef_channel"
        consumer.channel_layer = AsyncMock()
        consumer.send = AsyncMock()
        for message_type in ("otef_velocity_update", "otef_viewport_update", "otef_layer_update", "otef_animation_toggle"):
            async_to_sync(consumer.handle_otef_message)({"type": message_type, "table": "otef",
                "experience": "nli", "experience_revision": 1, "vx": 1, "vy": 1,
                "viewport": {"bbox": [1, 2, 3, 4]}, "layers": {"old": True}})
        consumer.channel_layer.group_send.assert_not_awaited()
        self.assertEqual(consumer.send.await_count, 4)

    def test_accepted_velocity_is_stamped_and_mutation_rechecks_after_admission(self):
        from backend.otef_experience import ExperienceError
        from websocket_app.consumers import GeneralConsumer
        table = Table.objects.create(name="otef", display_name="OTEF")
        state = OTEFViewportState.objects.create(table=table, experience_revision=2)
        consumer = GeneralConsumer()
        consumer.channel_type = "otef"
        consumer.room_group_name = "otef_channel"
        consumer.channel_layer = AsyncMock()
        consumer.send = AsyncMock()
        payload = {"type": "otef_velocity_update", "table": "otef", "experience": "regular", "experience_revision": 2, "vx": 1, "vy": 0}
        async_to_sync(consumer.handle_otef_message)(payload)
        message = consumer.channel_layer.group_send.call_args.args[1]["message"]
        self.assertEqual((message["experience"], message["experience_revision"]), ("regular", 2))
        state.active_experience, state.experience_revision = "nli", 3
        state.save()
        with self.assertRaises(ExperienceError):
            async_to_sync(consumer._save_layers)("otef", {**payload, "layers": {"old": True}})
        state.refresh_from_db()
        self.assertNotIn("old", state.layers)

    def test_pending_only_accepts_video_inactive_cleanup_not_new_playback_or_queries(self):
        from websocket_app.consumers import GeneralConsumer
        table = Table.objects.create(name="otef", display_name="OTEF")
        OTEFViewportState.objects.create(table=table, active_experience="nli", experience_revision=1,
            experience_pending={"request_id": "leave", "from_experience": "nli", "target": "regular", "expected_revision": 1})
        consumer = GeneralConsumer()
        consumer.channel_type, consumer.room_group_name = "otef", "otef_channel"
        consumer.channel_layer, consumer.send = AsyncMock(), AsyncMock()
        base = {"type": "otef_nli_video_playback_state", "table": "otef", "sourceId": "gis", "sequence": 1,
            "experience": "nli", "experience_revision": 1}
        async_to_sync(consumer.handle_otef_message)({**base, "active": False})
        consumer.channel_layer.group_send.assert_awaited_once()
        async_to_sync(consumer.handle_otef_message)({**base, "active": True})
        consumer.channel_layer.group_send.assert_awaited_once()
        consumer.send.assert_awaited_once()
