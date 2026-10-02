from django.db import models
import importlib
import json
from unittest.mock import patch

from django.test import SimpleTestCase, TestCase

from backend.models import OTEFViewportState, Table
from backend.otef_nli_clock_layout import normalize_nli_clock_layout


class NliClockLayoutMigrationTests(SimpleTestCase):
    def test_0022_adds_blank_json_field_after_escape_overlay(self):
        migration = importlib.import_module(
            "backend.migrations.0022_otefviewportstate_nli_clock_layout"
        ).Migration

        self.assertEqual(
            migration.dependencies,
            [("backend", "0021_otefviewportstate_escape_overlay")],
        )
        operation = migration.operations[0]
        self.assertEqual(operation.model_name, "otefviewportstate")
        self.assertEqual(operation.name, "nli_clock_layout")
        self.assertIsInstance(operation.field, models.JSONField)
        self.assertEqual(operation.field.default, dict)
        self.assertTrue(operation.field.blank)

    def test_0029_adds_clock_and_legend_revisions_after_exhibit_mode(self):
        migration = importlib.import_module(
            "backend.migrations.0029_otefviewportstate_clock_legend_layout_revisions"
        ).Migration
        self.assertEqual(
            migration.dependencies,
            [("backend", "0028_otefviewportstate_exhibit_mode")],
        )
        self.assertEqual(
            [operation.name for operation in migration.operations],
            ["nli_clock_layout_revision", "legend_layout_revision"],
        )


class NliClockLayoutApiTests(TestCase):
    def setUp(self):
        self.table = Table.objects.create(name="otef")
        self.state = OTEFViewportState.objects.create(table=self.table)

    def command(self, **payload):
        with self.captureOnCommitCallbacks(execute=True):
            return self.client.post(
                "/api/otef_viewport/by-table/otef/command/",
                json.dumps({"action": "set_nli_clock_layout", **payload}),
                content_type="application/json",
            )

    def test_get_includes_empty_normalized_layout(self):
        listed = self.client.get("/api/otef_viewport/by-table/otef/")
        self.assertEqual(listed.status_code, 200)
        self.assertEqual(
            listed.json()["nli_clock_layout"],
            {
                "gis": {},
                "projection": {},
                "gisOverlays": {"novaExplainers": {"close": {}, "wide": {}}},
            },
        )

    def test_get_includes_zero_revision_fields(self):
        listed = self.client.get("/api/otef_viewport/by-table/otef/")
        self.assertEqual(listed.status_code, 200)
        self.assertEqual(listed.json()["nli_clock_layout_revision"], 0)
        self.assertEqual(listed.json()["legend_layout_revision"], 0)

    def test_slot_write_preserves_raw_history_and_conflicts(self):
        layout = dict(leftPct=10, topPct=80, widthPct=20,
                      heightPct=8, fontPx=22, rotateDeg=0)
        self.state.nli_clock_layout = {
            "gis": {}, "projection": {"full": {"legacy": "keep"}},
            "unknownMetadata": {"keep": True},
        }
        self.state.save(update_fields=["nli_clock_layout"])
        first = self.command(surface="gis", slot="start", baseRevision=0, layout=layout)
        self.assertEqual(first.status_code, 200)
        self.assertEqual(first.json()["nliClockLayoutRevision"], 1)
        self.state.refresh_from_db()
        self.assertEqual(self.state.nli_clock_layout["projection"]["full"], {"legacy": "keep"})
        self.assertEqual(self.state.nli_clock_layout["unknownMetadata"], {"keep": True})
        self.assertEqual(self.state.nli_clock_layout_revision, 1)
        with patch("backend.views.OTEFViewportStateViewSet._broadcast_nli_clock_layout") as broadcast:
            stale = self.command(surface="gis", slot="nova", baseRevision=0, layout=layout)
        self.assertEqual(stale.status_code, 409)
        self.assertEqual(stale.json()["nliClockLayoutRevision"], 1)
        self.state.refresh_from_db()
        self.assertNotIn("nova", self.state.nli_clock_layout["gis"])
        broadcast.assert_not_called()

    def test_legacy_flat_layout_moves_to_start_on_intentional_write(self):
        self.state.nli_clock_layout = {
            "leftPct": 12, "topPct": 80, "widthPct": 20,
            "heightPct": 8, "fontPx": 22, "rotateDeg": 0,
            "sourceNote": "retain",
        }
        self.state.save(update_fields=["nli_clock_layout"])
        response = self.command(
            surface="gis", slot="segev", baseRevision=0,
            layout={"leftPct": 10, "topPct": 80, "widthPct": 20,
                   "heightPct": 8, "fontPx": 22, "rotateDeg": 0},
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["nliClockLayout"]["gis"]["start"]["leftPct"], 12)
        self.state.refresh_from_db()
        self.assertEqual(self.state.nli_clock_layout["sourceNote"], "retain")
        self.assertIn("start", self.state.nli_clock_layout["gis"])
        self.assertIn("segev", self.state.nli_clock_layout["gis"])

    def test_nested_top_only_flat_layout_moves_to_start_on_intentional_write(self):
        self.state.nli_clock_layout = {
            "gis": {
                "topPct": 80, "widthPct": 20, "heightPct": 8,
                "fontPx": 22, "rotateDeg": 0, "sourceNote": "retain",
            },
            "unknownMetadata": {"keep": True},
        }
        self.state.save(update_fields=["nli_clock_layout"])
        response = self.command(
            surface="gis", slot="segev", baseRevision=0,
            layout={"leftPct": 10, "topPct": 80, "widthPct": 20,
                   "heightPct": 8, "fontPx": 22, "rotateDeg": 0},
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["nliClockLayout"]["gis"]["start"]["topPct"], 80)
        self.assertIn("segev", response.json()["nliClockLayout"]["gis"])
        self.state.refresh_from_db()
        self.assertEqual(self.state.nli_clock_layout["gis"]["sourceNote"], "retain")
        self.assertEqual(self.state.nli_clock_layout["unknownMetadata"], {"keep": True})
        self.assertEqual(self.state.nli_clock_layout["gis"]["start"]["topPct"], 80)

    def test_oversized_integer_is_clamped_without_server_error(self):
        response = self.command(
            surface="gis", slot="start", baseRevision=0,
            layout={"leftPct": 10, "topPct": 80, "widthPct": 20,
                   "heightPct": 8, "fontPx": 10 ** 400, "rotateDeg": 0},
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["nliClockLayout"]["gis"]["start"]["fontPx"], 64)

    def test_rejects_missing_revision_invalid_slot_and_incomplete_or_invalid_layout(self):
        valid = {"leftPct": 10, "topPct": 80, "widthPct": 20,
                 "heightPct": 8, "fontPx": 22, "rotateDeg": 0}
        payloads = [
            {"surface": "gis", "slot": "start", "layout": valid},
            {"surface": "projection", "slot": "full", "baseRevision": 0, "layout": valid},
            {"surface": "projection", "slot": "right", "baseRevision": 0, "layout": valid},
            {"surface": "gis", "slot": "start", "baseRevision": 0, "layout": {**valid, "fontPx": True}},
            {"surface": "gis", "slot": "start", "baseRevision": 0, "layout": {**valid, "extra": 1}},
            {"surface": "gis", "slot": "start", "baseRevision": 0, "layout": {**valid, "fontPx": float("inf")}},
            {"surface": "gis", "slot": "start", "baseRevision": 0, "layout": {"widthPct": 20}},
        ]
        for payload in payloads:
            with self.subTest(payload=payload):
                self.assertEqual(self.command(**payload).status_code, 400)
        self.state.refresh_from_db()
        self.assertEqual(self.state.nli_clock_layout, {})
        self.assertEqual(self.state.nli_clock_layout_revision, 0)

    def test_generic_patch_rejects_clock_and_legend_persistence_fields(self):
        for field in ("nli_clock_layout", "nli_clock_layout_revision", "legend_settings", "legend_layout_revision"):
            with self.subTest(field=field):
                response = self.client.patch(
                    "/api/otef_viewport/by-table/otef/",
                    json.dumps({field: {} if field.endswith("layout") or field == "legend_settings" else 1}),
                    content_type="application/json",
                )
                self.assertEqual(response.status_code, 400)
        self.state.refresh_from_db()
        self.assertEqual(self.state.nli_clock_layout_revision, 0)
        self.assertEqual(self.state.legend_layout_revision, 0)

    def test_projection_park_persists_and_does_not_wipe_gis(self):
        gis = self.command(
            surface="gis",
            slot="start", baseRevision=0,
            layout={"leftPct": 10, "topPct": 80, "widthPct": 20, "heightPct": 8, "fontPx": 22, "rotateDeg": 0},
        )
        self.assertEqual(gis.status_code, 200)
        projection = self.command(
            surface="projection", slot="left", baseRevision=1,
            layout={"leftPct": 40, "topPct": 20, "widthPct": 10, "heightPct": 8, "fontPx": 40, "rotateDeg": 90},
        )
        self.assertEqual(projection.status_code, 200)
        self.state.refresh_from_db()
        stored = normalize_nli_clock_layout(self.state.nli_clock_layout)
        self.assertEqual(stored["gis"]["start"]["leftPct"], 10)
        self.assertEqual(stored["projection"]["left"]["fontPx"], 40)
        listed = self.client.get("/api/otef_viewport/by-table/otef/")
        self.assertEqual(listed.json()["nli_clock_layout"]["projection"]["left"]["fontPx"], 40)

    def test_rejects_invalid_surface(self):
        response = self.command(surface="td", slot="start", baseRevision=0, layout={})
        self.assertEqual(response.status_code, 400)

    @patch("backend.views.OTEFViewportStateViewSet._broadcast_nli_clock_layout")
    def test_broadcasts_after_commit(self, broadcast):
        response = self.command(surface="projection", slot="left", baseRevision=0,
                                layout={"leftPct": 31, "topPct": 20, "widthPct": 10,
                                        "heightPct": 8, "fontPx": 40, "rotateDeg": 0})
        self.assertEqual(response.status_code, 200)
        broadcast.assert_called_once()
        _table, layout, _meta = broadcast.call_args.args
        self.assertEqual(layout["projection"]["left"]["leftPct"], 31)
        self.assertEqual(_meta["nliClockLayoutRevision"], 1)

    def _clock(self, **overrides):
        layout = {
            "leftPct": 10, "topPct": 80, "widthPct": 20,
            "heightPct": 8, "fontPx": 22, "rotateDeg": 0,
        }
        layout.update(overrides)
        return layout

    def test_overlay_round_trip_reuses_clock_revision_and_event(self):
        clock = self._clock()
        first = self.command(surface="gis", slot="start", baseRevision=0, layout=clock)
        self.assertEqual(first.status_code, 200)
        self.assertEqual(first.json()["nliClockLayoutRevision"], 1)
        self.assertEqual(
            first.json()["nliClockLayout"]["gisOverlays"]["novaExplainers"],
            {"close": {}, "wide": {}},
        )
        overlay = {
            "close": {"100": {"leftPct": 12.5, "topPct": 20}},
            "wide": {"100": {"leftPct": 8, "topPct": 18}},
        }
        with patch("backend.views.OTEFViewportStateViewSet._broadcast_nli_clock_layout") as broadcast:
            second = self.command(
                surface="gisOverlays", slot="novaExplainers", baseRevision=1, layout=overlay,
            )
        self.assertEqual(second.status_code, 200)
        self.assertEqual(second.json()["nliClockLayoutRevision"], 2)
        self.assertEqual(second.json()["nliClockLayout"]["gis"]["start"]["leftPct"], 10)
        self.assertEqual(second.json()["nliClockLayout"]["gisOverlays"]["novaExplainers"], overlay)
        broadcast.assert_called_once()
        _table, layout, meta = broadcast.call_args.args
        self.assertEqual(layout["gisOverlays"]["novaExplainers"], overlay)
        self.assertEqual(meta["nliClockLayoutRevision"], 2)
        third = self.command(surface="gis", slot="nova", baseRevision=2, layout=self._clock(leftPct=15))
        self.assertEqual(third.status_code, 200)
        self.assertEqual(third.json()["nliClockLayoutRevision"], 3)
        self.assertEqual(third.json()["nliClockLayout"]["gisOverlays"]["novaExplainers"], overlay)
        self.assertEqual(third.json()["nliClockLayout"]["gis"]["start"]["leftPct"], 10)
        with patch("backend.views.OTEFViewportStateViewSet._broadcast_nli_clock_layout") as broadcast:
            stale = self.command(
                surface="gisOverlays", slot="novaExplainers", baseRevision=1, layout=overlay,
            )
        self.assertEqual(stale.status_code, 409)
        self.assertEqual(stale.json()["nliClockLayoutRevision"], 3)
        self.assertEqual(stale.json()["nliClockLayout"]["gisOverlays"]["novaExplainers"], overlay)
        self.state.refresh_from_db()
        self.assertEqual(self.state.nli_clock_layout_revision, 3)
        broadcast.assert_not_called()

    def test_overlay_write_clamps_keeps_non_story_ids_and_raw_siblings(self):
        self.state.nli_clock_layout = {
            "gis": {"start": self._clock()},
            "projection": {"full": {"legacy": "keep"}},
            "gisOverlays": {"other": {"keep": True}},
            "unknownMetadata": {"keep": True},
        }
        self.state.save(update_fields=["nli_clock_layout"])
        response = self.command(
            surface="gisOverlays", slot="novaExplainers", baseRevision=0,
            layout={
                "close": {
                    "100": {"leftPct": 101, "topPct": -1},
                    "107": {"leftPct": 1.5, "topPct": 2},
                },
                "wide": {},
            },
        )
        self.assertEqual(response.status_code, 200)
        nova = response.json()["nliClockLayout"]["gisOverlays"]["novaExplainers"]
        self.assertEqual(nova["close"]["100"], {"leftPct": 100, "topPct": 0})
        self.assertEqual(nova["close"]["107"], {"leftPct": 1.5, "topPct": 2})
        self.assertEqual(nova["wide"], {})
        self.state.refresh_from_db()
        self.assertEqual(self.state.nli_clock_layout["unknownMetadata"], {"keep": True})
        self.assertEqual(self.state.nli_clock_layout["gisOverlays"]["other"], {"keep": True})
        self.assertEqual(self.state.nli_clock_layout["projection"]["full"], {"legacy": "keep"})
        self.assertEqual(self.state.nli_clock_layout["gis"]["start"]["leftPct"], 10)
        stored = self.state.nli_clock_layout["gisOverlays"]["novaExplainers"]
        self.assertEqual(stored["wide"], {})
        self.assertEqual(stored["close"]["107"]["leftPct"], 1.5)

    def test_strict_nova_write_clamps_oversized_integer(self):
        response = self.command(
            surface="gisOverlays",
            slot="novaExplainers",
            baseRevision=0,
            layout={
                "close": {"100": {"leftPct": 10 ** 400, "topPct": 20}},
                "wide": {},
            },
        )
        self.assertEqual(response.status_code, 200)
        nova = response.json()["nliClockLayout"]["gisOverlays"]["novaExplainers"]
        self.assertEqual(nova["close"]["100"], {"leftPct": 100, "topPct": 20})
        self.assertEqual(nova["wide"], {})

    def test_tolerant_read_clamps_oversized_integer_nova_position(self):
        self.state.nli_clock_layout = {
            "gisOverlays": {
                "novaExplainers": {
                    "close": {"100": {"leftPct": 10 ** 400, "topPct": 20}},
                    "wide": {},
                }
            }
        }
        self.state.save(update_fields=["nli_clock_layout"])
        listed = self.client.get("/api/otef_viewport/by-table/otef/")
        self.assertEqual(listed.status_code, 200)
        nova = listed.json()["nli_clock_layout"]["gisOverlays"]["novaExplainers"]
        self.assertEqual(nova["close"]["100"], {"leftPct": 100, "topPct": 20})
        self.assertEqual(nova["wide"], {})

    def test_empty_camera_resets_without_copying_the_other(self):
        first = self.command(
            surface="gisOverlays", slot="novaExplainers", baseRevision=0,
            layout={
                "close": {"100": {"leftPct": 12.5, "topPct": 20}},
                "wide": {"104": {"leftPct": 8, "topPct": 18}},
            },
        )
        self.assertEqual(first.status_code, 200)
        second = self.command(
            surface="gisOverlays", slot="novaExplainers", baseRevision=1,
            layout={"close": {}, "wide": {"104": {"leftPct": 8, "topPct": 18}}},
        )
        self.assertEqual(second.status_code, 200)
        nova = second.json()["nliClockLayout"]["gisOverlays"]["novaExplainers"]
        self.assertEqual(nova["close"], {})
        self.assertEqual(nova["wide"], {"104": {"leftPct": 8, "topPct": 18}})

    def test_rejects_invalid_nova_explainer_layout(self):
        position = {"leftPct": 10, "topPct": 20}
        payloads = [
            {"close": {"100": {**position, "leftPct": True}}, "wide": {}},
            {"close": {"100": {**position, "leftPct": "10"}}, "wide": {}},
            {"close": {"100": {**position, "topPct": None}}, "wide": {}},
            {"close": {"100": {**position, "topPct": float("nan")}}, "wide": {}},
            {"close": {"100": {**position, "topPct": float("inf")}}, "wide": {}},
            {"close": {"100": {"leftPct": 10}}, "wide": {}},
            {"close": {"100": {**position, "extra": 1}}, "wide": {}},
            {"close": {"100": [10, 20]}, "wide": {}},
            {"close": {"0": position}, "wide": {}},
            {"close": {"01": position}, "wide": {}},
            {"close": {"10a": position}, "wide": {}},
            {"close": {str(i): position for i in range(1, 34)}, "wide": {}},
            {"close": {}},
            {"wide": {}},
            {"close": {}, "wide": {}, "extra": 1},
            [],
            None,
        ]
        for layout in payloads:
            with self.subTest(layout=layout):
                with patch("backend.views.OTEFViewportStateViewSet._broadcast_nli_clock_layout") as broadcast:
                    response = self.command(
                        surface="gisOverlays", slot="novaExplainers", baseRevision=0, layout=layout,
                    )
                self.assertEqual(response.status_code, 400)
                broadcast.assert_not_called()
        self.state.refresh_from_db()
        self.assertEqual(self.state.nli_clock_layout, {})
        self.assertEqual(self.state.nli_clock_layout_revision, 0)

    def test_tolerant_read_sanitizes_overlays_and_legacy_clocks(self):
        close = {
            "100": {"leftPct": 150, "topPct": -5},
            "107": {"leftPct": 4, "topPct": 6},
            "bad": {"leftPct": True, "topPct": 1},
            "101": {"leftPct": "4", "topPct": 1},
            "102": {"leftPct": None, "topPct": 1},
            "103": [1, 2],
            "104": {"leftPct": 1},
            "105": {"leftPct": 1, "topPct": 2, "extra": 9},
        }
        close.update({str(i): {"leftPct": 1, "topPct": 2} for i in range(1, 41)})
        self.state.nli_clock_layout = {
            "gis": {
                "leftPct": 12, "topPct": 80, "widthPct": 20,
                "heightPct": 8, "fontPx": 22, "rotateDeg": 0,
            },
            "gisOverlays": {"novaExplainers": {"close": close, "wide": None}, "other": {"keep": True}},
            "unknownMetadata": {"keep": True},
        }
        self.state.save(update_fields=["nli_clock_layout"])
        listed = self.client.get("/api/otef_viewport/by-table/otef/")
        layout = listed.json()["nli_clock_layout"]
        self.assertEqual(layout["gis"]["start"]["leftPct"], 12)
        nova = layout["gisOverlays"]["novaExplainers"]
        self.assertEqual(len(nova["close"]), 32)
        self.assertEqual(nova["close"]["100"], {"leftPct": 100, "topPct": 0})
        self.assertEqual(nova["close"]["107"], {"leftPct": 4, "topPct": 6})
        self.assertNotIn("31", nova["close"])
        self.assertNotIn("bad", nova["close"])
        self.assertNotIn("101", nova["close"])
        self.assertEqual(nova["wide"], {})
        self.assertNotIn("other", layout["gisOverlays"])
        self.assertNotIn("unknownMetadata", layout)
