import json
import tempfile
import unittest
from pathlib import Path

from otef_layer_processing.layer_stats import LayerStats, collect_geojson_stats


class CollectGeojsonStatsTests(unittest.TestCase):
    def write_geojson(self, payload):
        temp_dir = tempfile.TemporaryDirectory()
        path = Path(temp_dir.name) / "layer.geojson"
        path.write_text(json.dumps(payload), encoding="utf-8")
        self.addCleanup(temp_dir.cleanup)
        return path

    def write_raw_geojson(self, raw_text):
        temp_dir = tempfile.TemporaryDirectory()
        path = Path(temp_dir.name) / "layer.geojson"
        path.write_text(raw_text, encoding="utf-8")
        self.addCleanup(temp_dir.cleanup)
        return path

    def test_collects_feature_coordinate_property_and_geometry_stats_for_lines(self):
        path = self.write_geojson(
            {
                "type": "FeatureCollection",
                "features": [
                    {
                        "type": "Feature",
                        "properties": {"name": "alpha"},
                        "geometry": {
                            "type": "LineString",
                            "coordinates": [[0, 0], [1, 1], [2, 2]],
                        },
                    },
                    {
                        "type": "Feature",
                        "properties": {"name": "beta"},
                        "geometry": {
                            "type": "LineString",
                            "coordinates": [[3, 3], [4, 4], [5, 5]],
                        },
                    },
                ],
            }
        )

        stats = collect_geojson_stats(path)

        self.assertEqual(
            stats,
            LayerStats(
                size_bytes=path.stat().st_size,
                feature_count=2,
                coordinate_count=6,
                property_bytes=len(
                    json.dumps({"name": "alpha"}, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
                )
                + len(
                    json.dumps({"name": "beta"}, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
                ),
                geometry_family="line",
            ),
        )

    def test_counts_nested_multipolygon_coordinates_recursively(self):
        path = self.write_geojson(
            {
                "type": "FeatureCollection",
                "features": [
                    {
                        "type": "Feature",
                        "properties": {"zone": "floodplain"},
                        "geometry": {
                            "type": "MultiPolygon",
                            "coordinates": [
                                [
                                    [
                                        [0, 0],
                                        [0, 5],
                                        [5, 5],
                                        [0, 0],
                                    ]
                                ],
                                [
                                    [
                                        [10, 10],
                                        [10, 12],
                                        [12, 12],
                                        [10, 10],
                                    ],
                                    [
                                        [10.5, 10.5],
                                        [11, 10.5],
                                        [10.5, 11],
                                        [10.5, 10.5],
                                    ],
                                ],
                            ],
                        },
                    }
                ],
            }
        )

        stats = collect_geojson_stats(path)

        self.assertEqual(stats.feature_count, 1)
        self.assertEqual(stats.coordinate_count, 12)
        self.assertEqual(stats.geometry_family, "polygon")
        self.assertGreater(stats.property_bytes, 0)

    def test_raises_clear_error_for_empty_file(self):
        temp_dir = tempfile.TemporaryDirectory()
        path = Path(temp_dir.name) / "empty.geojson"
        path.write_text("", encoding="utf-8")
        self.addCleanup(temp_dir.cleanup)

        with self.assertRaisesRegex(ValueError, "empty"):
            collect_geojson_stats(path)

    def test_raises_clear_error_for_unsupported_geojson_shape(self):
        path = self.write_geojson({"type": "Point", "coordinates": [34.8, 31.2]})

        with self.assertRaisesRegex(ValueError, "FeatureCollection"):
            collect_geojson_stats(path)

    def test_raises_clear_error_for_malformed_json(self):
        path = self.write_raw_geojson('{"type":"FeatureCollection","features":[}')

        with self.assertRaisesRegex(ValueError, "malformed"):
            collect_geojson_stats(path)
