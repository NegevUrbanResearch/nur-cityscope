from unittest.mock import patch

from django.test import TestCase
from rest_framework.test import APIClient

from backend.models import Table


class CuratedSupabasePullEndpointTests(TestCase):
    """GET /api/supabase/curated/pull-from-supabase/ (CuratedSupabasePullView)."""

    def setUp(self):
        self.client = APIClient()
        self.table = Table.objects.create(name="otef", display_name="OTEF")

    @patch("backend.supabase_proxy.pull_published_curated_layers_from_supabase")
    def test_pull_success_ok_and_updated_key_present(self, mock_pull):
        mock_pull.return_value = {
            "checked": 2,
            "updated": 0,
            "errors": [],
        }
        response = self.client.get(
            "/api/supabase/curated/pull-from-supabase/?table=otef",
        )
        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertTrue(body.get("ok"))
        self.assertIn("updated", body)
        self.assertEqual(body.get("updated"), 0)
        self.assertEqual(body.get("checked"), 2)
        mock_pull.assert_called_once()

    @patch("backend.supabase_proxy.pull_published_curated_layers_from_supabase")
    def test_pull_updated_increments_per_mock_return(self, mock_pull):
        mock_pull.side_effect = [
            {"checked": 1, "updated": 0, "errors": []},
            {"checked": 1, "updated": 3, "errors": []},
        ]
        r1 = self.client.get("/api/supabase/curated/pull-from-supabase/?table=otef")
        r2 = self.client.get("/api/supabase/curated/pull-from-supabase/?table=otef")
        self.assertEqual(r1.status_code, 200)
        self.assertEqual(r2.status_code, 200)
        self.assertEqual(r1.json().get("updated"), 0)
        self.assertEqual(r2.json().get("updated"), 3)
        self.assertEqual(mock_pull.call_count, 2)

    @patch("backend.supabase_proxy.pull_published_curated_layers_from_supabase")
    def test_pull_passes_table_model_and_name(self, mock_pull):
        mock_pull.return_value = {"checked": 0, "updated": 0, "errors": []}
        self.client.get("/api/supabase/curated/pull-from-supabase/?table=otef")
        args, _kwargs = mock_pull.call_args
        table_arg, name_arg = args
        self.assertEqual(table_arg, self.table)
        self.assertEqual(name_arg, "otef")

    def test_pull_unknown_table_404(self):
        response = self.client.get(
            "/api/supabase/curated/pull-from-supabase/?table=nonexistent_table_xyz",
        )
        self.assertEqual(response.status_code, 404)
        self.assertIn("error", response.json())
