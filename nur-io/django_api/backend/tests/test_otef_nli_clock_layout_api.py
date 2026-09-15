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

    def test_projection_park_persists_and_does_not_wipe_gis(self):
        gis = self.command(
            surface="gis",
            layout={"start": {"leftPct": 10, "topPct": 80, "widthPct": 20, "heightPct": 8, "fontPx": 22, "rotateDeg": 0}},
        )
        self.assertEqual(gis.status_code, 200)
        projection = self.command(
            surface="projection",
            layout={"left": {"leftPct": 40, "topPct": 20, "widthPct": 10, "heightPct": 8, "fontPx": 40, "rotateDeg": 90}},
        )
        self.assertEqual(projection.status_code, 200)
        self.state.refresh_from_db()
        stored = normalize_nli_clock_layout(self.state.nli_clock_layout)
        self.assertEqual(stored["gis"]["start"]["leftPct"], 10)
        self.assertEqual(stored["projection"]["left"]["fontPx"], 40)
        listed = self.client.get("/api/otef_viewport/by-table/otef/")
        self.assertEqual(listed.json()["nli_clock_layout"]["projection"]["left"]["fontPx"], 40)

    def test_rejects_invalid_surface(self):
        response = self.command(surface="td", layout={})
        self.assertEqual(response.status_code, 400)

    @patch("backend.views.OTEFViewportStateViewSet._broadcast_nli_clock_layout")
    def test_broadcasts_after_commit(self, broadcast):
        response = self.command(surface="projection", layout={"full": {"leftPct": 31}})
        self.assertEqual(response.status_code, 200)
        broadcast.assert_called_once()
        _table, layout, _meta = broadcast.call_args.args
        self.assertEqual(layout["projection"]["full"]["leftPct"], 31)
