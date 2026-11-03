from django.test import SimpleTestCase

from backend.supabase_proxy import enrich_feature_collection_with_submission_batch


class EnrichFeatureCollectionWithSubmissionBatchTests(SimpleTestCase):
    def test_enrich_sets_display_color_and_submission_name_from_list(self):
        sub_id = "550e8400-e29b-41d4-a716-446655440000"
        fc = {
            "type": "FeatureCollection",
            "features": [
                {
                    "type": "Feature",
                    "geometry": {"type": "Point", "coordinates": [34.0, 31.0]},
                    "properties": {"feature_type": "pink_line_node"},
                }
            ],
        }
        batch_rows = [
            {
                "submission_id": sub_id,
                "display_color": "#FF69B4",
                "submission_name": "Test",
            }
        ]
        out = enrich_feature_collection_with_submission_batch(fc, sub_id, batch_rows)
        self.assertIs(out, fc)
        props = out["features"][0]["properties"]
        self.assertEqual(props["display_color"], "#FF69B4")
        self.assertEqual(props["submission_name"], "Test")

    def test_enrich_matches_submission_id_case_insensitively(self):
        sub_id = "550e8400-e29b-41d4-a716-446655440000"
        fc = {
            "type": "FeatureCollection",
            "features": [
                {
                    "type": "Feature",
                    "geometry": {"type": "Point", "coordinates": [0, 0]},
                    "properties": {},
                }
            ],
        }
        batch_row = {
            "submission_id": sub_id.upper(),
            "display_color": "#00AAFF",
            "submission_name": "Case",
        }
        enrich_feature_collection_with_submission_batch(fc, sub_id.lower(), batch_row)
        props = fc["features"][0]["properties"]
        self.assertEqual(props["display_color"], "#00AAFF")
        self.assertEqual(props["submission_name"], "Case")

    def test_enrich_skips_invalid_display_color(self):
        sub_id = "550e8400-e29b-41d4-a716-446655440000"
        fc = {
            "type": "FeatureCollection",
            "features": [
                {
                    "type": "Feature",
                    "geometry": {"type": "Point", "coordinates": [0, 0]},
                    "properties": {"display_color": "#111111"},
                }
            ],
        }
        batch_row = {
            "submission_id": sub_id,
            "display_color": "url(javascript:alert(1))",
            "submission_name": "N",
        }
        enrich_feature_collection_with_submission_batch(fc, sub_id, batch_row)
        props = fc["features"][0]["properties"]
        self.assertEqual(props["display_color"], "#111111")
        self.assertEqual(props["submission_name"], "N")

    def test_enrich_none_batch_is_noop(self):
        fc = {
            "type": "FeatureCollection",
            "features": [
                {
                    "type": "Feature",
                    "geometry": {"type": "Point", "coordinates": [0, 0]},
                    "properties": {"a": 1},
                }
            ],
        }
        out = enrich_feature_collection_with_submission_batch(
            fc, "550e8400-e29b-41d4-a716-446655440000", None
        )
        self.assertIs(out, fc)
        self.assertEqual(fc["features"][0]["properties"], {"a": 1})
