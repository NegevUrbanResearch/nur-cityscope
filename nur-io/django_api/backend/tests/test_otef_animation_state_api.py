from django.test import TestCase
from rest_framework.test import APIClient

from backend.models import Table


class OTEFAnimationStateApiTests(TestCase):
    def test_default_animations_empty_dict(self):
        Table.objects.create(name="otef", display_name="OTEF")
        client = APIClient()
        resp = client.get("/api/otef_viewport/by-table/otef/")
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.data["animations"], {})
