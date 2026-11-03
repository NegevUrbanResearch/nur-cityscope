import copy
import hashlib
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from otef_layer_processing.nli_shelters import (
    prepare_shelters_232,
    merge_shelter_resource,
    stage_shelter_cohort,
    DEFAULT_FIXTURE,
)


class ShelterPreparationTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.fixture = json.loads(DEFAULT_FIXTURE.read_text(encoding="utf-8"))
        self.people = self.root / "people.geojson"
        self.people.write_text(
            json.dumps(
                {
                    "features": [
                        {"properties": {"pid": pid}}
                        for s in self.fixture["shelters"]
                        for pid in s["personPids"]
                    ]
                }
            )
        )
        self.input = self.root / "fixture.json"

    def prepare(self):
        self.input.write_text(json.dumps(self.fixture))
        return prepare_shelters_232(self.input, self.people, self.root)

    def test_fixed_original_nine_groups_and_84_members(self):
        resource = self.prepare()
        raw = (self.root / resource["file"]).read_bytes()
        doc = json.loads(raw)
        self.assertEqual(len(doc["features"]), 9)
        self.assertEqual(
            len({p for f in doc["features"] for p in f["properties"]["personPids"]}), 84
        )
        south = next(f for f in doc["features"] if f["id"] == "nli-shelter-gama-south")
        self.assertEqual(south["geometry"]["coordinates"], [34.44717, 31.38013])
        self.assertEqual(resource["sha256"], hashlib.sha256(raw).hexdigest())

    def test_reorder_is_byte_and_version_identical(self):
        a = self.prepare()
        raw = (self.root / a["file"]).read_bytes()
        self.fixture["shelters"].reverse()
        for s in self.fixture["shelters"]:
            s["personPids"].reverse()
        self.assertEqual(a, self.prepare())
        self.assertEqual(raw, (self.root / a["file"]).read_bytes())

    def test_invalid_input_preserves_previous_output(self):
        resource = self.prepare()
        path = self.root / resource["file"]
        raw = path.read_bytes()
        original = copy.deepcopy(self.fixture)
        for mutate in [
            lambda: self.fixture["shelters"][0]["personPids"].append("unknown"),
            lambda: self.fixture["shelters"][0].update(
                id=self.fixture["shelters"][1]["id"]
            ),
            lambda: self.fixture["shelters"][0].update(coordinates=[float("nan"), 31]),
        ]:
            self.fixture = copy.deepcopy(original)
            mutate()
            with self.assertRaises(ValueError):
                self.prepare()
            self.assertEqual(raw, path.read_bytes())

    def test_route_bindings_share_sidecar_and_hash(self):
        routes = {"features": [{"properties": {"OBJECTID": 7}}]}
        route_path = self.root / "fleeing_route.geojson"
        route_path.write_text(json.dumps(routes))
        sid = self.fixture["shelters"][0]["id"]
        pid = self.fixture["shelters"][0]["personPids"][0]
        crosswalk = self.root / "routes.json"
        crosswalk.write_text(json.dumps({
            "schemaVersion": 1,
            "novaRoutesSHA256": hashlib.sha256(route_path.read_bytes()).hexdigest(),
            "bindings": [{"routeObjectId": 7, "personPid": pid, "shelterId": sid}],
        }))
        self.input.write_text(json.dumps(self.fixture))
        resource = prepare_shelters_232(self.input, self.people, self.root,
                                       route_fixture_path=crosswalk)
        doc = json.loads((self.root / resource["file"]).read_bytes())
        self.assertEqual(doc["novaRoutesSHA256"], hashlib.sha256(route_path.read_bytes()).hexdigest())
        feature = next(f for f in doc["features"] if f["id"] == sid)
        self.assertEqual(feature["properties"]["novaRouteObjectIds"], ["7"])
        before = (self.root / resource["file"]).read_bytes()
        route_path.write_text(json.dumps({"features": []}))
        with self.assertRaisesRegex(ValueError, "hash"):
            prepare_shelters_232(self.input, self.people, self.root,
                                 route_fixture_path=crosswalk)
        self.assertEqual(before, (self.root / resource["file"]).read_bytes())

    def test_route_binding_rejects_unknown_id_wrong_member_and_duplicate(self):
        route_path = self.root / "fleeing_route.geojson"
        route_path.write_text(json.dumps({"features": [{"properties": {"OBJECTID": 7}}]}))
        first, second = self.fixture["shelters"][:2]
        good = {"routeObjectId": 7, "personPid": first["personPids"][0], "shelterId": first["id"]}
        crosswalk = self.root / "routes.json"
        self.input.write_text(json.dumps(self.fixture))
        for bindings in [[{**good, "routeObjectId": 8}],
                         [{**good, "personPid": second["personPids"][0]}],
                         [good, good]]:
            crosswalk.write_text(json.dumps({"schemaVersion": 1,
                "novaRoutesSHA256": hashlib.sha256(route_path.read_bytes()).hexdigest(),
                "bindings": bindings}))
            with self.assertRaises(ValueError):
                prepare_shelters_232(self.input, self.people, self.root,
                                     route_fixture_path=crosswalk)

    def test_route_binding_rejects_changed_provenance(self):
        route_path = self.root / "fleeing_route.geojson"
        route_path.write_text(json.dumps({"features": [{"properties": {"OBJECTID": 7}}]}))
        group = self.fixture["shelters"][0]
        crosswalk = self.root / "routes.json"
        self.input.write_text(json.dumps(self.fixture))
        for key, value in [("personName", "changed"), ("originalMarkerCoordinates", [34, 31]),
                           ("routeLabel", "changed"), ("destinationCoordinates", [34, 31])]:
            crosswalk.write_text(json.dumps({"schemaVersion": 1,
                "novaRoutesSHA256": hashlib.sha256(route_path.read_bytes()).hexdigest(),
                "bindings": [{"routeObjectId": 7, "personPid": group["personPids"][0],
                              "shelterId": group["id"], key: value}]}))
            with self.assertRaisesRegex(ValueError, "provenance"):
                prepare_shelters_232(self.input, self.people, self.root,
                                     route_fixture_path=crosswalk)

    def test_explicit_processed_route_path_overrides_source_peer(self):
        source_route = self.root / "fleeing_route.geojson"
        source_route.write_text(json.dumps({"features": []}))
        processed_route = self.root / "processed-route.geojson"
        processed_route.write_text(json.dumps({"features": [{"properties": {"OBJECTID": 7}}]}))
        group = self.fixture["shelters"][0]
        crosswalk = self.root / "routes.json"
        crosswalk.write_text(json.dumps({"schemaVersion": 1,
            "novaRoutesSHA256": hashlib.sha256(processed_route.read_bytes()).hexdigest(),
            "bindings": [{"routeObjectId": 7, "personPid": group["personPids"][0],
                          "shelterId": group["id"]}]}))
        self.input.write_text(json.dumps(self.fixture))
        result = prepare_shelters_232(self.input, self.people, self.root,
            route_fixture_path=crosswalk, routes_path=processed_route)
        doc = json.loads((self.root / result["file"]).read_bytes())
        self.assertEqual(doc["novaRoutesSHA256"], hashlib.sha256(processed_route.read_bytes()).hexdigest())

    def test_default_accepted_fixture_requires_route_artifact(self):
        with self.assertRaisesRegex(ValueError, "missing"):
            prepare_shelters_232(DEFAULT_FIXTURE, self.people, self.root)

    def test_merge_refreshes_only_shelter_entry(self):
        self.prepare()
        result = merge_shelter_resource(
            {"other": {"file": "other.json"}, "shelters232": {"sha256": "old"}},
            self.root,
        )
        self.assertEqual(result["other"], {"file": "other.json"})
        self.assertNotEqual(result["shelters232"]["sha256"], "old")
        (self.root / "shelters_232.geojson").unlink()
        self.assertEqual(
            merge_shelter_resource(result, self.root), {"other": {"file": "other.json"}}
        )

    def test_failed_stage_never_mutates_accepted_cohort(self):
        self.prepare()
        manifest = {
            "layers": [
                {"id": "ציר_232", "resources": {"other": {"file": "other.json"}}}
            ]
        }
        (self.root / "manifest.json").write_text(json.dumps(manifest))
        (self.root / "release-metadata.json").write_text(
            '{"datasetVersion":"people-v1"}'
        )
        before = {p.name: p.read_bytes() for p in self.root.iterdir() if p.is_file()}
        output_temp = tempfile.TemporaryDirectory()
        self.addCleanup(output_temp.cleanup)
        destination = Path(output_temp.name) / "new-cohort"
        with patch(
            "otef_layer_processing.nli_shelters.stamp_nli_runtime_artifact_hash",
            side_effect=RuntimeError("publication failed"),
        ):
            with self.assertRaises(RuntimeError):
                stage_shelter_cohort(self.root, destination, self.input)
        self.assertFalse(destination.exists())
        self.assertEqual(
            before, {p.name: p.read_bytes() for p in self.root.iterdir() if p.is_file()}
        )
        stage_shelter_cohort(self.root, destination, self.input)
        updated = json.loads(
            (destination / "manifest.json").read_text(encoding="utf-8")
        )
        self.assertIn("shelters232", updated["layers"][0]["resources"])
        self.assertEqual(
            json.loads(
                (destination / "release-metadata.json").read_text(encoding="utf-8")
            )["datasetVersion"],
            "people-v1",
        )

    def test_cached_and_metadata_processing_refresh_shelters_and_keep_other_resources(
        self,
    ):
        from otef_layer_processing.orchestrator import ProcessingOrchestrator

        resource = self.prepare()
        source = self.root / "source" / "source" / "layers" / "nli"
        gis, styles = source / "gis", source / "styles"
        gis.mkdir(parents=True)
        styles.mkdir()
        road = gis / "ציר_232.geojson"
        road.write_text(
            json.dumps(
                {
                    "type": "FeatureCollection",
                    "features": [
                        {
                            "type": "Feature",
                            "properties": {},
                            "geometry": {
                                "type": "LineString",
                                "coordinates": [[34.4, 31.4], [34.5, 31.5]],
                            },
                        }
                    ],
                }
            )
        )
        # This synthetic cohort has no active Gaza-route release. Keep its
        # evidence paths local rather than borrowing the workstation's lock.
        curation_scripts = self.root / "otef-interactive" / "scripts"
        curation_options = {
            "curation_recipe_path": curation_scripts / "recipe.json",
            "curation_lock_path": curation_scripts / "missing-lock.json",
        }
        orchestrator = ProcessingOrchestrator(
            self.root / "source", self.root / "output", max_workers=1,
            **curation_options,
        )
        # The point resource is an independent existing processed sidecar.
        output = self.root / "output" / "nli"
        output.mkdir(parents=True)
        (output / "shelters_232.geojson").write_bytes(
            (self.root / "shelters_232.geojson").read_bytes()
        )
        task = {
            "pack_id": "nli",
            "geo_file": road,
            "styles_dir": styles,
            "pack_output": output,
        }
        first = orchestrator.process_single_layer(task, 30)
        self.assertEqual(first[0].to_dict()["resources"]["shelters232"], resource)
        orchestrator.cache[first[2]] = first[3]
        orchestrator.cache[first[2]]["resources"]["other"] = {"file": "other.json"}
        self.fixture["shelters"][0]["nameHe"] += " updated"
        newer = self.prepare()
        (output / "shelters_232.geojson").write_bytes(
            (self.root / "shelters_232.geojson").read_bytes()
        )
        cached = orchestrator.process_single_layer(task, 30)
        self.assertEqual(cached[0].to_dict()["resources"]["shelters232"], newer)
        self.assertEqual(
            cached[0].to_dict()["resources"]["other"], {"file": "other.json"}
        )
        (output / "manifest.json").write_text(
            json.dumps({"layers": [cached[0].to_dict()]})
        )
        fresh = ProcessingOrchestrator(
            self.root / "source", self.root / "output", no_cache=True, max_workers=1,
            **curation_options,
        )
        full = fresh.process_single_layer(task, 30)
        self.assertEqual(
            full[0].to_dict()["resources"]["other"], {"file": "other.json"}
        )
        self.assertEqual(full[0].to_dict()["resources"]["shelters232"], newer)
        orchestrator.update_metadata_only()
        manifest = json.loads((output / "manifest.json").read_text(encoding="utf-8"))
        entry = next(l for l in manifest["layers"] if l["id"] == "ציר_232")
        self.assertEqual(entry["resources"]["shelters232"], newer)
        self.assertEqual(entry["resources"]["other"], {"file": "other.json"})


if __name__ == "__main__":
    unittest.main()
