import copy
import json
import tempfile
import unittest
import zipfile
from pathlib import Path

from nli_pack_prep import (
    OCT7_STATUS_CLASSES,
    NLI_CATEGORY_CLASSES,
    NLI_CATALOG_MARKER_SIZE,
    NLI_CATALOG_STROKE,
    NLI_CATALOG_STROKE_WIDTH,
    apply_timeline_minutes,
    collect_timeline_beats,
    group_nli_category,
    jitter_coincident_points,
    merge_popup_config,
    NLI_POPUP_CONFIG,
    object_ids_active_at,
    parse_local_timeline_to_minutes,
    reproject_web_mercator_collection_to_wgs84,
    rewrite_nli_layer_properties,
    rewrite_oct7_status,
    sanitize_time_like_properties,
    simple_polygon_lyrx,
    unique_value_point_lyrx,
    unit_from_seed,
    zip_entry_name,
)
from otef_layer_processing.styles import parse_lyrx_style


def _point(lon, lat, **props):
    return {
        "type": "Feature",
        "properties": props,
        "geometry": {"type": "Point", "coordinates": [lon, lat]},
    }


class ZipEntryNameTests(unittest.TestCase):
    def test_reads_infozip_unicode_path_extra_field(self):
        zip_path = (
            Path(__file__).resolve().parents[3]
            / "geojson-20260818T050200Z-1-001.zip"
        )
        self.assertTrue(zip_path.is_file(), f"missing {zip_path}")
        with zipfile.ZipFile(zip_path) as zf:
            names = [zip_entry_name(info) for info in zf.infolist()]
        self.assertIn("geojson/פוליגונים מתחקירים.geojson", names)
        self.assertIn("geojson/oct7database_mid_manual_gitit.geojson", names)
        self.assertIn("geojson/noam_layer.geojson", names)


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
        self.assertNotIn("source_lon", features[0]["properties"])

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


def _write_lyrx(payload):
    tmp = Path(tempfile.mkdtemp()) / "layer.lyrx"
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

    def test_nli_catalog_lyrx_uses_amber_fill_dark_stroke_and_smaller_size(self):
        parsed = parse_lyrx_style(
            _write_lyrx(
                unique_value_point_lyrx(
                    "categories",
                    NLI_CATEGORY_CLASSES,
                    size=NLI_CATALOG_MARKER_SIZE,
                    stroke=NLI_CATALOG_STROKE,
                    shape="square",
                    stroke_width=NLI_CATALOG_STROKE_WIDTH,
                )
            )
        )
        self.assertIsNotNone(parsed)
        data = parsed.to_dict()
        classes = data["uniqueValues"]["classes"]
        markers = [
            layer
            for layer in classes[0]["symbol"]["symbolLayers"]
            if layer.get("type") == "markerPoint"
        ]
        self.assertTrue(markers)
        self.assertEqual(markers[0]["marker"]["fillColor"], "#d97706")
        self.assertNotEqual(markers[0]["marker"]["fillColor"], "#b42318")
        self.assertEqual(markers[0]["marker"]["strokeColor"], "#0f172a")
        self.assertAlmostEqual(markers[0]["marker"]["size"], 10.0 * (96 / 72))
        self.assertAlmostEqual(markers[0]["marker"]["strokeWidth"], 0.6 * (96 / 72))
        self.assertEqual(markers[0]["marker"]["shape"], "square")
        self.assertEqual(NLI_CATALOG_MARKER_SIZE, 10.0)
        self.assertEqual(NLI_CATALOG_STROKE_WIDTH, 0.6)


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

    def test_nli_category_classes_are_three_and_not_oct7_palette(self):
        self.assertEqual(len(NLI_CATEGORY_CLASSES), 3)
        self.assertEqual(
            [row[0] for row in NLI_CATEGORY_CLASSES],
            ["Victims of terrorism", "Fallen soldiers", "Kidnapping victims"],
        )
        self.assertEqual(NLI_CATEGORY_CLASSES[0][2], (217, 119, 6))
        self.assertEqual(NLI_CATEGORY_CLASSES[1][2], (109, 40, 217))
        self.assertEqual(NLI_CATEGORY_CLASSES[2][2], (8, 145, 178))
        oct7_fills = {row[2] for row in OCT7_STATUS_CLASSES}
        catalog_fills = {row[2] for row in NLI_CATEGORY_CLASSES}
        self.assertFalse(catalog_fills & oct7_fills)


class GroupingTests(unittest.TestCase):
    def test_bibas_status_rewrites_to_murdered_in_captivity(self):
        self.assertEqual(
            rewrite_oct7_status("Murdered in captivity (bibas)"),
            "Murdered in captivity",
        )
        self.assertEqual(rewrite_oct7_status("Murdered"), "Murdered")
        self.assertEqual(rewrite_oct7_status("Killed on duty"), "Killed on duty")

    def test_kidnapping_substring_wins_category_group(self):
        self.assertEqual(
            group_nli_category("Victims of terrorism; Kidnapping victims"),
            "Kidnapping victims",
        )
        self.assertEqual(
            group_nli_category("Fallen soldiers; Kidnapping victims"),
            "Kidnapping victims",
        )
        self.assertEqual(group_nli_category("Kidnapping victims"), "Kidnapping victims")
        self.assertEqual(group_nli_category("Fallen soldiers"), "Fallen soldiers")
        self.assertEqual(
            group_nli_category("Tourists; Victims of terrorism"),
            "Victims of terrorism",
        )
        self.assertEqual(
            group_nli_category("Victims of terrorism; People with disabilities"),
            "Victims of terrorism",
        )
        self.assertEqual(group_nli_category(""), "")
        self.assertIsNone(group_nli_category(None))

    def test_rewrite_nli_layer_properties_mutates_status_and_categories(self):
        oct7 = {
            "features": [
                _point(34.47, 31.40, status="Murdered in captivity (bibas)"),
                _point(34.48, 31.41, status="Murdered"),
            ]
        }
        catalog = {
            "features": [
                _point(34.47, 31.40, categories="Fallen soldiers; Kidnapping victims"),
                _point(34.48, 31.41, categories="Victims of terrorism"),
            ]
        }
        self.assertEqual(rewrite_nli_layer_properties("oct7_database", oct7), 1)
        self.assertEqual(
            oct7["features"][0]["properties"]["status"],
            "Murdered in captivity",
        )
        self.assertEqual(oct7["features"][1]["properties"]["status"], "Murdered")
        self.assertEqual(rewrite_nli_layer_properties("nli_catalog", catalog), 1)
        self.assertEqual(
            catalog["features"][0]["properties"]["categories"],
            "Kidnapping victims",
        )
        self.assertEqual(
            catalog["features"][1]["properties"]["categories"],
            "Victims of terrorism",
        )


class PreparePackTests(unittest.TestCase):
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
        self.assertIn("nli_catalog", data["nli"]["layers"])
        self.assertNotIn("legendLabel", data["nli"]["layers"]["oct7_database"])
        self.assertNotIn("legendLabel", data["nli"]["layers"]["nli_catalog"])
        self.assertEqual(
            data["nli"]["layers"]["investigation_polygons"]["legendLabel"],
            "Investigation polygons",
        )

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
        snippet = src[nli_idx : nli_idx + 400]
        self.assertIn("investigation_polygons", snippet)
        self.assertIn('"type": "timeline"', snippet)
        self.assertIn("enabledByDefault", snippet)

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


if __name__ == "__main__":
    unittest.main()
