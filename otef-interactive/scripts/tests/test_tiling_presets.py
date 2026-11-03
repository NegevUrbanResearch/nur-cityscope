import unittest
import sys
import types
from pathlib import Path
from unittest.mock import patch

from otef_layer_processing.tiling import (
    PMTILES_MAX_ZOOM,
    build_tippecanoe_base_args,
    build_tippecanoe_extra_args,
    convert_mbtiles_to_pmtiles,
    generate_pmtiles_smart,
)


class TilingPresetTests(unittest.TestCase):
    def test_roads_paths_rivers_preserves_projection_detail(self):
        args = build_tippecanoe_extra_args("roads_paths_rivers")

        self.assertIn("--no-line-simplification", args)
        self.assertFalse(any(arg.startswith("--simplification=") for arg in args))

    def test_critical_boundaries_uses_conservative_line_handling(self):
        args = build_tippecanoe_extra_args("critical_boundaries")

        self.assertIn("--no-line-simplification", args)
        self.assertNotIn("--simplification=2", args)

    def test_base_tippecanoe_args_are_inspectable(self):
        args = build_tippecanoe_base_args("out.mbtiles", "input.geojson")

        self.assertIn("--layer=layer", args)
        self.assertIn("--minimum-zoom=9", args)
        self.assertIn(f"--maximum-zoom={PMTILES_MAX_ZOOM}", args)
        self.assertIn("--detect-shared-borders", args)
        self.assertNotIn("--drop-densest-as-needed", args)

    def test_all_presets_are_defined(self):
        for preset in (
            "critical_boundaries",
            "roads_paths_rivers",
            "large_polygons",
            "dense_feature_polygons",
            "points_thin",
        ):
            with self.subTest(preset=preset):
                self.assertGreater(len(build_tippecanoe_extra_args(preset)), 0)

    def test_high_fidelity_true_maps_to_critical_boundaries_when_preset_absent(self):
        with patch(
            "otef_layer_processing.tiling.run_tippecanoe", return_value=False
        ) as run_tippecanoe:
            generate_pmtiles_smart(
                Path("input.geojson"), Path("output.pmtiles"), high_fidelity=True
            )

        extra_args = run_tippecanoe.call_args.args[2]
        self.assertIn("--no-line-simplification", extra_args)

    def test_explicit_preset_overrides_high_fidelity_compatibility_flag(self):
        with patch(
            "otef_layer_processing.tiling.run_tippecanoe", return_value=False
        ) as run_tippecanoe:
            generate_pmtiles_smart(
                Path("input.geojson"),
                Path("output.pmtiles"),
                high_fidelity=True,
                preset="roads_paths_rivers",
            )

        extra_args = run_tippecanoe.call_args.args[2]
        self.assertIn("--no-line-simplification", extra_args)
        self.assertFalse(any(arg.startswith("--simplification=") for arg in extra_args))

    def test_small_mbtiles_conversion_preserves_projection_maxzoom(self):
        mbtiles = Path("input.mbtiles")
        pmtiles = Path("output.pmtiles")
        calls = []
        fake_convert_module = types.SimpleNamespace(
            mbtiles_to_pmtiles=lambda *args, **kwargs: calls.append((args, kwargs))
        )

        with (
            patch.object(Path, "exists", return_value=True),
            patch.object(Path, "stat") as stat_path,
            patch.object(Path, "unlink"),
            patch.dict(sys.modules, {"pmtiles.convert": fake_convert_module}),
        ):
            stat_path.return_value.st_size = 1024

            self.assertTrue(convert_mbtiles_to_pmtiles(mbtiles, pmtiles))

        self.assertEqual(calls, [((str(mbtiles), str(pmtiles)), {"maxzoom": PMTILES_MAX_ZOOM})])


if __name__ == "__main__":
    unittest.main()
