import os
from unittest.mock import Mock, patch

import requests
from django.test import TestCase
from rest_framework.test import APIClient


class CurationRouteComputeProxyEndpointTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.valid_payload = {
            "base_paths": [[34.8, 32.08], [34.81, 32.09]],
            "current_points": [],
            "history_points": [],
        }

    @patch("backend.supabase_proxy._is_curation_write_authorized")
    def test_endpoint_uses_curation_write_auth_gate(self, mock_auth):
        mock_auth.return_value = (False, "Unauthorized write request")

        response = self.client.post(
            "/api/supabase/curated/compute-route/",
            self.valid_payload,
            format="json",
        )

        self.assertEqual(response.status_code, 401, response.data)
        mock_auth.assert_called_once()

    @patch.dict(os.environ, {"CURATION_WRITE_TOKEN": "test-write-token"}, clear=False)
    def test_missing_auth_token_returns_401(self):
        response = self.client.post(
            "/api/supabase/curated/compute-route/",
            self.valid_payload,
            format="json",
        )

        self.assertEqual(response.status_code, 401, response.data)

    @patch.dict(os.environ, {"CURATION_WRITE_TOKEN": "test-write-token"}, clear=False)
    def test_wrong_auth_token_returns_401(self):
        response = self.client.post(
            "/api/supabase/curated/compute-route/",
            self.valid_payload,
            format="json",
            HTTP_X_CURATION_WRITE_TOKEN="wrong-token",
        )

        self.assertEqual(response.status_code, 401, response.data)

    @patch("backend.supabase_proxy.requests.post")
    @patch.dict(
        os.environ,
        {
            "CURATION_WRITE_TOKEN": "test-write-token",
            "SUPABASE_URL": "https://example.supabase.co",
            "SUPABASE_SECRET_KEY": "service-key",
        },
        clear=False,
    )
    def test_valid_auth_token_reaches_downstream(self, mock_post):
        upstream_response = Mock()
        upstream_response.ok = True
        upstream_response.json.return_value = {"ok": True, "route": []}
        mock_post.return_value = upstream_response

        response = self.client.post(
            "/api/supabase/curated/compute-route/",
            self.valid_payload,
            format="json",
            HTTP_X_CURATION_WRITE_TOKEN="test-write-token",
        )

        self.assertEqual(response.status_code, 200, response.data)
        mock_post.assert_called_once()

    @patch("backend.supabase_proxy._is_curation_write_authorized")
    def test_base_paths_is_required_list(self, mock_auth):
        mock_auth.return_value = (True, None)

        response = self.client.post(
            "/api/supabase/curated/compute-route/",
            {
                "current_points": [],
                "history_points": [],
            },
            format="json",
        )

        self.assertEqual(response.status_code, 400, response.data)
        self.assertIn("base_paths", str(response.data.get("error", "")))

    @patch("backend.supabase_proxy._is_curation_write_authorized")
    def test_current_points_must_be_list(self, mock_auth):
        mock_auth.return_value = (True, None)

        response = self.client.post(
            "/api/supabase/curated/compute-route/",
            {
                "base_paths": [],
                "current_points": "not-a-list",
                "history_points": [],
            },
            format="json",
        )

        self.assertEqual(response.status_code, 400, response.data)
        self.assertIn("current_points", str(response.data.get("error", "")))

    @patch("backend.supabase_proxy._is_curation_write_authorized")
    def test_history_points_must_be_list(self, mock_auth):
        mock_auth.return_value = (True, None)

        response = self.client.post(
            "/api/supabase/curated/compute-route/",
            {
                "base_paths": [],
                "current_points": [],
                "history_points": "not-a-list",
            },
            format="json",
        )

        self.assertEqual(response.status_code, 400, response.data)
        self.assertIn("history_points", str(response.data.get("error", "")))

    @patch("backend.supabase_proxy._is_curation_write_authorized")
    def test_non_object_payload_returns_400(self, mock_auth):
        mock_auth.return_value = (True, None)

        response = self.client.post(
            "/api/supabase/curated/compute-route/",
            ["not", "an", "object"],
            format="json",
        )

        self.assertEqual(response.status_code, 400, response.data)
        self.assertIn("json object", str(response.data.get("error", "")).lower())

    @patch("backend.supabase_proxy.requests.post")
    @patch("backend.supabase_proxy._is_curation_write_authorized")
    @patch.dict(
        os.environ,
        {
            "SUPABASE_URL": "https://example.supabase.co",
            "SUPABASE_SECRET_KEY": "service-key",
        },
        clear=False,
    )
    def test_calls_upstream_with_backend_headers_and_default_path(
        self, mock_auth, mock_post
    ):
        mock_auth.return_value = (True, None)
        upstream_response = Mock()
        upstream_response.ok = True
        upstream_response.json.return_value = {"ok": True, "route": []}
        mock_post.return_value = upstream_response

        response = self.client.post(
            "/api/supabase/curated/compute-route/",
            self.valid_payload,
            format="json",
        )

        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(response.data.get("ok"), True)
        mock_post.assert_called_once()
        _, kwargs = mock_post.call_args
        self.assertEqual(
            mock_post.call_args.args[0],
            "https://example.supabase.co/functions/v1/curation-route-compute",
        )
        headers = kwargs.get("headers", {})
        self.assertEqual(headers.get("apikey"), "service-key")
        self.assertEqual(headers.get("Authorization"), "Bearer service-key")
        self.assertEqual(kwargs.get("json"), self.valid_payload)

    @patch("backend.supabase_proxy.requests.post")
    @patch("backend.supabase_proxy._is_curation_write_authorized")
    @patch.dict(
        os.environ,
        {
            "SUPABASE_URL": "https://example.supabase.co",
            "SUPABASE_SECRET_KEY": "service-key",
            "SUPABASE_CURATION_ROUTE_FUNCTION_PATH": "/functions/v1/primary-route",
            "SUPABASE_CURATION_ROUTE_COMPUTE_PATH": "/functions/v1/legacy-route",
        },
        clear=False,
    )
    def test_uses_primary_route_function_path_env_var_precedence(
        self, mock_auth, mock_post
    ):
        mock_auth.return_value = (True, None)
        upstream_response = Mock()
        upstream_response.ok = True
        upstream_response.json.return_value = {"ok": True}
        mock_post.return_value = upstream_response

        response = self.client.post(
            "/api/supabase/curated/compute-route/",
            self.valid_payload,
            format="json",
        )

        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(
            mock_post.call_args.args[0],
            "https://example.supabase.co/functions/v1/primary-route",
        )

    @patch("backend.supabase_proxy.requests.post")
    @patch("backend.supabase_proxy._is_curation_write_authorized")
    @patch.dict(
        os.environ,
        {
            "SUPABASE_URL": "https://example.supabase.co",
            "SUPABASE_SECRET_KEY": "service-key",
        },
        clear=False,
    )
    def test_upstream_non_ok_maps_to_502(self, mock_auth, mock_post):
        mock_auth.return_value = (True, None)
        upstream_response = Mock()
        upstream_response.ok = False
        upstream_response.status_code = 500
        upstream_response.text = "upstream failed"
        upstream_response.json.side_effect = ValueError("not-json")
        mock_post.return_value = upstream_response

        response = self.client.post(
            "/api/supabase/curated/compute-route/",
            self.valid_payload,
            format="json",
        )

        self.assertEqual(response.status_code, 502, response.data)

    @patch("backend.supabase_proxy.requests.post")
    @patch("backend.supabase_proxy._is_curation_write_authorized")
    @patch.dict(
        os.environ,
        {
            "SUPABASE_URL": "https://example.supabase.co",
            "SUPABASE_SECRET_KEY": "service-key",
        },
        clear=False,
    )
    def test_upstream_request_exception_maps_to_502(self, mock_auth, mock_post):
        mock_auth.return_value = (True, None)
        mock_post.side_effect = requests.RequestException("network down")

        response = self.client.post(
            "/api/supabase/curated/compute-route/",
            self.valid_payload,
            format="json",
        )

        self.assertEqual(response.status_code, 502, response.data)

    @patch("backend.supabase_proxy.requests.post")
    @patch("backend.supabase_proxy._is_curation_write_authorized")
    @patch.dict(
        os.environ,
        {
            "SUPABASE_URL": "https://example.supabase.co",
            "SUPABASE_SECRET_KEY": "service-key",
        },
        clear=False,
    )
    def test_upstream_timeout_maps_to_502_with_error_code(self, mock_auth, mock_post):
        mock_auth.return_value = (True, None)
        mock_post.side_effect = requests.Timeout("timed out")

        response = self.client.post(
            "/api/supabase/curated/compute-route/",
            self.valid_payload,
            format="json",
        )

        self.assertEqual(response.status_code, 502, response.data)
        self.assertEqual(response.data.get("error_code"), "UPSTREAM_TIMEOUT")
