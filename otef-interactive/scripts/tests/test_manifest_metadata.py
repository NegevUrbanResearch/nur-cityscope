import unittest

from otef_layer_processing.models import LayerEntry


class LayerEntryMetadataTests(unittest.TestCase):
    def test_serializes_tiling_preset_and_processing_metadata_when_present(self):
        entry = LayerEntry(
            id="rivers",
            name="Rivers",
            file="rivers.geojson",
            geometry_type="LineString",
            pmtiles_file="rivers.pmtiles",
            tiling_preset="roads_paths_rivers",
            processing={
                "featureCount": 870,
                "coordinateCount": 291000,
                "propertyBytes": 0,
                "sizeBytes": 12700000,
                "pmtilesReasons": ["coordinate_count"],
            },
        )

        layer = entry.to_dict()

        self.assertEqual(layer["pmtilesFile"], "rivers.pmtiles")
        self.assertEqual(layer["tilingPreset"], "roads_paths_rivers")
        self.assertEqual(
            layer["processing"],
            {
                "featureCount": 870,
                "coordinateCount": 291000,
                "propertyBytes": 0,
                "sizeBytes": 12700000,
                "pmtilesReasons": ["coordinate_count"],
            },
        )

    def test_omits_optional_metadata_when_absent(self):
        entry = LayerEntry(
            id="roads",
            name="Roads",
            file="roads.geojson",
            geometry_type="LineString",
        )

        layer = entry.to_dict()

        self.assertNotIn("tilingPreset", layer)
        self.assertNotIn("processing", layer)


if __name__ == "__main__":
    unittest.main()
