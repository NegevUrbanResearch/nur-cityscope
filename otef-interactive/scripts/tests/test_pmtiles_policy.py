import unittest

from otef_layer_processing.layer_stats import LayerStats
from otef_layer_processing.pmtiles_policy import PmtilesDecision, decide_pmtiles


class DecidePmtilesTests(unittest.TestCase):
    def test_rivers_line_with_high_coordinate_count_uses_pmtiles_and_river_preset(self):
        decision = decide_pmtiles(
            pack_id="greens",
            layer_id="rivers_layer",
            geometry_type="LineString",
            style_config={},
            stats=LayerStats(
                size_bytes=12_700_000,
                feature_count=870,
                coordinate_count=291_000,
                property_bytes=0,
                geometry_family="line",
            ),
        )

        self.assertEqual(
            decision,
            PmtilesDecision(
                use_pmtiles=True,
                preset="roads_paths_rivers",
                reasons=("size_bytes", "coordinate_count"),
            ),
        )

    def test_projector_base_is_explicit_opt_out(self):
        decision = decide_pmtiles(
            pack_id="projector_base",
            layer_id="sea",
            geometry_type="Polygon",
            style_config={},
            stats=LayerStats(
                size_bytes=5_000_000,
                feature_count=10,
                coordinate_count=80_000,
                property_bytes=0,
                geometry_family="polygon",
            ),
        )

        self.assertEqual(
            decision,
            PmtilesDecision(
                use_pmtiles=False,
                preset=None,
                reasons=("projector_base_opt_out",),
            ),
        )

    def test_label_only_point_layer_is_explicit_opt_out(self):
        decision = decide_pmtiles(
            pack_id="greens",
            layer_id="settlement_labels",
            geometry_type="Point",
            style_config={"labels": {"field": "name"}},
            stats=LayerStats(
                size_bytes=2_000_000,
                feature_count=200,
                coordinate_count=200,
                property_bytes=1000,
                geometry_family="point",
            ),
        )

        self.assertEqual(
            decision,
            PmtilesDecision(
                use_pmtiles=False,
                preset=None,
                reasons=("label_point_opt_out",),
            ),
        )

    def test_label_only_point_layer_ignores_empty_parser_style_shapes(self):
        decision = decide_pmtiles(
            pack_id="greens",
            layer_id="settlement_labels",
            geometry_type="Point",
            style_config={
                "labels": {"field": "name"},
                "defaultSymbol": {"symbolLayers": []},
                "defaultStyle": {},
                "style": {},
                "uniqueValues": {"classes": []},
            },
            stats=LayerStats(
                size_bytes=2_000_000,
                feature_count=6_000,
                coordinate_count=6_000,
                property_bytes=1000,
                geometry_family="point",
            ),
        )

        self.assertEqual(
            decision,
            PmtilesDecision(
                use_pmtiles=False,
                preset=None,
                reasons=("label_point_opt_out",),
            ),
        )

    def test_point_layer_with_labels_and_render_symbol_is_not_label_only_opt_out(self):
        decision = decide_pmtiles(
            pack_id="greens",
            layer_id="settlements",
            geometry_type="Point",
            style_config={
                "labels": {"field": "name"},
                "defaultSymbol": {
                    "symbolLayers": [
                        {"type": "markerPoint"},
                    ]
                },
            },
            stats=LayerStats(
                size_bytes=400_000,
                feature_count=5_500,
                coordinate_count=5_500,
                property_bytes=1000,
                geometry_family="point",
            ),
        )

        self.assertEqual(
            decision,
            PmtilesDecision(
                use_pmtiles=True,
                preset="points_thin",
                reasons=("advanced_style", "feature_count"),
            ),
        )

    def test_large_floodplain_polygon_uses_large_polygon_preset(self):
        decision = decide_pmtiles(
            pack_id="greens",
            layer_id="floodplains_layer",
            geometry_type="Polygon",
            style_config={},
            stats=LayerStats(
                size_bytes=2_400_000,
                feature_count=120,
                coordinate_count=95_000,
                property_bytes=0,
                geometry_family="polygon",
            ),
        )

        self.assertTrue(decision.use_pmtiles)
        self.assertEqual(decision.preset, "large_polygons")
        self.assertIn("coordinate_count", decision.reasons)

    def test_advanced_style_below_thresholds_still_uses_pmtiles(self):
        decision = decide_pmtiles(
            pack_id="greens",
            layer_id="styled_line_layer",
            geometry_type="LineString",
            style_config={
                "defaultSymbol": {
                    "symbolLayers": [
                        {"type": "stroke"},
                        {"type": "stroke", "dash": {"array": [4, 2]}},
                    ]
                }
            },
            stats=LayerStats(
                size_bytes=400_000,
                feature_count=100,
                coordinate_count=4000,
                property_bytes=0,
                geometry_family="line",
            ),
        )

        self.assertEqual(
            decision,
            PmtilesDecision(
                use_pmtiles=True,
                preset="roads_paths_rivers",
                reasons=("advanced_style",),
            ),
        )

    def test_line_layers_do_not_infer_critical_boundaries_from_name(self):
        decision = decide_pmtiles(
            pack_id="greens",
            layer_id="admin_boundary_lines",
            geometry_type="LineString",
            style_config={},
            stats=LayerStats(
                size_bytes=2_000_000,
                feature_count=50,
                coordinate_count=12_000,
                property_bytes=0,
                geometry_family="line",
            ),
        )

        self.assertEqual(
            decision,
            PmtilesDecision(
                use_pmtiles=True,
                preset="roads_paths_rivers",
                reasons=("size_bytes",),
            ),
        )

    def test_advanced_unique_values_style_triggers_pmtiles_for_line_layers(self):
        decision = decide_pmtiles(
            pack_id="greens",
            layer_id="classed_line_layer",
            geometry_type="LineString",
            style_config={
                "uniqueValues": {
                    "classes": [
                        {
                            "symbol": {
                                "symbolLayers": [
                                    {"type": "stroke"},
                                    {"type": "stroke", "dash": {"array": [4, 2]}},
                                ]
                            }
                        }
                    ]
                }
            },
            stats=LayerStats(
                size_bytes=400_000,
                feature_count=100,
                coordinate_count=4000,
                property_bytes=0,
                geometry_family="line",
            ),
        )

        self.assertEqual(
            decision,
            PmtilesDecision(
                use_pmtiles=True,
                preset="roads_paths_rivers",
                reasons=("advanced_style",),
            ),
        )

    def test_mixed_geometry_does_not_recommend_pmtiles_without_supported_preset(self):
        decision = decide_pmtiles(
            pack_id="greens",
            layer_id="mixed_layer",
            geometry_type="GeometryCollection",
            style_config={},
            stats=LayerStats(
                size_bytes=12_000_000,
                feature_count=8_000,
                coordinate_count=120_000,
                property_bytes=0,
                geometry_family="mixed",
            ),
        )

        self.assertEqual(
            decision,
            PmtilesDecision(
                use_pmtiles=False,
                preset=None,
                reasons=(),
            ),
        )
