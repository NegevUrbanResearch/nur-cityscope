from unittest.mock import patch

from django.test import SimpleTestCase
from rest_framework.test import APIClient


SID_A = "00000000-0000-0000-0000-000000000001"
SID_B = "00000000-0000-0000-0000-000000000002"
PID_1 = "10000000-0000-0000-0000-000000000001"
BATCH_PK_A = "20000000-0000-0000-0000-0000000000a1"
BATCH_PK_B = "20000000-0000-0000-0000-0000000000b1"


class SupabaseSubmissionListAllTests(SimpleTestCase):
    def setUp(self):
        self.client = APIClient()

    @patch("backend.supabase_proxy._get")
    @patch("backend.supabase_proxy._supabase_headers")
    def test_submissions_all_returns_name_type_and_history_flags(
        self, mock_headers, mock_get
    ):
        mock_headers.return_value = ("https://example.supabase.co", "secret-key", None)

        def getter(path, params=None):
            if path == "/submission_batches":
                return (
                    [
                        {
                            "id": BATCH_PK_A,
                            "submission_id": SID_A,
                            "submission_name": "Alpha batch",
                            "updated_at": "2024-06-15T00:00:00+00:00",
                        }
                    ],
                    None,
                )
            if path == "/projects":
                return ([{"id": PID_1, "name": "Tkuma corridor"}], None)
            if path == "/geo_features":
                return (
                    [
                        {
                            "submission_id": SID_A,
                            "project_id": PID_1,
                            "is_current": True,
                            "updated_at": "2024-06-01T00:00:00+00:00",
                            "feature_type": None,
                            "geom": {
                                "type": "LineString",
                                "coordinates": [[34.0, 31.0], [34.1, 31.1]],
                            },
                        },
                        {
                            "submission_id": SID_A,
                            "project_id": PID_1,
                            "is_current": False,
                            "updated_at": "2024-05-01T00:00:00+00:00",
                            "feature_type": None,
                            "geom": {
                                "type": "LineString",
                                "coordinates": [[34.0, 31.0], [34.1, 31.1]],
                            },
                        },
                    ],
                    None,
                )
            return None, f"unexpected path {path}"

        mock_get.side_effect = getter

        resp = self.client.get("/api/supabase/submissions/")
        self.assertEqual(resp.status_code, 200)
        self.assertIsInstance(resp.data, list)
        self.assertEqual(len(resp.data), 1)
        row = resp.data[0]
        self.assertEqual(row["id"], SID_A)
        self.assertEqual(row["name"], "Alpha batch")
        self.assertTrue(row["has_current"])
        self.assertTrue(row["has_history"])
        self.assertEqual(row["type_label"], "Tkuma Line")
        self.assertEqual(row["type_tags"], ["Tkuma Line"])
        self.assertIn("id", row)
        self.assertIn("name", row)
        self.assertIn("has_current", row)
        self.assertIn("has_history", row)
        self.assertIn("type_label", row)
        self.assertIn("type_tags", row)

    @patch("backend.supabase_proxy._get")
    @patch("backend.supabase_proxy._supabase_headers")
    def test_submissions_all_fallback_name_when_batch_missing(
        self, mock_headers, mock_get
    ):
        mock_headers.return_value = ("https://example.supabase.co", "secret-key", None)

        def getter(path, params=None):
            if path == "/submission_batches":
                return (None, "submission_batches not found")
            if path == "/projects":
                return ([], None)
            if path == "/geo_features":
                return (
                    [
                        {
                            "submission_id": SID_B,
                            "project_id": PID_1,
                            "is_current": True,
                            "updated_at": "2024-01-01T00:00:00+00:00",
                        },
                    ],
                    None,
                )
            return None, f"unexpected path {path}"

        mock_get.side_effect = getter

        resp = self.client.get("/api/supabase/submissions/")
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(len(resp.data), 1)
        self.assertEqual(resp.data[0]["id"], SID_B)
        self.assertTrue(resp.data[0]["name"])
        self.assertNotEqual(resp.data[0]["name"], SID_B)

    @patch("backend.supabase_proxy._get")
    @patch("backend.supabase_proxy._supabase_headers")
    def test_submissions_all_type_label_mixed(self, mock_headers, mock_get):
        mock_headers.return_value = ("https://example.supabase.co", "secret-key", None)

        def getter(path, params=None):
            if path == "/submission_batches":
                return ([], None)
            if path == "/projects":
                return ([], None)
            if path == "/geo_features":
                return (
                    [
                        {
                            "submission_id": SID_A,
                            "project_id": PID_1,
                            "is_current": True,
                            "updated_at": "2024-01-01T00:00:00+00:00",
                            "feature_type": "central",
                            "geom": {
                                "type": "LineString",
                                "coordinates": [[0, 0], [1, 1]],
                            },
                        },
                    ],
                    None,
                )
            return None, f"unexpected path {path}"

        mock_get.side_effect = getter

        resp = self.client.get("/api/supabase/submissions/")
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.data[0]["type_label"], "Mixed")
        self.assertEqual(resp.data[0]["type_tags"], ["Tkuma Line", "Memorials"])

    @patch("backend.supabase_proxy._get")
    @patch("backend.supabase_proxy._supabase_headers")
    def test_submissions_all_sorts_newer_updated_first_then_name(
        self, mock_headers, mock_get
    ):
        mock_headers.return_value = ("https://example.supabase.co", "secret-key", None)

        def getter(path, params=None):
            if path == "/submission_batches":
                return (
                    [
                        {
                            "id": BATCH_PK_B,
                            "submission_id": SID_B,
                            "submission_name": "B",
                            "updated_at": "2020-01-01T00:00:00+00:00",
                        },
                        {
                            "id": BATCH_PK_A,
                            "submission_id": SID_A,
                            "submission_name": "A",
                            "updated_at": "2024-01-01T00:00:00+00:00",
                        },
                    ],
                    None,
                )
            if path == "/projects":
                return ([], None)
            if path == "/geo_features":
                return (
                    [
                        {
                            "submission_id": SID_A,
                            "project_id": PID_1,
                            "is_current": True,
                            "updated_at": "2024-01-01T00:00:00+00:00",
                        },
                        {
                            "submission_id": SID_B,
                            "project_id": PID_1,
                            "is_current": True,
                            "updated_at": "2023-01-01T00:00:00+00:00",
                        },
                    ],
                    None,
                )
            return None, f"unexpected path {path}"

        mock_get.side_effect = getter

        resp = self.client.get("/api/supabase/submissions/")
        self.assertEqual(resp.status_code, 200)
        ids = [r["id"] for r in resp.data]
        self.assertEqual(ids[0], SID_A)
        self.assertEqual(ids[1], SID_B)

    @patch("backend.supabase_proxy._get")
    @patch("backend.supabase_proxy._supabase_headers")
    def test_submissions_all_batch_name_keyed_by_submission_id_not_batch_row_id(
        self, mock_headers, mock_get
    ):
        """Names must join on submission_batches.submission_id, not submission_batches.id."""
        mock_headers.return_value = ("https://example.supabase.co", "secret-key", None)
        # Batch PK is unrelated to submission UUID; wrong join key would miss the name.
        alien_batch_pk = "ffffffff-ffff-ffff-ffff-ffffffffffff"

        def getter(path, params=None):
            if path == "/submission_batches":
                return (
                    [
                        {
                            "id": alien_batch_pk,
                            "submission_id": SID_A,
                            "submission_name": "Joined by submission_id",
                            "updated_at": "2024-06-15T00:00:00+00:00",
                        }
                    ],
                    None,
                )
            if path == "/projects":
                return ([], None)
            if path == "/geo_features":
                return (
                    [
                        {
                            "submission_id": SID_A,
                            "project_id": PID_1,
                            "is_current": True,
                            "updated_at": "2024-06-01T00:00:00+00:00",
                        },
                    ],
                    None,
                )
            return None, f"unexpected path {path}"

        mock_get.side_effect = getter

        resp = self.client.get("/api/supabase/submissions/")
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(len(resp.data), 1)
        row = resp.data[0]
        self.assertEqual(row["id"], SID_A)
        self.assertEqual(row["name"], "Joined by submission_id")
        self.assertIn("type_tags", row)
        self.assertIn("type_label", row)

    @patch("backend.supabase_proxy._get")
    @patch("backend.supabase_proxy._supabase_headers")
    def test_submissions_all_includes_submission_color_from_geo_features(
        self, mock_headers, mock_get
    ):
        """submission_color is derived from geo_features rows (GeoJSON Feature props or flat columns)."""
        mock_headers.return_value = ("https://example.supabase.co", "secret-key", None)

        def getter(path, params=None):
            if path == "/submission_batches":
                return (
                    [
                        {
                            "id": BATCH_PK_A,
                            "submission_id": SID_A,
                            "submission_name": "Alpha batch",
                            "updated_at": "2024-06-15T00:00:00+00:00",
                        }
                    ],
                    None,
                )
            if path == "/projects":
                return ([], None)
            if path == "/geo_features":
                return (
                    [
                        {
                            "submission_id": SID_A,
                            "project_id": PID_1,
                            "is_current": True,
                            "updated_at": "2024-06-01T00:00:00+00:00",
                            "feature_type": None,
                            "geom": {
                                "type": "Feature",
                                "properties": {"stroke": "#00aa11"},
                                "geometry": {
                                    "type": "LineString",
                                    "coordinates": [[34.0, 31.0], [34.1, 31.1]],
                                },
                            },
                        },
                    ],
                    None,
                )
            return None, f"unexpected path {path}"

        mock_get.side_effect = getter

        resp = self.client.get("/api/supabase/submissions/")
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(len(resp.data), 1)
        row = resp.data[0]
        self.assertEqual(row["id"], SID_A)
        self.assertEqual(row["submission_color"], "#00aa11")

    @patch("backend.supabase_proxy._get")
    @patch("backend.supabase_proxy._supabase_headers")
    def test_submissions_all_prefers_submission_batch_display_color_over_geo(
        self, mock_headers, mock_get
    ):
        """submission_batches.display_color wins over stroke parsed from geo_features."""
        mock_headers.return_value = ("https://example.supabase.co", "secret-key", None)

        def getter(path, params=None):
            if path == "/submission_batches":
                return (
                    [
                        {
                            "id": BATCH_PK_A,
                            "submission_id": SID_A,
                            "submission_name": "Alpha batch",
                            "updated_at": "2024-06-15T00:00:00+00:00",
                            "display_color": "#ff0000",
                        }
                    ],
                    None,
                )
            if path == "/projects":
                return ([], None)
            if path == "/geo_features":
                return (
                    [
                        {
                            "submission_id": SID_A,
                            "project_id": PID_1,
                            "is_current": True,
                            "updated_at": "2024-06-01T00:00:00+00:00",
                            "feature_type": None,
                            "geom": {
                                "type": "Feature",
                                "properties": {"stroke": "#00aa11"},
                                "geometry": {
                                    "type": "LineString",
                                    "coordinates": [[34.0, 31.0], [34.1, 31.1]],
                                },
                            },
                        },
                    ],
                    None,
                )
            return None, f"unexpected path {path}"

        mock_get.side_effect = getter

        resp = self.client.get("/api/supabase/submissions/")
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(len(resp.data), 1)
        self.assertEqual(resp.data[0]["submission_color"], "#ff0000")

    @patch("backend.supabase_proxy._get")
    @patch("backend.supabase_proxy._supabase_headers")
    def test_submissions_all_uses_display_color_when_geo_has_no_color(
        self, mock_headers, mock_get
    ):
        mock_headers.return_value = ("https://example.supabase.co", "secret-key", None)

        def getter(path, params=None):
            if path == "/submission_batches":
                return (
                    [
                        {
                            "id": BATCH_PK_A,
                            "submission_id": SID_A,
                            "submission_name": "Alpha batch",
                            "updated_at": "2024-06-15T00:00:00+00:00",
                            "display_color": "rgb(10, 20, 30)",
                        }
                    ],
                    None,
                )
            if path == "/projects":
                return ([], None)
            if path == "/geo_features":
                return (
                    [
                        {
                            "submission_id": SID_A,
                            "project_id": PID_1,
                            "is_current": True,
                            "updated_at": "2024-06-01T00:00:00+00:00",
                            "feature_type": None,
                            "geom": {
                                "type": "LineString",
                                "coordinates": [[34.0, 31.0], [34.1, 31.1]],
                            },
                        },
                    ],
                    None,
                )
            return None, f"unexpected path {path}"

        mock_get.side_effect = getter

        resp = self.client.get("/api/supabase/submissions/")
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(len(resp.data), 1)
        self.assertEqual(resp.data[0]["submission_color"], "rgb(10, 20, 30)")

    @patch("backend.supabase_proxy._get")
    @patch("backend.supabase_proxy._supabase_headers")
    def test_submissions_all_matches_batch_display_color_when_uuid_casing_differs(
        self, mock_headers, mock_get
    ):
        """PostgREST may return mixed-case UUIDs; join must still pick up display_color."""
        mock_headers.return_value = ("https://example.supabase.co", "secret-key", None)
        sid_geo = "e85913be-db41-4af5-adc1-0cf2ff6614a6"
        sid_batch = "E85913BE-DB41-4AF5-ADC1-0CF2FF6614A6"

        def getter(path, params=None):
            if path == "/submission_batches":
                return (
                    [
                        {
                            "id": BATCH_PK_A,
                            "submission_id": sid_batch,
                            "submission_name": "Case batch",
                            "updated_at": "2024-06-15T00:00:00+00:00",
                            "display_color": "#00aa11",
                        }
                    ],
                    None,
                )
            if path == "/projects":
                return ([], None)
            if path == "/geo_features":
                return (
                    [
                        {
                            "submission_id": sid_geo,
                            "project_id": PID_1,
                            "is_current": True,
                            "updated_at": "2024-06-01T00:00:00+00:00",
                            "feature_type": None,
                            "geom": {
                                "type": "LineString",
                                "coordinates": [[34.0, 31.0], [34.1, 31.1]],
                            },
                        },
                    ],
                    None,
                )
            return None, f"unexpected path {path}"

        mock_get.side_effect = getter

        resp = self.client.get("/api/supabase/submissions/")
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(len(resp.data), 1)
        self.assertEqual(resp.data[0]["id"], sid_geo)
        self.assertEqual(resp.data[0]["submission_color"], "#00aa11")
