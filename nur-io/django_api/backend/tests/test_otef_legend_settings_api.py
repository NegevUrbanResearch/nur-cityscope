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
        self.assertEqual(listed.json()["legend_layout_revision"], 0)
        saved = self.command(span="left", baseRevision=0, layout={"leftPct": 10, "topPct": 10, "widthPct": 20, "heightPct": 35, "fontPx": 22, "rotateDeg": 0, "dwellSeconds": 8})
        self.assertEqual(saved.status_code, 200)
        self.assertEqual(saved.json()["changeKind"], "layout")
        self.assertEqual(saved.json()["legendLayoutRevision"], 1)
        changed = self.command(language="en")
        self.assertEqual(changed.status_code, 200)
        self.assertEqual(changed.json()["changeKind"], "metadata")
        self.assertEqual(changed.json()["legendSettingsPatch"], {"language": "en"})
        self.assertEqual(changed.json()["legendLayoutRevision"], 1)
        listed = self.client.get("/api/otef_viewport/by-table/otef/")
        self.assertEqual(listed.json()["legend_settings"]["language"], "en")
        self.assertIn("left", listed.json()["legend_settings"]["projection"])

    def test_one_span_save_preserves_another_and_clamps_dwell(self):
        left = {"leftPct": 10, "topPct": 10, "widthPct": 20, "heightPct": 20, "fontPx": 22, "rotateDeg": 0, "dwellSeconds": 8}
        right = {"leftPct": 20, "topPct": 10, "widthPct": 30, "heightPct": 30, "fontPx": 22, "rotateDeg": 0, "dwellSeconds": 99}
        self.assertEqual(self.command(span="left", baseRevision=0, layout=left).status_code, 200)
        response = self.command(span="right", baseRevision=1, layout=right)
        projection = response.json()["legendProjection"]
        self.assertIn("left", projection)
        self.assertEqual(projection["right"]["dwellSeconds"], 30)
        self.assertEqual(response.json()["legendLayoutRevision"], 2)

    def test_columns_values_round_trip_and_legacy_layout_keeps_seven_fields(self):
        base = {"leftPct": 10, "topPct": 10, "widthPct": 20, "heightPct": 20, "fontPx": 22, "rotateDeg": 0, "dwellSeconds": 8}
        for columns in range(4):
            with self.subTest(columns=columns):
                payload = {**base, "columns": columns}
                with patch("backend.views.OTEFViewportStateViewSet._broadcast_legend_settings") as broadcast:
                    with self.captureOnCommitCallbacks(execute=True):
                        response = self.command(span="left", baseRevision=self.state.legend_layout_revision, layout=payload)
                self.assertEqual(response.status_code, 200)
                self.assertEqual(response.json()["legendProjection"]["left"]["columns"], columns)
                self.assertEqual(response.json()["legendProjection"]["left"], payload)
                listed = self.client.get("/api/otef_viewport/by-table/otef/")
                self.assertEqual(listed.json()["legend_settings"]["projection"]["left"]["columns"], columns)
                broadcast.assert_called_once()
                _table, change, _meta = broadcast.call_args.args
                self.assertEqual(change["legendProjection"]["left"]["columns"], columns)
                self.state.refresh_from_db()

        legacy = self.command(span="left", baseRevision=self.state.legend_layout_revision, layout=base)
        self.assertEqual(legacy.status_code, 200)
        self.assertEqual(legacy.json()["legendProjection"]["left"], base)
        self.assertEqual(len(legacy.json()["legendProjection"]["left"]), 7)

    def test_malformed_stored_columns_normalize_to_auto_without_adding_legacy_field(self):
        base = {"leftPct": 10, "topPct": 10, "widthPct": 20, "heightPct": 20, "fontPx": 22, "rotateDeg": 0, "dwellSeconds": 8}
        malformed = normalize_legend_settings({"projection": {"left": {**base, "columns": "2"}}})
        self.assertEqual(malformed["projection"]["left"]["columns"], 0)
        legacy = normalize_legend_settings({"projection": {"left": base}})
        self.assertNotIn("columns", legacy["projection"]["left"])

    def test_invalid_columns_are_rejected_without_storage_revision_or_broadcast(self):
        base = {"leftPct": 10, "topPct": 10, "widthPct": 20, "heightPct": 20, "fontPx": 22, "rotateDeg": 0, "dwellSeconds": 8}
        invalid = [True, False, -1, 4, 1.5, "2", None, {"value": 2}]
        for columns in invalid:
            with self.subTest(columns=columns):
                layout = {**base, "columns": columns}
                with patch("backend.views.OTEFViewportStateViewSet._broadcast_legend_settings") as broadcast:
                    with self.captureOnCommitCallbacks(execute=True) as callbacks:
                        response = self.command(span="left", baseRevision=0, layout=layout)
                self.assertEqual(response.status_code, 400)
                self.assertEqual(callbacks, [])
                broadcast.assert_not_called()
                self.state.refresh_from_db()
                self.assertEqual(self.state.legend_settings, {})
                self.assertEqual(self.state.legend_layout_revision, 0)

        with patch("backend.views.OTEFViewportStateViewSet._broadcast_legend_settings") as broadcast:
            with self.captureOnCommitCallbacks(execute=True) as callbacks:
                response = self.command(span="left", baseRevision=0, layout={**base, "unknown": 1})
        self.assertEqual(response.status_code, 400)
        self.assertEqual(callbacks, [])
        broadcast.assert_not_called()
        self.state.refresh_from_db()
        self.assertEqual(self.state.legend_settings, {})
        self.assertEqual(self.state.legend_layout_revision, 0)

    def test_layout_conflict_preserves_raw_legend_metadata_and_other_spans(self):
        layout = {"leftPct": 10, "topPct": 10, "widthPct": 20, "heightPct": 20, "fontPx": 22, "rotateDeg": 0, "dwellSeconds": 8}
        self.state.legend_settings = {
            "language": "en", "summarizedGroupIds": ["roads"],
            "projection": {"right": {"legacy": "keep"}},
            "unknownMetadata": {"keep": True},
        }
        self.state.save(update_fields=["legend_settings"])
        first = self.command(span="left", baseRevision=0, layout=layout)
        self.assertEqual(first.status_code, 200)
        with patch("backend.views.OTEFViewportStateViewSet._broadcast_legend_settings") as broadcast:
            with self.captureOnCommitCallbacks(execute=True) as callbacks:
                stale = self.command(span="full", baseRevision=0, layout=layout)
        self.assertEqual(stale.status_code, 409)
        self.assertEqual(stale.json()["changeKind"], "layout")
        self.assertEqual(stale.json()["legendLayoutRevision"], 1)
        self.state.refresh_from_db()
        self.assertEqual(self.state.legend_settings["language"], "en")
        self.assertEqual(self.state.legend_settings["summarizedGroupIds"], ["roads"])
        self.assertEqual(self.state.legend_settings["projection"]["right"], {"legacy": "keep"})
        self.assertEqual(self.state.legend_settings["unknownMetadata"], {"keep": True})
        self.assertEqual(self.state.legend_layout_revision, 1)
        self.assertEqual(callbacks, [])
        broadcast.assert_not_called()

    def test_layout_requires_base_revision_complete_finite_exact_numeric_fields(self):
        valid = {"leftPct": 10, "topPct": 10, "widthPct": 20, "heightPct": 20, "fontPx": 22, "rotateDeg": 0, "dwellSeconds": 8}
        invalid_layouts = [
            {"leftPct": 10},
            {**valid, "fontPx": True},
            {**valid, "dwellSeconds": float("inf")},
            {**valid, "extra": 1},
        ]
        self.assertEqual(self.command(span="left", layout=valid).status_code, 400)
        for layout in invalid_layouts:
            with self.subTest(layout=layout):
                self.assertEqual(self.command(span="left", baseRevision=0, layout=layout).status_code, 400)
        self.assertEqual(self.command(span="full", baseRevision=0, language="en", layout=valid).status_code, 400)
        self.state.refresh_from_db()
        self.assertEqual(self.state.legend_settings, {})
        self.assertEqual(self.state.legend_layout_revision, 0)

    def test_oversized_integer_dwell_is_clamped_without_server_error(self):
        response = self.command(
            span="left", baseRevision=0,
            layout={"leftPct": 10, "topPct": 10, "widthPct": 20,
                   "heightPct": 20, "fontPx": 22, "rotateDeg": 0,
                   "dwellSeconds": 10 ** 400},
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["legendProjection"]["left"]["dwellSeconds"], 30)

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
        _table, change, _meta = broadcast.call_args.args
        self.assertEqual(change["changeKind"], "metadata")
        self.assertEqual(change["legendSettingsPatch"], {"language": "en"})
        self.assertEqual(change["legendLayoutRevision"], response.json()["legendLayoutRevision"])
        self.assertEqual(response.json()["legendSettingsPatch"], {"language": "en"})

    def test_summary_ids_are_deduplicated(self):
        response = self.command(summarizedGroupIds=["roads", "roads", "nli"])
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["legendSettingsPatch"], {"summarizedGroupIds": ["roads", "nli"]})
        self.assertEqual(response.json()["legendLayoutRevision"], 0)
        self.assertEqual(normalize_legend_settings({"summarizedGroupIds": ["x", "x"]})["summarizedGroupIds"], ["x"])
