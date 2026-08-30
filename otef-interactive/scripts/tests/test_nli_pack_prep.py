import copy
import json
import tempfile
import unittest
import zipfile
from pathlib import Path

from nli_pack_prep import (
    ASHKELON_NORTH_FALLBACK_LAT,
    MITZPE_RAMON_LAT,
    OCT7_STATUS_CLASSES,
    NLI_CATEGORY_CLASSES,
    NLI_CATALOG_MARKER_SIZE,
    NLI_CATALOG_STROKE,
    NLI_CATALOG_STROKE_WIDTH,
    NLI_KEEP_STEMS,
    ZIP_LAYER_MAP,
    apply_alarm_timeline_minutes,
    apply_timeline_minutes,
    ashkelon_north_lat,
    attach_nli_catalog_links,
    city_centroid_in_story_band,
    collapse_alarms_to_cities,
    collect_timeline_beats,
    default_nli_zip_path,
    group_nli_category,
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

    def test_people_names_lyrx_is_labels_only_point_with_name_and_force_visible(self):
        payload = labels_only_point_lyrx()
        parsed = parse_lyrx_style(_write_lyrx(payload, "people_names.lyrx"))
        self.assertIsNotNone(parsed)
        data = parsed.to_dict()
        self.assertEqual(data["type"], "point")
        self.assertEqual(data["renderer"], "simple")
        self.assertNotIn("uniqueValues", data)
        labels = data["labels"]
        self.assertEqual(labels["field"], "name")
        self.assertTrue(labels["forceVisible"])
        self.assertFalse(labels["hebrewBidiWrap"])
        self.assertEqual(labels["font"], ["Guttman Hatzvi", "Noto Sans Regular"])
        self.assertEqual(labels["color"], "#ffffff")
        self.assertEqual(float(labels["size"]), 14.0)
        self.assertLessEqual(float(labels.get("haloSize") or 0), 0.35)
        self.assertGreater(float(labels.get("haloSize") or 0), 0)
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
        self.assertEqual(rewrite_oct7_status("Murdered then kidnapped"), "Murdered")

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
        self.assertEqual(rewrite_nli_layer_properties("people", oct7), 1)
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


if __name__ == "__main__":
    unittest.main()
