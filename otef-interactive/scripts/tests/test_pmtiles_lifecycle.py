import json
import tempfile
import unittest
from pathlib import Path

from otef_layer_processing.pmtiles_lifecycle import resolve_pmtiles_lifecycle


def _write_geojson(path: Path, coordinate_count: int) -> None:
    coordinates = [[float(index), 0.0] for index in range(coordinate_count)]
    payload = {
        "type": "FeatureCollection",
        "features": [
            {
                "type": "Feature",
                "properties": {},
                "geometry": {"type": "LineString", "coordinates": coordinates},
            }
        ],
    }
    path.write_text(json.dumps(payload), encoding="utf-8")


class PmtilesLifecycleTests(unittest.TestCase):
    def test_advertises_existing_artifact_only_when_policy_recommends_pmtiles(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            geojson_path = root / "line.geojson"
            pmtiles_path = root / "line.pmtiles"
            _write_geojson(geojson_path, 50_001)
            pmtiles_path.write_bytes(b"pmtiles")

            result = resolve_pmtiles_lifecycle(
                pack_id="greens",
                layer_id="line",
                geometry_type="LineString",
                style_config={},
                geojson_path=geojson_path,
                pmtiles_path=pmtiles_path,
            )

            self.assertEqual(result.pmtiles_file, "line.pmtiles")
            self.assertEqual(result.tiling_preset, "roads_paths_rivers")
            self.assertEqual(result.metadata["pmtilesReasons"], ["coordinate_count"])

    def test_does_not_advertise_stale_artifact_when_policy_opts_out(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            geojson_path = root / "labels.geojson"
            pmtiles_path = root / "labels.pmtiles"
            _write_geojson(geojson_path, 10)
            pmtiles_path.write_bytes(b"stale")

            with self.assertLogs(
                "otef_layer_processing.pmtiles_lifecycle", level="WARNING"
            ):
                result = resolve_pmtiles_lifecycle(
                    pack_id="greens",
                    layer_id="labels",
                    geometry_type="Point",
                    style_config={
                        "labels": {"field": "name"},
                        "defaultSymbol": {"symbolLayers": []},
                    },
                    geojson_path=geojson_path,
                    pmtiles_path=pmtiles_path,
                )

            self.assertIsNone(result.pmtiles_file)
            self.assertIsNone(result.tiling_preset)
            self.assertFalse(pmtiles_path.exists())
            self.assertEqual(result.metadata["pmtilesReasons"], ["label_point_opt_out"])

    def test_metadata_only_missing_recommended_artifact_keeps_reasons_but_omits_file(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            geojson_path = root / "line.geojson"
            pmtiles_path = root / "line.pmtiles"
            _write_geojson(geojson_path, 50_001)

            result = resolve_pmtiles_lifecycle(
                pack_id="greens",
                layer_id="line",
                geometry_type="LineString",
                style_config={},
                geojson_path=geojson_path,
                pmtiles_path=pmtiles_path,
            )

            self.assertIsNone(result.pmtiles_file)
            self.assertIsNone(result.tiling_preset)
            self.assertEqual(result.metadata["pmtilesReasons"], ["coordinate_count"])

    def test_generates_missing_recommended_artifact_before_advertising(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            geojson_path = root / "line.geojson"
            pmtiles_path = root / "line.pmtiles"
            _write_geojson(geojson_path, 50_001)
            calls = []

            def generate(input_geojson, output_pmtiles, preset):
                calls.append((input_geojson, output_pmtiles, preset))
                output_pmtiles.write_bytes(b"generated")
                return True

            result = resolve_pmtiles_lifecycle(
                pack_id="greens",
                layer_id="line",
                geometry_type="LineString",
                style_config={},
                geojson_path=geojson_path,
                pmtiles_path=pmtiles_path,
                generate_pmtiles=generate,
            )

            self.assertEqual(calls, [(geojson_path, pmtiles_path, "roads_paths_rivers")])
            self.assertEqual(result.pmtiles_file, "line.pmtiles")
            self.assertEqual(result.tiling_preset, "roads_paths_rivers")

    def test_regenerates_existing_recommended_artifact_when_requested(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            geojson_path = root / "line.geojson"
            pmtiles_path = root / "line.pmtiles"
            _write_geojson(geojson_path, 50_001)
            pmtiles_path.write_bytes(b"old")
            calls = []

            def generate(input_geojson, output_pmtiles, preset):
                calls.append((input_geojson, output_pmtiles, preset))
                output_pmtiles.write_bytes(b"new")
                return True

            result = resolve_pmtiles_lifecycle(
                pack_id="greens",
                layer_id="line",
                geometry_type="LineString",
                style_config={},
                geojson_path=geojson_path,
                pmtiles_path=pmtiles_path,
                generate_pmtiles=generate,
                regenerate_existing=True,
            )

            self.assertEqual(calls, [(geojson_path, pmtiles_path, "roads_paths_rivers")])
            self.assertEqual(pmtiles_path.read_bytes(), b"new")
            self.assertEqual(result.pmtiles_file, "line.pmtiles")
            self.assertEqual(result.tiling_preset, "roads_paths_rivers")

    def test_does_not_regenerate_existing_artifact_without_request(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            geojson_path = root / "line.geojson"
            pmtiles_path = root / "line.pmtiles"
            _write_geojson(geojson_path, 50_001)
            pmtiles_path.write_bytes(b"old")
            calls = []

            result = resolve_pmtiles_lifecycle(
                pack_id="greens",
                layer_id="line",
                geometry_type="LineString",
                style_config={},
                geojson_path=geojson_path,
                pmtiles_path=pmtiles_path,
                generate_pmtiles=lambda input_geojson, output_pmtiles, preset: calls.append(
                    (input_geojson, output_pmtiles, preset)
                )
                or True,
            )

            self.assertEqual(calls, [])
            self.assertEqual(pmtiles_path.read_bytes(), b"old")
            self.assertEqual(result.pmtiles_file, "line.pmtiles")

    def test_generation_failure_keeps_recommendation_metadata_but_omits_file(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            geojson_path = root / "line.geojson"
            pmtiles_path = root / "line.pmtiles"
            _write_geojson(geojson_path, 50_001)

            with self.assertLogs(
                "otef_layer_processing.pmtiles_lifecycle", level="WARNING"
            ):
                result = resolve_pmtiles_lifecycle(
                    pack_id="greens",
                    layer_id="line",
                    geometry_type="LineString",
                    style_config={},
                    geojson_path=geojson_path,
                    pmtiles_path=pmtiles_path,
                    generate_pmtiles=lambda input_geojson, output_pmtiles, preset: False,
                )

            self.assertIsNone(result.pmtiles_file)
            self.assertIsNone(result.tiling_preset)
            self.assertEqual(result.metadata["pmtilesReasons"], ["coordinate_count"])

    def test_failed_regeneration_does_not_advertise_existing_stale_artifact(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            geojson_path = root / "line.geojson"
            pmtiles_path = root / "line.pmtiles"
            _write_geojson(geojson_path, 50_001)
            pmtiles_path.write_bytes(b"old")

            with self.assertLogs(
                "otef_layer_processing.pmtiles_lifecycle", level="WARNING"
            ):
                result = resolve_pmtiles_lifecycle(
                    pack_id="greens",
                    layer_id="line",
                    geometry_type="LineString",
                    style_config={},
                    geojson_path=geojson_path,
                    pmtiles_path=pmtiles_path,
                    generate_pmtiles=lambda input_geojson, output_pmtiles, preset: False,
                    regenerate_existing=True,
                )

            self.assertIsNone(result.pmtiles_file)
            self.assertIsNone(result.tiling_preset)
            self.assertFalse(pmtiles_path.exists())
            self.assertEqual(result.metadata["pmtilesReasons"], ["coordinate_count"])


if __name__ == "__main__":
    unittest.main()
