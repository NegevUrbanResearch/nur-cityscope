import json
import tempfile
from pathlib import Path

from django.test import SimpleTestCase

from backend.calibration_io import normalize_calibration_payload, write_model_bounds_to_storage


class CalibrationIoTests(SimpleTestCase):
    def test_normalize_keeps_bounds_and_angle(self):
        payload = {
            "west": 1,
            "east": 2,
            "south": 3,
            "north": 4,
            "bounds_polygon": [{"x": 1, "y": 3}, {"x": 2, "y": 3}, {"x": 2, "y": 4}],
            "viewer_angle_deg": 17.5,
        }
        result = normalize_calibration_payload(payload)
        self.assertEqual(result["viewer_angle_deg"], 17.5)
        self.assertEqual(
            result["bounds_polygon"],
            [{"x": 1.0, "y": 3.0}, {"x": 2.0, "y": 3.0}, {"x": 2.0, "y": 4.0}],
        )
        self.assertEqual(result["west"], 1.0)
        self.assertEqual(result["east"], 2.0)
        self.assertEqual(result["south"], 3.0)
        self.assertEqual(result["north"], 4.0)

    def test_fallback_polygon_key_supported(self):
        payload = {"polygon": [{"x": 10, "y": 20}]}
        result = normalize_calibration_payload(payload)
        self.assertEqual(result["bounds_polygon"], [{"x": 10, "y": 20}])
        self.assertEqual(result["viewer_angle_deg"], 0.0)

    def test_bbox_synthesizes_polygon_when_missing(self):
        payload = {"west": 1, "east": 3, "south": 2, "north": 5}
        result = normalize_calibration_payload(payload)
        expected = [
            {"x": 1.0, "y": 2.0},
            {"x": 3.0, "y": 2.0},
            {"x": 3.0, "y": 5.0},
            {"x": 1.0, "y": 5.0},
        ]
        self.assertEqual(result["bounds_polygon"], expected)
        self.assertEqual(result["west"], 1.0)
        self.assertEqual(result["east"], 3.0)
        self.assertEqual(result["south"], 2.0)
        self.assertEqual(result["north"], 5.0)

    def test_invalid_vertices_are_dropped(self):
        payload = {
            "bounds_polygon": [
                {"x": 1, "y": 2},
                {"x": "bad", "y": 3},
                {"x": 4},
                {"x": 5, "y": 6},
                {"x": 7, "y": "bad"},
            ],
        }
        result = normalize_calibration_payload(payload)
        self.assertEqual(result["bounds_polygon"], [{"x": 1.0, "y": 2.0}, {"x": 5.0, "y": 6.0}])

    def test_viewer_angle_deg_invalid_defaults_to_zero(self):
        payload = {"viewer_angle_deg": "", "polygon": [{"x": 0, "y": 0}]}
        result = normalize_calibration_payload(payload)
        self.assertEqual(result["viewer_angle_deg"], 0.0)

    def test_viewer_angle_deg_none_defaults_to_zero(self):
        payload = {"viewer_angle_deg": None, "polygon": [{"x": 0, "y": 0}]}
        result = normalize_calibration_payload(payload)
        self.assertEqual(result["viewer_angle_deg"], 0.0)

    def test_none_payload_returns_empty_calibration(self):
        result = normalize_calibration_payload(None)
        self.assertEqual(result["bounds_polygon"], [])
        self.assertEqual(result["viewer_angle_deg"], 0.0)

    def test_write_model_bounds_to_storage_merges_and_writes_file(self):
        normalized = {
            "bounds_polygon": [{"x": 1.0, "y": 2.0}, {"x": 3.0, "y": 2.0}],
            "viewer_angle_deg": 10.0,
        }
        mock_config = type("MockConfig", (), {"model_bounds": {"crs": "EPSG:2039"}, "save": lambda self: None})()
        with tempfile.TemporaryDirectory() as tmp:
            file_path = Path(tmp) / "model-bounds.json"
            existing = {"west": 100, "east": 200, "south": 300, "north": 400}
            with open(file_path, "w", encoding="utf-8") as f:
                json.dump(existing, f)
            write_model_bounds_to_storage(normalized, mock_config, str(file_path))
            self.assertEqual(mock_config.model_bounds["bounds_polygon"], normalized["bounds_polygon"])
            self.assertEqual(mock_config.model_bounds["viewer_angle_deg"], 10.0)
            self.assertEqual(mock_config.model_bounds["crs"], "EPSG:2039")
            with open(file_path, encoding="utf-8") as f:
                file_data = json.load(f)
            self.assertEqual(file_data["bounds_polygon"], normalized["bounds_polygon"])
            self.assertEqual(file_data["polygon"], normalized["bounds_polygon"])
            self.assertEqual(file_data["viewer_angle_deg"], 10.0)
            self.assertEqual(file_data["west"], 100)
