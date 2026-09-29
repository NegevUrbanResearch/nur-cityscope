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
            {"gis": {}, "projection": {}},
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
