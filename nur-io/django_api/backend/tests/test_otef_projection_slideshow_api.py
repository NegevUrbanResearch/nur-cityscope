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
class OTEFProjectionSlideshowApiTests(TestCase):
    def setUp(self):
        self.table = Table.objects.create(name="otef")
        OTEFViewportState.objects.create(
            table=self.table,
            viewport=OTEFViewportState.DEFAULT_VIEWPORT.copy(),
            layers=OTEFViewportState.DEFAULT_LAYERS.copy(),
            animations={},
        )

    def test_get_by_table_includes_projection_slideshow(self):
        res = self.client.get("/api/otef_viewport/by-table/otef/")
        self.assertEqual(res.status_code, 200)
        body = res.json()
        self.assertIn("projection_slideshow", body)
        self.assertEqual(body["projection_slideshow"], {})

    def test_patch_projection_slideshow_start(self):
        res = self.client.patch(
            "/api/otef_viewport/by-table/otef/",
            data=json.dumps(
                {
                    "projection_slideshow": {
                        "type": "start",
                        "payload": {
                            "packOrder": ["a", "b"],
                            "intervalMs": 5000,
                            "crossfadeMs": 800,
                            "warmupLeadMs": 1000,
                        },
                    }
                }
            ),
            content_type="application/json",
        )
        self.assertEqual(res.status_code, 200)
        data = res.json()
        ps = data["projection_slideshow"]
        self.assertEqual(ps["type"], "start")
        self.assertEqual(ps["revision"], 1)
        self.assertEqual(ps["payload"]["packOrder"], ["a", "b"])
        self.assertEqual(ps["payload"]["intervalMs"], 5000)
        self.assertEqual(ps["payload"]["crossfadeMs"], 800)
        self.assertEqual(ps["payload"]["warmupLeadMs"], 1000)

        state = OTEFViewportState.objects.get(table=self.table)
        self.assertEqual(state.projection_slideshow["revision"], 1)

    def test_patch_projection_slideshow_stop(self):
        self.client.patch(
            "/api/otef_viewport/by-table/otef/",
            data=json.dumps(
                {
                    "projection_slideshow": {
                        "type": "start",
                        "payload": {"packOrder": ["x"], "intervalMs": 1000},
                    }
                }
            ),
            content_type="application/json",
        )
        res = self.client.patch(
            "/api/otef_viewport/by-table/otef/",
            data=json.dumps({"projection_slideshow": {"type": "stop", "payload": {}}}),
            content_type="application/json",
        )
        self.assertEqual(res.status_code, 200)
        ps = res.json()["projection_slideshow"]
        self.assertEqual(ps["type"], "stop")
        self.assertEqual(ps["payload"], {})
        self.assertEqual(ps["revision"], 2)

    def test_patch_projection_slideshow_rejects_bad_type(self):
        res = self.client.patch(
            "/api/otef_viewport/by-table/otef/",
            data=json.dumps({"projection_slideshow": {"type": "nope"}}),
            content_type="application/json",
        )
        self.assertEqual(res.status_code, 400)
