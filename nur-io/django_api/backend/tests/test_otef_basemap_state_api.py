import json

from backend.models import OTEFViewportState, Table
from django.test import TestCase
from django.test.utils import override_settings


@override_settings(
    CHANNEL_LAYERS={
        "default": {
            "BACKEND": "channels.layers.InMemoryChannelLayer",
        }
    }
)
class OTEFBasemapStateApiTests(TestCase):
    def setUp(self):
        self.table = Table.objects.create(name="otef")
        OTEFViewportState.objects.create(
            table=self.table,
            viewport=OTEFViewportState.DEFAULT_VIEWPORT.copy(),
            layers=OTEFViewportState.DEFAULT_LAYERS.copy(),
            animations={},
        )

    def test_get_by_table_includes_default_basemap(self):
        res = self.client.get("/api/otef_viewport/by-table/otef/")
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.json()["basemap"], "osm")

    def test_patch_basemap_accepts_supported_values(self):
        res = self.client.patch(
            "/api/otef_viewport/by-table/otef/",
            data=json.dumps({"basemap": "satellite"}),
            content_type="application/json",
        )
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.json()["basemap"], "satellite")

        state = OTEFViewportState.objects.get(table=self.table)
        self.assertEqual(state.basemap, "satellite")

        res = self.client.patch(
            "/api/otef_viewport/by-table/otef/",
            data=json.dumps({"basemap": "dark"}),
            content_type="application/json",
        )
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.json()["basemap"], "dark")
        state = OTEFViewportState.objects.get(table=self.table)
        self.assertEqual(state.basemap, "dark")

    def test_patch_basemap_rejects_unknown_values(self):
        res = self.client.patch(
            "/api/otef_viewport/by-table/otef/",
            data=json.dumps({"basemap": "terrain"}),
            content_type="application/json",
        )
        self.assertEqual(res.status_code, 400)
