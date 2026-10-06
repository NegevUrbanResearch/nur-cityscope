import json
import tempfile
import unittest
from pathlib import Path

import otef_layer_processing.settlement_label_additions as additions_module
from otef_layer_processing.settlement_label_additions import add_outline_matches, add_settlement_labels


class SettlementLabelAdditionsTests(unittest.TestCase):
    def test_imported_amioz_outline_is_idempotent_and_preserves_existing_polygons(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "outlines.geojson"
            original = {"type": "Feature", "properties": {"OBJECTID": 8}, "geometry": {"type": "Polygon", "coordinates": [[[0,0],[1,0],[1,1],[0,0]]]}}
            path.write_text(json.dumps({"type": "FeatureCollection", "features": [original]}), encoding="utf-8")
            additions_module.add_settlement_outlines(path)
            first = json.loads(path.read_text(encoding="utf-8"))
            additions_module.add_settlement_outlines(path)
            self.assertEqual(json.loads(path.read_text(encoding="utf-8")), first)
            self.assertEqual(first["features"][0], original)
            imported = first["features"][1]
            self.assertEqual(imported["properties"]["citycode"], "0318")
            self.assertEqual(imported["properties"]["OBJECTID"], 44)
            self.assertEqual(imported["geometry"]["coordinates"][0][0], imported["geometry"]["coordinates"][0][-1])
            self.assertIn("openstreetmap.org/way/82487628", imported["properties"]["sourceUrl"])

    def test_addition_is_idempotent_and_preserves_original_features(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "names.geojson"
            original = {"type": "Feature", "properties": {"citycode": "0067", "OBJECTID": 4, "cityname": "אור הנר"},
                        "geometry": {"type": "Point", "coordinates": [34.6, 31.5]}}
            path.write_text(json.dumps({"type": "FeatureCollection", "features": [original]}), encoding="utf-8")
            additions = add_settlement_labels(path)
            first = json.loads(path.read_text(encoding="utf-8"))
            add_settlement_labels(path)
            self.assertEqual(json.loads(path.read_text(encoding="utf-8")), first)
            self.assertEqual(first["features"][0], original)
            added = first["features"][1]
            self.assertEqual(added["properties"]["citycode"], "1240")
            self.assertTrue(added["properties"]["otef_supplemental_label"])
            mapping = Path(directory) / "mapping.json"
            mapping.write_text(json.dumps({"matches": []}), encoding="utf-8")
            add_outline_matches(mapping, additions)
            add_outline_matches(mapping, additions)
            self.assertEqual(json.loads(mapping.read_text(encoding="utf-8"))["matches"], [
                {"citycode": "1240", "cityname": "עין הבשור", "outlineObjectId": 12},
                {"citycode": "1237", "cityname": "תלמי יוסף", "outlineObjectId": 9},
                {"citycode": "0415", "cityname": "שוקדה", "outlineObjectId": 22},
                {"citycode": "1095", "cityname": "כפר מימון", "outlineObjectId": 23},
                {"citycode": "0342", "cityname": "גברעם", "outlineObjectId": 33},
            ])


if __name__ == "__main__":
    unittest.main()
