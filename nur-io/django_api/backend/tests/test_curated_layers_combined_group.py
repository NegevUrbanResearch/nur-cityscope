from django.test import TestCase
from rest_framework.test import APIClient

from backend.models import Table, GISLayer, LayerGroup, LayerState


class CuratedLayersCombinedGroupTests(TestCase):
    def setUp(self):
        self.table = Table.objects.create(name="otef", display_name="OTEF")
        self.client = APIClient()

    def _minimal_geojson(self):
        return {
            "type": "FeatureCollection",
            "features": [
                {
                    "type": "Feature",
                    "geometry": {"type": "Point", "coordinates": [34.8, 32.08]},
                    "properties": {},
                }
            ],
        }

    def test_otef_layergroups_returns_single_moreshet_axis_group(self):
        layer_a = GISLayer.objects.create(
            table=self.table,
            name="curated_project_a_proposal_a",
            display_name="Proposal A",
            layer_type="geojson",
            data=self._minimal_geojson(),
            style_config={},
            is_active=True,
            order=1,
            project_name="Project A",
        )
        layer_b = GISLayer.objects.create(
            table=self.table,
            name="curated_project_b_proposal_b",
            display_name="Proposal B",
            layer_type="geojson",
            data=self._minimal_geojson(),
            style_config={},
            is_active=True,
            order=2,
            project_name="Project B",
        )

        LayerGroup.objects.create(table=self.table, group_id="curated_project_a", enabled=True)
        LayerGroup.objects.create(table=self.table, group_id="curated_project_b", enabled=True)

        LayerState.objects.create(
            table=self.table,
            layer_id=f"curated_project_a.{layer_a.id}",
            enabled=True,
        )
        LayerState.objects.create(
            table=self.table,
            layer_id=f"curated_project_b.{layer_b.id}",
            enabled=False,
        )

        resp = self.client.get("/api/otef_viewport/by-table/otef/")
        self.assertEqual(resp.status_code, 200, resp.data)

        groups = resp.data.get("layerGroups") or []
        self.assertIsInstance(groups, list)

        self.assertEqual(len(groups), 1)
        self.assertEqual(groups[0].get("id"), "curated_moresht_axis")
        self.assertEqual(groups[0].get("name"), "Moreshet Axis")
        self.assertEqual(len(groups[0].get("layers") or []), 2)
