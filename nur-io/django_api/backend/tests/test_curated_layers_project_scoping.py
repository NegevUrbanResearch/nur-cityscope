from django.db import IntegrityError
from django.test import TestCase
from rest_framework.test import APIClient

from backend.models import Table, GISLayer, LayerGroup, LayerState


class CuratedLayersProjectScopingTests(TestCase):
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

    def test_gislayer_allows_same_name_across_projects_but_not_within_project(self):
        # Same slug + display name in different projects should be allowed.
        GISLayer.objects.create(
            table=self.table,
            name="curated_proj_a_layer",
            display_name="My Layer",
            layer_type="geojson",
            data=self._minimal_geojson(),
            style_config={},
            is_active=True,
            order=1,
            project_name="Project A",
        )

        # Different project_name, same table/name should be allowed once project scoping is in place.
        GISLayer.objects.create(
            table=self.table,
            name="curated_proj_a_layer",
            display_name="My Layer",
            layer_type="geojson",
            data=self._minimal_geojson(),
            style_config={},
            is_active=True,
            order=2,
            project_name="Project B",
        )

        # Within the same project, duplicated slug should raise IntegrityError.
        with self.assertRaises(IntegrityError):
            GISLayer.objects.create(
                table=self.table,
                name="curated_proj_a_layer",
                display_name="My Layer",
                layer_type="geojson",
                data=self._minimal_geojson(),
                style_config={},
                is_active=True,
                order=3,
                project_name="Project A",
            )

    def test_curated_publish_requires_project_name(self):
        response = self.client.post(
            "/api/supabase/curated/publish/",
            {
                "name": "My Layer",
                "geojson": self._minimal_geojson(),
                "table": "otef",
            },
            format="json",
        )
        self.assertEqual(response.status_code, 400)
        self.assertIn("project_name", str(response.data.get("error", "")))

    def test_curated_publish_creates_project_scoped_group_and_state(self):
        payload = {
            "name": "My Layer",
            "geojson": self._minimal_geojson(),
            "table": "otef",
            "project_name": "My Project",
        }
        response = self.client.post(
            "/api/supabase/curated/publish/", payload, format="json"
        )
        self.assertEqual(response.status_code, 201, response.data)

        data = response.data
        self.assertIn("layerId", data)
        self.assertIn("groupId", data)
        self.assertIn("fullLayerId", data)
        self.assertEqual(data.get("projectName"), "My Project")

        layer_id = data["layerId"]
        group_id = data["groupId"]
        full_layer_id = data["fullLayerId"]

        # Group id and full layer id should be project-scoped.
        self.assertTrue(group_id.startswith("curated_"))
        self.assertTrue(full_layer_id.startswith(group_id + "."))

        # Database state: GISLayer, LayerGroup, LayerState all connected to the same table.
        layer = GISLayer.objects.get(id=layer_id)
        self.assertEqual(layer.table, self.table)

        group = LayerGroup.objects.get(table=self.table, group_id=group_id)
        self.assertTrue(group.enabled)

        state = LayerState.objects.get(table=self.table, layer_id=full_layer_id)
        self.assertTrue(state.enabled)

    def test_curated_publish_conflict_is_project_scoped(self):
        base_payload = {
            "name": "Shared Name",
            "geojson": self._minimal_geojson(),
            "table": "otef",
        }

        # First publish in Project A succeeds.
        resp_a = self.client.post(
            "/api/supabase/curated/publish/",
            {**base_payload, "project_name": "Project A"},
            format="json",
        )
        self.assertEqual(resp_a.status_code, 201, resp_a.data)

        # Same name in a different project should still succeed.
        resp_b = self.client.post(
            "/api/supabase/curated/publish/",
            {**base_payload, "project_name": "Project B"},
            format="json",
        )
        self.assertEqual(resp_b.status_code, 201, resp_b.data)

        # Same name again in Project A must conflict.
        resp_conflict = self.client.post(
            "/api/supabase/curated/publish/",
            {**base_payload, "project_name": "Project A"},
            format="json",
        )
        self.assertEqual(resp_conflict.status_code, 409, resp_conflict.data)
        msg = str(resp_conflict.data.get("error", "") or resp_conflict.data)
        self.assertIn("Project A", msg)

    def test_get_otef_layers_includes_project_name(self):
        # Create a couple of layers with different logical projects.
        GISLayer.objects.create(
            table=self.table,
            name="curated_proj_a_1",
            display_name="Layer A1",
            layer_type="geojson",
            data=self._minimal_geojson(),
            style_config={},
            is_active=True,
            order=1,
        )
        GISLayer.objects.create(
            table=self.table,
            name="curated_proj_b_1",
            display_name="Layer B1",
            layer_type="geojson",
            data=self._minimal_geojson(),
            style_config={},
            is_active=True,
            order=2,
        )

        response = self.client.get(
            "/api/actions/get_otef_layers/", {"table": "otef"}
        )
        self.assertEqual(response.status_code, 200)
        self.assertIsInstance(response.data, list)
        self.assertGreaterEqual(len(response.data), 2)
        for item in response.data:
            # Every layer entry should include project_name so frontends can group curated packs by project.
            self.assertIn("project_name", item)

    def test_layer_groups_fallback_groups_layers_by_project_name(self):
        # No LayerGroup rows exist; fallback should build curated groups from GISLayer rows.
        GISLayer.objects.create(
            table=self.table,
            name="curated_proj_a_1",
            display_name="Layer A1",
            layer_type="geojson",
            data=self._minimal_geojson(),
            style_config={},
            is_active=True,
            order=1,
            project_name="Project A",
        )
        GISLayer.objects.create(
            table=self.table,
            name="curated_proj_b_1",
            display_name="Layer B1",
            layer_type="geojson",
            data=self._minimal_geojson(),
            style_config={},
            is_active=True,
            order=2,
            project_name="Project B",
        )

        resp = self.client.get("/api/otef_viewport/by-table/otef/")
        self.assertEqual(resp.status_code, 200, resp.data)
        groups = resp.data.get("layerGroups") or []
        self.assertIsInstance(groups, list)
        # Expect at least one curated group; in the fully project-scoped world,
        # multiple curated_<slug> groups may be returned.
        curated_groups = [g for g in groups if str(g.get("id", "")).startswith("curated")]
        self.assertTrue(curated_groups)

