import json

from django.test import SimpleTestCase

from backend.supabase_proxy import enrich_feature_collection_with_submission_batch


class EnrichColabRouteGeometryBundleTests(SimpleTestCase):
    def test_enrich_attaches_colab_route_geometry_bundle_on_feature_collection_root(self):
        fc = {
            "type": "FeatureCollection",
            "features": [
                {
                    "type": "Feature",
                    "properties": {"submission_id": "550e8400-e29b-41d4-a716-446655440000"},
                    "geometry": {"type": "Point", "coordinates": [34.0, 31.0]},
                }
            ],
        }
        bundle = {
            "detour_export_version": 1,
            "integrated_route": {"solid": [], "removed": []},
            "detour_paint": {"road": [], "offroad": [], "junctions": []},
        }
        batch_row = {
            "submission_id": "550e8400-e29b-41d4-a716-446655440000",
            "submission_name": "t",
            "display_color": "#FF69B4",
            "colab_route_geometry_bundle": bundle,
        }

        out = enrich_feature_collection_with_submission_batch(
            fc, "550e8400-e29b-41d4-a716-446655440000", batch_row
        )
        self.assertIs(out, fc)
        self.assertEqual(out.get("colab_route_geometry_bundle"), bundle)
        props = out["features"][0]["properties"]
        self.assertEqual(props["submission_name"], "t")
        self.assertEqual(props["display_color"], "#FF69B4")

    def test_enrich_parses_bundle_json_string(self):
        sub_id = "550e8400-e29b-41d4-a716-446655440000"
        fc = {
            "type": "FeatureCollection",
            "features": [
                {
                    "type": "Feature",
                    "properties": {},
                    "geometry": {"type": "Point", "coordinates": [0, 0]},
                }
            ],
        }
        bundle = {"detour_export_version": 1, "a": 1}
        batch_row = {
            "submission_id": sub_id,
            "submission_name": "s",
            "colab_route_geometry_bundle": json.dumps(bundle),
        }
        out = enrich_feature_collection_with_submission_batch(fc, sub_id, batch_row)
        self.assertEqual(out.get("colab_route_geometry_bundle"), bundle)

    def test_enrich_skips_invalid_bundle_json_string(self):
        sub_id = "550e8400-e29b-41d4-a716-446655440000"
        fc = {
            "type": "FeatureCollection",
            "features": [
                {
                    "type": "Feature",
                    "properties": {},
                    "geometry": {"type": "Point", "coordinates": [0, 0]},
                }
            ],
        }
        batch_row = {
            "submission_id": sub_id,
            "submission_name": "s",
            "colab_route_geometry_bundle": "{not json",
        }
        out = enrich_feature_collection_with_submission_batch(fc, sub_id, batch_row)
        self.assertNotIn("colab_route_geometry_bundle", out)

    def test_enrich_omits_bundle_when_null(self):
        sub_id = "550e8400-e29b-41d4-a716-446655440000"
        fc = {
            "type": "FeatureCollection",
            "features": [
                {
                    "type": "Feature",
                    "properties": {},
                    "geometry": {"type": "Point", "coordinates": [0, 0]},
                }
            ],
        }
        batch_row = {
            "submission_id": sub_id,
            "submission_name": "s",
            "colab_route_geometry_bundle": None,
        }
        out = enrich_feature_collection_with_submission_batch(fc, sub_id, batch_row)
        self.assertNotIn("colab_route_geometry_bundle", out)
