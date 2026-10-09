import copy
import importlib
import json
from pathlib import Path
from unittest.mock import patch

from django.db import transaction
from django.test import SimpleTestCase, TestCase

from backend.models import OTEFProjectionCalibration, OTEFViewportState, Table
from backend.otef_road_signs import normalize_road_sign_settings


FIXTURES = json.loads(
    (Path(__file__).parents[2] / ".." / ".." / "otef-interactive" / "tests" / "fixtures" / "road-sign-settings.json")
    .resolve()
    .read_text(encoding="utf-8")
)


class RoadSignsMigrationTests(SimpleTestCase):
    def test_0033_adds_only_signs_document_and_revision_after_current_leaf(self):
        migration = importlib.import_module(
            "backend.migrations.0033_otefviewportstate_road_signs"
        ).Migration
        self.assertEqual(migration.dependencies, [("backend", "0032_otefviewportstate_gaza_border_visible")])
        self.assertEqual([operation.__class__.__name__ for operation in migration.operations], ["AddField", "AddField"])
        self.assertEqual(
            {operation.name for operation in migration.operations},
            {"road_sign_settings", "road_sign_revision"},
        )


class RoadSignsNormalizerTests(SimpleTestCase):
    def test_optional_gis_output_preserves_projection_settings_and_validates_ids(self):
        settings = copy.deepcopy(FIXTURES["twoOutputs"])
        sign = copy.deepcopy(settings["outputs"]["left"][0])
        sign["id"] = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
        settings["outputs"]["gis"] = [sign]
        self.assertEqual(normalize_road_sign_settings(settings), settings)
        sign["id"] = settings["outputs"]["left"][0]["id"]
        with self.assertRaises(ValueError):
            normalize_road_sign_settings(settings)

    def test_fixture_documents_normalize_and_blank_storage_is_empty_without_write(self):
        self.assertEqual(normalize_road_sign_settings({}), FIXTURES["empty"])
        self.assertEqual(normalize_road_sign_settings(FIXTURES["twoOutputs"]), FIXTURES["twoOutputs"])

    def test_fixture_invalid_documents_are_rejected(self):
        for name, settings in FIXTURES["invalid"].items():
            with self.subTest(name=name), self.assertRaises(ValueError):
                normalize_road_sign_settings(settings)

    def test_rejects_nonfinite_numbers_oversized_output_and_bad_leader(self):
        base = copy.deepcopy(FIXTURES["twoOutputs"]["outputs"]["left"][0])
        for change in (
            {"x": float("inf")},
            {"rotateDeg": float("nan")},
            {"x": 10 ** 400},
            {"extra": True},
            {"scale": 0.009},
            {"scale": 3.001},
            {"rotateDeg": -180.1},
            {"rotateDeg": 180.1},
            {"y": -0.1},
            {"visible": 1},
            {"leader": {"enabled": 1, "x": 1, "y": 2}},
            {"leader": {"enabled": False, "x": 1, "y": 2, "extra": 1}},
            {"scale": 0},
            {"leader": {"enabled": False, "x": 1921, "y": 2}},
        ):
            invalid = copy.deepcopy(FIXTURES["empty"])
            invalid["outputs"]["left"] = [{**base, **change}]
            with self.subTest(change=change), self.assertRaises(ValueError):
                normalize_road_sign_settings(invalid)
        oversized = copy.deepcopy(FIXTURES["empty"])
        oversized["outputs"]["left"] = [
            {**base, "id": f"00000000-0000-4000-8000-{index:012d}"}
            for index in range(65)
        ]
        with self.assertRaises(ValueError):
            normalize_road_sign_settings(oversized)


class RoadSignsApiTests(TestCase):
    def setUp(self):
        self.table = Table.objects.create(name="otef")
        self.viewport = {"bbox": [101, 202, 303, 404], "zoom": 12}
        self.revisions = {
            "nli_clock_layout_revision": 11,
            "legend_layout_revision": 12,
            "settlement_name_revision": 13,
        }
        self.state = OTEFViewportState.objects.create(
            table=self.table,
            viewport=copy.deepcopy(self.viewport),
            **self.revisions,
        )
        self.calibration = OTEFProjectionCalibration.objects.create(
            table=self.table,
            working_config={"preserve": "calibration"},
            revision=27,
        )

    def assert_unrelated_state_preserved(self):
        self.state.refresh_from_db()
        self.assertEqual(self.state.viewport, self.viewport)
        for field, value in self.revisions.items():
            self.assertEqual(getattr(self.state, field), value)
        self.calibration.refresh_from_db()
        self.assertEqual(self.calibration.working_config, {"preserve": "calibration"})
        self.assertEqual(self.calibration.revision, 27)

    def command(self, settings, revision=0):
        return self.client.post(
            "/api/otef_viewport/by-table/otef/command/",
            json.dumps({"action": "set_road_signs", "settings": settings, "baseRevision": revision,
                        "sourceId": "44444444-4444-4444-8444-444444444444", "timestamp": 123}),
            content_type="application/json",
        )

    def test_command_cas_increments_only_signs_revision_and_preserves_other_state(self):
        self.state.gaza_border_visible = True
        self.state.legend_settings = {"language": "en"}
        self.state.save(update_fields=["gaza_border_visible", "legend_settings"])
        settings = FIXTURES["twoOutputs"]
        response = self.command(settings)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["roadSignSettings"], settings)
        self.assertEqual(response.json()["roadSignRevision"], 1)
        self.state.refresh_from_db()
        self.assertEqual(self.state.road_sign_revision, 1)
        self.assertEqual(self.state.legend_settings, {"language": "en"})
        self.assertTrue(self.state.gaza_border_visible)
        self.assert_unrelated_state_preserved()

        changed = copy.deepcopy(settings)
        changed["outputs"]["left"][0]["x"] = 25.5
        updated = self.command(changed, revision=1)
        self.assertEqual(updated.status_code, 200)
        self.assertEqual(updated.json()["roadSignRevision"], 2)
        self.assertEqual(updated.json()["roadSignSettings"]["outputs"]["left"][0]["x"], 25.5)
        self.assertEqual(updated.json()["roadSignSettings"]["outputs"]["left"][1], settings["outputs"]["left"][1])
        self.assertEqual(updated.json()["roadSignSettings"]["outputs"]["right"], settings["outputs"]["right"])
        self.state.refresh_from_db()
        self.assertEqual(self.state.legend_settings, {"language": "en"})
        self.assertTrue(self.state.gaza_border_visible)
        self.assert_unrelated_state_preserved()

        stale = self.command(FIXTURES["empty"], revision=1)
        self.assertEqual(stale.status_code, 409)
        self.assertEqual(stale.json()["roadSignSettings"], changed)
        self.assertEqual(stale.json()["roadSignRevision"], 2)
        self.assert_unrelated_state_preserved()

    def test_gis_signs_round_trip_without_changing_projection_placements(self):
        settings = copy.deepcopy(FIXTURES["twoOutputs"])
        sign = copy.deepcopy(settings["outputs"]["left"][0])
        sign["id"] = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
        settings["outputs"]["gis"] = [sign]
        response = self.command(settings)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["roadSignSettings"], settings)
        self.state.refresh_from_db()
        self.assertEqual(self.state.road_sign_settings, settings)
        self.assert_unrelated_state_preserved()

    def test_invalid_write_changes_nothing_and_does_not_broadcast(self):
        invalid = FIXTURES["invalid"]["badTheme"]
        with patch("backend.views.OTEFViewportStateViewSet._broadcast_road_signs") as broadcast:
            with self.captureOnCommitCallbacks(execute=True) as callbacks:
                response = self.command(invalid)
        self.assertEqual(response.status_code, 400)
        self.assertEqual(callbacks, [])
        broadcast.assert_not_called()
        self.state.refresh_from_db()
        self.assertEqual(self.state.road_sign_settings, {})
        self.assertEqual(self.state.road_sign_revision, 0)
        self.assert_unrelated_state_preserved()

    def test_broadcast_occurs_after_commit_and_is_discarded_on_rollback(self):
        with patch("backend.views.OTEFViewportStateViewSet._broadcast_road_signs") as broadcast:
            with self.captureOnCommitCallbacks(execute=False) as callbacks:
                response = self.command(FIXTURES["twoOutputs"])
            self.assertEqual(response.status_code, 200)
            self.assertEqual(len(callbacks), 1)
            broadcast.assert_not_called()
            callbacks[0]()
            broadcast.assert_called_once()

        with patch("backend.views.OTEFViewportStateViewSet._broadcast_road_signs") as rollback_broadcast:
            with self.captureOnCommitCallbacks(execute=True) as rollback_callbacks:
                with transaction.atomic():
                    response = self.client.post(
                        "/api/otef_viewport/by-table/otef/command/",
                        json.dumps({
                            "action": "set_road_signs",
                            "settings": FIXTURES["empty"],
                            "baseRevision": 1,
                            "sourceId": "44444444-4444-4444-8444-444444444444",
                            "timestamp": 123,
                        }),
                        content_type="application/json",
                    )
                    self.assertEqual(response.status_code, 200)
                    self.assertEqual(response.json()["roadSignRevision"], 2)
                    transaction.set_rollback(True)
            self.assertEqual(rollback_callbacks, [])
            rollback_broadcast.assert_not_called()
        self.state.refresh_from_db()
        self.assertEqual(self.state.road_sign_settings, FIXTURES["twoOutputs"])
        self.assertEqual(self.state.road_sign_revision, 1)

    def test_by_table_get_normalizes_blank_without_initializing_json(self):
        self.state.road_sign_settings = {}
        self.state.save(update_fields=["road_sign_settings"])
        response = self.client.get("/api/otef_viewport/by-table/otef/")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["road_sign_settings"], FIXTURES["empty"])
        self.state.refresh_from_db()
        self.assertEqual(self.state.road_sign_settings, {})

        saved = self.command(FIXTURES["twoOutputs"])
        self.assertEqual(saved.status_code, 200)
        populated = self.client.get("/api/otef_viewport/by-table/otef/")
        self.assertEqual(populated.status_code, 200)
        self.assertEqual(populated.json()["road_sign_settings"], FIXTURES["twoOutputs"])
        self.assertEqual(populated.json()["road_sign_revision"], 1)

    def test_ordinary_serializer_get_includes_normalized_sign_state(self):
        response = self.client.get("/api/otef_viewport/")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()[0]["road_sign_settings"], FIXTURES["empty"])
        self.assertEqual(response.json()[0]["road_sign_revision"], 0)
        saved = self.command(FIXTURES["twoOutputs"])
        self.assertEqual(saved.status_code, 200)
        populated = self.client.get("/api/otef_viewport/")
        self.assertEqual(populated.status_code, 200)
        self.assertEqual(populated.json()[0]["road_sign_settings"], FIXTURES["twoOutputs"])
        self.assertEqual(populated.json()[0]["road_sign_revision"], 1)

    def test_ordinary_put_patch_and_by_table_patch_reject_sign_fields(self):
        for field, value in (("road_sign_settings", FIXTURES["twoOutputs"]), ("road_sign_revision", 2)):
            for method in ("put", "patch"):
                with self.subTest(field=field, method=method):
                    payload = {field: value}
                    if method == "put":
                        payload = {
                            "table": self.table.pk,
                            "viewport": self.viewport,
                            "layers": {},
                            "animations": {},
                            "basemap": "osm",
                            "projection_slideshow": {},
                            "investigation_clock": {},
                            "workshop_auto_publish": False,
                            "exhibit_mode": False,
                            **payload,
                        }
                    response = getattr(self.client, method)(
                        f"/api/otef_viewport/{self.state.pk}/",
                        json.dumps(payload),
                        content_type="application/json",
                    )
                    self.assertEqual(response.status_code, 400)
                    if method == "put":
                        self.assertIn("Road 232 signs must use their versioned command", response.json()["non_field_errors"])
            protected = self.client.patch(
                "/api/otef_viewport/by-table/otef/",
                json.dumps({field: value}),
                content_type="application/json",
            )
            self.assertEqual(protected.status_code, 400)
        self.state.refresh_from_db()
        self.assertEqual(self.state.road_sign_settings, {})
