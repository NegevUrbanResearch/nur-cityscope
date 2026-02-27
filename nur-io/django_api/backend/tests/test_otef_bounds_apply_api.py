from django.test import TestCase
from rest_framework.test import APIClient

from backend.models import OTEFViewportState, Table, OTEFModelConfig


class BoundsApplyApiTests(TestCase):
    def setUp(self):
        self.table = Table.objects.create(name="otef", display_name="OTEF")
        self.client = APIClient()

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

