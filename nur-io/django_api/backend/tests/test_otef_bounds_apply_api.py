import tempfile
from pathlib import Path
from unittest.mock import patch

from django.test import TestCase
from rest_framework.test import APIClient

from backend.calibration_io import write_model_bounds_to_storage
from backend.models import OTEFViewportState, Table, OTEFModelConfig


class BoundsApplyApiTests(TestCase):
    def setUp(self):
        self.table = Table.objects.create(name="otef", display_name="OTEF")
        self.client = APIClient()
        self._temporary_directory = tempfile.TemporaryDirectory()
        self._temporary_bounds_path = Path(self._temporary_directory.name) / "model-bounds.json"
        self.addCleanup(self._temporary_directory.cleanup)

        def write_to_temporary_storage(normalized, config, _production_path):
            return write_model_bounds_to_storage(
                normalized,
                config,
                str(self._temporary_bounds_path),
            )

        self._bounds_writer = patch(
            "backend.views.write_model_bounds_to_storage",
            side_effect=write_to_temporary_storage,
        )
        self._bounds_writer.start()
        self.addCleanup(self._bounds_writer.stop)

    def test_post_saves_polygon_and_angle(self):
        payload = {
            "table": "otef",
            "polygon": [
                {"x": 1, "y": 1},
                {"x": 2, "y": 1},
                {"x": 2, "y": 2},
            ],
            "viewer_angle_deg": 35.0,
        }
        res = self.client.post("/api/otef/bounds/apply/", payload, format="json")
        self.assertEqual(res.status_code, 200)
        self.assertTrue(self._temporary_bounds_path.is_file())

        state = OTEFViewportState.objects.get(table=self.table)
        self.assertEqual(
            state.bounds_polygon,
            [
                {"x": 1.0, "y": 1.0},
                {"x": 2.0, "y": 1.0},
                {"x": 2.0, "y": 2.0},
            ],
        )
        self.assertEqual(state.viewer_angle_deg, 35.0)

        # Config should mirror polygon and angle (canonical bounds_polygon)
        config = OTEFModelConfig.objects.filter(table=self.table).first()
        if config:
            self.assertEqual(
                config.model_bounds.get("bounds_polygon"),
                [
                    {"x": 1.0, "y": 1.0},
                    {"x": 2.0, "y": 1.0},
                    {"x": 2.0, "y": 2.0},
                ],
            )
            self.assertEqual(config.model_bounds.get("viewer_angle_deg"), 35.0)

    def test_post_rejects_invalid_angle(self):
        payload = {
            "table": "otef",
            "polygon": [
                {"x": 1, "y": 1},
                {"x": 2, "y": 1},
                {"x": 2, "y": 2},
            ],
            "viewer_angle_deg": "not-a-number",
        }
        res = self.client.post("/api/otef/bounds/apply/", payload, format="json")
        self.assertEqual(res.status_code, 400)
        self.assertIn("error", res.data)
