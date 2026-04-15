from unittest.mock import MagicMock, patch

from django.test import TestCase
import requests
from rest_framework.test import APIClient


class SupabaseSubmissionFeaturesFilterTests(TestCase):
    def setUp(self):
        self.client = APIClient()

    @patch("backend.supabase_proxy._supabase_headers")
    @patch("backend.supabase_proxy.requests.get")
    def test_submission_features_supports_optional_project_filter(
        self, mock_requests_get, mock_headers
    ):
        mock_headers.return_value = ("https://example.supabase.co", "secret-key", None)
        fake_response = MagicMock()
        fake_response.raise_for_status.return_value = None
        fake_response.json.return_value = []
        mock_requests_get.return_value = fake_response

        self.client.get(
            "/api/supabase/submissions/00000000-0000-0000-0000-000000000001/features/",
            {"project_id": "00000000-0000-0000-0000-000000000002"},
        )

        _, kwargs = mock_requests_get.call_args
        params = kwargs.get("params") or {}
        self.assertEqual(
            params.get("submission_id"), "eq.00000000-0000-0000-0000-000000000001"
        )
        self.assertEqual(
            params.get("project_id"), "eq.00000000-0000-0000-0000-000000000002"
        )

    @patch("backend.supabase_proxy._supabase_headers")
    @patch("backend.supabase_proxy.requests.get")
    def test_submission_features_filters_current_and_history_rows(
        self, mock_requests_get, mock_headers
    ):
        mock_headers.return_value = ("https://example.supabase.co", "secret-key", None)
        fake_response = MagicMock()
        fake_response.raise_for_status.return_value = None
        fake_response.json.return_value = [
            {
                "id": "a",
                "is_current": True,
                "geom": {"type": "Point", "coordinates": [34.8, 32.08]},
            },
            {
                "id": "b",
                "is_current": False,
                "geom": {"type": "Point", "coordinates": [34.81, 32.09]},
            },
        ]
        mock_requests_get.return_value = fake_response

        only_current = self.client.get(
            "/api/supabase/submissions/00000000-0000-0000-0000-000000000001/features/",
            {"include_current": "true", "include_history": "false"},
        )
        self.assertEqual(only_current.status_code, 200)
        self.assertEqual(len((only_current.data or {}).get("features", [])), 1)

        only_history = self.client.get(
            "/api/supabase/submissions/00000000-0000-0000-0000-000000000001/features/",
            {"include_current": "false", "include_history": "true"},
        )
        self.assertEqual(only_history.status_code, 200)
        self.assertEqual(len((only_history.data or {}).get("features", [])), 1)

        neither = self.client.get(
            "/api/supabase/submissions/00000000-0000-0000-0000-000000000001/features/",
            {"include_current": "false", "include_history": "false"},
        )
        self.assertEqual(neither.status_code, 200)
        self.assertEqual((neither.data or {}).get("features", []), [])

    @patch("backend.supabase_proxy._supabase_headers")
    @patch("backend.supabase_proxy.requests.get")
    def test_project_submissions_excludes_history_rows_by_default(
        self, mock_requests_get, mock_headers
    ):
        mock_headers.return_value = ("https://example.supabase.co", "secret-key", None)
        fake_response = MagicMock()
        fake_response.raise_for_status.return_value = None
        fake_response.json.return_value = [
            {"submission_id": "sub-a", "is_current": True},
            {"submission_id": "sub-a", "is_current": False},
            {"submission_id": "sub-b", "is_current": False},
        ]
        mock_requests_get.return_value = fake_response

        resp = self.client.get(
            "/api/supabase/projects/00000000-0000-0000-0000-000000000001/submissions/"
        )
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.data, [{"id": "sub-a"}])

    @patch("backend.supabase_proxy._supabase_headers")
    @patch("backend.supabase_proxy.requests.get")
    def test_project_submissions_fallbacks_when_is_current_column_missing(
        self, mock_requests_get, mock_headers
    ):
        mock_headers.return_value = ("https://example.supabase.co", "secret-key", None)

        first_response = MagicMock()
        first_response.raise_for_status.side_effect = requests.RequestException(
            'column "is_current" does not exist'
        )

        second_response = MagicMock()
        second_response.raise_for_status.return_value = None
        second_response.json.return_value = [{"submission_id": "sub-a"}]

        def fake_get(*args, **kwargs):
            params = kwargs.get("params") or {}
            select_expr = str(params.get("select") or "")
            if "is_current" in select_expr:
                return first_response
            return second_response

        mock_requests_get.side_effect = fake_get

        resp = self.client.get(
            "/api/supabase/projects/00000000-0000-0000-0000-000000000001/submissions/"
        )
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.data, [{"id": "sub-a"}])
