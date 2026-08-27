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
        layers = groups[0].get("layers") or []
        companion_ids = ("pink_line_parking", "pink_line_route")
        parking = next(
            (L for L in layers if str(L.get("id", "")) == "pink_line_parking"), None
        )
        pink_route = next(
            (L for L in layers if str(L.get("id", "")) == "pink_line_route"), None
        )
        self.assertIsNotNone(parking)
        self.assertIsNotNone(pink_route)
        self.assertFalse(pink_route.get("enabled"))
        curated_numeric = [
            L for L in layers if str(L.get("id", "")) not in companion_ids
        ]
        self.assertEqual(len(curated_numeric), 2)
        self.assertEqual(len(layers), 4)

    def test_pink_line_route_toggle_round_trips_in_layergroups(self):
        layer = GISLayer.objects.create(
            table=self.table,
            name="curated_moresht_axis_demo",
            display_name="Demo",
            layer_type="geojson",
            data=self._minimal_geojson(),
            style_config={},
            is_active=True,
            order=1,
            project_name="Moreshet Axis",
        )
        LayerGroup.objects.create(
            table=self.table, group_id="curated_moresht_axis", enabled=True
        )
        LayerState.objects.create(
            table=self.table,
            layer_id=f"curated_moresht_axis.{layer.id}",
            enabled=False,
        )

        resp = self.client.post(
            "/api/otef_viewport/by-table/otef/command/",
            {
                "action": "set_layer_toggles",
                "changes": [
                    {
                        "full_layer_id": "curated_moresht_axis.pink_line_route",
                        "enabled": True,
                    }
                ],
            },
            format="json",
        )
        self.assertEqual(resp.status_code, 200, resp.data)
        groups = resp.data.get("layerGroups") or []
        curated = next(
            (g for g in groups if isinstance(g, dict) and g.get("id") == "curated_moresht_axis"),
            None,
        )
        self.assertIsNotNone(curated)
        pink = next(
            (
                x
                for x in (curated.get("layers") or [])
                if isinstance(x, dict) and x.get("id") == "pink_line_route"
            ),
            None,
        )
        self.assertIsNotNone(pink)
        self.assertTrue(pink.get("enabled"))
        demo = next(
            (
                x
                for x in (curated.get("layers") or [])
                if isinstance(x, dict) and str(x.get("id")) == str(layer.id)
            ),
            None,
        )
        self.assertIsNotNone(demo)
        self.assertFalse(demo.get("enabled"))

        viewport = self.client.get("/api/otef_viewport/by-table/otef/")
        self.assertEqual(viewport.status_code, 200, viewport.data)
        again = next(
            (
                g
                for g in (viewport.data.get("layerGroups") or [])
                if isinstance(g, dict) and g.get("id") == "curated_moresht_axis"
            ),
            None,
        )
        pink_again = next(
            (
                x
                for x in (again.get("layers") or [])
                if isinstance(x, dict) and x.get("id") == "pink_line_route"
            ),
            None,
        )
        self.assertTrue(pink_again.get("enabled"))
