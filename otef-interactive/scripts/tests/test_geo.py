import json
import tempfile
import unittest
from pathlib import Path

from otef_layer_processing.geo import transform_to_wgs84


class TransformToWgs84JsonTypesTests(unittest.TestCase):
    def test_roundtrip_preserves_list_property_and_feature_id(self):
        payload = {
            "type": "FeatureCollection",
            "features": [
                {
                    "type": "Feature",
                    "id": "Sderot",
                    "properties": {
                        "city": "Sderot",
                        "alarm_minutes": [389, 390],
                        "alarm_count_total": 2,
                    },
                    "geometry": {"type": "Point", "coordinates": [34.51, 31.41]},
                }
            ],
        }
        with tempfile.TemporaryDirectory() as tmp:
            src = Path(tmp) / "in.geojson"
            dst = Path(tmp) / "out.geojson"
            src.write_text(json.dumps(payload), encoding="utf-8")
            self.assertTrue(transform_to_wgs84(src, dst))
            out = json.loads(dst.read_text(encoding="utf-8"))
        feat = out["features"][0]
        minutes = feat["properties"]["alarm_minutes"]
        self.assertIsInstance(minutes, list)
        self.assertTrue(all(isinstance(m, int) and not isinstance(m, bool) for m in minutes))
        self.assertEqual(minutes, [389, 390])
        self.assertEqual(feat["id"], "Sderot")
        self.assertEqual(feat["properties"]["city"], "Sderot")
