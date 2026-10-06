import importlib
import json
import tempfile
from copy import deepcopy
from pathlib import Path
from unittest.mock import patch

from django.test import SimpleTestCase, TestCase, override_settings

from backend.admin import OTEFViewportStateAdmin
from backend.models import OTEFProjectionCalibration, OTEFViewportState, Table
from backend.tests.settlement_name_fixtures import (
    ADDED_CATALOG_DIGEST,
    ADDED_CATALOG_JSON,
    ADDED_SOURCE_GEOJSON,
    BASELINE_POSITIONS,
    CALIBRATION_REVISION,
    SOURCE_GEOJSON,
    SOURCE_ID,
    STYLE,
    TIMESTAMP,
    canonical_v5_config,
    initialization_payload,
    working_v5_config,
)


def write_trusted_source(root, text):
    path = Path(root) / "public" / "processed" / "layers" / "projector_base" / "שמות_יישובים.geojson"
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(text.encode("utf-8"))
    return path


class SettlementNameMigrationTests(SimpleTestCase):
    def test_0030_adds_only_json_and_revision_fields(self):
        migration = importlib.import_module(
            "backend.migrations.0030_otefviewportstate_settlement_names"
        ).Migration
        self.assertEqual(
            migration.dependencies,
            [("backend", "0029_otefviewportstate_clock_legend_layout_revisions")],
        )
        self.assertEqual([operation.__class__.__name__ for operation in migration.operations], ["AddField", "AddField"])
        self.assertEqual(
            {operation.name for operation in migration.operations},
            {"settlement_name_settings", "settlement_name_revision"},
        )
        self.assertFalse(any(operation.__class__.__name__ == "RunPython" for operation in migration.operations))

    def test_admin_and_serializer_reject_generic_replacement(self):
        self.assertIn("settlement_name_settings", OTEFViewportStateAdmin.readonly_fields)
        self.assertIn("settlement_name_revision", OTEFViewportStateAdmin.readonly_fields)
        from backend.serializers import OTEFViewportStateSerializer

        self.assertIn("settlement_name_settings", OTEFViewportStateSerializer.Meta.read_only_fields)
        self.assertIn("settlement_name_revision", OTEFViewportStateSerializer.Meta.read_only_fields)


class SettlementNameFixtureMixin:
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.settings_override = override_settings(BASE_DIR=self.tmp.name)
        self.settings_override.enable()
        self.table = Table.objects.create(name="otef", display_name="Otef")
        self.state = OTEFViewportState.objects.create(table=self.table)
        self.source = SOURCE_ID
        write_trusted_source(self.tmp.name, SOURCE_GEOJSON)
        canonical = canonical_v5_config()
        working = working_v5_config()
        self.calibration = OTEFProjectionCalibration.objects.create(
            table=self.table,
            working_config=working,
            revision=CALIBRATION_REVISION,
            presets=[
                {"id": "original", "name": "Original calibration", "config": canonical, "readOnly": True},
                {
                    "id": "33333333-3333-4333-8333-333333333333",
                    "name": "Desk",
                    "config": deepcopy(working),
                    "readOnly": False,
                },
            ],
            selected_preset_id="original",
        )

    def tearDown(self):
        self.settings_override.disable()
        self.tmp.cleanup()

    def initialize_from_fixture(self):
        from backend.projection_name_initialization import initialize_projection_name_settings

        initialize_projection_name_settings("otef", initialization_payload())
        self.state.refresh_from_db()
        self.calibration.refresh_from_db()

    def command(self, **payload):
        body = {
            "action": "set_settlement_names",
            "sourceId": self.source,
            "timestamp": TIMESTAMP,
            **payload,
        }
        return self.client.post(
            "/api/otef_viewport/by-table/otef/command/",
            json.dumps(body),
            content_type="application/json",
        )


class SettlementNameApiTests(SettlementNameFixtureMixin, TestCase):
    def test_manual_origin_is_shared_and_can_reset_without_changing_placement(self):
        self.initialize_from_fixture()
        before = deepcopy(self.state.settlement_name_settings)
        origin = {"lng": 34.5, "lat": 31.4}
        response = self.command(operation="leader_origin", citycode="0067", origin=origin, baseRevision=1)
        self.assertEqual(response.status_code, 200)
        self.state.refresh_from_db()
        self.assertEqual(self.state.settlement_name_settings["leaderOrigins"], {"0067": origin})
        self.assertEqual(self.state.settlement_name_settings["outputs"], before["outputs"])
        self.assertEqual(self.state.settlement_name_settings["baseline"], before["baseline"])
        response = self.command(operation="reset_leader_origin", citycode="0067", baseRevision=2)
        self.assertEqual(response.status_code, 200)
        self.state.refresh_from_db()
        self.assertEqual(self.state.settlement_name_settings["leaderOrigins"], {})

    def test_line_break_preserves_canonical_catalog_and_calibration(self):
        self.initialize_from_fixture()
        before = deepcopy(self.state.settlement_name_settings)
        response = self.command(operation="line_break", citycode="0067", afterWord=1, baseRevision=1)
        self.assertEqual(response.status_code, 200)
        self.state.refresh_from_db()
        self.assertEqual(self.state.settlement_name_settings["lineBreaks"], {"0067": 1})
        self.assertEqual(self.state.settlement_name_settings["baseline"], before["baseline"])
        self.assertEqual(self.state.settlement_name_revision, 2)
        response = self.command(operation="line_break", citycode="0067", afterWord=0, baseRevision=2)
        self.assertEqual(response.status_code, 200)
        self.state.refresh_from_db()
        self.assertEqual(self.state.settlement_name_settings["lineBreaks"], {})

    def test_leader_style_preserves_font_and_rejects_invalid_fields(self):
        self.initialize_from_fixture()
        style = {"widthPx": 2, "outlineWidthPx": 0.5, "color": "#ffffff", "outlineColor": "#bfbf99", "opacity": 0.8}
        response = self.command(operation="leader_style", leaderStyle=style, baseRevision=1)
        self.assertEqual(response.status_code, 200)
        self.state.refresh_from_db()
        self.assertEqual(self.state.settlement_name_settings["leaderStyle"], style)
        self.assertEqual(self.state.settlement_name_settings["style"], STYLE)
        for field, invalid in (("widthPx", True), ("widthPx", 0), ("color", "bad"), ("opacity", 2), ("outlineWidthPx", -1)):
            response = self.command(operation="leader_style", leaderStyle={**style, field: invalid}, baseRevision=2)
            self.assertEqual(response.status_code, 400)

    def test_position_write_preserves_baseline_other_output_and_metadata(self):
        self.initialize_from_fixture()
        self.state.settlement_name_settings["retained"] = {"keep": True}
        self.state.save(update_fields=["settlement_name_settings"])
        before = deepcopy(self.state.settlement_name_settings)
        response = self.command(
            operation="position",
            output="left",
            citycode="0067",
            position={"x": 510, "y": 350},
            baseRevision=1,
        )
        self.assertEqual(response.status_code, 200)
        self.state.refresh_from_db()
        self.assertEqual(self.state.settlement_name_revision, 2)
        self.assertEqual(self.state.settlement_name_settings["baseline"], before["baseline"])
        self.assertEqual(self.state.settlement_name_settings["outputs"]["right"], before["outputs"]["right"])
        self.assertEqual(self.state.settlement_name_settings["retained"], {"keep": True})
        self.assertEqual(response.json()["settlementNameRevision"], 2)
        self.assertEqual(response.json()["action"], "set_settlement_names")

    def test_stale_missing_and_unsafe_revision_do_not_write(self):
        self.initialize_from_fixture()
        before = deepcopy(self.state.settlement_name_settings)
        stale = self.command(operation="position", output="left", citycode="0067", position={"x": 10, "y": 10}, baseRevision=0)
        self.assertEqual(stale.status_code, 409)
        self.assertEqual(stale.json()["error"], "conflict")
        self.assertEqual(stale.json()["settlementNameRevision"], 1)
        self.assertEqual(stale.json()["settlementNameSettings"]["baseline"], before["baseline"])
        for revision in (None, True, 1.5, -1, 2**53, ""):
            payload = {"operation": "position", "output": "left", "citycode": "0067", "position": {"x": 10, "y": 10}}
            if revision is not None:
                payload["baseRevision"] = revision
            response = self.command(**payload)
            self.assertEqual(response.status_code, 400, revision)
        self.state.refresh_from_db()
        self.assertEqual(self.state.settlement_name_revision, 1)
        self.assertEqual(self.state.settlement_name_settings, before)

    def test_bool_nonfinite_empty_and_extra_fields_are_rejected(self):
        self.initialize_from_fixture()
        before = deepcopy(self.state.settlement_name_settings)
        cases = [
            {"operation": "position", "output": "left", "citycode": "0067", "position": {"x": True, "y": 1}, "baseRevision": 1},
            {"operation": "position", "output": "left", "citycode": "0067", "position": {"x": float("inf"), "y": 1}, "baseRevision": 1},
            {"operation": "position", "output": "left", "citycode": "", "position": {"x": 1, "y": 1}, "baseRevision": 1},
            {"operation": "position", "output": "left", "citycode": "0067", "position": {"x": 1, "y": 1, "z": 1}, "baseRevision": 1},
            {"operation": "position", "output": "left", "citycode": "0067", "position": {"x": 1, "y": 1}, "baseRevision": 1, "style": STYLE},
            {"operation": "style", "style": {"fontFamily": "Guttman Hatzvi", "fontPx": True, "rotateDeg": 1}, "baseRevision": 1},
            {"operation": "style", "style": {}, "baseRevision": 1},
        ]
        for payload in cases:
            response = self.command(**payload)
            self.assertEqual(response.status_code, 400, payload)
        self.state.refresh_from_db()
        self.assertEqual(self.state.settlement_name_settings, before)
        self.assertEqual(self.state.settlement_name_revision, 1)

    def test_unknown_catalog_font_and_body_limit(self):
        self.initialize_from_fixture()
        self.assertEqual(
            self.command(operation="position", output="left", citycode="67", position={"x": 1, "y": 1}, baseRevision=1).status_code,
            400,
        )
        self.assertEqual(
            self.command(
                operation="style",
                style={"fontFamily": "Comic Sans", "fontPx": 14, "rotateDeg": 0},
                baseRevision=1,
            ).status_code,
            400,
        )
        oversized = json.dumps({
            "action": "set_settlement_names",
            "operation": "position",
            "output": "left",
            "citycode": "0067",
            "position": {"x": 1, "y": 1},
            "baseRevision": 1,
            "sourceId": self.source,
            "timestamp": TIMESTAMP,
            "padding": "x" * (256 * 1024),
        }).encode("utf-8")
        limited = self.client.post(
            "/api/otef_viewport/by-table/otef/command/",
            oversized,
            content_type="application/json",
        )
        self.assertEqual(limited.status_code, 400)
        self.assertEqual(limited.json()["error"], "body too large")
        self.state.refresh_from_db()
        self.assertEqual(self.state.settlement_name_revision, 1)

    def test_missing_content_length_rejects_oversized_json_body(self):
        self.initialize_from_fixture()
        oversized = json.dumps({
            "action": "set_settlement_names",
            "operation": "position",
            "output": "left",
            "citycode": "0067",
            "position": {"x": 1, "y": 1},
            "baseRevision": 1,
            "sourceId": self.source,
            "timestamp": TIMESTAMP,
            "padding": "x" * (256 * 1024),
        }).encode("utf-8")
        self.assertGreater(len(oversized), 256 * 1024)
        for declared in ("", "0"):
            with self.subTest(content_length=declared or "missing"):
                limited = self.client.post(
                    "/api/otef_viewport/by-table/otef/command/",
                    oversized,
                    content_type="application/json",
                    CONTENT_LENGTH=declared,
                )
                self.assertEqual(limited.status_code, 400)
                self.assertEqual(limited.json()["error"], "body too large")
        self.state.refresh_from_db()
        self.calibration.refresh_from_db()
        self.assertEqual(self.state.settlement_name_revision, 1)
        self.assertEqual(self.calibration.revision, CALIBRATION_REVISION + 1)

    def test_override_only_citycode_is_unknown(self):
        self.initialize_from_fixture()
        self.state.settlement_name_settings["outputs"]["left"]["ghost"] = {"x": 1, "y": 2}
        self.state.save(update_fields=["settlement_name_settings"])
        before = deepcopy(self.state.settlement_name_settings)
        positioned = self.command(
            operation="position",
            output="left",
            citycode="ghost",
            position={"x": 3, "y": 4},
            baseRevision=1,
        )
        self.assertEqual(positioned.status_code, 400)
        self.assertEqual(positioned.json()["error"], "unknown citycode")
        reset = self.command(operation="reset_position", output="left", citycode="ghost", baseRevision=1)
        self.assertEqual(reset.status_code, 400)
        self.assertEqual(reset.json()["error"], "unknown citycode")
        self.state.refresh_from_db()
        self.assertEqual(self.state.settlement_name_revision, 1)
        self.assertEqual(self.state.settlement_name_settings, before)
        retained = deepcopy(before)
        retained["baseline"]["outputs"]["left"].pop("0099")
        retained["baseline"]["retained"] = {"left": {"0099": {"x": -100, "y": 2000}}, "right": {}}
        self.state.settlement_name_settings = retained
        self.state.save(update_fields=["settlement_name_settings"])
        edited = self.command(
            operation="position",
            output="left",
            citycode="0099",
            position={"x": 12, "y": 13},
            baseRevision=1,
        )
        self.assertEqual(edited.status_code, 200)
        self.state.refresh_from_db()
        self.assertEqual(self.state.settlement_name_settings["outputs"]["left"]["0099"], {"x": 12, "y": 13})
        self.assertNotIn("0099", self.state.settlement_name_settings["baseline"]["outputs"]["left"])
        self.assertEqual(self.state.settlement_name_settings["baseline"]["retained"]["left"]["0099"], {"x": -100, "y": 2000})

    def test_reset_removes_only_override_and_style_preserves_positions(self):
        self.initialize_from_fixture()
        self.state.settlement_name_settings["outputs"]["left"]["0067"] = {"x": 11, "y": 12}
        self.state.settlement_name_settings["outputs"]["right"]["0099"] = {"x": 13, "y": 14}
        self.state.save(update_fields=["settlement_name_settings"])
        reset = self.command(operation="reset_position", output="left", citycode="0067", baseRevision=1)
        self.assertEqual(reset.status_code, 200)
        self.state.refresh_from_db()
        self.assertNotIn("0067", self.state.settlement_name_settings["outputs"]["left"])
        self.assertEqual(self.state.settlement_name_settings["outputs"]["right"]["0099"], {"x": 13, "y": 14})
        self.assertEqual(self.state.settlement_name_settings["baseline"]["outputs"], BASELINE_POSITIONS)
        styled = self.command(
            operation="style",
            style={"fontFamily": "Arial", "fontPx": 20, "rotateDeg": -20},
            baseRevision=2,
        )
        self.assertEqual(styled.status_code, 200)
        self.state.refresh_from_db()
        self.assertEqual(self.state.settlement_name_settings["style"]["fontFamily"], "Arial")
        self.assertEqual(self.state.settlement_name_settings["outputs"]["right"]["0099"], {"x": 13, "y": 14})
        self.assertEqual(self.state.settlement_name_settings["baseline"]["outputs"]["left"]["0067"], {"x": 510, "y": 350})
        self.assertEqual(self.state.settlement_name_revision, 3)

    def test_uninitialized_get_does_not_write_and_command_conflicts(self):
        listed = self.client.get("/api/otef_viewport/by-table/otef/")
        self.assertEqual(listed.status_code, 200)
        self.assertEqual(listed.json()["settlement_name_settings"], {})
        self.assertEqual(listed.json()["settlement_name_revision"], 0)
        self.calibration.refresh_from_db()
        self.assertEqual(self.calibration.working_config["schemaVersion"], 5)
        response = self.command(operation="position", output="left", citycode="0067", position={"x": 1, "y": 1}, baseRevision=0)
        self.assertEqual(response.status_code, 409)
        self.assertEqual(response.json()["error"], "initialization_required")
        self.state.refresh_from_db()
        self.assertEqual(self.state.settlement_name_settings, {})
        self.assertEqual(self.state.settlement_name_revision, 0)

    def test_generic_patch_cannot_replace_settlement_fields(self):
        listed = self.client.patch(
            "/api/otef_viewport/by-table/otef/",
            json.dumps({"settlement_name_settings": {"baseline": {"keep": False}}, "settlement_name_revision": 9, "exhibit_mode": True}),
            content_type="application/json",
        )
        self.assertEqual(listed.status_code, 400)
        detail = self.client.patch(
            f"/api/otef_viewport/{self.state.id}/",
            json.dumps({"settlement_name_settings": {"injected": True}, "settlement_name_revision": 9}),
            content_type="application/json",
        )
        self.assertEqual(detail.status_code, 400)
        self.state.refresh_from_db()
        self.assertEqual(self.state.settlement_name_settings, {})
        self.assertEqual(self.state.settlement_name_revision, 0)
        self.assertFalse(self.state.exhibit_mode)

    @patch("backend.views.OTEFViewportStateViewSet._broadcast_settlement_names")
    def test_broadcast_happens_after_commit(self, broadcast):
        self.initialize_from_fixture()
        with self.captureOnCommitCallbacks(execute=True) as callbacks:
            response = self.command(
                operation="position", output="left", citycode="0067", position={"x": 20, "y": 30}, baseRevision=1,
            )
        self.assertEqual(response.status_code, 200)
        self.assertTrue(callbacks)
        broadcast.assert_called_once()
        _table, settings, revision, metadata = broadcast.call_args.args
        self.assertEqual(revision, 2)
        self.assertEqual(settings["outputs"]["left"]["0067"], {"x": 20, "y": 30})
        self.assertEqual(metadata["sourceId"], self.source)
        self.assertEqual(metadata["timestamp"], TIMESTAMP)

    def test_revision_overflow_does_not_mutate(self):
        self.initialize_from_fixture()
        self.state.settlement_name_revision = 2**53 - 1
        self.state.save(update_fields=["settlement_name_revision"])
        before = deepcopy(self.state.settlement_name_settings)
        response = self.command(
            operation="position", output="left", citycode="0067", position={"x": 1, "y": 1}, baseRevision=2**53 - 1,
        )
        self.assertEqual(response.status_code, 400)
        self.state.refresh_from_db()
        self.assertEqual(self.state.settlement_name_revision, 2**53 - 1)
        self.assertEqual(self.state.settlement_name_settings, before)

    def test_append_baseline_inserts_only_missing_catalog_ids(self):
        self.initialize_from_fixture()
        self.state.settlement_name_settings["outputs"]["left"]["0067"] = {"x": 8, "y": 9}
        self.state.save(update_fields=["settlement_name_settings"])
        write_trusted_source(self.tmp.name, ADDED_SOURCE_GEOJSON)
        rejected = self.command(
            operation="append_baseline",
            catalogJson=ADDED_CATALOG_JSON,
            catalogDigest=ADDED_CATALOG_DIGEST,
            positions={"left": {"0067": {"x": 1, "y": 1}}, "right": {"0067": {"x": 1, "y": 1}}},
            baseRevision=1,
        )
        self.assertEqual(rejected.status_code, 400)
        response = self.command(
            operation="append_baseline",
            catalogJson=ADDED_CATALOG_JSON,
            catalogDigest=ADDED_CATALOG_DIGEST,
            positions={"left": {"0100": {"x": 40, "y": 50}}, "right": {"0100": {"x": 60, "y": 70}}},
            baseRevision=1,
        )
        self.assertEqual(response.status_code, 200)
        self.state.refresh_from_db()
        baseline = self.state.settlement_name_settings["baseline"]
        self.assertEqual(baseline["outputs"]["left"]["0067"], {"x": 510, "y": 350})
        self.assertEqual(baseline["outputs"]["left"]["0100"], {"x": 40, "y": 50})
        self.assertEqual(baseline["outputs"]["right"]["0100"], {"x": 60, "y": 70})
        self.assertEqual(baseline["captureId"], initialization_payload()["captureId"])
        self.assertEqual(self.state.settlement_name_settings["outputs"]["left"]["0067"], {"x": 8, "y": 9})
        self.assertEqual(self.state.settlement_name_settings["style"], STYLE)
        self.assertEqual(self.state.settlement_name_revision, 2)
