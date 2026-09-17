import copy
import json
import math
import subprocess
import tempfile
import unittest
import zipfile
from pathlib import Path
from unittest.mock import patch

from nli_pack_prep import (
    ASHKELON_NORTH_FALLBACK_LAT,
    FLEEING_GEOJSON_ZIP_SHA256,
    FLEEING_LYRX_ZIP_SHA256,
    FLEEING_ROUTE_OVERLAPP_URL,
    FLEEING_ROUTE_URL,
    MITZPE_RAMON_LAT,
    NOVA_FACILITY_WGS84,
    NOVA_FLEEING_ENVELOPE,
    OCT7_STATUS_CLASSES,
    NLI_KEEP_STEMS,
    ROUTE_232_STEM,
    ROUTE_232_LABEL_FILL,
    ROUTE_232_STROKE_ALPHA,
    ROUTE_232_STROKE_COLOR,
    ROUTE_232_STROKE_WIDTH_PT,
    ZIP_LAYER_MAP,
    emphasize_copied_line_lyrx,
    generate_nova_escape_index,
    install_nli_fleeing_overlays,
    install_nli_route_232_overlay,
    reverse_fleeing_individuals,
    reverse_fleeing_overlap,
    sha256_file,
    apply_alarm_timeline_minutes,
    apply_people_name_offsets,
    apply_people_source_overlay,
    apply_timeline_minutes,
    ashkelon_north_lat,
    attach_nli_catalog_links,
    city_centroid_in_story_band,
    collapse_alarms_to_cities,
    collect_timeline_beats,
    default_nli_zip_path,
    jitter_coincident_points,
    labels_only_point_lyrx,
    merge_popup_config,
    nli_authority_url,
    NLI_POPUP_CONFIG,
    object_ids_active_at,
    parse_alarm_timestamp_to_minutes,
    parse_local_timeline_to_minutes,
    parse_marc_name,
    prepare_nli_pack,
    reproject_web_mercator_collection_to_wgs84,
    resolve_zip_layer_info,
    rewrite_nli_layer_properties,
    rewrite_oct7_status,
    sanitize_time_like_properties,
    simple_line_lyrx,
    simple_point_lyrx,
    simple_polygon_lyrx,
    unique_value_point_lyrx,
    unit_from_seed,
    zip_entry_name,
)
from otef_layer_processing.orchestrator import _layer_render_sort_key
from otef_layer_processing.styles import parse_lyrx_style


def _point(lon, lat, **props):
    return {
        "type": "Feature",
        "properties": props,
        "geometry": {"type": "Point", "coordinates": [lon, lat]},
    }


def haversine_m(a, b):
    radius_m = 6371000.0
    lon1, lat1 = math.radians(a[0]), math.radians(a[1])
    lon2, lat2 = math.radians(b[0]), math.radians(b[1])
    dlon = lon2 - lon1
    dlat = lat2 - lat1
    chord = (
        math.sin(dlat / 2.0) ** 2
        + math.cos(lat1) * math.cos(lat2) * math.sin(dlon / 2.0) ** 2
    )
    return 2.0 * radius_m * math.asin(math.sqrt(chord))


def _lonlat_to_mercator(lon, lat):
    earth_a = 6378137.0
    x = lon * (math.pi / 180.0) * earth_a
    phi = lat * (math.pi / 180.0)
    y = math.log(math.tan(math.pi / 4.0 + phi / 2.0)) * earth_a
    return [x, y]


def _hsv_color(h, s, v, a=100):
    return {"type": "CIMHSVColor", "colorSpace": "HSV", "values": [h, s, v, a]}


def _gradient_stroke(width, *, dashes_without_template=False):
    effects = []
    if dashes_without_template:
        effects.append(
            {
                "type": "CIMGeometricEffectDashes",
                "lineDashEnding": "NoConstraint",
                "controlPointEnding": "NoConstraint",
            }
        )
    effects.append({"type": "CIMGeometricEffectTaperedPolygon", "toWidth": 1})
    return {
        "type": "CIMGradientStroke",
        "effects": effects,
        "enable": True,
        "capStyle": "Round",
        "joinStyle": "Round",
        "width": width,
        "colorRamp": {
            "type": "CIMPolarContinuousColorRamp",
            "fromColor": _hsv_color(60, 100, 96, 100),
            "toColor": _hsv_color(0, 100, 96, 100),
            "interpolationSpace": "HSV",
        },
        "gradientMethod": "AcrossLine",
        "gradientSize": 75,
        "gradientSizeUnits": "Relative",
        "gradientType": "Continuous",
    }


def _line_symbol_ref(stroke):
    return {
        "type": "CIMSymbolReference",
        "symbol": {
            "type": "CIMLineSymbol",
            "symbolLayers": [stroke],
        },
    }


def _class_break(upper_bound, width):
    return {
        "type": "CIMClassBreak",
        "upperBound": upper_bound,
        "symbol": _line_symbol_ref(
            _gradient_stroke(width, dashes_without_template=True)
        ),
    }


def _fleeing_individual_lyrx():
    return {
        "layerDefinitions": [
            {
                "name": "Fleeing_route",
                "transparency": 40,
                "renderer": {
                    "type": "CIMSimpleRenderer",
                    "symbol": _line_symbol_ref(_gradient_stroke(1)),
                },
            }
        ]
    }


def _fleeing_overlap_lyrx():
    return {
        "layerDefinitions": [
            {
                "name": "fleeing_route_overlapp",
                "renderer": {
                    "type": "CIMClassBreaksRenderer",
                    "classBreakType": "GraduatedSymbol",
                    "field": "COUNT_",
                    "authoringInfo": {
                        "type": "CIMClassBreaksRendererAuthoringInfo",
                        "templateSymbol": _line_symbol_ref(_gradient_stroke(2.25)),
                    },
                    "breaks": [
                        _class_break(13, 0.5),
                        _class_break(39, 1.375),
                        _class_break(100, 2.25),
                        _class_break(146, 3.125),
                        _class_break(235, 4),
                    ],
                },
            }
        ]
    }


def load_fixture_3857():
    nova_merc = _lonlat_to_mercator(*NOVA_FACILITY_WGS84)
    far_merc = _lonlat_to_mercator(34.51622737688783, 31.450087893615223)
    return {
        "type": "FeatureCollection",
        "crs": {"type": "name", "properties": {"name": "EPSG:3857"}},
        "features": [
            {
                "type": "Feature",
                "properties": {"OBJECTID": 1, "Name": "Ada - מוקד לחימה 4 - מתחם הנובה"},
                "geometry": {
                    "type": "LineString",
                    "coordinates": [far_merc, nova_merc],
                },
            }
        ],
    }


def load_overlap_fixture():
    nova_merc = _lonlat_to_mercator(*NOVA_FACILITY_WGS84)
    far_merc = _lonlat_to_mercator(34.4765945958846, 31.4247984299415)
    return {
        "type": "FeatureCollection",
        "crs": {"type": "name", "properties": {"name": "EPSG:3857"}},
        "features": [
            {
                "type": "Feature",
                "properties": {"OBJECTID": 10, "COUNT_": 235},
                "geometry": {
                    "type": "LineString",
                    "coordinates": [far_merc, list(nova_merc)],
                },
            },
            {
                "type": "Feature",
                "properties": {"OBJECTID": 11, "COUNT_": 1},
                "geometry": {
                    "type": "LineString",
                    "coordinates": [far_merc, list(nova_merc)],
                },
            },
        ],
    }


def _write_fleeing_fixture_zips(tmp):
    geojson_zip = tmp / "fleeing_route_geojson.zip"
    lyrx_zip = tmp / "Fleeing_route_lyrx.zip"
    with zipfile.ZipFile(geojson_zip, "w") as archive:
        archive.writestr("Fleeing_route.geojson", json.dumps(load_fixture_3857()))
        archive.writestr(
            "fleeing_route_overlapp.geojson", json.dumps(load_overlap_fixture())
        )
    with zipfile.ZipFile(lyrx_zip, "w") as archive:
        archive.writestr("Fleeing_route.lyrx", json.dumps(_fleeing_individual_lyrx()))
        archive.writestr(
            "fleeing_route_overlapp.lyrx", json.dumps(_fleeing_overlap_lyrx())
        )
    return geojson_zip, lyrx_zip


def _collection_bbox(collection):
    lons = []
    lats = []
    for feat in collection.get("features") or []:
        coords = (feat.get("geometry") or {}).get("coordinates") or []
        for point in coords:
            lons.append(float(point[0]))
            lats.append(float(point[1]))
    return (min(lons), min(lats), max(lons), max(lats))


class ZipEntryNameTests(unittest.TestCase):
    def test_reads_infozip_unicode_path_extra_field(self):
        zip_path = (
            Path(__file__).resolve().parents[3]
            / "geojson-20260823T094646Z-1-001.zip"
        )
        if not zip_path.is_file():
            self.skipTest(f"missing {zip_path}")
        with zipfile.ZipFile(zip_path) as zf:
            names = [zip_entry_name(info) for info in zf.infolist()]
        self.assertIn("geojson/people_7_10.json", names)
        self.assertIn("geojson/polygons_7_10.geojson", names)
        self.assertIn("geojson/lines_7_10.geojson", names)
        self.assertTrue(any(name.startswith("geojson/older versions/") for name in names))

    def test_dated_drive_dump_uses_root_geojson_names(self):
        zip_path = (
            Path(__file__).resolve().parents[3]
            / "drive-download-20260827T125810Z-1-001.zip"
        )
        if not zip_path.is_file():
            self.skipTest(f"missing {zip_path}")
        with zipfile.ZipFile(zip_path) as zf:
            names = [zip_entry_name(info) for info in zf.infolist()]
        self.assertIn("people_7_10_270826.geojson", names)
        self.assertIn("polygons_7_10_270826.geojson", names)
        self.assertIn("lines_7_10_270826.geojson", names)

    def test_resolve_prefers_canonical_then_dated_root(self):
        dated = zipfile.ZipInfo("people_7_10_270826.geojson")
        by_name = {"people_7_10_270826.geojson": dated}
        info = resolve_zip_layer_info(by_name, "geojson/people_7_10.json", "people")
        self.assertIs(info, dated)

    def test_default_nli_zip_path_prefers_dated_dump(self):
        tmp = Path(tempfile.mkdtemp())
        dated = tmp / "drive-download-20260827T125810Z-1-001.zip"
        dated.write_bytes(b"PK")
        self.assertEqual(default_nli_zip_path(tmp), dated)


class JitterTests(unittest.TestCase):
    def test_unit_from_seed_is_stable_and_in_range(self):
        a = unit_from_seed("1190", "lat")
        b = unit_from_seed("1190", "lat")
        c = unit_from_seed("1190", "lon")
        self.assertEqual(a, b)
        self.assertNotEqual(a, c)
        self.assertGreaterEqual(a, 0.0)
        self.assertLess(a, 1.0)

    def test_leaves_singleton_points_untouched(self):
        features = [_point(34.47, 31.40, oct7_pid=1)]
        moved = jitter_coincident_points(features)
        self.assertEqual(moved, 0)
        self.assertEqual(features[0]["geometry"]["coordinates"], [34.47, 31.40])
        self.assertEqual(features[0]["properties"]["source_lon"], 34.47)
        self.assertEqual(features[0]["properties"]["source_lat"], 31.40)

    def test_distant_singletons_get_zero_offsets_and_are_not_grouped(self):
        features = [
            _point(34.47, 31.40, oct7_pid=1),
            _point(35.00, 32.00, oct7_pid=2),
        ]
        jitter_coincident_points(features)
        apply_people_name_offsets(features)
        for feat in features:
            self.assertEqual(feat["properties"]["otef_map_text_offset_em"], [0, 0])
            self.assertIn("source_lon", feat["properties"])
            self.assertIn("source_lat", feat["properties"])
        self.assertNotEqual(
            (features[0]["properties"]["source_lon"], features[0]["properties"]["source_lat"]),
            (features[1]["properties"]["source_lon"], features[1]["properties"]["source_lat"]),
        )

    def test_missing_source_keys_fall_back_to_geometry_not_a_shared_bucket(self):
        features = [
            _point(34.47, 31.40, oct7_pid=1),
            _point(35.00, 32.00, oct7_pid=2),
        ]
        apply_people_name_offsets(features)
        for feat in features:
            self.assertEqual(feat["properties"]["otef_map_text_offset_em"], [0, 0])
            self.assertNotIn("source_lon", feat["properties"])

    def test_shared_source_coords_get_opposite_offsets_despite_jittered_geometry(self):
        features = [
            _point(34.47, 31.40, oct7_pid=1),
            _point(34.47, 31.40, oct7_pid=2),
        ]
        jitter_coincident_points(features)
        self.assertNotEqual(
            features[0]["geometry"]["coordinates"],
            features[1]["geometry"]["coordinates"],
        )
        self.assertEqual(features[0]["properties"]["source_lon"], 34.47)
        self.assertEqual(features[1]["properties"]["source_lon"], 34.47)
        apply_people_name_offsets(features)
        off0 = features[0]["properties"]["otef_map_text_offset_em"]
        off1 = features[1]["properties"]["otef_map_text_offset_em"]
        self.assertEqual(len(off0), 2)
        self.assertEqual(len(off1), 2)
        self.assertNotEqual(off0, [0, 0])
        self.assertNotEqual(off1, [0, 0])
        self.assertAlmostEqual(off0[0] + off1[0], 0.0, places=9)
        self.assertAlmostEqual(off0[1] + off1[1], 0.0, places=9)
        self.assertAlmostEqual(math.hypot(off0[0], off0[1]), 1.8, places=6)
        self.assertAlmostEqual(math.hypot(off1[0], off1[1]), 1.8, places=6)

    def test_radial_offset_radius_caps_at_4_5(self):
        features = [_point(34.47, 31.40, oct7_pid=i) for i in range(20)]
        apply_people_name_offsets(features)
        radii = [
            math.hypot(*feat["properties"]["otef_map_text_offset_em"])
            for feat in features
        ]
        self.assertTrue(all(abs(r - 4.5) < 1e-6 for r in radii))

    def test_mixed_numeric_and_nonnumeric_pids_get_offsets_without_raising(self):
        features = [
            _point(34.47, 31.40, oct7_pid=1),
            _point(34.47, 31.40, oct7_pid="abc"),
        ]
        apply_people_name_offsets(features)
        offsets = [feat["properties"]["otef_map_text_offset_em"] for feat in features]
        for offset in offsets:
            self.assertEqual(len(offset), 2)
            self.assertTrue(all(isinstance(value, (int, float)) for value in offset))
        self.assertTrue(all(offset != [0, 0] for offset in offsets))

    def test_spreads_coincident_points_as_seeded_blob_not_ring(self):
        features = [
            _point(34.4724927, 31.40148705, oct7_pid=i) for i in range(20)
        ]
        original = copy.deepcopy(features)
        moved = jitter_coincident_points(features, size_deg=0.005)
        self.assertEqual(moved, 20)
        coords = [tuple(f["geometry"]["coordinates"]) for f in features]
        self.assertEqual(len(set(coords)), 20)
        radii = []
        for feat, src in zip(features, original):
            lon, lat = feat["geometry"]["coordinates"]
            self.assertEqual(feat["properties"]["source_lon"], src["geometry"]["coordinates"][0])
            self.assertEqual(feat["properties"]["source_lat"], src["geometry"]["coordinates"][1])
            dlon = lon - src["geometry"]["coordinates"][0]
            dlat = lat - src["geometry"]["coordinates"][1]
            radii.append((dlon**2 + dlat**2) ** 0.5)
            self.assertLessEqual(abs(dlat), 0.005 + 1e-12)
            self.assertLessEqual(abs(dlon), 0.005 + 1e-12)
        # A ring would put every radius near size_deg. A blob has mixed radii.
        self.assertLess(min(radii), 0.002)
        self.assertGreater(max(radii) - min(radii), 0.001)

    def test_same_ids_produce_same_offsets(self):
        a = [_point(34.47, 31.40, oct7_pid=7), _point(34.47, 31.40, oct7_pid=8)]
        b = copy.deepcopy(a)
        jitter_coincident_points(a)
        jitter_coincident_points(b)
        self.assertEqual(a[0]["geometry"]["coordinates"], b[0]["geometry"]["coordinates"])
        self.assertEqual(a[1]["geometry"]["coordinates"], b[1]["geometry"]["coordinates"])


def _write_lyrx(payload, name="layer.lyrx"):
    tmp = Path(tempfile.mkdtemp()) / name
    tmp.write_text(json.dumps(payload), encoding="utf-8")
    return tmp


class LyrxBuilderTests(unittest.TestCase):
    def test_point_unique_value_parses_as_point_not_polygon(self):
        payload = unique_value_point_lyrx(
            "status",
            [("Murdered", "Murdered", (180, 35, 24))],
        )
        parsed = parse_lyrx_style(_write_lyrx(payload))
        self.assertIsNotNone(parsed)
        data = parsed.to_dict()
        self.assertEqual(data["type"], "point")
        self.assertEqual(data["renderer"], "uniqueValue")
        self.assertEqual(data["uniqueValues"]["field"], "status")
        self.assertEqual(data["uniqueValues"]["classes"][0]["value"], "Murdered")
        marker = data["uniqueValues"]["classes"][0]["symbol"]["symbolLayers"]
        markers = [layer for layer in marker if layer.get("type") == "markerPoint"]
        self.assertTrue(markers, msg=f"expected markerPoint, got {marker}")
        self.assertEqual(markers[0]["marker"]["fillColor"], "#b42318")
        # 12pt CIM * 96/72 = 16px, matching october_7th אירוע_נקודתי-רציחה_חטיפה
        self.assertEqual(markers[0]["marker"]["size"], 16.0)

    def test_polygon_simple_parses_as_polygon(self):
        parsed = parse_lyrx_style(_write_lyrx(simple_polygon_lyrx()))
        self.assertIsNotNone(parsed)
        data = parsed.to_dict()
        self.assertEqual(data["type"], "polygon")
        self.assertEqual(data["renderer"], "simple")
        fills = [
            layer
            for layer in data["defaultSymbol"]["symbolLayers"]
            if layer.get("type") == "fill"
        ]
        self.assertTrue(fills)

    def test_line_simple_parses_as_line(self):
        parsed = parse_lyrx_style(_write_lyrx(simple_line_lyrx()))
        self.assertIsNotNone(parsed)
        data = parsed.to_dict()
        self.assertEqual(data["type"], "line")
        self.assertEqual(data["renderer"], "simple")
        strokes = [
            layer
            for layer in data["defaultSymbol"]["symbolLayers"]
            if layer.get("type") == "stroke"
        ]
        self.assertTrue(strokes)
        self.assertEqual(strokes[0]["color"], "#c31f4f")

    def test_oct7_status_classes_parse_four_unique_values(self):
        parsed = parse_lyrx_style(_write_lyrx(unique_value_point_lyrx("status", OCT7_STATUS_CLASSES)))
        self.assertIsNotNone(parsed)
        data = parsed.to_dict()
        self.assertEqual(data["renderer"], "uniqueValue")
        classes = data["uniqueValues"]["classes"]
        self.assertEqual(len(classes), 4)
        self.assertEqual([c["value"] for c in classes], [
            "Murdered",
            "Killed on duty",
            "Kidnap survivor",
            "Murdered in captivity",
        ])
        murdered = [
            layer
            for layer in classes[0]["symbol"]["symbolLayers"]
            if layer.get("type") == "markerPoint"
        ]
        self.assertEqual(murdered[0]["marker"]["fillColor"], "#b42318")
        self.assertEqual(murdered[0]["marker"]["strokeColor"], "#ffffff")
        self.assertEqual(murdered[0]["marker"]["shape"], "circle")

    def test_people_names_lyrx_is_labels_only_point_with_hebrew_name_and_force_visible(self):
        payload = labels_only_point_lyrx()
        parsed = parse_lyrx_style(_write_lyrx(payload, "people_names.lyrx"))
        self.assertIsNotNone(parsed)
        data = parsed.to_dict()
        self.assertEqual(data["type"], "point")
        self.assertEqual(data["renderer"], "simple")
        self.assertNotIn("uniqueValues", data)
        labels = data["labels"]
        self.assertEqual(labels["field"], "hebrew_name")
        self.assertTrue(labels["forceVisible"])
        self.assertFalse(labels["hebrewBidiWrap"])
        self.assertEqual(labels["font"], ["Guttman Hatzvi", "Noto Sans Regular"])
        self.assertFalse(any("Bold" in str(face) for face in labels["font"]))
        self.assertEqual(labels["color"], "#ffffff")
        self.assertEqual(float(labels["size"]), 8.0)
        self.assertAlmostEqual(float(labels.get("haloSize") or 0), 0.12)
        self.assertEqual(labels.get("textRotationAlignment"), "map")
        self.assertEqual(labels["offsetArrayProperty"], "otef_map_text_offset_em")
        self.assertIsNot(labels.get("offsetEmFromProperties"), True)
        self.assertIsNot(labels.get("angleFromProperties"), True)
        self.assertNotEqual((labels.get("fontStyleName") or "Regular").lower(), "bold")
        symbol_layers = (data.get("defaultSymbol") or {}).get("symbolLayers") or []
        markers = [layer for layer in symbol_layers if layer.get("type") == "markerPoint"]
        self.assertFalse(markers, msg=f"expected labels-only, got markers {markers}")
        self.assertEqual(symbol_layers, [])

    def test_alarms_lyrx_is_simple_point(self):
        parsed = parse_lyrx_style(_write_lyrx(simple_point_lyrx(), "alarms.lyrx"))
        self.assertIsNotNone(parsed)
        data = parsed.to_dict()
        self.assertEqual(data["type"], "point")
        self.assertEqual(data["renderer"], "simple")
        markers = [
            layer
            for layer in data["defaultSymbol"]["symbolLayers"]
            if layer.get("type") == "markerPoint"
        ]
        self.assertTrue(markers)


class LegendClassContractTests(unittest.TestCase):
    def test_oct7_status_classes_are_four_without_bibas(self):
        self.assertEqual(len(OCT7_STATUS_CLASSES), 4)
        values = [row[0] for row in OCT7_STATUS_CLASSES]
        self.assertEqual(
            values,
            ["Murdered", "Killed on duty", "Kidnap survivor", "Murdered in captivity"],
        )
        self.assertFalse(any("bibas" in value.lower() for value in values))
        self.assertEqual(OCT7_STATUS_CLASSES[0][2], (180, 35, 24))
        self.assertEqual(OCT7_STATUS_CLASSES[3][2], (122, 34, 34))

class GroupingTests(unittest.TestCase):
    def test_bibas_status_rewrites_to_murdered_in_captivity(self):
        self.assertEqual(
            rewrite_oct7_status("Murdered in captivity (bibas)"),
            "Murdered in captivity",
        )
        self.assertEqual(rewrite_oct7_status("Murdered"), "Murdered")
        self.assertEqual(rewrite_oct7_status("Killed on duty"), "Killed on duty")
        self.assertEqual(rewrite_oct7_status("Murdered then kidnapped"), "Murdered")

    def test_rewrite_nli_layer_properties_mutates_people_status(self):
        oct7 = {
            "features": [
                _point(34.47, 31.40, status="Murdered in captivity (bibas)"),
                _point(34.48, 31.41, status="Murdered"),
            ]
        }
        self.assertEqual(rewrite_nli_layer_properties("people", oct7), 1)
        self.assertEqual(
            oct7["features"][0]["properties"]["status"],
            "Murdered in captivity",
        )
        self.assertEqual(oct7["features"][1]["properties"]["status"], "Murdered")


class CatalogLinkTests(unittest.TestCase):
    def test_parse_marc_name_uses_dollar_a(self):
        self.assertEqual(parse_marc_name("$$aשביט, טל$$d2003-2024$$9heb"), "שביט, טל")

    def test_attaches_string_mms_id_and_authority_url(self):
        people = {
            "features": [
                _point(34.47, 31.40, pid=23, hebrew_name="רן גואילי", name="Ran Gvili"),
                _point(34.48, 31.41, pid=16, hebrew_name="לא ידוע", name="Singh Dhami Lokendra"),
            ]
        }
        stats = attach_nli_catalog_links(
            people,
            [{"mms_id": "987007591931905171", "he": "גואילי, רן", "en": "Gvili, Ran"}],
        )
        self.assertEqual(stats["linked"], 1)
        self.assertEqual(stats["unmatched"], 1)
        linked = people["features"][0]["properties"]
        self.assertEqual(linked["mms_id"], "987007591931905171")
        self.assertIsInstance(linked["mms_id"], str)
        self.assertEqual(
            linked["nli_url"],
            nli_authority_url("987007591931905171"),
        )
        self.assertNotIn("mms_id", people["features"][1]["properties"])

    def test_uses_old_catalog_names_when_people_name_does_not_match(self):
        people = {
            "features": [
                _point(34.47, 31.40, pid=1190, hebrew_name="לא ידוע", name="Alik P"),
            ]
        }
        stats = attach_nli_catalog_links(
            people,
            [{"mms_id": "987012345678901234", "he": "פוזדניאקוב, אליק", "en": "Pozdnykov, Alik"}],
            catalog_features=[
                {"properties": {"oct7_pid": 1190, "name_he": "פוזדניאקוב, אליק", "name_en": "Pozdnykov, Alik"}}
            ],
        )
        self.assertEqual(stats["linked"], 1)
        self.assertEqual(people["features"][0]["properties"]["mms_id"], "987012345678901234")

    def test_pid_mms_map_links_when_names_do_not_match(self):
        people = {
            "features": [
                _point(34.47, 31.40, pid=15, hebrew_name="לא ידוע", name="Rajan Phulara"),
            ]
        }
        stats = attach_nli_catalog_links(
            people,
            [{"mms_id": "987012802865205171", "he": "פולרה, ראג'ן", "en": "Rajan, Phulara"}],
            pid_mms_ids={"15": "987012802865205171"},
        )
        self.assertEqual(stats["linked"], 1)
        self.assertEqual(stats.get("linked_by_pid"), 1)
        self.assertEqual(people["features"][0]["properties"]["mms_id"], "987012802865205171")
        self.assertEqual(
            people["features"][0]["properties"]["nli_url"],
            nli_authority_url("987012802865205171"),
        )

    def test_pid_mms_map_overrides_conflicting_name_match(self):
        people = {
            "features": [
                _point(34.47, 31.40, pid=65, hebrew_name="לוי דניאל", name="Daniel Levy"),
            ]
        }
        stats = attach_nli_catalog_links(
            people,
            [{"mms_id": "987012802828105171", "he": "לוי, דניאל", "en": "Levy, Daniel"}],
            pid_mms_ids={"65": "987012770614205171"},
        )
        self.assertEqual(stats["linked"], 1)
        self.assertEqual(people["features"][0]["properties"]["mms_id"], "987012770614205171")


class PreparePackTests(unittest.TestCase):
    def test_prepare_explicit_investigation_lyrx_is_copied_byte_for_byte(self):
        tmp = Path(tempfile.mkdtemp())
        zip_path = _nli_zip_with_polygons(tmp, {"type": "FeatureCollection", "features": []})
        pack_dir = tmp / "nli"
        source_lyrx = tmp / "authored.lyrx"
        source_bytes = b"{\n  \"authored\": true,\n  \"bytes\": \"\\xff\"\n}\n"
        source_lyrx.write_bytes(source_bytes)

        prepare_nli_pack(
            zip_path,
            pack_dir,
            authorities_path=tmp / "missing.json",
            investigation_polygons_lyrx=source_lyrx,
        )

        self.assertEqual(
            (pack_dir / "styles" / "investigation_polygons.lyrx").read_bytes(),
            source_bytes,
        )

    def test_prepare_missing_explicit_investigation_lyrx_fails_before_pack_writes(self):
        tmp = Path(tempfile.mkdtemp())
        zip_path = _nli_zip_with_polygons(tmp, {"type": "FeatureCollection", "features": []})
        pack_dir = tmp / "nli"

        with self.assertRaises(FileNotFoundError):
            prepare_nli_pack(
                zip_path,
                pack_dir,
                authorities_path=tmp / "missing.json",
                investigation_polygons_lyrx=tmp / "missing.lyrx",
            )

        self.assertFalse(pack_dir.exists())

    def test_merge_popup_config_preserves_other_packs(self):
        tmp = Path(tempfile.mkdtemp())
        popup = tmp / "popup-config.json"
        popup.write_text(
            json.dumps({"october_7th": {"layers": {"x": {"titleField": "A"}}}}),
            encoding="utf-8",
        )
        merge_popup_config(popup, NLI_POPUP_CONFIG)
        data = json.loads(popup.read_text(encoding="utf-8"))
        self.assertEqual(data["october_7th"]["layers"]["x"]["titleField"], "A")
        self.assertIn("people", data["nli"]["layers"])
        self.assertIn("lines", data["nli"]["layers"])
        self.assertNotIn("nli_catalog", data["nli"]["layers"])
        self.assertNotIn("oct7_database", data["nli"]["layers"])
        self.assertNotIn("people_names", data["nli"]["layers"])
        self.assertNotIn("legendLabel", data["nli"]["layers"]["people"])
        self.assertEqual(
            data["nli"]["layers"]["investigation_polygons"]["legendLabel"],
            "Investigation polygons",
        )
        self.assertEqual(
            data["nli"]["layers"]["lines"]["legendLabel"],
            "Infiltration routes",
        )
        self.assertEqual(
            data["nli"]["layers"][ROUTE_232_STEM]["legendLabel"],
            "Highway 232",
        )

    def test_alarms_popup_is_city_and_count(self):
        tmp = Path(tempfile.mkdtemp())
        popup = tmp / "popup-config.json"
        merge_popup_config(popup, NLI_POPUP_CONFIG)
        data = json.loads(popup.read_text(encoding="utf-8"))
        alarms = data["nli"]["layers"]["alarms"]
        self.assertEqual(alarms["titleField"], "city")
        keys = {field["key"] for field in alarms["fields"]}
        self.assertEqual(keys, {"city", "alarm_count_total"})
        self.assertIn({"label": "City", "key": "city"}, alarms["fields"])

    def test_rewrites_hhmmss_timeline_values(self):
        collection = {
            "features": [
                {"properties": {"timeline": "07:15:00", "Name": "x"}, "geometry": {"type": "Polygon", "coordinates": []}}
            ]
        }
        changed = sanitize_time_like_properties(collection)
        self.assertEqual(changed, 1)
        self.assertEqual(collection["features"][0]["properties"]["timeline"], "local 07:15")

    def test_web_mercator_polygon_lands_in_israel_degrees(self):
        collection = {
            "crs": {"type": "name", "properties": {"name": "EPSG:3857"}},
            "features": [
                {
                    "properties": {},
                    "geometry": {
                        "type": "Polygon",
                        "coordinates": [[
                            [3842503.6232047714, 3691714.1237349138],
                            [3842504.6232047714, 3691714.1237349138],
                            [3842504.6232047714, 3691715.1237349138],
                            [3842503.6232047714, 3691714.1237349138],
                        ]],
                    },
                }
            ],
        }
        reproject_web_mercator_collection_to_wgs84(collection)
        self.assertNotIn("crs", collection)
        lon, lat = collection["features"][0]["geometry"]["coordinates"][0][0]
        self.assertTrue(34.0 < lon < 35.5)
        self.assertTrue(31.0 < lat < 32.0)

    def test_keep_stems_include_derived_people_names(self):
        self.assertIn("people_names", NLI_KEEP_STEMS)
        self.assertIn("people", NLI_KEEP_STEMS)

    def test_keep_stems_include_alarms(self):
        self.assertIn("alarms", NLI_KEEP_STEMS)
        self.assertNotIn("alarms", ZIP_LAYER_MAP.values())

    def test_keep_stems_include_route_232_overlay(self):
        self.assertIn(ROUTE_232_STEM, NLI_KEEP_STEMS)
        self.assertNotIn(ROUTE_232_STEM, ZIP_LAYER_MAP.values())

    def test_keep_stems_exclude_investigation_settlements_sidecar(self):
        self.assertNotIn("investigation_settlements", NLI_KEEP_STEMS)
        self.assertNotIn("investigation_settlements", ZIP_LAYER_MAP.values())

    def test_prepare_copies_jittered_people_to_people_names(self):
        tmp = Path(tempfile.mkdtemp())
        zip_path = tmp / "nli.zip"
        people = {
            "type": "FeatureCollection",
            "features": [
                _point(34.47, 31.40, name="Ada", hebrew_name="עדה", status="Murdered", oct7_pid=1),
                _point(34.47, 31.40, name="Ben", hebrew_name="בן", status="Murdered", oct7_pid=2),
            ],
        }
        empty = {"type": "FeatureCollection", "features": []}
        with zipfile.ZipFile(zip_path, "w") as archive:
            archive.writestr("geojson/people_7_10.json", json.dumps(people))
            archive.writestr("geojson/polygons_7_10.geojson", json.dumps(empty))
            archive.writestr("geojson/lines_7_10.geojson", json.dumps(empty))
        pack_dir = tmp / "nli"
        prepare_nli_pack(zip_path, pack_dir, authorities_path=tmp / "missing.json")
        people_out = json.loads((pack_dir / "gis" / "people.geojson").read_text(encoding="utf-8"))
        names_out = json.loads((pack_dir / "gis" / "people_names.geojson").read_text(encoding="utf-8"))
        self.assertTrue((pack_dir / "styles" / "people_names.lyrx").is_file())
        self.assertEqual(len(names_out["features"]), len(people_out["features"]))
        self.assertEqual(len(names_out["features"]), 2)
        self.assertEqual(
            [feat["geometry"] for feat in names_out["features"]],
            [feat["geometry"] for feat in people_out["features"]],
        )
        coords = [tuple(feat["geometry"]["coordinates"]) for feat in names_out["features"]]
        self.assertEqual(len(set(coords)), 2)
        offsets = [feat["properties"].get("otef_map_text_offset_em") for feat in names_out["features"]]
        self.assertTrue(all(isinstance(offset, list) and len(offset) == 2 for offset in offsets))
        self.assertTrue(any(offset != [0, 0] for offset in offsets))
        self.assertAlmostEqual(offsets[0][0] + offsets[1][0], 0.0, places=9)
        self.assertAlmostEqual(offsets[0][1] + offsets[1][1], 0.0, places=9)
        for feat in names_out["features"]:
            self.assertIn("source_lon", feat["properties"])
            self.assertIn("source_lat", feat["properties"])

    def test_prepare_accepts_dated_root_geojson_names(self):
        tmp = Path(tempfile.mkdtemp())
        zip_path = tmp / "nli.zip"
        people = {
            "type": "FeatureCollection",
            "features": [_point(34.47, 31.40, name="Ada", oct7_pid=1)],
        }
        empty = {"type": "FeatureCollection", "features": []}
        with zipfile.ZipFile(zip_path, "w") as archive:
            archive.writestr("people_7_10_270826.geojson", json.dumps(people))
            archive.writestr("polygons_7_10_270826.geojson", json.dumps(empty))
            archive.writestr("lines_7_10_270826.geojson", json.dumps(empty))
        pack_dir = tmp / "nli"
        summary = prepare_nli_pack(zip_path, pack_dir, authorities_path=tmp / "missing.json")
        self.assertEqual(summary["layers"]["people"]["features"], 1)
        self.assertTrue((pack_dir / "gis" / "people.geojson").is_file())
        self.assertTrue((pack_dir / "gis" / "investigation_polygons.geojson").is_file())
        self.assertTrue((pack_dir / "gis" / "lines.geojson").is_file())

    def test_prepare_writes_alarms_from_external_geojson(self):
        tmp = Path(tempfile.mkdtemp())
        zip_path = tmp / "nli.zip"
        people = {
            "type": "FeatureCollection",
            "features": [_point(34.47, 31.40, name="Ada", oct7_pid=1)],
        }
        empty = {"type": "FeatureCollection", "features": []}
        with zipfile.ZipFile(zip_path, "w") as archive:
            archive.writestr("geojson/people_7_10.json", json.dumps(people))
            archive.writestr("geojson/polygons_7_10.geojson", json.dumps(empty))
            archive.writestr("geojson/lines_7_10.geojson", json.dumps(empty))
        alarms_path = tmp / "oct7_alarms_2023-10-07.geojson"
        alarms_path.write_text(
            json.dumps(
                {
                    "type": "FeatureCollection",
                    "features": [
                        _point(
                            34.50,
                            31.40,
                            time="2023-10-07 06:29:02",
                            id="1",
                            rid="a",
                            city="שדרות",
                        ),
                        _point(
                            34.52,
                            31.42,
                            time="2023-10-07 06:30:00",
                            id="2",
                            rid="b",
                            city="שדרות",
                        ),
                        _point(
                            34.80,
                            32.08,
                            time="2023-10-07 06:29:02",
                            id="3",
                            rid="c",
                            city="תל אביב - מרכז העיר",
                        ),
                    ],
                }
            ),
            encoding="utf-8",
        )
        pack_dir = tmp / "nli"
        summary = prepare_nli_pack(
            zip_path,
            pack_dir,
            authorities_path=tmp / "missing.json",
            alarms_path=alarms_path,
        )
        out_path = pack_dir / "gis" / "alarms.geojson"
        self.assertTrue(out_path.is_file())
        self.assertTrue((pack_dir / "styles" / "alarms.lyrx").is_file())
        out = json.loads(out_path.read_text(encoding="utf-8"))
        self.assertEqual(len(out["features"]), 1)
        feat = out["features"][0]
        self.assertEqual(feat["id"], feat["properties"]["city"])
        self.assertEqual(feat["properties"]["city"], "שדרות")
        self.assertEqual(feat["properties"]["alarm_minutes"], [389, 390])
        self.assertEqual(feat["properties"]["alarm_count_total"], 2)
        self.assertIsNone(feat["properties"].get("timeline_minutes"))
        coords = [tuple(feat["geometry"]["coordinates"][:2]) for feat in out["features"]]
        self.assertEqual(len(set(coords)), 1)
        self.assertAlmostEqual(coords[0][0], 34.51, places=5)
        self.assertAlmostEqual(coords[0][1], 31.41, places=5)
        self.assertEqual(summary["layers"]["alarms"]["jittered"], 0)
        cities = {feat["properties"]["city"] for feat in out["features"]}
        self.assertNotIn("תל אביב - מרכז העיר", cities)


def _cim_stroke_widths(payload):
    widths = []

    def walk(obj):
        if isinstance(obj, dict):
            if obj.get("type") == "CIMSolidStroke" and obj.get("enable", True):
                widths.append(obj.get("width"))
            for value in obj.values():
                walk(value)
        elif isinstance(obj, list):
            for item in obj:
                walk(item)

    walk(payload)
    return widths


class Route232OverlayTests(unittest.TestCase):
    def test_restyle_uses_brown_stroke_without_casing(self):
        payload = simple_line_lyrx(width=4.0)
        out = emphasize_copied_line_lyrx(payload)
        widths = _cim_stroke_widths(out)
        self.assertEqual(tuple(ROUTE_232_STROKE_COLOR), (135, 62, 35))
        self.assertEqual(ROUTE_232_STROKE_WIDTH_PT, 2.0)
        self.assertEqual(ROUTE_232_STROKE_ALPHA, 100)
        self.assertEqual(tuple(ROUTE_232_LABEL_FILL), (255, 224, 210))
        self.assertEqual(widths, [ROUTE_232_STROKE_WIDTH_PT])
        parsed = parse_lyrx_style(_write_lyrx(out))
        self.assertIsNotNone(parsed)
        strokes = [
            layer
            for layer in parsed.to_dict()["defaultSymbol"]["symbolLayers"]
            if layer.get("type") == "stroke"
        ]
        self.assertEqual(len(strokes), 1)
        self.assertEqual(strokes[0]["color"], "#873e23")
        self.assertAlmostEqual(strokes[0]["opacity"], 1.0)
        self.assertEqual(strokes[0]["width"], ROUTE_232_STROKE_WIDTH_PT * (96 / 72))

    def test_install_skips_when_future_development_is_missing(self):
        tmp = Path(tempfile.mkdtemp())
        result = install_nli_route_232_overlay(tmp / "nli", overlay_source_root=tmp)
        self.assertFalse(result["installed"])
        self.assertEqual(result["reason"], "missing_source_geojson")

    def test_install_copies_source_and_renames_lyrx_to_geojson_stem(self):
        tmp = Path(tempfile.mkdtemp())
        src_gis = tmp / "future_development" / "gis"
        src_styles = tmp / "future_development" / "styles"
        src_gis.mkdir(parents=True)
        src_styles.mkdir(parents=True)
        geo = {
            "type": "FeatureCollection",
            "crs": {"type": "name", "properties": {"name": "EPSG:2039"}},
            "features": [],
        }
        (src_gis / f"{ROUTE_232_STEM}.geojson").write_text(
            json.dumps(geo), encoding="utf-8"
        )
        (src_styles / "232_ציר.lyrx").write_text(
            json.dumps(simple_line_lyrx(width=4.0)), encoding="utf-8"
        )
        pack_dir = tmp / "nli"
        result = install_nli_route_232_overlay(pack_dir, overlay_source_root=tmp)
        self.assertTrue(result["installed"])
        self.assertEqual(result["lyrx_match"], "token_sorted")
        dest_geo = pack_dir / "gis" / f"{ROUTE_232_STEM}.geojson"
        dest_lyrx = pack_dir / "styles" / f"{ROUTE_232_STEM}.lyrx"
        self.assertTrue(dest_geo.is_file())
        self.assertTrue(dest_lyrx.is_file())
        copied = json.loads(dest_geo.read_text(encoding="utf-8"))
        self.assertEqual(copied["crs"]["properties"]["name"], "EPSG:2039")
        widths = _cim_stroke_widths(json.loads(dest_lyrx.read_text(encoding="utf-8")))
        self.assertEqual(widths, [ROUTE_232_STROKE_WIDTH_PT])

    def test_prepare_keeps_route_232_overlay_and_skips_without_source(self):
        tmp = Path(tempfile.mkdtemp())
        zip_path = tmp / "nli.zip"
        people = {
            "type": "FeatureCollection",
            "features": [_point(34.47, 31.40, name="Ada", oct7_pid=1)],
        }
        empty = {"type": "FeatureCollection", "features": []}
        with zipfile.ZipFile(zip_path, "w") as archive:
            archive.writestr("geojson/people_7_10.json", json.dumps(people))
            archive.writestr("geojson/polygons_7_10.geojson", json.dumps(empty))
            archive.writestr("geojson/lines_7_10.geojson", json.dumps(empty))
        pack_dir = tmp / "nli"
        skipped = prepare_nli_pack(
            zip_path, pack_dir, authorities_path=tmp / "missing.json", overlay_source_root=tmp
        )
        self.assertFalse(skipped["overlays"]["route_232"]["installed"])

        src_gis = tmp / "future_development" / "gis"
        src_styles = tmp / "future_development" / "styles"
        src_gis.mkdir(parents=True)
        src_styles.mkdir(parents=True)
        (src_gis / f"{ROUTE_232_STEM}.geojson").write_text(
            json.dumps({"type": "FeatureCollection", "features": []}), encoding="utf-8"
        )
        (src_styles / f"{ROUTE_232_STEM}.lyrx").write_text(
            json.dumps(simple_line_lyrx(width=4.0)), encoding="utf-8"
        )
        kept = prepare_nli_pack(
            zip_path, pack_dir, authorities_path=tmp / "missing.json", overlay_source_root=tmp
        )
        self.assertTrue(kept["overlays"]["route_232"]["installed"])
        self.assertTrue((pack_dir / "gis" / f"{ROUTE_232_STEM}.geojson").is_file())
        self.assertTrue((pack_dir / "styles" / f"{ROUTE_232_STEM}.lyrx").is_file())
        removed = kept.get("removed_obsolete") or []
        self.assertNotIn(f"{ROUTE_232_STEM}.geojson", removed)
        self.assertNotIn(f"{ROUTE_232_STEM}.lyrx", removed)

    def test_route_232_renders_under_infiltration_lines_and_people(self):
        ordered = sorted(
            [
                {"id": "people"},
                {"id": ROUTE_232_STEM},
                {"id": "lines"},
                {"id": "investigation_polygons"},
                {"id": "alarms"},
                {"id": "people_names"},
            ],
            key=_layer_render_sort_key,
        )
        ids = [layer["id"] for layer in ordered]
        self.assertLess(ids.index(ROUTE_232_STEM), ids.index("lines"))
        self.assertLess(ids.index(ROUTE_232_STEM), ids.index("people"))
        self.assertGreater(ids.index(ROUTE_232_STEM), ids.index("investigation_polygons"))


INVESTIGATION_TIMELINE_FIXTURE = [
    (1, "מרחב כניסה לקיבוץ", "local 07:15"),
    (2, "קרב בבית פרטי", "local 12:20"),
    (3, "גן הדר ובריכה", "local 09:20"),
    (4, "מגורי תושבים זרים, רפתות ומוסכים", "local 07:00"),
    (5, "מרחב הנחיתות", "local 11:40"),
    (6, "חדירה דרך השער הקדמי", "local 09:30"),
    (7, "חדירה ליישוב מהשער האחורי שליד שכונת שדות", "local 07:00"),
    (8, "חדירה מדרום, מכיוון הרפתות", "local 09:30"),
    (9, "מוקד חטיפה", "local 09:30"),
    (12, "השכונה הצפונית", "local 06:40"),
    (13, 'שכונת "דור צעיר"', "local 09:30"),
    (14, "השכונה הדרומית", "local 07:00"),
    (15, "שכונת ההרחבה", "local 06:50"),
]


class TimelineMinutesTests(unittest.TestCase):
    def test_parses_alarm_timestamp_to_minute_of_day(self):
        self.assertEqual(parse_alarm_timestamp_to_minutes("2023-10-07 06:29:02"), 389)
        self.assertEqual(parse_alarm_timestamp_to_minutes("2023-10-07 20:00:11"), 1200)
        self.assertIsNone(parse_alarm_timestamp_to_minutes(None))

    def test_apply_alarm_timeline_minutes(self):
        col = {"features": [_point(34.75, 32.01, time="2023-10-07 06:29:02", id="1")]}
        self.assertEqual(apply_alarm_timeline_minutes(col), 1)
        self.assertEqual(col["features"][0]["properties"]["timeline_minutes"], 389)

    def test_parses_local_hhmm_to_minutes(self):
        self.assertEqual(parse_local_timeline_to_minutes("local 07:15"), 435)
        self.assertEqual(parse_local_timeline_to_minutes("local 06:40"), 400)
        self.assertIsNone(parse_local_timeline_to_minutes("07:15:00"))
        self.assertIsNone(parse_local_timeline_to_minutes(None))

    def test_apply_timeline_minutes_and_eight_beats(self):
        collection = {
            "features": [
                {
                    "type": "Feature",
                    "properties": {"OBJECTID": oid, "Name": name, "timeline": clock},
                    "geometry": {"type": "Polygon", "coordinates": []},
                }
                for oid, name, clock in INVESTIGATION_TIMELINE_FIXTURE
            ]
        }
        changed = apply_timeline_minutes(collection)
        self.assertEqual(changed, 13)
        self.assertEqual(
            collection["features"][0]["properties"]["timeline_minutes"],
            435,
        )
        beats = collect_timeline_beats(collection["features"])
        self.assertEqual(beats, [400, 410, 420, 435, 560, 570, 700, 740])
        self.assertEqual(object_ids_active_at(collection["features"], 420), [4, 7, 14])


class CityAlarmCollapseTests(unittest.TestCase):
    def test_city_band_includes_ashkelon_netivot_ofakim_excludes_tel_aviv(self):
        north = 31.6857
        self.assertTrue(city_centroid_in_story_band(31.6857, north))
        self.assertTrue(city_centroid_in_story_band(31.423, north))
        self.assertTrue(city_centroid_in_story_band(31.312, north))
        self.assertTrue(city_centroid_in_story_band(31.40, north))
        self.assertFalse(city_centroid_in_story_band(32.08, north))
        self.assertFalse(city_centroid_in_story_band(29.55, north))
        self.assertTrue(city_centroid_in_story_band(MITZPE_RAMON_LAT, north))

    def test_ashkelon_north_lat_uses_max_ashkelon_point_or_fallback(self):
        self.assertEqual(ashkelon_north_lat([]), ASHKELON_NORTH_FALLBACK_LAT)
        self.assertEqual(ashkelon_north_lat(None), ASHKELON_NORTH_FALLBACK_LAT)
        features = [
            _point(34.57, 31.650, city="אשקלון - דרום"),
            _point(34.57, 31.686, city="אשקלון - צפון"),
            _point(34.80, 32.08, city="תל אביב - מרכז העיר"),
        ]
        self.assertAlmostEqual(ashkelon_north_lat(features), 31.686, places=5)

    def test_collapse_alarms_to_cities_merges_minutes_and_centroid(self):
        col = {
            "type": "FeatureCollection",
            "features": [
                _point(34.50, 31.40, time="2023-10-07 06:29:02", city="שדרות"),
                _point(34.52, 31.42, time="2023-10-07 06:30:00", city="שדרות"),
                _point(34.80, 32.08, time="2023-10-07 06:29:02", city="תל אביב - מרכז העיר"),
            ],
        }
        apply_alarm_timeline_minutes(col)
        out = collapse_alarms_to_cities(col)
        self.assertEqual(len(out["features"]), 1)
        feat = out["features"][0]
        self.assertEqual(feat["id"], "שדרות")
        self.assertEqual(feat["properties"]["city"], "שדרות")
        self.assertEqual(feat["properties"]["alarm_minutes"], [389, 390])
        self.assertEqual(feat["properties"]["alarm_count_total"], 2)
        lon, lat = feat["geometry"]["coordinates"][:2]
        self.assertAlmostEqual(lon, 34.51, places=5)
        self.assertAlmostEqual(lat, 31.41, places=5)
        self.assertIsNone(feat["properties"].get("timeline_minutes"))

    def test_collapse_skips_empty_city_and_keeps_duplicate_minutes(self):
        col = {
            "type": "FeatureCollection",
            "features": [
                _point(34.50, 31.40, time="2023-10-07 06:29:02", city="שדרות"),
                _point(34.50, 31.40, time="2023-10-07 06:29:02", city="שדרות"),
                _point(34.51, 31.41, time="2023-10-07 06:30:00", city=""),
                _point(34.52, 31.42, time="2023-10-07 06:31:00"),
            ],
        }
        apply_alarm_timeline_minutes(col)
        out = collapse_alarms_to_cities(col)
        self.assertEqual(len(out["features"]), 1)
        feat = out["features"][0]
        self.assertEqual(feat["properties"]["city"], "שדרות")
        self.assertEqual(feat["properties"]["alarm_minutes"], [389, 389])
        self.assertEqual(feat["properties"]["alarm_count_total"], 2)

    def test_collapse_skips_cities_with_empty_alarm_minutes(self):
        col = {
            "type": "FeatureCollection",
            "features": [
                _point(34.50, 31.40, city="שדרות"),
                _point(34.51, 31.41, time="2023-10-07 06:29:02", city="נתיבות"),
            ],
        }
        apply_alarm_timeline_minutes(col)
        out = collapse_alarms_to_cities(col)
        cities = [feat["properties"]["city"] for feat in out["features"]]
        self.assertEqual(cities, ["נתיבות"])
        self.assertEqual(out["features"][0]["id"], out["features"][0]["properties"]["city"])


class AnimationOverrideContractTests(unittest.TestCase):
    def test_orchestrator_declares_nli_investigation_timeline(self):
        path = (
            Path(__file__).resolve().parents[1]
            / "otef_layer_processing"
            / "orchestrator.py"
        )
        src = path.read_text(encoding="utf-8")
        nli_idx = src.find('"nli"')
        self.assertGreater(nli_idx, -1)
        snippet = src[nli_idx : nli_idx + 600]
        self.assertIn("investigation_polygons", snippet)
        self.assertIn("lines", snippet)
        self.assertIn("alarms", snippet)
        self.assertIn('"type": "timeline"', snippet)
        self.assertIn("enabledByDefault", snippet)
        alarms_block = snippet[snippet.find("alarms") : snippet.find("alarms") + 120]
        self.assertIn("False", alarms_block)

    def test_processed_nli_investigation_style_is_timeline(self):
        path = (
            Path(__file__).resolve().parents[2]
            / "public"
            / "processed"
            / "layers"
            / "nli"
            / "styles.json"
        )
        self.assertTrue(path.is_file(), f"missing {path}")
        data = json.loads(path.read_text(encoding="utf-8"))
        animation = data.get("investigation_polygons", {}).get("animation") or {}
        self.assertEqual(animation.get("type"), "timeline")
        self.assertFalse(animation.get("enabledByDefault"))
        line_animation = data.get("lines", {}).get("animation") or {}
        self.assertEqual(line_animation.get("type"), "timeline")
        self.assertFalse(line_animation.get("enabledByDefault"))
        alarm_style = data.get("alarms") or {}
        alarm_animation = alarm_style.get("animation") or {}
        self.assertEqual(alarm_animation.get("type"), "timeline")
        self.assertFalse(alarm_animation.get("enabledByDefault"))
        self.assertIsNone(alarm_style.get("labels"))
        layers = (alarm_style.get("defaultSymbol") or {}).get("symbolLayers") or []
        self.assertTrue(any(layer.get("type") == "markerPoint" for layer in layers))
        names = data.get("people_names") or {}
        self.assertEqual((names.get("labels") or {}).get("field"), "hebrew_name")


class PeopleSourceOverlayTests(unittest.TestCase):
    def test_overlay_fills_hebrew_names_and_english_fixes_without_truncating_info(self):
        people = {
            "type": "FeatureCollection",
            "features": [
                _point(
                    34.55,
                    31.50,
                    pid=801,
                    name="Shani Louk",
                    hebrew_name="לא ידוע",
                    info="full biography that must not be chopped",
                    links="https://example.com/long",
                ),
                _point(
                    34.40,
                    31.30,
                    pid=1597,
                    name="Michael Muzarkov",
                    hebrew_name=None,
                    info="keep me",
                ),
                _point(
                    34.41,
                    31.31,
                    pid=100,
                    name="Unchanged Person",
                    hebrew_name="שם קיים",
                    info="also keep",
                ),
            ],
        }
        overlay = {
            "type": "FeatureCollection",
            "features": [
                {
                    "type": "Feature",
                    "properties": {
                        "pid": 801,
                        "name": "Shani Louk",
                        "hebrew_nam": "שני לוק",
                        "info": "chopped",
                        "links": "https://ex",
                    },
                    "geometry": {
                        "type": "Point",
                        "coordinates": [34.559255847, 31.505946785],
                    },
                },
                {
                    "type": "Feature",
                    "properties": {
                        "pid": 1597,
                        "name": "Michael Murzakhanov",
                        "hebrew_nam": "מיכאל מורזאחנוב",
                        "info": "x",
                    },
                    "geometry": {
                        "type": "Point",
                        "coordinates": [34.400000001, 31.300000001],
                    },
                },
            ],
        }
        stats = apply_people_source_overlay(people, overlay)
        by_pid = {
            str(feat["properties"]["pid"]): feat for feat in people["features"]
        }
        shani = by_pid["801"]["properties"]
        self.assertEqual(shani["hebrew_name"], "שני לוק")
        self.assertEqual(shani["info"], "full biography that must not be chopped")
        self.assertEqual(shani["links"], "https://example.com/long")
        self.assertAlmostEqual(by_pid["801"]["geometry"]["coordinates"][0], 34.559255847)
        michael = by_pid["1597"]["properties"]
        self.assertEqual(michael["name"], "Michael Murzakhanov")
        self.assertEqual(michael["hebrew_name"], "מיכאל מורזאחנוב")
        self.assertEqual(michael["info"], "keep me")
        unchanged = by_pid["100"]["properties"]
        self.assertEqual(unchanged["hebrew_name"], "שם קיים")
        self.assertEqual(unchanged["name"], "Unchanged Person")
        self.assertEqual(stats["hebrew_name"], 2)
        self.assertEqual(stats["name"], 1)
        self.assertEqual(stats["geometry"], 1)

    def test_prepare_applies_people_overlay_before_jitter(self):
        tmp = Path(tempfile.mkdtemp())
        zip_path = tmp / "nli.zip"
        people = {
            "type": "FeatureCollection",
            "features": [
                _point(34.55, 31.50, pid=801, name="Shani Louk", hebrew_name="לא ידוע"),
            ],
        }
        empty = {"type": "FeatureCollection", "features": []}
        with zipfile.ZipFile(zip_path, "w") as archive:
            archive.writestr("geojson/people_7_10.json", json.dumps(people))
            archive.writestr("geojson/polygons_7_10.geojson", json.dumps(empty))
            archive.writestr("geojson/lines_7_10.geojson", json.dumps(empty))
        overlay_path = tmp / "people_overlay.geojson"
        overlay_path.write_text(
            json.dumps(
                {
                    "type": "FeatureCollection",
                    "features": [
                        {
                            "type": "Feature",
                            "properties": {
                                "pid": 801,
                                "name": "Shani Louk",
                                "hebrew_nam": "שני לוק",
                            },
                            "geometry": {
                                "type": "Point",
                                "coordinates": [34.559255847, 31.505946785],
                            },
                        }
                    ],
                }
            ),
            encoding="utf-8",
        )
        pack_dir = tmp / "nli"
        summary = prepare_nli_pack(
            zip_path,
            pack_dir,
            authorities_path=tmp / "missing.json",
            people_overlay_path=overlay_path,
        )
        out = json.loads((pack_dir / "gis" / "people.geojson").read_text(encoding="utf-8"))
        props = out["features"][0]["properties"]
        self.assertEqual(props["hebrew_name"], "שני לוק")
        self.assertAlmostEqual(props["source_lon"], 34.559255847)
        self.assertAlmostEqual(props["source_lat"], 31.505946785)
        lyrx = json.loads((pack_dir / "styles" / "people_names.lyrx").read_text(encoding="utf-8"))
        expression = lyrx["layerDefinitions"][0]["labelClasses"][0]["expression"]
        self.assertIn("hebrew_name", expression)
        self.assertEqual(summary["layers"]["people"]["overlay"]["hebrew_name"], 1)


NOVA_SITE_POLYGON = {
    "type": "Polygon",
    "coordinates": [[
        [34.46865421797836, 31.39786792616594],
        [34.47042663746633, 31.39746452642137],
        [34.47068868562143, 31.398194820700727],
        [34.470195830580955, 31.398634093987706],
        [34.47069554966174, 31.399682468196676],
        [34.469303307614744, 31.39939757929375],
        [34.46865421797836, 31.39786792616594],
    ]],
}


def _nli_zip_with_polygons(tmp, polygons):
    zip_path = tmp / "nli.zip"
    people = {
        "type": "FeatureCollection",
        "features": [_point(34.47, 31.40, name="Ada", oct7_pid=1)],
    }
    empty = {"type": "FeatureCollection", "features": []}
    with zipfile.ZipFile(zip_path, "w") as archive:
        archive.writestr("geojson/people_7_10.json", json.dumps(people))
        archive.writestr("geojson/polygons_7_10.geojson", json.dumps(polygons))
        archive.writestr("geojson/lines_7_10.geojson", json.dumps(empty))
    return zip_path


def _reim_settlement_feature():
    return {
        "type": "Feature",
        "id": "nli-settlement-outline-18",
        "properties": {"outlineObjectId": 18, "locations": ["רעים"]},
        "geometry": {
            "type": "Polygon",
            "coordinates": [[[34.45, 31.38], [34.46, 31.38], [34.46, 31.39], [34.45, 31.38]]],
        },
    }


def _polygon_100_collection():
    return {
        "type": "FeatureCollection",
        "features": [
            {
                "type": "Feature",
                "id": 100,
                "properties": {
                    "OBJECTID": 100,
                    "מיקום": "נובה",
                    "Name": "מוקד לחימה 4 - מתחם הנובה",
                    "timeline": "local 08:20",
                },
                "geometry": copy.deepcopy(NOVA_SITE_POLYGON),
            }
        ],
    }


class NovaSiteSettlementSidecarTests(unittest.TestCase):
    def test_prepare_fails_closed_without_processed_seed_sidecar(self):
        tmp = Path(tempfile.mkdtemp())
        zip_path = _nli_zip_with_polygons(tmp, _polygon_100_collection())
        pack_dir = tmp / "nli"
        gis_dir = pack_dir / "gis"
        gis_dir.mkdir(parents=True)
        leftover = gis_dir / "investigation_settlements.geojson"
        leftover.write_text(
            json.dumps({"type": "FeatureCollection", "features": [_reim_settlement_feature()]}),
            encoding="utf-8",
        )
        processed_layers_dir = tmp / "processed"
        summary = prepare_nli_pack(
            zip_path,
            pack_dir,
            authorities_path=tmp / "missing.json",
            processed_layers_dir=processed_layers_dir,
        )
        self.assertFalse(leftover.exists())
        self.assertFalse((gis_dir / "investigation_settlements.geojson").exists())
        self.assertFalse((processed_layers_dir / "investigation_settlements.geojson").exists())
        self.assertNotIn("investigation_settlements", summary["layers"])

    def test_prepare_copies_polygon_100_into_processed_investigation_settlements(self):
        tmp = Path(tempfile.mkdtemp())
        zip_path = _nli_zip_with_polygons(tmp, _polygon_100_collection())
        pack_dir = tmp / "nli"
        processed_layers_dir = tmp / "processed"
        processed_layers_dir.mkdir()
        (processed_layers_dir / "investigation_settlements.geojson").write_text(
            json.dumps({"type": "FeatureCollection", "features": [_reim_settlement_feature()]}),
            encoding="utf-8",
        )
        summary = prepare_nli_pack(
            zip_path,
            pack_dir,
            authorities_path=tmp / "missing.json",
            processed_layers_dir=processed_layers_dir,
        )
        gis_sidecar = pack_dir / "gis" / "investigation_settlements.geojson"
        self.assertFalse(gis_sidecar.exists())
        settlements_path = processed_layers_dir / "investigation_settlements.geojson"
        self.assertTrue(settlements_path.is_file())
        settlements = json.loads(settlements_path.read_text(encoding="utf-8"))
        nova = next(
            (
                feat
                for feat in settlements.get("features") or []
                if (feat.get("properties") or {}).get("outlineObjectId") == 100
            ),
            None,
        )
        self.assertIsNotNone(nova)
        self.assertEqual(nova["properties"]["locations"], ["נובה"])
        polygons_out = json.loads(
            (pack_dir / "gis" / "investigation_polygons.geojson").read_text(encoding="utf-8")
        )
        site = next(
            feat
            for feat in polygons_out["features"]
            if feat["properties"]["OBJECTID"] == 100
        )
        self.assertEqual(nova["geometry"], site["geometry"])
        self.assertEqual(summary["layers"]["investigation_settlements"]["features"], 2)
        self.assertNotIn("investigation_settlements", NLI_POPUP_CONFIG["nli"]["layers"])

    def test_prepare_keeps_reim_18_and_does_not_alias_nova_onto_it(self):
        tmp = Path(tempfile.mkdtemp())
        zip_path = _nli_zip_with_polygons(tmp, _polygon_100_collection())
        pack_dir = tmp / "nli"
        gis_dir = pack_dir / "gis"
        gis_dir.mkdir(parents=True)
        leftover_gis = gis_dir / "investigation_settlements.geojson"
        leftover_gis.write_text(
            json.dumps({"type": "FeatureCollection", "features": [_reim_settlement_feature()]}),
            encoding="utf-8",
        )
        processed_layers_dir = tmp / "processed"
        processed_layers_dir.mkdir()
        (processed_layers_dir / "investigation_settlements.geojson").write_text(
            json.dumps({"type": "FeatureCollection", "features": [_reim_settlement_feature()]}),
            encoding="utf-8",
        )
        prepare_nli_pack(
            zip_path,
            pack_dir,
            authorities_path=tmp / "missing.json",
            processed_layers_dir=processed_layers_dir,
        )
        self.assertFalse(leftover_gis.exists())
        settlements = json.loads(
            (processed_layers_dir / "investigation_settlements.geojson").read_text(encoding="utf-8")
        )
        by_id = {
            feat["properties"]["outlineObjectId"]: feat["properties"]
            for feat in settlements["features"]
        }
        self.assertEqual(by_id[18]["locations"], ["רעים"])
        self.assertNotIn("נובה", by_id[18]["locations"])
        self.assertEqual(by_id[100]["locations"], ["נובה"])
        self.assertEqual({feat["properties"]["outlineObjectId"] for feat in settlements["features"]}, {18, 100})


class KeepStemsFleeingTests(unittest.TestCase):
    def test_keep_stems_include_fleeing_and_not_popup_or_zip_map(self):
        self.assertIn("fleeing_route", NLI_KEEP_STEMS)
        self.assertIn("fleeing_route_overlapp", NLI_KEEP_STEMS)
        self.assertNotIn("fleeing_route", ZIP_LAYER_MAP.values())
        self.assertNotIn("fleeing_route_overlapp", ZIP_LAYER_MAP.values())
        self.assertNotIn("fleeing_route", NLI_POPUP_CONFIG["nli"]["layers"])
        self.assertNotIn("fleeing_route_overlapp", NLI_POPUP_CONFIG["nli"]["layers"])

    def test_fleeing_overlay_urls_use_exhibit_public_prefix(self):
        self.assertEqual(
            FLEEING_ROUTE_URL,
            "/otef-interactive/public/processed/layers/nli/fleeing_route.geojson",
        )
        self.assertEqual(
            FLEEING_ROUTE_OVERLAPP_URL,
            "/otef-interactive/public/processed/layers/nli/fleeing_route_overlapp.geojson",
        )
        self.assertNotEqual(
            FLEEING_ROUTE_URL, "/processed/layers/nli/fleeing_route.geojson"
        )
        self.assertNotEqual(
            FLEEING_ROUTE_OVERLAPP_URL,
            "/processed/layers/nli/fleeing_route_overlapp.geojson",
        )

    def test_reverse_puts_vertex0_at_nova_and_swaps_taper(self):
        collection = reverse_fleeing_individuals(load_fixture_3857())
        reproject_web_mercator_collection_to_wgs84(collection)
        nova = (34.46975, 31.39851)
        self.assertEqual(tuple(NOVA_FACILITY_WGS84), nova)
        for feat in collection["features"]:
            lon, lat = feat["geometry"]["coordinates"][0]
            self.assertLess(haversine_m((lon, lat), nova), 25)
            self.assertNotEqual(feat["properties"].get("flow_direction"), "reverse")
            self.assertNotIn("flow_direction", feat["properties"])
            self.assertIn("OBJECTID", feat["properties"])
            taper = feat["properties"]["acrossLine"]
            self.assertGreater(taper["taperFromWidthPt"], taper["taperToWidthPt"])
            self.assertEqual(taper["fromColor"], "#f5f500")
            self.assertEqual(taper["toColor"], "#f50000")
            self.assertEqual(taper["gradientSize"], 0.75)
            self.assertEqual(taper["widthPt"], 1)
            self.assertEqual(taper["opacity"], 0.6)
        west, south, east, north = _collection_bbox(collection)
        self.assertLessEqual(west, nova[0])
        self.assertLessEqual(south, nova[1])
        self.assertGreaterEqual(east, nova[0])
        self.assertGreaterEqual(north, nova[1])
        self.assertEqual(NOVA_FLEEING_ENVELOPE, (34.36128, 31.23319, 34.60479, 31.52479))

    def test_overlap_count_is_class_width_not_1pt(self):
        collection = reverse_fleeing_overlap(load_overlap_fixture())
        feat235 = next(f for f in collection["features"] if f["properties"]["COUNT_"] == 235)
        ir = feat235["properties"]["acrossLine"]
        self.assertEqual(ir["widthPt"], 4)
        self.assertEqual(ir["taperFromWidthPt"], 4)
        self.assertEqual(ir["taperToWidthPt"], 0)
        self.assertNotEqual(ir["widthPt"], 2.25)
        self.assertNotEqual(ir["widthPt"], 1)
        self.assertEqual(ir["fromColor"], "#f5f500")
        self.assertEqual(ir["toColor"], "#f50000")
        feat1 = next(f for f in collection["features"] if f["properties"]["COUNT_"] == 1)
        self.assertEqual(feat1["properties"]["acrossLine"]["widthPt"], 0.5)
        self.assertEqual(feat1["properties"]["acrossLine"]["taperFromWidthPt"], 0.5)
        self.assertEqual(feat1["properties"]["acrossLine"]["taperToWidthPt"], 0)
        self.assertEqual(feat1["properties"]["COUNT_"], 1)
        self.assertNotEqual(feat1["properties"].get("flow_direction"), "reverse")

    def test_install_rejects_sha256_mismatch(self):
        tmp = Path(tempfile.mkdtemp())
        geojson_zip, lyrx_zip = _write_fleeing_fixture_zips(tmp)
        with self.assertRaises(ValueError):
            install_nli_fleeing_overlays(
                tmp / "processed",
                geojson_zip,
                lyrx_zip,
                expected_geojson_sha256="0" * 64,
                expected_lyrx_sha256=sha256_file(lyrx_zip),
            )

    def test_fleeing_stems_are_not_written_to_gis_dir_or_styles_dir(self):
        tmp = Path(tempfile.mkdtemp())
        zip_path = tmp / "nli.zip"
        people = {
            "type": "FeatureCollection",
            "features": [_point(34.47, 31.40, name="Ada", hebrew_name="עדה", status="Murdered", oct7_pid=1)],
        }
        empty = {"type": "FeatureCollection", "features": []}
        with zipfile.ZipFile(zip_path, "w") as archive:
            archive.writestr("geojson/people_7_10.json", json.dumps(people))
            archive.writestr("geojson/polygons_7_10.geojson", json.dumps(empty))
            archive.writestr("geojson/lines_7_10.geojson", json.dumps(empty))
        pack_dir = tmp / "nli"
        processed_dir = tmp / "processed" / "layers" / "nli"
        geojson_zip, lyrx_zip = _write_fleeing_fixture_zips(tmp)
        prepare_nli_pack(
            zip_path,
            pack_dir,
            authorities_path=tmp / "missing.json",
            processed_layers_dir=processed_dir,
            fleeing_geojson_zip=geojson_zip,
            fleeing_lyrx_zip=lyrx_zip,
        )
        gis_dir = pack_dir / "gis"
        styles_dir = pack_dir / "styles"
        stems = ("fleeing_route", "fleeing_route_overlapp")
        for stem in stems:
            self.assertFalse(any(path.stem == stem for path in gis_dir.iterdir()))
            self.assertFalse(any(path.stem == stem for path in styles_dir.iterdir()))
        self.assertTrue((processed_dir / "fleeing_route.geojson").is_file())
        self.assertTrue((processed_dir / "fleeing_route_overlapp.geojson").is_file())
        individual = json.loads(
            (processed_dir / "fleeing_route.geojson").read_text(encoding="utf-8")
        )
        lon, lat = individual["features"][0]["geometry"]["coordinates"][0]
        self.assertLess(haversine_m((lon, lat), tuple(NOVA_FACILITY_WGS84)), 25)
        overlap = json.loads(
            (processed_dir / "fleeing_route_overlapp.geojson").read_text(encoding="utf-8")
        )
        feat235 = next(
            feat
            for feat in overlap["features"]
            if feat["properties"]["COUNT_"] == 235
        )
        self.assertEqual(feat235["properties"]["acrossLine"]["widthPt"], 4)
        self.assertEqual(feat235["properties"]["acrossLine"]["taperFromWidthPt"], 4)
        self.assertEqual(FLEEING_GEOJSON_ZIP_SHA256, FLEEING_GEOJSON_ZIP_SHA256.lower())
        self.assertEqual(len(FLEEING_GEOJSON_ZIP_SHA256), 64)
        self.assertEqual(len(FLEEING_LYRX_ZIP_SHA256), 64)

    def test_owner_zips_reverse_to_spec_envelope(self):
        geojson_zip = Path.home() / "Downloads" / "fleeing_route_geojson.zip"
        lyrx_zip = Path.home() / "Downloads" / "Fleeing_route_lyrx.zip"
        if not geojson_zip.is_file() or not lyrx_zip.is_file():
            self.skipTest("owner fleeing zips are not in Downloads")
        self.assertEqual(sha256_file(geojson_zip), FLEEING_GEOJSON_ZIP_SHA256)
        self.assertEqual(sha256_file(lyrx_zip), FLEEING_LYRX_ZIP_SHA256)
        tmp = Path(tempfile.mkdtemp())
        processed_dir = tmp / "processed" / "layers" / "nli"
        install_nli_fleeing_overlays(
            processed_dir,
            geojson_zip,
            lyrx_zip,
            expected_geojson_sha256=FLEEING_GEOJSON_ZIP_SHA256,
            expected_lyrx_sha256=FLEEING_LYRX_ZIP_SHA256,
        )
        individual = json.loads(
            (processed_dir / "fleeing_route.geojson").read_text(encoding="utf-8")
        )
        nova = tuple(NOVA_FACILITY_WGS84)
        self.assertEqual(len(individual["features"]), 416)
        for feat in individual["features"]:
            lon, lat = feat["geometry"]["coordinates"][0]
            self.assertLess(haversine_m((lon, lat), nova), 25)
            self.assertNotIn("flow_direction", feat["properties"])
            taper = feat["properties"]["acrossLine"]
            self.assertGreater(taper["taperFromWidthPt"], taper["taperToWidthPt"])
            self.assertEqual(taper["fromColor"], "#f5f500")
            self.assertEqual(taper["toColor"], "#f50000")
        west, south, east, north = _collection_bbox(individual)
        spec_w, spec_s, spec_e, spec_n = NOVA_FLEEING_ENVELOPE
        self.assertAlmostEqual(west, spec_w, places=5)
        self.assertAlmostEqual(south, spec_s, places=5)
        self.assertAlmostEqual(east, spec_e, places=5)
        self.assertAlmostEqual(north, spec_n, places=5)
        overlap = json.loads(
            (processed_dir / "fleeing_route_overlapp.geojson").read_text(encoding="utf-8")
        )
        feat235 = next(
            feat
            for feat in overlap["features"]
            if feat["properties"]["COUNT_"] == 235
        )
        self.assertEqual(feat235["properties"]["acrossLine"]["widthPt"], 4)
        self.assertEqual(feat235["properties"]["acrossLine"]["taperFromWidthPt"], 4)
        self.assertNotEqual(feat235["properties"]["acrossLine"]["widthPt"], 2.25)

    def test_generate_nova_escape_index_invokes_node_with_explicit_paths(self):
        tmp = Path(tempfile.mkdtemp())
        inputs = [tmp / name for name in ("routes.geojson", "polygons.geojson", "lines.geojson", "settlements.geojson")]
        for path in inputs:
            path.write_text('{"type":"FeatureCollection","features":[]}', encoding="utf-8")
        output = tmp / "fleeing_route_impacts.json"
        with patch("nli_pack_prep.shutil.which", return_value="node"), patch(
            "nli_pack_prep.subprocess.run"
        ) as run:
            self.assertTrue(generate_nova_escape_index(*inputs, output))
        generator = Path(__file__).resolve().parents[1] / "generate-nova-escape-index.mjs"
        run.assert_called_once_with(
            ["node", "--experimental-detect-module", str(generator), *(str(path) for path in inputs), str(output)],
            check=True,
        )

    def test_missing_node_removes_stale_index_before_raising(self):
        tmp = Path(tempfile.mkdtemp())
        inputs = [tmp / name for name in ("routes.geojson", "polygons.geojson", "lines.geojson", "settlements.geojson")]
        for path in inputs:
            path.write_text('{"type":"FeatureCollection","features":[]}', encoding="utf-8")
        output = tmp / "fleeing_route_impacts.json"
        output.write_text("stale", encoding="utf-8")
        with patch("nli_pack_prep.shutil.which", return_value=None):
            with self.assertRaisesRegex(RuntimeError, "Node.js is required"):
                generate_nova_escape_index(*inputs, output)
        self.assertFalse(output.exists())

    def test_prepare_reports_impact_index_only_after_successful_helper(self):
        tmp = Path(tempfile.mkdtemp())
        zip_path = _nli_zip_with_polygons(tmp, _polygon_100_collection())
        pack_dir = tmp / "nli"
        processed_dir = tmp / "processed"
        processed_dir.mkdir()
        (processed_dir / "fleeing_route.geojson").write_text(
            '{"type":"FeatureCollection","features":[]}', encoding="utf-8"
        )
        (processed_dir / "investigation_settlements.geojson").write_text(
            json.dumps({"type": "FeatureCollection", "features": [_reim_settlement_feature()]}),
            encoding="utf-8",
        )
        with patch("nli_pack_prep.generate_nova_escape_index", return_value=False):
            failed = prepare_nli_pack(
                zip_path,
                pack_dir,
                authorities_path=tmp / "missing.json",
                processed_layers_dir=processed_dir,
            )
        self.assertNotIn("impact_index", failed.get("fleeing_overlays", {}))
        with patch("nli_pack_prep.generate_nova_escape_index", return_value=True):
            succeeded = prepare_nli_pack(
                zip_path,
                pack_dir,
                authorities_path=tmp / "missing.json",
                processed_layers_dir=processed_dir,
            )
        self.assertEqual(
            succeeded["fleeing_overlays"]["impact_index"],
            str(processed_dir / "fleeing_route_impacts.json"),
        )

    def test_missing_settlements_removes_stale_index_and_keeps_route_overlays(self):
        tmp = Path(tempfile.mkdtemp())
        zip_path = _nli_zip_with_polygons(tmp, _polygon_100_collection())
        pack_dir = tmp / "nli"
        processed_dir = tmp / "processed"
        stale = processed_dir / "fleeing_route_impacts.json"
        processed_dir.mkdir()
        stale.write_text("stale", encoding="utf-8")
        geojson_zip, lyrx_zip = _write_fleeing_fixture_zips(tmp)
        summary = prepare_nli_pack(
            zip_path,
            pack_dir,
            authorities_path=tmp / "missing.json",
            processed_layers_dir=processed_dir,
            fleeing_geojson_zip=geojson_zip,
            fleeing_lyrx_zip=lyrx_zip,
        )
        self.assertFalse(stale.exists())
        self.assertNotIn("impact_index", summary["fleeing_overlays"])
        self.assertTrue((processed_dir / "fleeing_route.geojson").is_file())
        self.assertTrue((processed_dir / "fleeing_route_overlapp.geojson").is_file())

    def test_prepare_without_fleeing_archives_regenerates_existing_route_index(self):
        tmp = Path(tempfile.mkdtemp())
        zip_path = _nli_zip_with_polygons(tmp, _polygon_100_collection())
        pack_dir = tmp / "nli"
        processed_dir = tmp / "processed"
        processed_dir.mkdir()
        route_path = processed_dir / "fleeing_route.geojson"
        route_path.write_text(
            '{"type":"FeatureCollection","features":[]}', encoding="utf-8"
        )
        settlements_path = processed_dir / "investigation_settlements.geojson"
        settlements_path.write_text(
            json.dumps({"type": "FeatureCollection", "features": [_reim_settlement_feature()]}),
            encoding="utf-8",
        )
        with patch("nli_pack_prep.generate_nova_escape_index", return_value=True) as generate:
            summary = prepare_nli_pack(
                zip_path,
                pack_dir,
                authorities_path=tmp / "missing.json",
                processed_layers_dir=processed_dir,
            )
        polygon_path = pack_dir / "gis" / "investigation_polygons.geojson"
        lines_path = pack_dir / "gis" / "lines.geojson"
        output_path = processed_dir / "fleeing_route_impacts.json"
        generate.assert_called_once_with(route_path, polygon_path, lines_path, settlements_path, output_path)
        self.assertEqual(summary["fleeing_overlays"]["impact_index"], str(output_path))

    def test_checked_generation_failure_propagates_without_preserving_stale_index(self):
        tmp = Path(tempfile.mkdtemp())
        inputs = [tmp / name for name in ("routes.geojson", "polygons.geojson", "lines.geojson", "settlements.geojson")]
        for path in inputs:
            path.write_text('{"type":"FeatureCollection","features":[]}', encoding="utf-8")
        output = tmp / "fleeing_route_impacts.json"
        failure = subprocess.CalledProcessError(1, ["node"])

        def fail_after_writing_partial(command, *, check):
            self.assertTrue(check)
            Path(command[-1]).write_text("partial", encoding="utf-8")
            raise failure

        with patch("nli_pack_prep.shutil.which", return_value="node"), patch(
            "nli_pack_prep.subprocess.run", side_effect=fail_after_writing_partial
        ):
            with self.assertRaises(subprocess.CalledProcessError):
                generate_nova_escape_index(*inputs, output)
        self.assertFalse(output.exists())


if __name__ == "__main__":
    unittest.main()
