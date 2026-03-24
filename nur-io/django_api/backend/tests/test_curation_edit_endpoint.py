import os
from unittest.mock import patch

from django.db import IntegrityError, ProgrammingError
from django.test import TestCase
from django.test.utils import override_settings
from rest_framework.test import APIClient

from backend.models import Table, GISLayer, LayerGroup, LayerState, CurationEditRevision


class CuratedLayerEditEndpointTests(TestCase):
    def setUp(self):
        self.table = Table.objects.create(name="otef", display_name="OTEF")
        self._old_token = os.environ.get("CURATION_WRITE_TOKEN")
        os.environ["CURATION_WRITE_TOKEN"] = "test-write-token"
        self.client = APIClient()
        self.client.credentials(HTTP_X_CURATION_WRITE_TOKEN="test-write-token")

    def tearDown(self):
        if self._old_token is None:
            os.environ.pop("CURATION_WRITE_TOKEN", None)
        else:
            os.environ["CURATION_WRITE_TOKEN"] = self._old_token

    def _minimal_geojson(self):
        return {
            "type": "FeatureCollection",
            "features": [
                {
                    "type": "Feature",
                    "geometry": {"type": "Point", "coordinates": [34.8, 32.08]},
                    "properties": {"id": "feature-1"},
                }
            ],
        }

    def test_edit_endpoint_requires_auth_token(self):
        unauth = APIClient()
        resp = unauth.post(
            "/api/supabase/curated/edit/",
            {
                "table": "otef",
                "project_id": "project-a",
                "project_name": "Moresht Axis (ציר מורשת)",
                "submission_id": "submission-a",
                "feature_id": "feature-1",
                "before_geom": {"type": "Point", "coordinates": [34.8, 32.08]},
                "after_geom": {"type": "Point", "coordinates": [34.81, 32.09]},
            },
            format="json",
        )
        self.assertEqual(resp.status_code, 401, resp.data)

    @patch("backend.supabase_proxy._patch")
    @patch("backend.supabase_proxy._get")
    def test_edit_endpoint_writes_revision_for_draft(self, mock_get, mock_patch):
        mock_get.return_value = (
            [
                {
                    "id": "feature-1",
                    "geom": {"type": "Point", "coordinates": [34.8, 32.08]},
                    "project_id": "project-a",
                    "submission_id": "submission-a",
                }
            ],
            None,
        )
        mock_patch.return_value = ([{"id": "feature-1"}], None)

        resp = self.client.post(
            "/api/supabase/curated/edit/",
            {
                "table": "otef",
                "project_id": "project-a",
                "project_name": "Moresht Axis (ציר מורשת)",
                "submission_id": "submission-a",
                "feature_id": "feature-1",
                "before_geom": {"type": "Point", "coordinates": [34.8, 32.08]},
                "after_geom": {"type": "Point", "coordinates": [34.81, 32.09]},
            },
            format="json",
        )
        self.assertEqual(resp.status_code, 200, resp.data)
        self.assertTrue(resp.data.get("ok"))
        self.assertIsNotNone(resp.data.get("revision_id"))
        self.assertEqual(CurationEditRevision.objects.count(), 1)

    @patch("backend.supabase_proxy._patch")
    @patch("backend.supabase_proxy._get")
    def test_edit_endpoint_creates_new_layer_revision_when_published(
        self, mock_get, mock_patch
    ):
        mock_get.return_value = (
            [
                {
                    "id": "feature-1",
                    "geom": {"type": "Point", "coordinates": [34.8, 32.08]},
                    "project_id": "project-a",
                    "submission_id": "submission-a",
                }
            ],
            None,
        )
        mock_patch.return_value = ([{"id": "feature-1"}], None)

        layer = GISLayer.objects.create(
            table=self.table,
            name="curated_moresht_layer",
            display_name="Proposal A",
            project_name="Moresht Axis (ציר מורשת)",
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

        resp = self.client.post(
            "/api/supabase/curated/edit/",
            {
                "table": "otef",
                "project_id": "project-a",
                "project_name": "Moresht Axis (ציר מורשת)",
                "submission_id": "submission-a",
                "feature_id": "feature-1",
                "before_geom": {"type": "Point", "coordinates": [34.8, 32.08]},
                "after_geom": {"type": "Point", "coordinates": [34.81, 32.09]},
                "published_layer_full_id": f"curated_moresht_axis.{layer.id}",
            },
            format="json",
        )
        self.assertEqual(resp.status_code, 200, resp.data)
        self.assertTrue(resp.data.get("new_full_layer_id"))
        self.assertEqual(GISLayer.objects.count(), 2)
        new_layer = GISLayer.objects.exclude(id=layer.id).first()
        self.assertIsNotNone(new_layer)
        self.assertTrue(new_layer.name.startswith(f"{layer.name}_rev"))

    @patch("backend.supabase_proxy._get")
    def test_edit_endpoint_source_not_found_returns_404(self, mock_get):
        mock_get.return_value = ([], None)
        resp = self.client.post(
            "/api/supabase/curated/edit/",
            {
                "table": "otef",
                "project_id": "project-a",
                "project_name": "Moreshet Axis (ציר מורשת)",
                "submission_id": "submission-a",
                "feature_id": "missing-feature",
                "before_geom": {"type": "Point", "coordinates": [34.8, 32.08]},
                "after_geom": {"type": "Point", "coordinates": [34.81, 32.09]},
            },
            format="json",
        )
        self.assertEqual(resp.status_code, 404, resp.data)
        self.assertIn("error", resp.data)

    @patch("backend.supabase_proxy._get")
    def test_edit_endpoint_ambiguous_feature_returns_409(self, mock_get):
        mock_get.return_value = (
            [
                {
                    "id": "feature-1",
                    "geom": {"type": "Point", "coordinates": [34.8, 32.08]},
                    "project_id": "project-a",
                    "submission_id": "submission-a",
                },
                {
                    "id": "feature-1",
                    "geom": {"type": "Point", "coordinates": [34.8, 32.08]},
                    "project_id": "project-b",
                    "submission_id": "submission-b",
                },
            ],
            None,
        )
        resp = self.client.post(
            "/api/supabase/curated/edit/",
            {
                "table": "otef",
                "project_id": "",
                "project_name": "Moresht Axis (ציר מורשת)",
                "submission_id": "",
                "feature_id": "feature-1",
                "before_geom": {"type": "Point", "coordinates": [34.8, 32.08]},
                "after_geom": {"type": "Point", "coordinates": [34.81, 32.09]},
            },
            format="json",
        )
        self.assertEqual(resp.status_code, 409, resp.data)
        self.assertIn("error", resp.data)

    @patch("backend.models.CurationEditRevision.objects.create")
    @patch("backend.supabase_proxy._patch")
    @patch("backend.supabase_proxy._get")
    @override_settings(DEBUG=False)
    def test_edit_endpoint_returns_json_when_revision_persistence_fails(
        self, mock_get, mock_patch, mock_rev_create
    ):
        mock_get.return_value = (
            [
                {
                    "id": "feature-1",
                    "geom": {"type": "Point", "coordinates": [34.8, 32.08]},
                    "project_id": "project-a",
                    "submission_id": "submission-a",
                }
            ],
            None,
        )
        mock_patch.return_value = ([{"id": "feature-1"}], None)
        mock_rev_create.side_effect = IntegrityError("revision_uniq")

        resp = self.client.post(
            "/api/supabase/curated/edit/",
            {
                "table": "otef",
                "project_id": "project-a",
                "project_name": "Moresht Axis (ציר מורשת)",
                "submission_id": "submission-a",
                "feature_id": "feature-1",
                "before_geom": {"type": "Point", "coordinates": [34.8, 32.08]},
                "after_geom": {"type": "Point", "coordinates": [34.81, 32.09]},
            },
            format="json",
        )
        self.assertEqual(resp.status_code, 500, resp.data)
        self.assertIn("error", resp.data)
        self.assertNotIn("detail", resp.data)

    @patch("backend.models.CurationEditRevision.objects.create")
    @patch("backend.supabase_proxy._patch")
    @patch("backend.supabase_proxy._get")
    def test_edit_continues_when_revision_table_missing(
        self, mock_get, mock_patch, mock_rev_create
    ):
        mock_get.return_value = (
            [
                {
                    "id": "feature-1",
                    "geom": {"type": "Point", "coordinates": [34.8, 32.08]},
                    "project_id": "project-a",
                    "submission_id": "submission-a",
                }
            ],
            None,
        )
        mock_patch.return_value = ([{"id": "feature-1"}], None)
        mock_rev_create.side_effect = ProgrammingError(
            "no such table: backend_curationeditrevision"
        )

        resp = self.client.post(
            "/api/supabase/curated/edit/",
            {
                "table": "otef",
                "project_id": "project-a",
                "project_name": "Moresht Axis (ציר מורשת)",
                "submission_id": "submission-a",
                "feature_id": "feature-1",
                "before_geom": {"type": "Point", "coordinates": [34.8, 32.08]},
                "after_geom": {"type": "Point", "coordinates": [34.81, 32.09]},
            },
            format="json",
        )
        self.assertEqual(resp.status_code, 200, resp.data)
        self.assertTrue(resp.data.get("ok"))
        self.assertIsNone(resp.data.get("revision_id"))
        self.assertIn("warning", resp.data)

    @patch("backend.supabase_proxy._patch")
    @patch("backend.supabase_proxy._get")
    def test_edit_ignores_inactive_published_layer_full_id(self, mock_get, mock_patch):
        """Stale published_layer_full_id pointing at an inactive row must not block edits."""
        mock_get.return_value = (
            [
                {
                    "id": "feature-1",
                    "geom": {"type": "Point", "coordinates": [34.8, 32.08]},
                    "project_id": "project-a",
                    "submission_id": "submission-a",
                }
            ],
            None,
        )
        mock_patch.return_value = ([{"id": "feature-1"}], None)

        inactive = GISLayer.objects.create(
            table=self.table,
            name="curated_stale",
            display_name="Stale",
            project_name="Moreshet Axis (ציר מורשת)",
            layer_type="geojson",
            data=self._minimal_geojson(),
            style_config={},
            is_active=False,
            order=1,
        )
        GISLayer.objects.create(
            table=self.table,
            name="curated_live",
            display_name="Live",
            project_name="Moreshet Axis (ציר מורשת)",
            layer_type="geojson",
            data={
                "type": "FeatureCollection",
                "features": [
                    {
                        "type": "Feature",
                        "geometry": {"type": "Point", "coordinates": [34.8, 32.08]},
                        "properties": {"id": "feature-1"},
                    }
                ],
            },
            style_config={},
            is_active=True,
            order=2,
        )

        resp = self.client.post(
            "/api/supabase/curated/edit/",
            {
                "table": "otef",
                "project_id": "project-a",
                "project_name": "Moreshet Axis (ציר מורשת)",
                "submission_id": "submission-a",
                "feature_id": "feature-1",
                "before_geom": {"type": "Point", "coordinates": [34.8, 32.08]},
                "after_geom": {"type": "Point", "coordinates": [34.81, 32.09]},
                "published_layer_full_id": f"curated_moresht_axis.{inactive.id}",
            },
            format="json",
        )
        self.assertEqual(resp.status_code, 200, resp.data)
        self.assertTrue(resp.data.get("ok"))
        self.assertIsNotNone(resp.data.get("new_full_layer_id"))

    @patch("backend.supabase_proxy._post")
    @patch("backend.supabase_proxy._patch")
    @patch("backend.supabase_proxy._get")
    def test_batch_edit_appends_revision_row_and_marks_source_non_current(
        self, mock_get, mock_patch, mock_post
    ):
        layer = GISLayer.objects.create(
            table=self.table,
            name="curated_batch_live",
            display_name="Batch",
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

        mock_get.return_value = (
            [
                {
                    "id": "feature-1",
                    "geom": {"type": "Point", "coordinates": [34.8, 32.08]},
                    "project_id": "project-a",
                    "submission_id": "submission-a",
                    "feature_lineage_id": "lineage-1",
                    "revision": 2,
                    "is_current": True,
                    "supersedes_feature_id": None,
                    "edited_at": None,
                    "edited_by": None,
                    "edit_reason": None,
                }
            ],
            None,
        )
        mock_post.return_value = ([{"id": "feature-2"}], None)
        mock_patch.return_value = ([{"id": "feature-1"}], None)

        resp = self.client.post(
            "/api/supabase/curated/edit-batch/",
            {
                "table": "otef",
                "project_name": "Moreshet Axis",
                "submission_id": "submission-a",
                "published_layer_full_id": f"curated_moresht_axis.{layer.id}",
                "edits": [
                    {
                        "feature_id": "feature-1",
                        "project_id": "project-a",
                        "before_geom": {"type": "Point", "coordinates": [34.8, 32.08]},
                        "after_geom": {"type": "Point", "coordinates": [34.81, 32.09]},
                    }
                ],
            },
            format="json",
        )
        self.assertEqual(resp.status_code, 200, resp.data)
        self.assertTrue(resp.data.get("ok"))
        self.assertEqual(resp.data.get("edits_applied"), 1)
        self.assertEqual(resp.data.get("new_feature_ids", {}).get("feature-1"), "feature-2")
        self.assertIsNotNone(resp.data.get("new_full_layer_id"))
        _, post_kwargs = mock_post.call_args
        inserted = post_kwargs.get("payload", {})
        self.assertEqual(inserted.get("is_current"), True)
        self.assertEqual(inserted.get("revision"), 3)
        self.assertEqual(inserted.get("feature_lineage_id"), "lineage-1")

    @patch("backend.supabase_proxy._get")
    def test_batch_edit_reports_missing_immutable_schema_columns(self, mock_get):
        mock_get.return_value = (
            [
                {
                    "id": "feature-1",
                    "geom": {"type": "Point", "coordinates": [34.8, 32.08]},
                    "project_id": "project-a",
                    "submission_id": "submission-a",
                }
            ],
            None,
        )
        resp = self.client.post(
            "/api/supabase/curated/edit-batch/",
            {
                "table": "otef",
                "project_name": "Moreshet Axis",
                "submission_id": "submission-a",
                "edits": [
                    {
                        "feature_id": "feature-1",
                        "project_id": "project-a",
                        "after_geom": {"type": "Point", "coordinates": [34.81, 32.09]},
                    }
                ],
            },
            format="json",
        )
        self.assertEqual(resp.status_code, 400, resp.data)
        self.assertIn("migration_sql", resp.data)
