import importlib
import json
from unittest.mock import patch

from django.test import SimpleTestCase, TestCase

from backend.models import OTEFViewportState, Table
from backend.otef_legend_settings import normalize_legend_settings


class LegendSettingsMigrationTests(SimpleTestCase):
    def test_0023_adds_legend_settings_after_clock_layout(self):
        migration = importlib.import_module(
            "backend.migrations.0023_otefviewportstate_legend_settings"
        ).Migration
        self.assertEqual(migration.dependencies, [("backend", "0022_otefviewportstate_nli_clock_layout")])
        operation = migration.operations[0]
        self.assertEqual(operation.name, "legend_settings")


class LegendSettingsApiTests(TestCase):
    def setUp(self):
        self.table = Table.objects.create(name="otef")
        self.state = OTEFViewportState.objects.create(table=self.table)

    def command(self, **payload):
        return self.client.post(
            "/api/otef_viewport/by-table/otef/command/",
            json.dumps({"action": "set_legend_settings", **payload}),
            content_type="application/json",
        )

    def test_default_and_language_patch_preserve_layout(self):
        listed = self.client.get("/api/otef_viewport/by-table/otef/")
        self.assertEqual(listed.json()["legend_settings"], {"language": "he", "projection": {}, "summarizedGroupIds": []})
        saved = self.command(span="left", layout={"leftPct": 10, "topPct": 10, "widthPct": 20, "heightPct": 35, "fontPx": 22, "rotateDeg": 0, "dwellSeconds": 8})
        self.assertEqual(saved.status_code, 200)
        changed = self.command(language="en")
        self.assertEqual(changed.status_code, 200)
        self.assertEqual(changed.json()["legendSettings"]["language"], "en")
        self.assertIn("left", changed.json()["legendSettings"]["projection"])

    def test_one_span_save_preserves_another_and_clamps_dwell(self):
        self.assertEqual(self.command(span="left", layout={"widthPct": 20, "heightPct": 20}).status_code, 200)
        response = self.command(span="right", layout={"widthPct": 30, "heightPct": 30, "dwellSeconds": 99})
        settings = response.json()["legendSettings"]
        self.assertIn("left", settings["projection"])
        self.assertEqual(settings["projection"]["right"]["dwellSeconds"], 30)

    def test_invalid_language_and_shape_return_400_without_clock_change(self):
        before = self.state.nli_clock_layout
        self.assertEqual(self.command(language="fr").status_code, 400)
        self.assertEqual(self.command(language=None).status_code, 400)
        self.assertEqual(self.command(span="left").status_code, 400)
        self.assertEqual(self.command(summarizedGroupIds=None).status_code, 400)
        self.assertEqual(self.command(language="en", summarizedGroupIds=[]).status_code, 400)
        self.state.refresh_from_db()
        self.assertEqual(self.state.nli_clock_layout, before)

    @patch("backend.views.OTEFViewportStateViewSet._broadcast_legend_settings")
    def test_response_and_after_commit_broadcast_agree(self, broadcast):
        with self.captureOnCommitCallbacks(execute=True):
            response = self.command(language="en")
        self.assertEqual(response.status_code, 200)
        broadcast.assert_called_once()
        _table, settings, _meta = broadcast.call_args.args
        self.assertEqual(settings, response.json()["legendSettings"])

    def test_summary_ids_are_deduplicated(self):
        response = self.command(summarizedGroupIds=["roads", "roads", "nli"])
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["legendSettings"]["summarizedGroupIds"], ["roads", "nli"])
        self.assertEqual(normalize_legend_settings({"summarizedGroupIds": ["x", "x"]})["summarizedGroupIds"], ["x"])
