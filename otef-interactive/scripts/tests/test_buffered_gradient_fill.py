import copy
import json
import shutil
import tempfile
import unittest
from unittest.mock import patch
from pathlib import Path

from pyproj import Transformer
from shapely.geometry import Polygon, shape
from shapely.ops import transform

from otef_layer_processing.buffered_gradient import (
    build_buffered_gradient_feature_collection,
    _round_coordinates,
    write_buffered_gradient_geojson,
)
import otef_layer_processing.orchestrator as orchestrator_module
from otef_layer_processing.orchestrator import (
    ProcessingOrchestrator,
    _commit_buffered_gradient_transaction,
)
from otef_layer_processing.styles import extract_simplified_style, parse_lyrx_style
from otef_layer_processing.styles import UnsupportedCimGradientFillError


def _rgb(values):
    return {
        "type": "CIMRGBColor",
        "colorSpace": {"type": "CIMICCColorSpace", "url": "Default RGB"},
        "values": [*values, 100],
    }


def _multipart_ramp(stops, weights):
    return {
        "type": "CIMMultipartColorRamp",
        "colorSpace": {"type": "CIMICCColorSpace", "url": "Default RGB"},
        "colorRamps": [
            {
                "type": "CIMLinearContinuousColorRamp",
                "colorSpace": {"type": "CIMICCColorSpace", "url": "Default RGB"},
                "fromColor": _rgb(start),
                "toColor": _rgb(end),
            }
            for start, end in zip(stops, stops[1:])
        ],
        "weights": weights,
    }


def _gradient_fill(stops, weights, interval):
    return {
        "type": "CIMGradientFill",
        "enable": True,
        "angle": 90,
        "colorRamp": _multipart_ramp(stops, weights),
        "gradientMethod": "Buffered",
        "gradientSize": 75,
        "gradientSizeUnits": "Relative",
        "gradientType": "Discrete",
        "interval": interval,
    }


def _polygon_symbol(layers):
    return {
        "type": "CIMSymbolReference",
        "symbol": {
            "type": "CIMPolygonSymbol",
            "symbolLayers": layers,
            "angleAlignment": "Map",
        },
    }


def _stroke(enabled, color=(110, 110, 110), width=0.7):
    return {
        "type": "CIMSolidStroke",
        "enable": enabled,
        "capStyle": "Round",
        "joinStyle": "Round",
        "lineStyle3D": "Strip",
        "miterLimit": 10,
        "width": width,
        "color": _rgb(color),
    }


# The three class symbols are a focused copy of the authored polygon.lyrx structures.
BATTLE_STOPS = [
    (103, 0, 13),
    (165, 15, 21),
    (203, 24, 29),
    (239, 59, 44),
    (251, 106, 74),
    (252, 146, 114),
    (252, 187, 161),
    (254, 224, 210),
]
BATTLE_WEIGHTS = [
    0.1326961547010447,
    0.1326961547010447,
    0.13269615470104476,
    0.13269615470104468,
    0.13269615470104468,
    0.13269615470104468,
    0.20382307179373185,
]
FIRE_STOPS = [
    (102, 76, 40),
    (121, 85, 35),
    (141, 95, 30),
    (160, 104, 25),
    (179, 113, 20),
    (198, 122, 15),
    (217, 131, 10),
    (236, 140, 5),
    (255, 149, 0),
    (255, 174, 0),
    (255, 198, 0),
    (255, 222, 0),
]
FIRE_WEIGHTS = [
    0.0909090909090909,
    0.0909090909090909,
    0.09090909090909091,
    0.09090909090909088,
    0.09090909090909088,
    0.09090909090909088,
    0.09090909090909088,
    0.09090909090909095,
    0.09090909090909095,
    0.09090909090909095,
    0.09090909090909095,
]


def buffered_gradient_polygon_lyrx():
    classes = [
        {
            "type": "CIMUniqueValueClass",
            "label": "מרחב לחימה - קרב",
            "symbol": _polygon_symbol(
                [_stroke(False), _gradient_fill(BATTLE_STOPS, BATTLE_WEIGHTS, 6)]
            ),
            "values": [{"type": "CIMUniqueValue", "fieldValues": ["מרחב לחימה - קרב"]}],
            "visible": True,
        },
        {
            "type": "CIMUniqueValueClass",
            "label": "שריפה",
            "symbol": _polygon_symbol(
                [_stroke(True), _gradient_fill(FIRE_STOPS, FIRE_WEIGHTS, 5)]
            ),
            "values": [{"type": "CIMUniqueValue", "fieldValues": ["שריפה"]}],
            "visible": True,
        },
        {
            "type": "CIMUniqueValueClass",
            "label": "מוקד חטיפה",
            "symbol": _polygon_symbol(
                [_stroke(False, color=(255, 255, 190), width=2), {
                    "type": "CIMSolidFill",
                    "enable": True,
                    "color": _rgb((255, 255, 115)),
                }]
            ),
            "values": [{"type": "CIMUniqueValue", "fieldValues": ["מוקד חטיפה"]}],
            "visible": True,
        },
    ]
    return {
        "layerDefinitions": [
            {
                "type": "CIMFeatureLayer",
                "renderer": {
                    "type": "CIMUniqueValueRenderer",
                    "defaultSymbol": _polygon_symbol([_stroke(True)]),
                    "fields": ["Notes"],
                    "groups": [{"type": "CIMUniqueValueGroup", "heading": "Notes", "classes": classes}],
                    "useDefaultSymbol": True,
                    "isDefaultSymbolVisible": False,
                },
            }
        ]
    }


class BufferedGradientFillTests(unittest.TestCase):
    def _parse(self, payload):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "polygon.lyrx"
            path.write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")
            return parse_lyrx_style(path)

    def test_buffered_classes_preserve_gradient_fields_and_resolve_bands(self):
        data = self._parse(buffered_gradient_polygon_lyrx()).to_dict()

        self.assertEqual(data["renderer"], "uniqueValue")
        self.assertEqual(data["uniqueValues"]["field"], "Notes")
        self.assertTrue(data["useDefaultSymbol"])
        self.assertFalse(data["isDefaultSymbolVisible"])

        classes = data["uniqueValues"]["classes"]
        self.assertEqual(
            [item["displayLabel"] for item in classes],
            ["מוקד קרב/טבח", "מוקד שריפה", "מוקד חטיפה"],
        )
        self.assertEqual([item["value"] for item in classes], [
            "מרחב לחימה - קרב", "שריפה", "מוקד חטיפה"
        ])

        battle_gradient = classes[0]["symbol"]["symbolLayers"][0]
        self.assertEqual(battle_gradient["type"], "fill")
        self.assertEqual(battle_gradient["fillType"], "gradient")
        self.assertEqual(battle_gradient["gradientMethod"], "Buffered")
        self.assertEqual(battle_gradient["gradientType"], "Discrete")
        self.assertEqual(battle_gradient["gradientSize"], 75)
        self.assertEqual(battle_gradient["gradientSizeUnits"], "Relative")
        self.assertEqual(battle_gradient["interval"], 6)
        self.assertEqual(battle_gradient["opacity"], 1.0)
        self.assertTrue(battle_gradient["enable"])
        self.assertEqual(
            battle_gradient["resolvedColors"],
            ["#8e0912", "#c7171c", "#f14230", "#fb7a5a", "#fcad91", "#fdd1be"],
        )
        self.assertEqual(battle_gradient["resolvedColors"][0], "#8e0912")
        self.assertEqual(battle_gradient["resolvedColors"][-1], "#fdd1be")
        self.assertEqual(len(battle_gradient["colorRamp"]["colorRamps"]), 7)
        self.assertEqual(battle_gradient["colorRamp"]["weights"], BATTLE_WEIGHTS)

        fire_gradient = classes[1]["symbol"]["symbolLayers"][1]
        self.assertEqual(fire_gradient["interval"], 5)
        self.assertEqual(
            fire_gradient["resolvedColors"],
            ["#7b5622", "#a66b18", "#d07e0c", "#f99201", "#ffc400"],
        )
        self.assertEqual(fire_gradient["resolvedColors"][0], "#7b5622")
        self.assertEqual(fire_gradient["resolvedColors"][-1], "#ffc400")
        self.assertEqual(len(fire_gradient["colorRamp"]["colorRamps"]), 11)
        self.assertEqual(fire_gradient["colorRamp"]["weights"], FIRE_WEIGHTS)
        fire_stroke = classes[1]["symbol"]["symbolLayers"][0]
        self.assertEqual(fire_stroke["type"], "stroke")
        self.assertEqual(fire_stroke["width"], 1.0)
        self.assertEqual(fire_stroke["lineCap"], "round")
        self.assertEqual(fire_stroke["lineJoin"], "round")
        self.assertEqual(fire_stroke["miterLimit"], 10)

        kidnapping_fill = classes[2]["symbol"]["symbolLayers"][0]
        self.assertEqual(kidnapping_fill["color"], "#ffff73")
        self.assertNotIn("#808080", json.dumps(classes))

    def test_unrelated_unique_value_class_has_no_investigation_display_label_override(self):
        payload = buffered_gradient_polygon_lyrx()
        unrelated = payload["layerDefinitions"][0]["renderer"]["groups"][0]["classes"][0]
        unrelated["label"] = unrelated["values"][0]["fieldValues"][0] = "Other"

        data = self._parse(payload).to_dict()
        self.assertNotIn("displayLabel", data["uniqueValues"]["classes"][0])

    def test_unrelated_enabled_stroke_keeps_subpixel_css_conversion(self):
        style = extract_simplified_style([_stroke(True, width=0.5)])
        self.assertAlmostEqual(style["strokeWidth"], 0.5 * 96 / 72)

    def test_unsupported_enabled_gradient_fails_before_gray_fallback(self):
        payload = buffered_gradient_polygon_lyrx()
        payload["layerDefinitions"][0]["renderer"]["groups"][0]["classes"][0]["symbol"]["symbol"]["symbolLayers"][1]["gradientMethod"] = "AlongLine"

        with self.assertRaises(UnsupportedCimGradientFillError) as raised:
            self._parse(payload)
        self.assertNotIn("#808080", str(raised.exception))
        self.assertNotIn("#c31f4f", str(raised.exception))

    def test_non_rgb_gradient_endpoint_is_rejected(self):
        payload = buffered_gradient_polygon_lyrx()
        endpoint = payload["layerDefinitions"][0]["renderer"]["groups"][0]["classes"][0]["symbol"]["symbol"]["symbolLayers"][1]["colorRamp"]["colorRamps"][0]["fromColor"]
        endpoint["type"] = "CIMHSVColor"

        with self.assertRaises(UnsupportedCimGradientFillError):
            self._parse(payload)

    def test_non_default_multipart_ramp_color_space_is_rejected(self):
        payload = buffered_gradient_polygon_lyrx()
        ramp = payload["layerDefinitions"][0]["renderer"]["groups"][0]["classes"][0]["symbol"]["symbol"]["symbolLayers"][1]["colorRamp"]
        ramp["colorSpace"]["url"] = "Display P3"

        with self.assertRaises(UnsupportedCimGradientFillError):
            self._parse(payload)

    def test_non_default_linear_segment_color_space_is_rejected(self):
        payload = buffered_gradient_polygon_lyrx()
        segment = payload["layerDefinitions"][0]["renderer"]["groups"][0]["classes"][0]["symbol"]["symbol"]["symbolLayers"][1]["colorRamp"]["colorRamps"][0]
        segment["colorSpace"]["url"] = "Display P3"

        with self.assertRaises(UnsupportedCimGradientFillError):
            self._parse(payload)


class BufferedGradientBandTests(unittest.TestCase):
    COLORS = ["#8e0912", "#c7171c", "#f14230", "#fb7a5a"]

    @classmethod
    def _style(cls, value="battle", interval=4):
        return {
            "renderer": "uniqueValue",
            "uniqueValues": {
                "field": "Notes",
                "classes": [
                    {
                        "value": value,
                        "symbol": {
                            "symbolLayers": [
                                {
                                    "type": "fill",
                                    "fillType": "gradient",
                                    "gradientMethod": "Buffered",
                                    "gradientType": "Discrete",
                                    "gradientSize": 75,
                                    "gradientSizeUnits": "Relative",
                                    "interval": interval,
                                    "resolvedColors": cls.COLORS[:interval],
                                }
                            ]
                        },
                    }
                ],
            },
        }

    @classmethod
    def _actual_gradient_style(cls):
        style = cls._style(value="מרחב לחימה - קרב", interval=4)
        style["uniqueValues"]["classes"].append(
            {
                "value": "שריפה",
                "symbol": {
                    "symbolLayers": [
                        {
                            "type": "fill",
                            "fillType": "gradient",
                            "gradientMethod": "Buffered",
                            "gradientType": "Discrete",
                            "gradientSize": 75,
                            "gradientSizeUnits": "Relative",
                            "interval": 4,
                            "resolvedColors": ["#7b5622", "#a66b18", "#d07e0c", "#f99201"],
                        }
                    ]
                },
            }
        )
        return style

    @staticmethod
    def _source(geometry, *, object_id=17, value="battle"):
        to_wgs84 = Transformer.from_crs("EPSG:2039", "EPSG:4326", always_xy=True).transform
        geometry = transform(to_wgs84, geometry)
        return {
            "type": "FeatureCollection",
            "features": [
                {
                    "type": "Feature",
                    "id": object_id,
                    "properties": {"Notes": value, "keep": "yes", "OBJECTID": object_id},
                    "geometry": geometry.__geo_interface__,
                }
            ],
        }

    def _bands(self, source, *, interval=4):
        result = build_buffered_gradient_feature_collection(
            source,
            self._style(interval=interval),
        )
        return result["features"]

    def test_rectangle_produces_nested_bands_with_stable_ordinals(self):
        features = self._bands(self._source(Polygon([(160000, 700000), (160100, 700000), (160100, 700060), (160000, 700060)])))

        self.assertEqual([f["properties"]["__cim_gradient_band"] for f in features], [0, 1, 2, 3])
        self.assertTrue(all(shape(f["geometry"]).is_valid for f in features))
        self.assertTrue(all(f["properties"]["__cim_source_object_id"] == 17 for f in features))
        self.assertTrue(all(f["properties"]["keep"] == "yes" for f in features))
        cumulative = None
        for feature in features:
            cumulative = shape(feature["geometry"]) if cumulative is None else cumulative.union(shape(feature["geometry"]))
            self.assertTrue(cumulative.is_valid)
        self.assertGreater(cumulative.area, 0)

    def test_concave_polygon_keeps_valid_nested_coverage(self):
        geometry = Polygon([(160000, 700000), (160100, 700000), (160100, 700100), (160060, 700100), (160060, 700035), (160000, 700035)])
        features = self._bands(self._source(geometry))

        self.assertEqual([f["properties"]["__cim_gradient_band"] for f in features], [0, 1, 2, 3])
        self.assertTrue(all(shape(f["geometry"]).is_valid for f in features))

    def test_polygon_with_hole_preserves_hole_in_outer_band(self):
        geometry = Polygon(
            [(160000, 700000), (160100, 700000), (160100, 700100), (160000, 700100)],
            [[(160035, 700035), (160065, 700035), (160065, 700065), (160035, 700065)]],
        )
        features = self._bands(self._source(geometry))

        outer = shape(features[0]["geometry"])
        polygons = list(outer.geoms) if outer.geom_type == "MultiPolygon" else [outer]
        self.assertGreaterEqual(sum(len(part.interiors) for part in polygons), 1)
        self.assertTrue(all(shape(f["geometry"]).is_valid for f in features))

    def test_multipart_polygon_keeps_components_in_each_ordinal(self):
        geometry = {
            "type": "MultiPolygon",
            "coordinates": [
                [[(160000, 700000), (160040, 700000), (160040, 700040), (160000, 700040), (160000, 700000)]],
                [[(160100, 700000), (160140, 700000), (160140, 700040), (160100, 700040), (160100, 700000)]],
            ],
        }
        features = self._bands(self._source(shape(geometry)))

        self.assertEqual(len(features), 4)
        self.assertTrue(all(shape(f["geometry"]).geom_type in ("Polygon", "MultiPolygon") for f in features))
        self.assertEqual([shape(f["geometry"]).geom_type for f in features[:1]], ["MultiPolygon"])

    def test_narrow_polygon_emits_final_original_when_depth_collapses(self):
        geometry = Polygon([(160000, 700000), (160100, 700000), (160100, 700000.02), (160000, 700000.02)])
        features = self._bands(self._source(geometry), interval=4)

        self.assertEqual([f["properties"]["__cim_gradient_band"] for f in features], [3])
        self.assertTrue(shape(features[0]["geometry"]).is_valid)
        self._assert_wgs84_coordinates(features[0]["geometry"]["coordinates"])

    def test_representative_nli_polygons_are_deterministic_and_rounded(self):
        source_path = Path(__file__).parents[2] / "public/source/layers/nli/gis/investigation_polygons.geojson"
        source = json.loads(source_path.read_text(encoding="utf-8"))
        selected = {1, 24}
        source["features"] = [feature for feature in source["features"] if feature.get("id") in selected]

        first = build_buffered_gradient_feature_collection(source, self._actual_gradient_style())
        second = build_buffered_gradient_feature_collection(source, self._actual_gradient_style())

        self.assertEqual(first, second)
        self.assertEqual(len(first["features"]), 8)
        self.assertEqual(
            [feature["properties"]["__cim_source_object_id"] for feature in first["features"]],
            [1, 1, 1, 1, 24, 24, 24, 24],
        )
        self.assertEqual(
            [feature["properties"]["__cim_gradient_band"] for feature in first["features"]],
            [0, 1, 2, 3, 0, 1, 2, 3],
        )
        for feature in first["features"]:
            self.assertTrue(shape(feature["geometry"]).is_valid)
            self._assert_wgs84_coordinates(feature["geometry"]["coordinates"])

    @staticmethod
    def _assert_wgs84_coordinates(coordinates):
        if coordinates and isinstance(coordinates[0], (int, float)):
            longitude, latitude = coordinates
            assert -180 <= longitude <= 180
            assert -90 <= latitude <= 90
            assert round(longitude, 7) == longitude
            assert round(latitude, 7) == latitude
            return
        for child in coordinates:
            BufferedGradientBandTests._assert_wgs84_coordinates(child)

    def test_cumulative_inner_polygons_are_covered_with_exact_area_tolerance(self):
        source = self._source(Polygon([(160000, 700000), (160100, 700000), (160100, 700060), (160000, 700060)]))
        result = build_buffered_gradient_feature_collection(source, self._style())
        rounded_source_geojson = {
            "type": "Polygon",
            "coordinates": _round_coordinates(source["features"][0]["geometry"]["coordinates"]),
        }
        projected = transform(Transformer.from_crs("EPSG:4326", "EPSG:2039", always_xy=True).transform, shape(rounded_source_geojson))
        output = [shape(feature["geometry"]) for feature in result["features"]]
        output = [transform(Transformer.from_crs("EPSG:4326", "EPSG:2039", always_xy=True).transform, geometry) for geometry in output]
        tolerance = max(0.01, projected.area * 1e-8)

        self.assertLessEqual(projected.difference(output[0]).area, tolerance)
        for outer, inner in zip(output, output[1:]):
            self.assertLessEqual(inner.difference(outer).area, tolerance)

    def test_invalid_geometry_is_repaired_to_polygonal_output_only(self):
        invalid = Polygon([(160000, 700000), (160100, 700060), (160000, 700060), (160100, 700000)])
        result = build_buffered_gradient_feature_collection(self._source(invalid), self._style())

        self.assertTrue(result["features"])
        self.assertTrue(all(shape(feature["geometry"]).geom_type in ("Polygon", "MultiPolygon") for feature in result["features"]))
        self.assertTrue(all(shape(feature["geometry"]).is_valid for feature in result["features"]))

    def test_sidecar_generation_failure_leaves_prior_output(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source_path = root / "source.geojson"
            output_path = root / "derived.geojson"
            source = self._source(Polygon([(160000, 700000), (160040, 700000), (160040, 700040), (160000, 700040)]))
            source["features"][0]["geometry"] = {
                "type": "Polygon",
                "coordinates": "malformed",
            }
            source_path.write_text(json.dumps(source), encoding="utf-8")
            output_path.write_text("prior-good-file", encoding="utf-8")

            with self.assertRaises(Exception):
                write_buffered_gradient_geojson(source_path, self._style(), output_path)
            self.assertEqual(output_path.read_text(encoding="utf-8"), "prior-good-file")

    def test_orchestrator_publishes_buffered_gradient_resource_after_sidecar(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source = root / "source"
            source_gis = source / "source" / "layers" / "nli" / "gis"
            source_styles = source / "source" / "layers" / "nli" / "styles"
            output = root / "processed" / "layers" / "nli"
            source_gis.mkdir(parents=True)
            source_styles.mkdir(parents=True)
            source_geo = self._source(
                Polygon([(160000, 700000), (160100, 700000), (160100, 700060), (160000, 700060)])
            )
            (source_gis / "investigation_polygons.geojson").write_text(
                json.dumps(source_geo), encoding="utf-8"
            )
            (source_styles / "investigation_polygons.lyrx").write_text(
                json.dumps(buffered_gradient_polygon_lyrx(), ensure_ascii=False), encoding="utf-8"
            )
            orchestrator = ProcessingOrchestrator(source, output, no_cache=True, max_workers=1)
            task = {
                "pack_id": "nli",
                "geo_file": source_gis / "investigation_polygons.geojson",
                "styles_dir": source_styles,
                "pack_output": output,
            }

            layer_entry, _, _, cache_value = orchestrator.process_single_layer(task, 30)
            sidecar_name = "investigation_polygons.buffered-gradient.geojson"
            self.assertTrue((output / sidecar_name).is_file())
            declaration = layer_entry.to_dict()["resources"]["bufferedGradient"]
            self.assertEqual(declaration["file"], sidecar_name)
            self.assertEqual(declaration["format"], "geojson")
            self.assertEqual(cache_value["resources"], layer_entry.to_dict()["resources"])

    def test_orchestrator_cache_misses_when_declared_sidecar_is_missing(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source = root / "source"
            source_gis = source / "source" / "layers" / "nli" / "gis"
            source_styles = source / "source" / "layers" / "nli" / "styles"
            output = root / "processed" / "layers" / "nli"
            source_gis.mkdir(parents=True)
            source_styles.mkdir(parents=True)
            source_geo = self._source(
                Polygon([(160000, 700000), (160100, 700000), (160100, 700060), (160000, 700060)])
            )
            (source_gis / "investigation_polygons.geojson").write_text(
                json.dumps(source_geo), encoding="utf-8"
            )
            (source_styles / "investigation_polygons.lyrx").write_text(
                json.dumps(buffered_gradient_polygon_lyrx(), ensure_ascii=False), encoding="utf-8"
            )
            orchestrator = ProcessingOrchestrator(source, output, no_cache=False, max_workers=1)
            task = {
                "pack_id": "nli",
                "geo_file": source_gis / "investigation_polygons.geojson",
                "styles_dir": source_styles,
                "pack_output": output,
            }
            first = orchestrator.process_single_layer(task, 30)
            self.assertIsNotNone(first)
            orchestrator.cache[first[2]] = first[3]
            sidecar = output / "investigation_polygons.buffered-gradient.geojson"
            sidecar.unlink()

            second = orchestrator.process_single_layer(task, 30)
            self.assertIsNotNone(second)
            self.assertTrue(sidecar.is_file())

    def test_full_processing_manifest_contains_sidecar_resource(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source = root / "source"
            source_gis = source / "source" / "layers" / "nli" / "gis"
            source_styles = source / "source" / "layers" / "nli" / "styles"
            output_root = root / "processed" / "layers"
            source_gis.mkdir(parents=True)
            source_styles.mkdir(parents=True)
            (source_gis / "investigation_polygons.geojson").write_text(
                json.dumps(self._source(
                    Polygon([(160000, 700000), (160100, 700000), (160100, 700060), (160000, 700060)])
                )), encoding="utf-8"
            )
            (source_styles / "investigation_polygons.lyrx").write_text(
                json.dumps(buffered_gradient_polygon_lyrx(), ensure_ascii=False), encoding="utf-8"
            )

            ProcessingOrchestrator(source, output_root, no_cache=True, max_workers=1).process_all()

            manifest = json.loads((output_root / "nli" / "manifest.json").read_text(encoding="utf-8"))
            layer = next(item for item in manifest["layers"] if item["id"] == "investigation_polygons")
            self.assertEqual(
                layer["resources"]["bufferedGradient"]["file"],
                "investigation_polygons.buffered-gradient.geojson",
            )
            ProcessingOrchestrator(source, output_root, no_cache=False, max_workers=1).update_metadata_only()
            refreshed = json.loads((output_root / "nli" / "manifest.json").read_text(encoding="utf-8"))
            refreshed_layer = next(item for item in refreshed["layers"] if item["id"] == "investigation_polygons")
            self.assertEqual(
                refreshed_layer["resources"]["bufferedGradient"]["file"],
                "investigation_polygons.buffered-gradient.geojson",
            )

    def test_full_processing_failure_preserves_prior_manifest_and_styles(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source = root / "source"
            source_gis = source / "source" / "layers" / "nli" / "gis"
            source_styles = source / "source" / "layers" / "nli" / "styles"
            output_root = root / "processed" / "layers"
            output = output_root / "nli"
            source_gis.mkdir(parents=True)
            source_styles.mkdir(parents=True)
            source_geo = self._source(
                Polygon([(160000, 700000), (160100, 700000), (160100, 700060), (160000, 700060)])
            )
            (source_gis / "investigation_polygons.geojson").write_text(json.dumps(source_geo), encoding="utf-8")
            invalid_style = buffered_gradient_polygon_lyrx()
            invalid_style["layerDefinitions"][0]["renderer"]["groups"][0]["classes"][0]["symbol"]["symbol"]["symbolLayers"][1]["gradientMethod"] = "AlongLine"
            (source_styles / "investigation_polygons.lyrx").write_text(
                json.dumps(invalid_style, ensure_ascii=False), encoding="utf-8"
            )
            output.mkdir(parents=True)
            prior_manifest = {
                "id": "nli",
                "name": "Nli",
                "layers": [{
                    "id": "investigation_polygons",
                    "name": "investigation_polygons",
                    "file": "investigation_polygons.geojson",
                    "resources": {"bufferedGradient": {"file": "investigation_polygons.buffered-gradient.geojson", "format": "geojson"}},
                    "pmtilesFile": "investigation_polygons.pmtiles",
                }],
            }
            prior_styles = {"investigation_polygons": {"renderer": "uniqueValue", "sentinel": "prior"}}
            (output / "manifest.json").write_text(json.dumps(prior_manifest), encoding="utf-8")
            (output / "styles.json").write_text(json.dumps(prior_styles), encoding="utf-8")

            ProcessingOrchestrator(source, output_root, no_cache=True, max_workers=1).process_all()

            self.assertEqual(json.loads((output / "manifest.json").read_text(encoding="utf-8")), prior_manifest)
            self.assertEqual(json.loads((output / "styles.json").read_text(encoding="utf-8")), prior_styles)

    def test_buffered_gradient_publish_rolls_back_on_each_replacement_failure(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            for failed_name in ("data.geojson", "sidecar.geojson", "layer.pmtiles"):
                case = root / failed_name.replace(".", "-")
                case.mkdir()
                staged_data = case / "staged-data"
                staged_sidecar = case / "staged-sidecar"
                staged_pmtiles = case / "staged-pmtiles"
                final_data = case / "data.geojson"
                final_sidecar = case / "sidecar.geojson"
                final_pmtiles = case / "layer.pmtiles"
                staged_data.write_text("new-data", encoding="utf-8")
                staged_sidecar.write_text("new-sidecar", encoding="utf-8")
                staged_pmtiles.write_text("new-pmtiles", encoding="utf-8")
                final_data.write_text("old-data", encoding="utf-8")
                final_sidecar.write_text("old-sidecar", encoding="utf-8")
                final_pmtiles.write_text("old-pmtiles", encoding="utf-8")
                real_replace = orchestrator_module._replace_transaction_file
                failed = False

                def fail_once(source_path, destination_path, *, target=case / failed_name):
                    nonlocal failed
                    if Path(destination_path) == target and not failed:
                        failed = True
                        raise OSError("injected publish failure")
                    return real_replace(source_path, destination_path)

                with patch.object(orchestrator_module, "_replace_transaction_file", side_effect=fail_once):
                    with self.assertRaises(OSError):
                        _commit_buffered_gradient_transaction(
                            staged_data,
                            staged_sidecar,
                            staged_pmtiles,
                            final_data,
                            final_sidecar,
                            final_pmtiles,
                        )
                self.assertEqual(final_data.read_text(encoding="utf-8"), "old-data")
                self.assertEqual(final_sidecar.read_text(encoding="utf-8"), "old-sidecar")
                self.assertEqual(final_pmtiles.read_text(encoding="utf-8"), "old-pmtiles")

    def test_buffered_gradient_backup_failure_preserves_all_prior_artifacts(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            for failed_backup_index in range(3):
                case = root / f"backup-{failed_backup_index}"
                case.mkdir()
                staged_data = case / "staged-data"
                staged_sidecar = case / "staged-sidecar"
                staged_pmtiles = case / "staged-pmtiles"
                final_data = case / "data.geojson"
                final_sidecar = case / "sidecar.geojson"
                final_pmtiles = case / "layer.pmtiles"
                staged_data.write_text("new-data", encoding="utf-8")
                staged_sidecar.write_text("new-sidecar", encoding="utf-8")
                staged_pmtiles.write_text("new-pmtiles", encoding="utf-8")
                final_data.write_text("old-data", encoding="utf-8")
                final_sidecar.write_text("old-sidecar", encoding="utf-8")
                final_pmtiles.write_text("old-pmtiles", encoding="utf-8")
                copy_calls = 0
                real_copy2 = shutil.copy2

                def fail_backup(source_path, destination_path):
                    nonlocal copy_calls
                    if Path(source_path).parent == case:
                        if copy_calls == failed_backup_index:
                            raise OSError("injected backup failure")
                        copy_calls += 1
                    return real_copy2(source_path, destination_path)

                with patch.object(orchestrator_module.shutil, "copy2", side_effect=fail_backup):
                    with self.assertRaises(OSError):
                        _commit_buffered_gradient_transaction(
                            staged_data,
                            staged_sidecar,
                            staged_pmtiles,
                            final_data,
                            final_sidecar,
                            final_pmtiles,
                        )
                self.assertEqual(final_data.read_text(encoding="utf-8"), "old-data")
                self.assertEqual(final_sidecar.read_text(encoding="utf-8"), "old-sidecar")
                self.assertEqual(final_pmtiles.read_text(encoding="utf-8"), "old-pmtiles")

    def test_buffered_gradient_success_removes_stale_pmtiles(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source = root / "source"
            source_gis = source / "source" / "layers" / "nli" / "gis"
            source_styles = source / "source" / "layers" / "nli" / "styles"
            output = root / "processed" / "layers" / "nli"
            source_gis.mkdir(parents=True)
            source_styles.mkdir(parents=True)
            (source_gis / "investigation_polygons.geojson").write_text(
                json.dumps(self._source(Polygon([(160000, 700000), (160100, 700000), (160100, 700060), (160000, 700060)]))), encoding="utf-8"
            )
            (source_styles / "investigation_polygons.lyrx").write_text(
                json.dumps(buffered_gradient_polygon_lyrx(), ensure_ascii=False), encoding="utf-8"
            )
            output.mkdir(parents=True)
            stale_pmtiles = output / "investigation_polygons.pmtiles"
            stale_pmtiles.write_text("stale", encoding="utf-8")
            orchestrator = ProcessingOrchestrator(source, output.parent, no_cache=True, max_workers=1)
            task = {"pack_id": "nli", "geo_file": source_gis / "investigation_polygons.geojson", "styles_dir": source_styles, "pack_output": output}

            result = orchestrator.process_single_layer(task, 30)

            self.assertIsNotNone(result)
            self.assertFalse(stale_pmtiles.exists())
            self.assertIsNone(result[0].to_dict().get("pmtilesFile"))

    def test_orchestrator_sidecar_failure_preserves_data_style_and_pmtiles(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source = root / "source"
            source_gis = source / "source" / "layers" / "nli" / "gis"
            source_styles = source / "source" / "layers" / "nli" / "styles"
            output = root / "processed" / "layers" / "nli"
            source_gis.mkdir(parents=True)
            source_styles.mkdir(parents=True)
            source_geo = self._source(
                Polygon([(160000, 700000), (160100, 700000), (160100, 700060), (160000, 700060)])
            )
            (source_gis / "investigation_polygons.geojson").write_text(
                json.dumps(source_geo), encoding="utf-8"
            )
            (source_styles / "investigation_polygons.lyrx").write_text(
                json.dumps(buffered_gradient_polygon_lyrx(), ensure_ascii=False), encoding="utf-8"
            )
            output.mkdir(parents=True)
            data_path = output / "investigation_polygons.geojson"
            sidecar_path = output / "investigation_polygons.buffered-gradient.geojson"
            pmtiles_path = output / "investigation_polygons.pmtiles"
            data_path.write_text("prior-good-data", encoding="utf-8")
            sidecar_path.write_text("prior-good-sidecar", encoding="utf-8")
            pmtiles_path.write_bytes(b"prior-good-pmtiles")

            orchestrator = ProcessingOrchestrator(source, output.parent, no_cache=True, max_workers=1)
            task = {
                "pack_id": "nli",
                "geo_file": source_gis / "investigation_polygons.geojson",
                "styles_dir": source_styles,
                "pack_output": output,
            }
            with patch(
                "otef_layer_processing.orchestrator.write_buffered_gradient_geojson",
                side_effect=RuntimeError("sidecar failed"),
            ):
                self.assertIsNone(orchestrator.process_single_layer(task, 30))
            self.assertEqual(data_path.read_text(encoding="utf-8"), "prior-good-data")
            self.assertEqual(sidecar_path.read_text(encoding="utf-8"), "prior-good-sidecar")
            self.assertEqual(pmtiles_path.read_bytes(), b"prior-good-pmtiles")

    def test_unmatched_notes_are_omitted_from_hidden_default_sidecar(self):
        source = self._source(
            Polygon([(160000, 700000), (160100, 700000), (160100, 700060), (160000, 700060)]),
            value="Notes not in renderer",
        )
        result = build_buffered_gradient_feature_collection(source, self._actual_gradient_style())
        self.assertEqual(result["features"], [])

    def test_single_layer_metadata_failure_rolls_back_data_sidecar_and_cache(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source = root / "source"
            source_gis = source / "source" / "layers" / "nli" / "gis"
            source_styles = source / "source" / "layers" / "nli" / "styles"
            output = root / "processed" / "layers" / "nli"
            source_gis.mkdir(parents=True)
            source_styles.mkdir(parents=True)
            (source_gis / "investigation_polygons.geojson").write_text(json.dumps(self._source(
                Polygon([(160000, 700000), (160100, 700000), (160100, 700060), (160000, 700060)])
            )), encoding="utf-8")
            (source_styles / "investigation_polygons.lyrx").write_text(json.dumps(buffered_gradient_polygon_lyrx(), ensure_ascii=False), encoding="utf-8")
            output.mkdir(parents=True)
            (output / "investigation_polygons.geojson").write_text("prior-data", encoding="utf-8")
            (output / "investigation_polygons.buffered-gradient.geojson").write_text("prior-sidecar", encoding="utf-8")
            (output / "styles.json").write_text(json.dumps({"investigation_polygons": {"sentinel": "prior"}}), encoding="utf-8")
            (output / "manifest.json").write_text(json.dumps({"sentinel": "prior"}), encoding="utf-8")
            (output.parent / ".layer-cache.json").write_text(json.dumps({"sentinel": "prior"}), encoding="utf-8")
            orchestrator = ProcessingOrchestrator(source, output.parent, no_cache=False, max_workers=1)
            real_write = orchestrator._atomic_write_json
            def fail_style(path, data):
                if Path(path).name == "styles.json":
                    raise OSError("injected styles write failure")
                return real_write(path, data)
            with patch.object(orchestrator, "_atomic_write_json", side_effect=fail_style):
                with self.assertRaises(OSError):
                    orchestrator.process_single_layer_merged("nli", "investigation_polygons")
            self.assertEqual((output / "investigation_polygons.geojson").read_text(encoding="utf-8"), "prior-data")
            self.assertEqual((output / "investigation_polygons.buffered-gradient.geojson").read_text(encoding="utf-8"), "prior-sidecar")
            self.assertEqual(json.loads((output / "styles.json").read_text(encoding="utf-8")), {"investigation_polygons": {"sentinel": "prior"}})
            self.assertEqual(json.loads((output / "manifest.json").read_text(encoding="utf-8")), {"sentinel": "prior"})
            self.assertEqual(json.loads((output.parent / ".layer-cache.json").read_text(encoding="utf-8")), {"sentinel": "prior"})

    def test_single_layer_manifest_write_failure_rolls_back_after_style_publish(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source = root / "source"
            source_gis = source / "source" / "layers" / "nli" / "gis"
            source_styles = source / "source" / "layers" / "nli" / "styles"
            output = root / "processed" / "layers" / "nli"
            source_gis.mkdir(parents=True)
            source_styles.mkdir(parents=True)
            (source_gis / "investigation_polygons.geojson").write_text(json.dumps(self._source(
                Polygon([(160000, 700000), (160100, 700000), (160100, 700060), (160000, 700060)])
            )), encoding="utf-8")
            (source_styles / "investigation_polygons.lyrx").write_text(json.dumps(buffered_gradient_polygon_lyrx(), ensure_ascii=False), encoding="utf-8")
            output.mkdir(parents=True)
            (output / "investigation_polygons.geojson").write_text("prior-data", encoding="utf-8")
            (output / "investigation_polygons.buffered-gradient.geojson").write_text("prior-sidecar", encoding="utf-8")
            (output / "styles.json").write_text(json.dumps({"sentinel": "prior"}), encoding="utf-8")
            (output / "manifest.json").write_text(json.dumps({"sentinel": "prior"}), encoding="utf-8")
            orchestrator = ProcessingOrchestrator(source, output.parent, no_cache=True, max_workers=1)
            real_write = orchestrator._atomic_write_json
            def fail_manifest(path, data):
                if Path(path).name == "manifest.json":
                    raise OSError("injected manifest write failure")
                return real_write(path, data)
            with patch.object(orchestrator, "_atomic_write_json", side_effect=fail_manifest):
                with self.assertRaises(OSError):
                    orchestrator.process_single_layer_merged("nli", "investigation_polygons")
            self.assertEqual((output / "investigation_polygons.geojson").read_text(encoding="utf-8"), "prior-data")
            self.assertEqual((output / "investigation_polygons.buffered-gradient.geojson").read_text(encoding="utf-8"), "prior-sidecar")
            self.assertEqual(json.loads((output / "styles.json").read_text(encoding="utf-8")), {"sentinel": "prior"})
            self.assertEqual(json.loads((output / "manifest.json").read_text(encoding="utf-8")), {"sentinel": "prior"})

    def test_full_processing_sibling_failure_after_polygon_publish_rolls_back_pack(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source = root / "source"
            source_gis = source / "source" / "layers" / "nli" / "gis"
            source_styles = source / "source" / "layers" / "nli" / "styles"
            output_root = root / "processed" / "layers"
            source_gis.mkdir(parents=True)
            source_styles.mkdir(parents=True)
            for name, value in (("investigation_polygons", "מרחב לחימה - קרב"), ("sibling", "other")):
                (source_gis / f"{name}.geojson").write_text(json.dumps(self._source(
                    Polygon([(160000, 700000), (160100, 700000), (160100, 700060), (160000, 700060)]), value=value
                )), encoding="utf-8")
            (source_styles / "investigation_polygons.lyrx").write_text(json.dumps(buffered_gradient_polygon_lyrx(), ensure_ascii=False), encoding="utf-8")
            output = output_root / "nli"
            output.mkdir(parents=True)
            (output / "investigation_polygons.geojson").write_text("prior-data", encoding="utf-8")
            (output / "investigation_polygons.buffered-gradient.geojson").write_text("prior-sidecar", encoding="utf-8")
            (output / "manifest.json").write_text(json.dumps({"sentinel": "prior"}), encoding="utf-8")
            (output / "styles.json").write_text(json.dumps({"sentinel": "prior"}), encoding="utf-8")
            real_executor = orchestrator_module.ProcessPoolExecutor
            class ImmediateExecutor:
                def __init__(self, *args, **kwargs): self._executor = real_executor(max_workers=1)
                def __enter__(self): return self
                def __exit__(self, *args): return self._executor.__exit__(*args)
                def submit(self, fn, task, log_level):
                    if task["geo_file"].stem == "sibling":
                        from concurrent.futures import Future
                        future = Future(); future.set_exception(RuntimeError("injected sibling failure")); return future
                    return self._executor.submit(fn, task, log_level)
            with patch.object(orchestrator_module, "ProcessPoolExecutor", ImmediateExecutor):
                (output_root / ".layer-cache.json").write_text(json.dumps({"sentinel": "prior"}), encoding="utf-8")
                ProcessingOrchestrator(source, output_root, no_cache=False, max_workers=1).process_all()
            self.assertEqual((output / "investigation_polygons.geojson").read_text(encoding="utf-8"), "prior-data")
            self.assertEqual((output / "investigation_polygons.buffered-gradient.geojson").read_text(encoding="utf-8"), "prior-sidecar")
            self.assertEqual(json.loads((output / "manifest.json").read_text(encoding="utf-8")), {"sentinel": "prior"})
            self.assertEqual(json.loads((output / "styles.json").read_text(encoding="utf-8")), {"sentinel": "prior"})
            self.assertEqual(json.loads((output_root / ".layer-cache.json").read_text(encoding="utf-8")), {"sentinel": "prior"})

    def test_full_processing_metadata_failure_restores_existing_image_bytes(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source = root / "source"
            source_gis = source / "source" / "layers" / "projector_base" / "gis"
            source_images = source / "source" / "layers" / "projector_base" / "images"
            output_root = root / "processed" / "layers"
            source_gis.mkdir(parents=True)
            source_images.mkdir(parents=True)
            (source_gis / "roads.geojson").write_text(json.dumps(self._source(
                Polygon([(160000, 700000), (160100, 700000), (160100, 700060), (160000, 700060)])
            )), encoding="utf-8")
            (source_images / "model.png").write_bytes(b"new-image")
            output = output_root / "projector_base"
            output.mkdir(parents=True)
            (output / "model.png").write_bytes(b"prior-image")
            (output / "manifest.json").write_text(json.dumps({"sentinel": "prior"}), encoding="utf-8")
            (output / "styles.json").write_text(json.dumps({"sentinel": "prior"}), encoding="utf-8")
            class ImmediateExecutor:
                def __init__(self, *args, **kwargs): pass
                def __enter__(self): return self
                def __exit__(self, *args): return False
                def submit(self, fn, *args):
                    from concurrent.futures import Future
                    future = Future()
                    try: future.set_result(fn(*args))
                    except Exception as error: future.set_exception(error)
                    return future
            orchestrator = ProcessingOrchestrator(source, output_root, no_cache=True, max_workers=1)
            real_write = orchestrator._atomic_write_json
            def fail_styles(path, data):
                if Path(path).name == "styles.json":
                    raise OSError("injected later metadata failure")
                return real_write(path, data)
            with patch.object(orchestrator_module, "ProcessPoolExecutor", ImmediateExecutor), patch.object(orchestrator, "_atomic_write_json", side_effect=fail_styles):
                with self.assertRaises(OSError):
                    orchestrator.process_all()
            self.assertEqual((output / "model.png").read_bytes(), b"prior-image")

    def test_failed_pack_boundary_assets_are_not_republished_for_existing_or_new_pack(self):
        for had_prior_output in (True, False):
            with self.subTest(had_prior_output=had_prior_output), tempfile.TemporaryDirectory() as directory:
                root = Path(directory)
                source = root / "source"
                source_pack = source / "source" / "layers" / "boundary_pack"
                source_gis = source_pack / "gis"
                output_root = root / "processed" / "layers"
                source_gis.mkdir(parents=True)
                (source_gis / "boundary_pack_boundary.geojson").write_text(json.dumps(self._source(
                    Polygon([(160000, 700000), (160100, 700000), (160100, 700060), (160000, 700060)])
                )), encoding="utf-8")
                (source_gis / "sibling.geojson").write_text(json.dumps(self._source(
                    Polygon([(160000, 700000), (160100, 700000), (160100, 700060), (160000, 700060)])
                )), encoding="utf-8")
                output = output_root / "boundary_pack"
                if had_prior_output:
                    output.mkdir(parents=True)
                    (output / "boundary_pack_boundary.geojson").write_text("prior-boundary", encoding="utf-8")
                    (output / "manifest.json").write_text(json.dumps({"sentinel": "prior"}), encoding="utf-8")
                class ImmediateExecutor:
                    def __init__(self, *args, **kwargs): pass
                    def __enter__(self): return self
                    def __exit__(self, *args): return False
                    def submit(self, fn, task, log_level):
                        from concurrent.futures import Future
                        future = Future()
                        if task["geo_file"].stem == "sibling":
                            future.set_exception(RuntimeError("injected sibling failure"))
                        else:
                            future.set_result(fn(task, log_level))
                        return future
                with patch.object(orchestrator_module, "ProcessPoolExecutor", ImmediateExecutor):
                    ProcessingOrchestrator(source, output_root, no_cache=True, max_workers=1).process_all()
                if had_prior_output:
                    self.assertEqual((output / "boundary_pack_boundary.geojson").read_text(encoding="utf-8"), "prior-boundary")
                else:
                    self.assertFalse(output.exists())


if __name__ == "__main__":
    unittest.main()
