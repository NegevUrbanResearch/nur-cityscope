from unittest.mock import patch

from django.test import TestCase
from rest_framework.test import APIClient

from backend.models import Table, GISLayer, LayerGroup, LayerState


class CuratedUnpublishEndpointTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.table = Table.objects.create(name="otef", display_name="OTEF")

    def _minimal_geojson(self):
        return {
            "type": "FeatureCollection",
            "features": [
                {
                    "type": "Feature",
                    "geometry": {"type": "Point", "coordinates": [34.8, 32.08]},
                    "properties": {"id": "f-1"},
                }
            ],
        }

    @patch.dict("os.environ", {"CURATION_WRITE_TOKEN": "test-token"}, clear=False)
    def test_unpublish_marks_layer_inactive_and_deletes_layer_state(self):
        layer = GISLayer.objects.create(
            table=self.table,
            name="curated_moresht_axis_demo",
            display_name="Demo",
            project_name="Moreshet Axis",
            layer_type="geojson",
            data=self._minimal_geojson(),
            style_config={},
            is_active=True,
            order=1,
        )
        LayerState.objects.create(
            table=self.table,
            layer_id=f"curated_moresht_axis.{layer.id}",
            enabled=True,
        )

        response = self.client.post(
            "/api/supabase/curated/unpublish/",
            {"table": "otef", "full_layer_id": f"curated_moresht_axis.{layer.id}"},
            format="json",
            HTTP_X_CURATION_WRITE_TOKEN="test-token",
        )

        self.assertEqual(response.status_code, 200, response.data)
        layer.refresh_from_db()
        self.assertFalse(layer.is_active)

        self.assertFalse(
            LayerState.objects.filter(
                table=self.table, layer_id=f"curated_moresht_axis.{layer.id}"
            ).exists()
        )

    @patch.dict("os.environ", {"CURATION_WRITE_TOKEN": "test-token"}, clear=False)
    def test_unpublish_removes_layer_from_viewport_group_listing(self):
        """Inactive GIS layers must not remain discoverable via persisted LayerGroup state."""
        layer = GISLayer.objects.create(
            table=self.table,
            name="curated_moresht_axis_demo",
            display_name="Demo",
            project_name="Moreshet Axis",
            layer_type="geojson",
            data=self._minimal_geojson(),
            style_config={},
            is_active=True,
            order=1,
        )
        LayerGroup.objects.create(
            table=self.table, group_id="curated_moresht_axis", enabled=True
        )
        LayerState.objects.create(
            table=self.table,
            layer_id=f"curated_moresht_axis.{layer.id}",
            enabled=True,
        )

        unpublish = self.client.post(
            "/api/supabase/curated/unpublish/",
            {"table": "otef", "full_layer_id": f"curated_moresht_axis.{layer.id}"},
            format="json",
            HTTP_X_CURATION_WRITE_TOKEN="test-token",
        )
        self.assertEqual(unpublish.status_code, 200, unpublish.data)

        viewport = self.client.get("/api/otef_viewport/by-table/otef/")
        self.assertEqual(viewport.status_code, 200, viewport.data)
        groups = viewport.data.get("layerGroups") or []
        curated = next(
            (g for g in groups if isinstance(g, dict) and g.get("id") == "curated_moresht_axis"),
            None,
        )
        self.assertIsNotNone(curated)
        layer_ids = {
            str(x.get("id"))
            for x in (curated.get("layers") or [])
            if isinstance(x, dict)
        }
        self.assertNotIn(str(layer.id), layer_ids)
