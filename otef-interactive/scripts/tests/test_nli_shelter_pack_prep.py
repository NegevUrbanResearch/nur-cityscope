"""Shelter preparation consumes installed processed Nova routes."""

import json
import tempfile
import unittest
import zipfile
from pathlib import Path
from unittest.mock import patch

import nli_pack_prep


class ShelterPackOrderTests(unittest.TestCase):
    def test_shelters_follow_processed_route_installation(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            archive_path = root / "source.zip"
            empty = {"type": "FeatureCollection", "features": []}
            people = {"type": "FeatureCollection", "features": [{
                "type": "Feature", "properties": {"pid": 1, "name": "Ada"},
                "geometry": {"type": "Point", "coordinates": [34.47, 31.4]},
            }]}
            with zipfile.ZipFile(archive_path, "w") as archive:
                archive.writestr("geojson/people_7_10.json", json.dumps(people))
                archive.writestr("geojson/polygons_7_10.geojson", json.dumps(empty))
                archive.writestr("geojson/lines_7_10.geojson", json.dumps(empty))
            processed = root / "processed"
            def install(destination, *args, **kwargs):
                destination.mkdir(parents=True, exist_ok=True)
                (destination / "fleeing_route.geojson").write_text(json.dumps(empty))
                return {"installed": True}
            def prepare(fixture, people_path, output, *, routes_path):
                self.assertEqual(routes_path, processed / "fleeing_route.geojson")
                self.assertTrue(routes_path.is_file())
                person = json.loads(people_path.read_text())["features"][0]["properties"]
                self.assertEqual(person["name"], "Ada")
                self.assertEqual([person["source_lon"], person["source_lat"]], [34.47, 31.4])
                return {"file": "shelters_232.geojson"}
            with patch("nli_pack_prep.install_nli_fleeing_overlays", side_effect=install), patch(
                "nli_pack_prep.generate_nova_escape_index", return_value=False
            ), patch("otef_layer_processing.nli_shelters.prepare_shelters_232", side_effect=prepare) as shelters:
                nli_pack_prep.prepare_nli_pack(
                    archive_path, root / "pack", authorities_path=root / "missing.json",
                    processed_layers_root=processed, processed_layers_dir=processed,
                    curation_recipe_path=root / "otef-interactive/scripts/recipe.json",
                    curation_lock_path=root / "otef-interactive/scripts/lock.json",
                    fleeing_geojson_zip=root / "routes.zip", fleeing_lyrx_zip=root / "styles.zip",
                    shelter_fixture_path=root / "shelters.json",
                )
                shelters.assert_called_once()
