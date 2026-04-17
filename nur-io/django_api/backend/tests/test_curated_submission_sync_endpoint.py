from unittest.mock import patch

from django.test import TestCase
from rest_framework.test import APIClient

from backend.models import GISLayer, OTEFViewportState, Table


class CuratedSubmissionSyncEndpointTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.table = Table.objects.create(name="otef", display_name="OTEF")
        self.sub_id = "550e8400-e29b-41d4-a716-446655440000"

    @patch.dict("os.environ", {"CURATION_WRITE_TOKEN": "test-token"}, clear=False)
    @patch("backend.supabase_proxy._get")
    def test_sync_updates_existing_published_layer(self, mock_get):
        mock_get.return_value = (
            [
                {
                    "id": "feat-1",
                    "submission_id": self.sub_id,
                    "geom": {"type": "Point", "coordinates": [35.0, 31.5]},
                    "is_current": True,
                }
            ],
            None,
        )
        layer = GISLayer.objects.create(
            table=self.table,
            name="curated_test_layer",
            display_name="My Pub",
            project_name="Moreshet Axis",
            layer_type="geojson",
            data={
                "type": "FeatureCollection",
                "features": [
                    {
                        "type": "Feature",
                        "geometry": {"type": "Point", "coordinates": [0, 0]},
                        "properties": {
                            "submission_id": self.sub_id,
                            "id": "feat-old",
                        },
                    }
                ],
            },
            style_config={},
            is_active=True,
            order=1,
        )

        response = self.client.post(
            "/api/supabase/curated/sync-submission/",
            {"table": "otef", "submission_id": self.sub_id},
            format="json",
            HTTP_X_CURATION_WRITE_TOKEN="test-token",
        )

        self.assertEqual(response.status_code, 200, response.data)
        self.assertTrue(response.data.get("ok"))
        self.assertEqual(response.data.get("action"), "updated_existing")
        layer.refresh_from_db()
        feats = (layer.data or {}).get("features") or []
        self.assertEqual(len(feats), 1)
        self.assertEqual(feats[0]["geometry"]["coordinates"], [35.0, 31.5])
        mock_get.assert_called()

    @patch.dict("os.environ", {"CURATION_WRITE_TOKEN": "test-token"}, clear=False)
    @patch("backend.supabase_proxy._get")
    def test_sync_unpublished_workshop_off_is_noop(self, mock_get):
        mock_get.return_value = (
            [
                {
                    "id": "feat-1",
                    "submission_id": self.sub_id,
                    "geom": {"type": "Point", "coordinates": [34.0, 32.0]},
                    "is_current": True,
                }
            ],
            None,
        )
        OTEFViewportState.objects.create(
            table=self.table, workshop_auto_publish=False
        )

        response = self.client.post(
            "/api/supabase/curated/sync-submission/",
            {"table": "otef", "submission_id": self.sub_id},
            format="json",
            HTTP_X_CURATION_WRITE_TOKEN="test-token",
        )

        self.assertEqual(response.status_code, 200, response.data)
        self.assertTrue(response.data.get("ok"))
        self.assertEqual(
            response.data.get("action"), "noop_unpublished_workshop_off"
        )
        self.assertFalse(
            GISLayer.objects.filter(
                table=self.table, name__startswith="curated_"
            ).exists()
        )

    @patch.dict("os.environ", {"CURATION_WRITE_TOKEN": "test-token"}, clear=False)
    @patch("backend.supabase_proxy._get")
    def test_sync_autopublishes_when_workshop_on_and_no_curated_layer(self, mock_get):
        mock_get.return_value = (
            [
                {
                    "id": "feat-1",
                    "submission_id": self.sub_id,
                    "geom": {"type": "Point", "coordinates": [35.0, 31.5]},
                    "is_current": True,
                }
            ],
            None,
        )
        OTEFViewportState.objects.create(
            table=self.table, workshop_auto_publish=True
        )

        response = self.client.post(
            "/api/supabase/curated/sync-submission/",
            {"table": "otef", "submission_id": self.sub_id},
            format="json",
            HTTP_X_CURATION_WRITE_TOKEN="test-token",
        )

        self.assertEqual(response.status_code, 200, response.data)
        self.assertTrue(response.data.get("ok"))
        self.assertEqual(response.data.get("action"), "autopublished")
        layer_id = response.data.get("layer_id")
        self.assertIsNotNone(layer_id)

        self.assertTrue(
            GISLayer.objects.filter(
                table=self.table, name__startswith="curated_", is_active=True
            ).exists()
        )
        layer = GISLayer.objects.get(pk=layer_id, table=self.table)
        self.assertTrue(layer.is_active)
        self.assertTrue(str(layer.name or "").startswith("curated_"))
        mock_get.assert_called()
