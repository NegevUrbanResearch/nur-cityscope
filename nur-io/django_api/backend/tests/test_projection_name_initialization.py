import json
from copy import deepcopy
from unittest.mock import patch

from django.db.models.query import QuerySet
from django.test import TestCase

from backend.models import OTEFProjectionCalibration
from backend.projection_config_schema import legacy_projection_config_defaults, validate_projection_snapshot
from backend.projection_warp_schema import migrate_projection_config_to_v2, migrate_projection_config_to_v5
from backend.tests.settlement_name_fixtures import (
    BASELINE_POSITIONS,
    CALIBRATION_CONFIG_DIGEST,
    CALIBRATION_CONFIG_JSON,
    CALIBRATION_REVISION,
    CATALOG_DIGEST,
    CATALOG_JSON,
    PROCESSED_SOURCE_DIGEST,
    SOURCE_GEOJSON,
    WALL_ROTATE_DEG,
    canonical_v5_config,
    initialization_payload,
    sha256_text,
)
from backend.tests.test_otef_settlement_names_api import SettlementNameFixtureMixin, write_trusted_source


class ProjectionNameInitializationTests(SettlementNameFixtureMixin, TestCase):
    def initialize(self, **overrides):
        from backend.projection_name_initialization import initialize_projection_name_settings

        return initialize_projection_name_settings("otef", initialization_payload(**overrides))

    def test_initialization_preserves_geometry_presets_and_records_provenance(self):
        before_working = deepcopy(self.calibration.working_config)
        before_presets = deepcopy(self.calibration.presets)
        with patch("backend.views.OTEFViewportStateViewSet._broadcast_settlement_names") as broadcast:
            with patch("channels.layers.get_channel_layer") as channel_layer:
                result = self.initialize()
        broadcast.assert_not_called()
        channel_layer.assert_not_called()
        self.state.refresh_from_db()
        self.calibration.refresh_from_db()
        self.assertEqual(self.state.settlement_name_revision, 1)
        self.assertEqual(self.calibration.revision, CALIBRATION_REVISION + 1)
        self.assertEqual(self.calibration.selected_preset_id, "original")
        self.assertEqual(self.calibration.working_config["schemaVersion"], 6)
        self.assertEqual(self.calibration.working_config["pre"], before_working["pre"])
        self.assertEqual(self.calibration.working_config["outputs"], before_working["outputs"])
        self.assertEqual(self.calibration.working_config["namesWall"]["rotateDeg"], WALL_ROTATE_DEG)
        self.assertEqual(
            {key: value for key, value in self.calibration.working_config["namesWall"].items() if key != "rotateDeg"},
            before_working["namesWall"],
        )
        self.assertEqual(
            [(preset["id"], preset["name"], preset["readOnly"]) for preset in self.calibration.presets],
            [(preset["id"], preset["name"], preset["readOnly"]) for preset in before_presets],
        )
        for before, after in zip(before_presets, self.calibration.presets):
            self.assertEqual(after["config"]["pre"], before["config"]["pre"])
            self.assertEqual(after["config"]["outputs"], before["config"]["outputs"])
            self.assertEqual(after["config"]["namesWall"]["rotateDeg"], WALL_ROTATE_DEG)
            self.assertEqual(after["config"]["schemaVersion"], 6)
        baseline = self.state.settlement_name_settings["baseline"]
        self.assertEqual(baseline["outputs"], BASELINE_POSITIONS)
        self.assertEqual(baseline["sourceDigest"], PROCESSED_SOURCE_DIGEST)
        self.assertEqual(baseline["catalogDigest"], CATALOG_DIGEST)
        self.assertEqual(baseline["predecessor"], {"revision": CALIBRATION_REVISION, "configDigest": CALIBRATION_CONFIG_DIGEST})
        self.assertEqual(baseline["successor"]["revision"], CALIBRATION_REVISION + 1)
        self.assertEqual(len(baseline["successor"]["configDigest"]), 64)
        self.assertEqual(self.state.settlement_name_settings["style"]["rotateDeg"], 35)
        self.assertEqual(self.state.settlement_name_settings["outputs"], {"left": {}, "right": {}})
        self.assertEqual(result["settlementNameRevision"], 1)
        self.assertEqual(result["projectionState"]["revision"], CALIBRATION_REVISION + 1)
        self.assertEqual(result["initialization"]["successor"], baseline["successor"])

    def test_locks_table_then_viewport_then_calibration(self):
        calls = []
        original = QuerySet.select_for_update

        def tracked(query, *args, **kwargs):
            calls.append(query.model.__name__)
            return original(query, *args, **kwargs)

        with patch.object(QuerySet, "select_for_update", tracked):
            self.initialize()
        self.assertEqual(calls[:3], ["Table", "OTEFViewportState", "OTEFProjectionCalibration"])

    def test_matching_bytes_with_wrong_semantics_wrong_hash_and_ids_do_not_write(self):
        from backend.projection_name_initialization import InitializationRejected

        altered = CALIBRATION_CONFIG_JSON.replace('"tx":0.0', '"tx":0.2', 1)
        cases = [
            {"calibrationConfigDigest": sha256_text(altered), "calibrationConfigJson": altered},
            {"calibrationConfigDigest": "0" * 64},
            {"baselinePositions": {"left": {"67": {"x": 1, "y": 1}, "0099": {"x": -100, "y": 2000}}, "right": deepcopy(BASELINE_POSITIONS["right"])}},
            {"catalogJson": CATALOG_JSON.replace("עזה", "אשדוד"), "catalogDigest": sha256_text(CATALOG_JSON.replace("עזה", "אשדוד"))},
            {"catalogJson": '{"citycode":"0067","citycode":"0099"}', "catalogDigest": sha256_text('{"citycode":"0067","citycode":"0099"}')},
        ]
        for overrides in cases:
            with self.subTest(overrides=sorted(overrides)):
                with self.assertRaises(InitializationRejected):
                    self.initialize(**overrides)
                self.state.refresh_from_db()
                self.calibration.refresh_from_db()
                self.assertEqual(self.state.settlement_name_revision, 0)
                self.assertEqual(self.state.settlement_name_settings, {})
                self.assertEqual(self.calibration.revision, CALIBRATION_REVISION)
                self.assertEqual(self.calibration.working_config["schemaVersion"], 5)

    def test_http_initialization_and_forced_failure_rolls_back_both_domains(self):
        response = self.client.post(
            "/api/otef_viewport/by-table/otef/command/",
            json.dumps(initialization_payload()),
            content_type="application/json",
        )
        self.assertEqual(response.status_code, 200)
        self.state.refresh_from_db()
        self.calibration.refresh_from_db()
        self.assertEqual(self.state.settlement_name_revision, 1)
        self.assertEqual(self.calibration.working_config["schemaVersion"], 6)
        self.state.settlement_name_settings = {}
        self.state.settlement_name_revision = 0
        self.state.save(update_fields=["settlement_name_settings", "settlement_name_revision"])
        presets = deepcopy(self.calibration.presets)
        presets[0]["config"] = canonical_v5_config()
        presets[1]["config"] = working_config_reset()
        self.calibration.working_config = working_config_reset()
        self.calibration.revision = CALIBRATION_REVISION
        self.calibration.presets = presets
        self.calibration.save()

        with patch.object(OTEFProjectionCalibration, "save", side_effect=RuntimeError("boom")):
            with self.assertRaises(RuntimeError):
                self.client.post(
                    "/api/otef_viewport/by-table/otef/command/",
                    json.dumps(initialization_payload()),
                    content_type="application/json",
                )
        self.state.refresh_from_db()
        self.calibration.refresh_from_db()
        self.assertEqual(self.state.settlement_name_revision, 0)
        self.assertEqual(self.state.settlement_name_settings, {})
        self.assertEqual(self.calibration.revision, CALIBRATION_REVISION)
        self.assertEqual(self.calibration.working_config["schemaVersion"], 5)

    def test_same_capture_retries_without_writes_and_other_capture_conflicts(self):
        with patch("channels.layers.get_channel_layer") as channel_layer:
            first = self.initialize()
            channel_layer.assert_not_called()
            second = self.initialize()
        self.state.refresh_from_db()
        self.calibration.refresh_from_db()
        self.assertEqual(second["settlementNameRevision"], 1)
        self.assertEqual(second["initialization"]["successor"], first["initialization"]["successor"])
        self.assertEqual(self.state.settlement_name_revision, 1)
        self.assertEqual(self.calibration.revision, CALIBRATION_REVISION + 1)
        from backend.projection_name_initialization import InitializationRejected

        with self.assertRaises(InitializationRejected):
            self.initialize(captureId="44444444-4444-4444-8444-444444444444", captureDigest="cd" * 32)
        self.state.refresh_from_db()
        self.calibration.refresh_from_db()
        self.assertEqual(self.state.settlement_name_revision, 1)
        self.assertEqual(self.calibration.revision, CALIBRATION_REVISION + 1)

    def test_retry_accepts_later_edits_catalog_addition_and_rejects_corruption(self):
        self.initialize_from_fixture()
        positioned = self.command(operation="position", output="left", citycode="0067", position={"x": 515, "y": 355}, baseRevision=1)
        self.assertEqual(positioned.status_code, 200)
        styled = self.command(operation="style", style={"fontFamily": "Arial", "fontPx": 18, "rotateDeg": 10}, baseRevision=2)
        self.assertEqual(styled.status_code, 200)
        config = self.client.get("/api/otef/projection-config/?table=otef").json()
        edited = deepcopy(config["config"])
        edited["pre"]["tx"] = 0.25
        preview = self.client.post("/api/otef/projection-config/", {
            "table": "otef", "baseRevision": config["revision"], "action": "preview",
            "sourceId": "11111111-1111-4111-8111-111111111111", "config": edited,
        }, content_type="application/json")
        self.assertEqual(preview.status_code, 200)
        saved = self.client.post("/api/otef/projection-config/", {
            "table": "otef", "baseRevision": preview.json()["revision"], "action": "save",
            "sourceId": "11111111-1111-4111-8111-111111111111", "config": edited,
            "presetId": None, "name": "Later",
        }, content_type="application/json")
        self.assertEqual(saved.status_code, 200)
        from backend.tests.settlement_name_fixtures import ADDED_CATALOG_DIGEST, ADDED_CATALOG_JSON, ADDED_SOURCE_GEOJSON

        write_trusted_source(self.tmp.name, ADDED_SOURCE_GEOJSON)
        appended = self.command(
            operation="append_baseline",
            catalogJson=ADDED_CATALOG_JSON,
            catalogDigest=ADDED_CATALOG_DIGEST,
            positions={"left": {"0100": {"x": 40, "y": 50}}, "right": {"0100": {"x": 60, "y": 70}}},
            baseRevision=3,
        )
        self.assertEqual(appended.status_code, 200)
        self.state.refresh_from_db()
        self.calibration.refresh_from_db()
        settlement_revision = self.state.settlement_name_revision
        calibration_revision = self.calibration.revision
        with patch("channels.layers.get_channel_layer") as channel_layer:
            retry = self.initialize()
        channel_layer.assert_not_called()
        self.state.refresh_from_db()
        self.calibration.refresh_from_db()
        self.assertEqual(self.state.settlement_name_revision, settlement_revision)
        self.assertEqual(self.calibration.revision, calibration_revision)
        self.assertEqual(retry["settlementNameSettings"]["outputs"]["left"]["0067"], {"x": 515, "y": 355})
        self.assertEqual(retry["settlementNameSettings"]["baseline"]["outputs"]["left"]["0100"], {"x": 40, "y": 50})
        self.assertEqual(retry["settlementNameSettings"]["style"]["fontFamily"], "Arial")
        self.assertEqual(retry["projectionState"]["config"]["pre"]["tx"], 0.25)
        self.assertGreater(retry["projectionState"]["revision"], CALIBRATION_REVISION + 1)

        self.state.settlement_name_settings["baseline"]["successor"]["revision"] = 1
        self.state.save(update_fields=["settlement_name_settings"])
        from backend.projection_name_initialization import InitializationRejected

        with self.assertRaises(InitializationRejected):
            self.initialize()
        self.calibration.refresh_from_db()
        self.assertEqual(self.calibration.revision, calibration_revision)

        self.state.refresh_from_db()
        self.state.settlement_name_settings["baseline"]["successor"]["revision"] = CALIBRATION_REVISION + 1
        self.state.settlement_name_revision = 0
        self.state.save(update_fields=["settlement_name_settings", "settlement_name_revision"])
        with self.assertRaises(InitializationRejected):
            self.initialize()

    def test_same_capture_retry_conflicts_on_corrupt_preset_envelopes(self):
        from backend.projection_name_initialization import InitializationConflict

        self.initialize()
        self.calibration.refresh_from_db()
        self.state.refresh_from_db()
        calibration_revision = self.calibration.revision
        settlement_revision = self.state.settlement_name_revision
        valid = deepcopy(self.calibration.presets)
        config = deepcopy(valid[0]["config"])
        cases = {
            "non-dict": (["not-a-preset"], self.calibration.selected_preset_id),
            "partial": ([{"config": config}], self.calibration.selected_preset_id),
            "duplicate-id": ([valid[0], deepcopy(valid[0])], self.calibration.selected_preset_id),
            "blank-name": (
                [{**valid[0], "name": "  "}, valid[1]],
                self.calibration.selected_preset_id,
            ),
            "read-only-type": (
                [{**valid[0], "readOnly": "yes"}, valid[1]],
                self.calibration.selected_preset_id,
            ),
            "unknown-selected": (valid, "99999999-9999-4999-8999-999999999999"),
        }
        for label, (presets, selected) in cases.items():
            with self.subTest(label=label):
                self.calibration.presets = presets
                self.calibration.selected_preset_id = selected
                self.calibration.save(update_fields=["presets", "selected_preset_id"])
                with self.assertRaises(InitializationConflict) as raised:
                    self.initialize()
                self.assertTrue(raised.exception.conflict)
                self.calibration.refresh_from_db()
                self.state.refresh_from_db()
                self.assertEqual(self.calibration.revision, calibration_revision)
                self.assertEqual(self.state.settlement_name_revision, settlement_revision)
                self.assertEqual(self.calibration.presets, presets)

    def test_same_capture_retry_conflicts_on_malformed_settlement_settings(self):
        from backend.projection_name_initialization import InitializationConflict

        self.initialize()
        self.calibration.refresh_from_db()
        self.state.refresh_from_db()
        calibration_revision = self.calibration.revision
        settlement_revision = self.state.settlement_name_revision
        valid = deepcopy(self.state.settlement_name_settings)

        def without_style(settings):
            settings.pop("style")

        def comic_sans(settings):
            settings["style"]["fontFamily"] = "Comic Sans"

        def boolean_font(settings):
            settings["style"]["fontPx"] = True

        def without_outputs(settings):
            settings.pop("outputs")

        def boolean_override(settings):
            settings["outputs"]["left"]["0067"] = {"x": True, "y": 1}

        def incomplete_baseline_position(settings):
            settings["baseline"]["outputs"]["left"]["extra"] = {"x": "nope"}

        def malformed_retained(settings):
            settings["baseline"]["retained"] = {"left": {"0099": {"x": "no"}}}

        cases = {
            "style-missing": without_style,
            "style-font": comic_sans,
            "style-boolean": boolean_font,
            "outputs-missing": without_outputs,
            "outputs-boolean": boolean_override,
            "baseline-incomplete-position": incomplete_baseline_position,
            "baseline-retained-malformed": malformed_retained,
        }
        for label, mutate in cases.items():
            with self.subTest(label=label):
                settings = deepcopy(valid)
                mutate(settings)
                self.state.settlement_name_settings = settings
                self.state.save(update_fields=["settlement_name_settings"])
                with self.assertRaises(InitializationConflict) as raised:
                    self.initialize()
                self.assertTrue(raised.exception.conflict)
                self.calibration.refresh_from_db()
                self.state.refresh_from_db()
                self.assertEqual(self.calibration.revision, calibration_revision)
                self.assertEqual(self.state.settlement_name_revision, settlement_revision)
                self.assertEqual(self.state.settlement_name_settings, settings)

    def test_same_capture_retry_conflicts_on_unsafe_settlement_revision(self):
        from backend.projection_name_initialization import InitializationConflict

        self.initialize()
        self.calibration.refresh_from_db()
        self.state.refresh_from_db()
        calibration_revision = self.calibration.revision
        settings = deepcopy(self.state.settlement_name_settings)
        self.state.settlement_name_revision = 2**53
        self.state.save(update_fields=["settlement_name_revision"])
        with self.assertRaises(InitializationConflict) as raised:
            self.initialize()
        self.assertTrue(raised.exception.conflict)
        self.calibration.refresh_from_db()
        self.state.refresh_from_db()
        self.assertEqual(self.calibration.revision, calibration_revision)
        self.assertEqual(self.state.settlement_name_revision, 2**53)
        self.assertEqual(self.state.settlement_name_settings, settings)

        self.state.settlement_name_revision = 2**53 - 1
        self.state.save(update_fields=["settlement_name_revision"])
        retry = self.initialize()
        self.state.refresh_from_db()
        self.calibration.refresh_from_db()
        self.assertEqual(retry["settlementNameRevision"], 2**53 - 1)
        self.assertEqual(self.state.settlement_name_revision, 2**53 - 1)
        self.assertEqual(self.calibration.revision, calibration_revision)
        self.assertEqual(self.state.settlement_name_settings, settings)

    def test_same_capture_retry_conflicts_on_orphan_override_citycodes(self):
        from backend.projection_name_initialization import InitializationConflict

        self.initialize()
        self.calibration.refresh_from_db()
        self.state.refresh_from_db()
        calibration_revision = self.calibration.revision
        settlement_revision = self.state.settlement_name_revision
        valid = deepcopy(self.state.settlement_name_settings)

        def orphan_left(settings):
            settings["outputs"]["left"]["ghost"] = {"x": 1, "y": 1}

        def known_only_on_other_output(settings):
            settings["baseline"]["outputs"]["left"]["onlyleft"] = {"x": 4, "y": 5}
            settings["outputs"]["right"]["onlyleft"] = {"x": 6, "y": 7}

        def retained_on_other_output(settings):
            settings["baseline"]["retained"] = {"left": {"ghost": {"x": 8, "y": 9}}}
            settings["outputs"]["right"]["ghost"] = {"x": 10, "y": 11}

        cases = {
            "orphan-left": orphan_left,
            "other-output-baseline": known_only_on_other_output,
            "retained-other-output": retained_on_other_output,
        }
        for label, mutate in cases.items():
            with self.subTest(label=label):
                settings = deepcopy(valid)
                mutate(settings)
                self.state.settlement_name_settings = settings
                self.state.save(update_fields=["settlement_name_settings"])
                with self.assertRaises(InitializationConflict) as raised:
                    self.initialize()
                self.assertTrue(raised.exception.conflict)
                self.calibration.refresh_from_db()
                self.state.refresh_from_db()
                self.assertEqual(self.calibration.revision, calibration_revision)
                self.assertEqual(self.state.settlement_name_revision, settlement_revision)
                self.assertEqual(self.state.settlement_name_settings, settings)

        retained = deepcopy(valid)
        retained["baseline"]["retained"] = {"left": {"ghost": {"x": 8, "y": 9}}}
        retained["outputs"]["left"]["ghost"] = {"x": 12, "y": 13}
        self.state.settlement_name_settings = retained
        self.state.save(update_fields=["settlement_name_settings"])
        retry = self.initialize()
        self.state.refresh_from_db()
        self.calibration.refresh_from_db()
        self.assertEqual(retry["settlementNameSettings"]["outputs"]["left"]["ghost"], {"x": 12, "y": 13})
        self.assertEqual(self.state.settlement_name_revision, settlement_revision)
        self.assertEqual(self.calibration.revision, calibration_revision)
        self.assertEqual(self.state.settlement_name_settings, retained)

    def test_first_initialization_rejects_preset_envelopes_retry_would_reject(self):
        from backend.projection_name_initialization import InitializationRejected

        valid = deepcopy(self.calibration.presets)
        working = deepcopy(self.calibration.working_config)
        cases = {
            "blank-name": ([{**valid[0], "name": "  "}, valid[1]], "original"),
            "read-only-type": ([{**valid[0], "readOnly": "yes"}, valid[1]], "original"),
            "duplicate-id": ([valid[0], deepcopy(valid[0])], "original"),
            "missing-original": ([valid[1]], valid[1]["id"]),
            "renamed-original": ([{**valid[0], "name": "Original"}, valid[1]], "original"),
            "original-writable": ([{**valid[0], "readOnly": False}, valid[1]], "original"),
            "writable-read-only": ([valid[0], {**valid[1], "readOnly": True}], "original"),
            "bad-id": ([valid[0], {**valid[1], "id": "desk"}], "original"),
            "unknown-selected": (valid, "99999999-9999-4999-8999-999999999999"),
        }
        for label, (presets, selected) in cases.items():
            with self.subTest(label=label):
                self.calibration.working_config = deepcopy(working)
                self.calibration.revision = CALIBRATION_REVISION
                self.calibration.presets = deepcopy(presets)
                self.calibration.selected_preset_id = selected
                self.calibration.save()
                self.state.settlement_name_settings = {}
                self.state.settlement_name_revision = 0
                self.state.save(update_fields=["settlement_name_settings", "settlement_name_revision"])
                with self.assertRaises(InitializationRejected) as raised:
                    self.initialize()
                self.assertFalse(raised.exception.conflict)
                self.calibration.refresh_from_db()
                self.state.refresh_from_db()
                self.assertEqual(self.state.settlement_name_revision, 0)
                self.assertEqual(self.state.settlement_name_settings, {})
                self.assertEqual(self.calibration.revision, CALIBRATION_REVISION)
                self.assertEqual(self.calibration.working_config["schemaVersion"], 5)
                self.assertEqual(self.calibration.presets, presets)
                self.assertEqual(self.calibration.selected_preset_id, selected)


def working_config_reset():
    from backend.tests.settlement_name_fixtures import working_v5_config

    return working_v5_config()


class ProjectionV6SchemaTests(TestCase):
    def test_v6_conversion_passthrough_modulo_and_original_rotation(self):
        from backend.projection_warp_schema import migrate_projection_config_to_v6, normalize_rotation_deg

        legacy = legacy_projection_config_defaults()
        for seed in (35, -180, 180, 395, 270):
            converted = migrate_projection_config_to_v6(legacy, seed)
            self.assertEqual(converted["schemaVersion"], 6)
            self.assertEqual(converted["namesWall"]["rotateDeg"], normalize_rotation_deg(seed))
            self.assertEqual(converted["pre"], legacy["pre"])
            self.assertEqual(converted["outputs"]["left"]["crop"], legacy["outputs"]["left"]["crop"])
        v5 = migrate_projection_config_to_v5(migrate_projection_config_to_v2(legacy))
        seeded = migrate_projection_config_to_v6(v5, 70)
        again = migrate_projection_config_to_v6(seeded, 12)
        self.assertEqual(again["namesWall"]["rotateDeg"], 70)
        self.assertEqual(again["outputs"], seeded["outputs"])
        self.assertNotIn("rotateDeg", v5["namesWall"])
        with self.assertRaises(ValueError):
            normalize_rotation_deg(True)
        with self.assertRaises(ValueError):
            migrate_projection_config_to_v6(v5, float("nan"))
        original = migrate_projection_config_to_v6(canonical_v5_config(), 70)
        snapshot = {
            "revision": 1,
            "config": original,
            "presets": [{"id": "original", "name": "Original calibration", "config": original, "readOnly": True}],
            "selectedPresetId": "original",
        }
        self.assertEqual(validate_projection_snapshot(snapshot), {})
        shifted = deepcopy(original)
        shifted["namesWall"]["profiles"]["wall"]["spacingPx"] = 3
        snapshot["presets"][0]["config"] = shifted
        self.assertIn("presets[0]", validate_projection_snapshot(snapshot))

    def test_new_defaults_use_v6_and_35_degrees(self):
        from backend.models import projection_config_defaults

        defaults = projection_config_defaults()
        self.assertEqual(defaults["schemaVersion"], 6)
        self.assertEqual(defaults["namesWall"]["rotateDeg"], 35)
        self.assertEqual(defaults["pre"], {"scale": 1.41, "rotateDeg": -50, "tx": 0.01, "ty": 0})
