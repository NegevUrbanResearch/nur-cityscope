from django.test import TestCase
from rest_framework.test import APIClient

from backend.models import OTEFViewportState, Table


class ExhibitModeApiTests(TestCase):
    def test_exhibit_mode_defaults_false_and_persists_across_patch_and_get(self):
        table = Table.objects.create(name="otef", display_name="OTEF")
        OTEFViewportState.objects.create(table=table)
        client = APIClient()
        get_default = client.get("/api/otef_viewport/by-table/otef/")
        self.assertEqual(get_default.status_code, 200)
        self.assertFalse(get_default.data["exhibit_mode"])

        patch_res = client.patch(
            "/api/otef_viewport/by-table/otef/",
            {"exhibit_mode": True},
            format="json",
        )
        self.assertEqual(patch_res.status_code, 200)
        self.assertTrue(patch_res.data["exhibit_mode"])
        get_res = client.get("/api/otef_viewport/by-table/otef/")
        self.assertEqual(get_res.status_code, 200)
        self.assertTrue(get_res.data["exhibit_mode"])

    def test_patch_exhibit_mode_rejects_yes_string(self):
        Table.objects.create(name="otef", display_name="OTEF")
        client = APIClient()
        res = client.patch(
            "/api/otef_viewport/by-table/otef/",
            {"exhibit_mode": "yes"},
            format="json",
        )
        self.assertEqual(res.status_code, 400)
