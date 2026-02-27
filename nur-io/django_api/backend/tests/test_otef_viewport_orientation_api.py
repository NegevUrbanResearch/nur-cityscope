from django.test import TestCase
from rest_framework.test import APIClient

from backend.models import OTEFViewportState, Table


class ViewportOrientationApiTests(TestCase):
    def test_get_by_table_returns_viewer_angle(self):
        table = Table.objects.create(name="otef", display_name="OTEF")
        OTEFViewportState.objects.create(table=table, viewer_angle_deg=23.0)
        client = APIClient()
        res = client.get("/api/otef_viewport/by-table/otef/")
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.data["viewer_angle_deg"], 23.0)

    def test_patch_by_table_updates_viewer_angle(self):
        table = Table.objects.create(name="otef", display_name="OTEF")
        state = OTEFViewportState.objects.create(table=table, viewer_angle_deg=0.0)
        client = APIClient()
        res = client.patch(
            "/api/otef_viewport/by-table/otef/",
            {"viewer_angle_deg": 45.5},
            format="json",
        )
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.data["viewer_angle_deg"], 45.5)
        state.refresh_from_db()
        self.assertEqual(state.viewer_angle_deg, 45.5)

    def test_patch_by_table_rejects_invalid_viewer_angle(self):
        Table.objects.create(name="otef", display_name="OTEF")
        client = APIClient()
        res = client.patch(
            "/api/otef_viewport/by-table/otef/",
            {"viewer_angle_deg": "not-a-number"},
            format="json",
        )
        self.assertEqual(res.status_code, 400)
        self.assertIn("error", res.data)
