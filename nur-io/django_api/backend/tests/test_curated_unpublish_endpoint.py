from unittest.mock import patch

from django.test import TestCase
from rest_framework.test import APIClient

from backend.models import Table, GISLayer, LayerGroup, LayerState
from backend.supabase_proxy import _delete_layer_states_for_gis_layer_pk


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

    def test_delete_layer_states_for_gis_pk_only_exact_numeric_suffix(self):
        """Republish cleanup must not remove ... .11 or ... .101 when retiring GISLayer pk=1."""
        LayerState.objects.create(
            table=self.table, layer_id="curated_moresht_axis.1", enabled=True
        )
        LayerState.objects.create(
            table=self.table, layer_id="curated_moresht_axis.11", enabled=True
        )
        LayerState.objects.create(
            table=self.table, layer_id="curated_moresht_axis.101", enabled=True
        )

        _delete_layer_states_for_gis_layer_pk(self.table, 1)

        self.assertFalse(
            LayerState.objects.filter(
                table=self.table, layer_id="curated_moresht_axis.1"
            ).exists()
        )
        self.assertTrue(
            LayerState.objects.filter(
                table=self.table, layer_id="curated_moresht_axis.11"
            ).exists()
        )
        self.assertTrue(
            LayerState.objects.filter(
                table=self.table, layer_id="curated_moresht_axis.101"
            ).exists()
        )

    @patch.dict("os.environ", {"CURATION_WRITE_TOKEN": "test-token"}, clear=False)
    def test_unpublish_pk_1_does_not_remove_layer_state_for_pk_11(self):
        """Unpublish must use exact GISLayer id segments; .11 must survive when retiring pk=1."""
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
        self.assertEqual(layer.id, 1)
        LayerState.objects.create(
            table=self.table, layer_id="curated_moresht_axis.1", enabled=True
        )
        LayerState.objects.create(
            table=self.table, layer_id="curated_moresht_axis.11", enabled=True
        )

        response = self.client.post(
            "/api/supabase/curated/unpublish/",
            {"table": "otef", "layer_id": "1"},
            format="json",
            HTTP_X_CURATION_WRITE_TOKEN="test-token",
        )

        self.assertEqual(response.status_code, 200, response.data)
        self.assertFalse(
            LayerState.objects.filter(
                table=self.table, layer_id="curated_moresht_axis.1"
            ).exists()
        )
        self.assertTrue(
            LayerState.objects.filter(
                table=self.table, layer_id="curated_moresht_axis.11"
            ).exists()
        )

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

    @patch.dict("os.environ", {"CURATION_WRITE_TOKEN": "test-token"}, clear=False)
    def test_republish_same_display_name_after_unpublish_succeeds(self):
        """Inactive rows must not block curated publish uniqueness (local GISLayer)."""
        geojson = self._minimal_geojson()
        publish_payload = {
            "name": "Reusable Title",
            "geojson": geojson,
            "table": "otef",
            "project_name": "Moreshet Axis",
        }
        first = self.client.post(
            "/api/supabase/curated/publish/",
            publish_payload,
            format="json",
            HTTP_X_CURATION_WRITE_TOKEN="test-token",
        )
        self.assertEqual(first.status_code, 201, first.data)
        full_layer_id = first.data["fullLayerId"]

        unpublish = self.client.post(
            "/api/supabase/curated/unpublish/",
            {"table": "otef", "full_layer_id": full_layer_id},
            format="json",
            HTTP_X_CURATION_WRITE_TOKEN="test-token",
        )
        self.assertEqual(unpublish.status_code, 200, unpublish.data)

        second = self.client.post(
            "/api/supabase/curated/publish/",
            publish_payload,
            format="json",
            HTTP_X_CURATION_WRITE_TOKEN="test-token",
        )
        self.assertEqual(second.status_code, 201, second.data)
        self.assertNotEqual(second.data.get("layerId"), first.data.get("layerId"))

    @patch.dict("os.environ", {"CURATION_WRITE_TOKEN": "test-token"}, clear=False)
    def test_publish_same_name_replaces_without_unpublish(self):
        """Republish while the prior layer is still active must soft-replace, not 409."""
        geojson = self._minimal_geojson()
        publish_payload = {
            "name": "Live Replace",
            "geojson": geojson,
            "table": "otef",
            "project_name": "Moreshet Axis",
        }
        first = self.client.post(
            "/api/supabase/curated/publish/",
            publish_payload,
            format="json",
            HTTP_X_CURATION_WRITE_TOKEN="test-token",
        )
        self.assertEqual(first.status_code, 201, first.data)

        second = self.client.post(
            "/api/supabase/curated/publish/",
            publish_payload,
            format="json",
            HTTP_X_CURATION_WRITE_TOKEN="test-token",
        )
        self.assertEqual(second.status_code, 201, second.data)
        self.assertNotEqual(second.data.get("layerId"), first.data.get("layerId"))
        layer_a = GISLayer.objects.get(id=first.data["layerId"])
        self.assertFalse(layer_a.is_active)
        layer_b = GISLayer.objects.get(id=second.data["layerId"])
        self.assertTrue(layer_b.is_active)

    @patch.dict("os.environ", {"CURATION_WRITE_TOKEN": "test-token"}, clear=False)
    def test_viewport_injects_pink_line_parking_row_when_no_layerstate(self):
        """GET layerGroups must list parking explicitly so clients do not infer default ON."""
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

        viewport = self.client.get("/api/otef_viewport/by-table/otef/")
        self.assertEqual(viewport.status_code, 200, viewport.data)
        groups = viewport.data.get("layerGroups") or []
        curated = next(
            (g for g in groups if isinstance(g, dict) and g.get("id") == "curated_moresht_axis"),
            None,
        )
        self.assertIsNotNone(curated)
        parking = next(
            (
                x
                for x in (curated.get("layers") or [])
                if isinstance(x, dict) and x.get("id") == "pink_line_parking"
            ),
            None,
        )
        self.assertIsNotNone(parking)
        self.assertTrue(parking.get("enabled"))

    @patch.dict("os.environ", {"CURATION_WRITE_TOKEN": "test-token"}, clear=False)
    def test_unpublish_all_deactivates_curated_layers_and_counts_removed(self):
        """All active curated_* layers for the table are retired; other layers untouched."""
        g1 = self._minimal_geojson()
        g2 = {
            "type": "FeatureCollection",
            "features": [
                {
                    "type": "Feature",
                    "geometry": {"type": "Point", "coordinates": [34.9, 32.1]},
                    "properties": {"id": "f-2"},
                }
            ],
        }
        a = GISLayer.objects.create(
            table=self.table,
            name="curated_a",
            display_name="A",
            project_name="Moreshet Axis",
            layer_type="geojson",
            data=g1,
            style_config={},
            is_active=True,
            order=1,
        )
        b = GISLayer.objects.create(
            table=self.table,
            name="curated_b",
            display_name="B",
            project_name="Moreshet Axis",
            layer_type="geojson",
            data=g2,
            style_config={},
            is_active=True,
            order=2,
        )
        GISLayer.objects.create(
            table=self.table,
            name="base_roads",
            display_name="Roads",
            project_name="",
            layer_type="geojson",
            data=g1,
            style_config={},
            is_active=True,
            order=3,
        )
        LayerState.objects.create(
            table=self.table,
            layer_id=f"curated_moresht_axis.{a.id}",
            enabled=True,
        )
        LayerState.objects.create(
            table=self.table,
            layer_id=f"curated_moresht_axis.{b.id}",
            enabled=True,
        )

        response = self.client.post(
            "/api/supabase/curated/unpublish-all/",
            {"table": "otef"},
            format="json",
            HTTP_X_CURATION_WRITE_TOKEN="test-token",
        )
        self.assertEqual(response.status_code, 200, response.data)
        self.assertTrue(response.data.get("ok"))
        self.assertEqual(response.data.get("removed_count"), 2)

        a.refresh_from_db()
        b.refresh_from_db()
        self.assertFalse(a.is_active)
        self.assertFalse(b.is_active)
        base = GISLayer.objects.get(table=self.table, name="base_roads")
        self.assertTrue(base.is_active)

        self.assertFalse(
            LayerState.objects.filter(
                table=self.table, layer_id=f"curated_moresht_axis.{a.id}"
            ).exists()
        )
        self.assertFalse(
            LayerState.objects.filter(
                table=self.table, layer_id=f"curated_moresht_axis.{b.id}"
            ).exists()
        )

        again = self.client.post(
            "/api/supabase/curated/unpublish-all/",
            {"table": "otef"},
            format="json",
            HTTP_X_CURATION_WRITE_TOKEN="test-token",
        )
        self.assertEqual(again.status_code, 200, again.data)
        self.assertEqual(again.data.get("removed_count"), 0)
