import sys
import copy
import hashlib
import json
from pathlib import Path
import unittest
import tempfile
import subprocess
import shutil
from unittest.mock import patch
from pyproj import Transformer

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "otef_layer_processing"))
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import nli_border_route_prepare as prepare_module
from nli_border_route_prepare import prepare_release, reconcile_preview


class PreviewReconciliationTests(unittest.TestCase):
    def test_origin_approach_preview_compares_both_endpoints_and_rejects_suffix(self):
        operation={"kind":"new_approach", "feature_id":1013, "parent_id":23, "shape":"origin_direction"}
        reference={"routes":[{"id":23,"proposed":[[0,0],[2,2],[3,3]]}]}
        self.assertEqual(prepare_module._operation_paths({1013:[[0,0],[2,2]]},reference,[operation])[0]["verticesCompared"],2)
        with self.assertRaisesRegex(ValueError,"like-for-like"):
            prepare_module._operation_paths({1013:[[0,0],[2,2],[3,3]]},reference,[operation])

    def _copy_pinned_prepare_inputs(self, root: Path) -> tuple[Path, Path]:
        worktree = Path(__file__).resolve().parents[3]
        app = worktree / "otef-interactive"
        runtime_bytes = (app / "tests/fixtures/nli-route-curation-runtime-baseline.geojson").read_bytes()
        runtime = json.loads(runtime_bytes)
        source = copy.deepcopy(runtime)
        for feature in source["features"]:
            feature["properties"].pop("flow_direction", None)
        source_bytes = json.dumps(source, ensure_ascii=False, separators=(",", ":")).encode()
        source_path, runtime_path = root / prepare_module.SOURCE, root / prepare_module.RUNTIME
        for path in (source_path, runtime_path, root / prepare_module.ROAD, root / prepare_module.BORDER,
                     root / prepare_module.METADATA, root / prepare_module.PRESENTER,
                     root / prepare_module.PROVENANCE, root / prepare_module.RECIPE):
            path.parent.mkdir(parents=True, exist_ok=True)
        source_path.write_bytes(source_bytes); runtime_path.write_bytes(runtime_bytes)
        road_bytes = b'{"type":"FeatureCollection","features":[]}'
        (root / prepare_module.ROAD).write_bytes(road_bytes)
        border_text = 'export default {"type":"FeatureCollection","features":[]};\n'
        (root / prepare_module.BORDER).write_text(border_text, encoding="utf-8", newline="\n")
        pins = dict(prepare_module.PINS)
        pins.update({"source": hashlib.sha256(source_bytes).hexdigest(),
                     "runtime": hashlib.sha256(runtime_bytes).hexdigest(),
                     "border": hashlib.sha256(border_text.encode()).hexdigest(),
                     "road": hashlib.sha256(road_bytes).hexdigest()})
        digest_cli = root / prepare_module.DIGEST_CLI
        digest_cli.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(worktree / prepare_module.DIGEST_CLI, digest_cli)
        result = subprocess.run(["node", str(digest_cli), "--file", str(runtime_path)],
                                cwd=root, capture_output=True, text=True, check=True)
        pins["confirmed"] = json.loads(result.stdout)["confirmedFeaturesSha256"]
        recipe_document = json.loads((worktree / prepare_module.RECIPE).read_text(encoding="utf-8"))
        recipe_document["expected_inputs"].update({
            "source_lines_sha256": pins["source"], "runtime_lines_sha256": pins["runtime"],
            "border_module_sha256_lf": pins["border"],
            "confirmed_features_sha256": pins["confirmed"]})
        (root / prepare_module.RECIPE).write_text(json.dumps(recipe_document), encoding="utf-8")
        metadata = {"sourceSha256": "a" * 64, "datasetVersion": "test-version", "counts": {"lines": 68}}
        presenter = {"acceptedSourceSha256": "a" * 64, "datasetVersion": "test-version", "records": {}}
        (root / prepare_module.METADATA).write_text(json.dumps(metadata), encoding="utf-8")
        (root / prepare_module.PRESENTER).write_text(json.dumps(presenter), encoding="utf-8")
        (root / prepare_module.PROVENANCE).write_text("{}", encoding="utf-8")
        support_files = [prepare_module.ASSEMBLER_CLI, prepare_module.VERIFIER_CLI,
            Path("otef-interactive/frontend/src/shared/nli-investigation-clock.js"),
            Path("otef-interactive/frontend/src/remote/nli-timeline-transport.js"),
            Path("otef-interactive/tests/fixtures/nli-presenter-navigation.json")]
        for relative in support_files:
            destination = root / relative
            destination.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(worktree / relative, destination)
        processed = root / prepare_module.PROCESSED
        for name in ("alarms.geojson", "investigation_polygons.geojson"):
            (processed / name).write_text('{"type":"FeatureCollection","features":[]}', encoding="utf-8")
        preview = root / "review/route-review-data.json"
        preview.parent.mkdir(parents=True, exist_ok=True)
        preview.write_text(json.dumps({"sourceSha256": pins["runtime"], "borderSha256": pins["border"], "routes": []}), encoding="utf-8")
        self.test_pins = pins
        return root / prepare_module.RECIPE, preview

    def test_check_mode_has_no_filesystem_writes_and_prepare_rejects_overlapping_targets(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp).resolve()
            recipe, preview = self._copy_pinned_prepare_inputs(root)
            staging = root / "unused-candidate"
            with patch("nli_border_route_prepare._validate_baseline", return_value=({}, {}, {}, {})):
                checked = prepare_release(root, recipe, staging, mode="check")
                self.assertEqual(checked["status"], "checked")
                self.assertFalse(staging.exists())
                with self.assertRaisesRegex(ValueError, "overlaps an active release path"):
                    prepare_module._validate_staging_location(root, root / prepare_module.RUNTIME)
                with self.assertRaisesRegex(ValueError, "overlaps an active release path"):
                    prepare_module._validate_staging_location(root, root / "otef-interactive")

    def test_check_mode_reconciles_an_explicit_preview_without_creating_stage_files(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp).resolve()
            recipe, preview = self._copy_pinned_prepare_inputs(root)
            staging = root / "check-only-stage"
            reconciliation = {"status": "passed", "comparedOperations": list(range(18)),
                              "toleranceMeters": 2.0}
            with patch.dict(prepare_module.PINS, self.test_pins), \
                 patch("nli_border_route_prepare._validate_baseline", return_value=({}, {}, {}, {})), \
                 patch.object(prepare_module, "_candidate_preview",
                              return_value=({}, {"feature_count": 89}, reconciliation)) as compare:
                result = prepare_release(root, recipe, staging, mode="check", preview_reference=preview)
            self.assertEqual(result["previewComparison"], reconciliation)
            compare.assert_called_once()
            self.assertFalse(staging.exists())
            preview.write_text(json.dumps({"sourceSha256": "wrong", "borderSha256": self.test_pins["border"],
                                           "routes": []}), encoding="utf-8")
            with patch.dict(prepare_module.PINS, self.test_pins), \
                 patch("nli_border_route_prepare._validate_baseline", return_value=({}, {}, {}, {})), \
                 patch.object(prepare_module, "_candidate_preview") as compare:
                with self.assertRaisesRegex(ValueError, "preview reference source or border identity"):
                    prepare_release(root, recipe, staging, mode="check", preview_reference=preview)
                compare.assert_not_called()
            self.assertFalse(staging.exists())

    def test_cli_check_forwards_explicit_preview_reference(self):
        import curate_nli_border_routes as cli
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp).resolve()
            preview = root / "review.json"
            preview.write_text("{}", encoding="utf-8")
            with patch.object(cli, "prepare_release", return_value={"status": "checked"}) as prepare:
                self.assertEqual(cli.main(["--check", "--repo-root", str(root),
                                           "--preview-reference", str(preview)]), 0)
            kwargs = prepare.call_args.kwargs
            self.assertEqual(kwargs["mode"], "check")
            self.assertEqual(kwargs["preview_reference"], preview.resolve())

    def test_first_prepare_requires_explicit_preview_before_staging_writes(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp).resolve()
            recipe, _ = self._copy_pinned_prepare_inputs(root)
            staging = root / "candidate"
            with patch("nli_border_route_prepare._validate_baseline", return_value=({}, {}, {}, {})):
                with self.assertRaisesRegex(ValueError, "requires --preview-reference"):
                    prepare_release(root, recipe, staging)
            self.assertFalse(staging.exists())

    def test_failed_reprepare_invalidates_old_ready_manifest_without_deleting_stage_files(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp).resolve()
            recipe, preview = self._copy_pinned_prepare_inputs(root)
            staging = root / "candidate"
            staging.mkdir()
            old_candidate = staging / "source.geojson"
            old_candidate.write_text("old bundle", encoding="utf-8")
            manifest_path = staging / "prepared-manifest.json"
            manifest_path.write_text(json.dumps({"readiness": {"status": "ready", "diagnostics": []},
                                                "targets": [{"role": "source_lines"}]}), encoding="utf-8")
            with patch("nli_border_route_prepare._validate_baseline", side_effect=ValueError("baseline drift")):
                with self.assertRaisesRegex(ValueError, "baseline drift"):
                    prepare_release(root, recipe, staging, preview_reference=preview)
            self.assertEqual(json.loads(manifest_path.read_text(encoding="utf-8"))["readiness"]["status"], "blocked")
            self.assertTrue(old_candidate.is_file())

    def test_baseline_road_metadata_citation_and_parent_id_failures_precede_stage_writes(self):
        cases = ("missing_baseline", "stale_border", "stale_road", "missing_metadata", "citation", "parent_id")
        for case in cases:
            with self.subTest(case=case), tempfile.TemporaryDirectory() as temp:
                root = Path(temp).resolve()
                recipe, preview = self._copy_pinned_prepare_inputs(root)
                staging = root / "candidate"
                if case == "missing_baseline":
                    (root / prepare_module.SOURCE).unlink()
                elif case == "stale_border":
                    with (root / prepare_module.BORDER).open("ab") as output: output.write(b" ")
                elif case == "stale_road":
                    with (root / prepare_module.ROAD).open("ab") as output: output.write(b" ")
                elif case == "missing_metadata":
                    (root / prepare_module.METADATA).unlink()
                with (patch.dict(prepare_module.PINS, self.test_pins),
                      patch.object(prepare_module, "_baseline_verifier_audit",
                                   return_value={"status": "passed", "returncode": 0, "diagnostics": []}) as verify,
                      patch.object(prepare_module, "build_curated_routes",
                                   side_effect=ValueError("parent IDs do not match recipe")) as build):
                    if case == "citation":
                        verify.return_value = {"status": "failed", "returncode": 1,
                                               "diagnostics": ["accepted source citation mismatch"]}
                    expected = {"missing_baseline": "sourceLines",
                                "stale_border": "canonical border module differs",
                                "stale_road": "road GeoJSON is missing",
                                "missing_metadata": "metadata",
                                "citation": "baseline presenter evidence verification failed",
                                "parent_id": "parent IDs do not match recipe"}[case]
                    with self.assertRaisesRegex((ValueError, FileNotFoundError), expected):
                        prepare_release(root, recipe, staging, preview_reference=preview)
                self.assertFalse(staging.exists(), f"{case} created a staging directory")
                self.assertFalse((staging / "prepared-manifest.json").exists())

    def test_self_contained_temp_baseline_can_prepare_when_all_readiness_checks_pass(self):
        repo = Path(__file__).resolve().parents[3]
        fixture = repo / "otef-interactive/tests/fixtures/nli-route-curation-runtime-baseline.geojson"
        recipe_template = json.loads((repo / "otef-interactive/scripts/nli-border-route-curation.json").read_text(encoding="utf-8"))
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp).resolve()
            source_path = root / prepare_module.SOURCE
            runtime_path = root / prepare_module.RUNTIME
            road_path = root / prepare_module.ROAD
            border_path = root / prepare_module.BORDER
            metadata_path = root / prepare_module.METADATA
            presenter_path = root / prepare_module.PRESENTER
            provenance_path = root / prepare_module.PROVENANCE
            recipe_path = root / prepare_module.RECIPE
            processed = root / prepare_module.PROCESSED
            for path in (source_path, runtime_path, road_path, border_path, metadata_path,
                         presenter_path, provenance_path, recipe_path):
                path.parent.mkdir(parents=True, exist_ok=True)
            runtime_bytes = fixture.read_bytes()
            runtime = json.loads(runtime_bytes)
            source = copy.deepcopy(runtime)
            for feature in source["features"]:
                feature["properties"].pop("flow_direction", None)
            source_bytes = json.dumps(source, ensure_ascii=False, separators=(",", ":")).encode()
            source_path.write_bytes(source_bytes)
            runtime_path.write_bytes(runtime_bytes)
            road_bytes = b'{"type":"FeatureCollection","features":[]}'
            road_path.write_bytes(road_bytes)
            border_text = 'export default {"type":"FeatureCollection","features":[]};\n'
            border_path.write_text(border_text, encoding="utf-8", newline="\n")
            border_hash = hashlib.sha256(border_text.encode()).hexdigest()
            pins = dict(prepare_module.PINS)
            pins.update({"source": hashlib.sha256(source_bytes).hexdigest(),
                         "runtime": hashlib.sha256(runtime_bytes).hexdigest(),
                         "border": border_hash, "road": hashlib.sha256(road_bytes).hexdigest()})
            recipe_template["expected_inputs"]["source_lines_sha256"] = pins["source"]
            recipe_template["expected_inputs"]["runtime_lines_sha256"] = pins["runtime"]
            recipe_template["expected_inputs"]["border_module_sha256_lf"] = border_hash
            recipe_path.write_text(json.dumps(recipe_template), encoding="utf-8")
            digest_cli = root / prepare_module.DIGEST_CLI
            digest_cli.parent.mkdir(parents=True, exist_ok=True)
            digest_cli.write_bytes((repo / prepare_module.DIGEST_CLI).read_bytes())
            for script in (prepare_module.ASSEMBLER_CLI, prepare_module.VERIFIER_CLI,
                           prepare_module.DIGEST_CLI,
                           Path("otef-interactive/frontend/src/shared/nli-investigation-clock.js"),
                           Path("otef-interactive/frontend/src/remote/nli-timeline-transport.js"),
                           Path("otef-interactive/tests/fixtures/nli-presenter-navigation.json")):
                script_path = root / script
                script_path.parent.mkdir(parents=True, exist_ok=True)
                if script_path.name == "nli-presenter-navigation.json":
                    script_path.write_bytes((repo / script).read_bytes())
                elif script_path.name == "nli-route-curation-digests.mjs":
                    script_path.write_bytes((repo / script).read_bytes())
                else:
                    script_path.write_text("// test harness intercepts this CLI\n", encoding="utf-8")
            for name in ("alarms.geojson", "investigation_polygons.geojson"):
                (processed / name).write_text('{"type":"FeatureCollection","features":[]}', encoding="utf-8")
            metadata = {"sourceSha256": "a" * 64, "datasetVersion": "test-version",
                        "fileHashes": {}, "artifactHashes": {}, "counts": {"lines": 68},
                        "reviewProvenance": {}, "runtimeArtifactHashes": {}}
            metadata_path.write_text(json.dumps(metadata), encoding="utf-8")
            presenter = {"acceptedSourceSha256": "a" * 64, "datasetVersion": "test-version",
                         "records": {}, "editorialEvidence": {"status": "source-checked", "checkedBy": "Sol"},
                         "sourceEvidence": {"acceptedPackageSha256": "b" * 64, "artifacts": {}}}
            presenter_path.write_text(json.dumps(presenter), encoding="utf-8")
            provenance_path.write_text("{}", encoding="utf-8")
            reference_path = root / "preview.json"
            reference_path.write_text(json.dumps({"sourceSha256": pins["runtime"],
                                                   "borderSha256": pins["border"], "routes": []}), encoding="utf-8")
            staging = root / "candidate"
            output_holder = {}

            def fake_build(baseline, border, recipe, roads):
                result = copy.deepcopy(baseline)
                by_id = {int(f["properties"]["OBJECTID"]): f for f in result["features"]}
                for op in recipe["operations"]:
                    if op["kind"] != "new_approach":
                        continue
                    parent = by_id[op["parent_id"]]
                    feature = copy.deepcopy(parent)
                    feature["id"] = op["feature_id"]
                    feature["properties"] = {"OBJECTID": op["feature_id"], "parent_objectid": op["parent_id"],
                                              "route_confidence": "unconfirmed", "flow_direction": "forward",
                                              "timeline": parent["properties"].get("timeline"),
                                              "timeline_minutes": parent["properties"].get("timeline_minutes")}
                    if op["shape"] == "origin_direction":
                        feature["geometry"]["coordinates"] = [parent["geometry"]["coordinates"][-1],
                                                                 parent["geometry"]["coordinates"][0]]
                    result["features"].append(feature)
                    by_id[op["feature_id"]] = feature
                projected = Transformer.from_crs("EPSG:4326", recipe["construction_crs"], always_xy=True)
                routes = {}
                for op in recipe["operations"]:
                    fid = op["feature_id"]
                    reference_id = op["parent_id"] if op["kind"] == "new_approach" else fid
                    coords = [list(p) for p in projected.itransform(by_id[fid]["geometry"]["coordinates"])]
                    if op["kind"] == "new_approach" and op["shape"] == "road_polyline":
                        routes[reference_id] = {"id": reference_id, "roadCandidate": {"coords": coords}}
                    elif op["kind"] == "new_approach":
                        routes[reference_id] = {"id": reference_id, "proposed": coords}
                    else:
                        routes[reference_id] = {"id": reference_id, "proposed": coords}
                reference_path.write_text(json.dumps({"sourceSha256": pins["runtime"],
                    "borderSha256": pins["border"], "routes": list(routes.values())}), encoding="utf-8")
                output_holder["features"] = len(result["features"])
                return result, {"feature_count": 89, "confirmed_count": 68, "unconfirmed_count": 21}

            original_run = subprocess.run
            def fake_cli(args, **kwargs):
                if str(args[1]).endswith("nli-route-curation-digests.mjs"):
                    return original_run(args, **kwargs)
                if str(args[1]).endswith("assemble-nli-presenter-manifest.mjs"):
                    seed = json.loads(Path(args[args.index("--manifest") + 1]).read_text(encoding="utf-8"))
                    out = Path(args[args.index("--output") + 1])
                    out.write_text(json.dumps(seed), encoding="utf-8")
                    return subprocess.CompletedProcess(args, 0, "", "")
                raise AssertionError(f"unexpected helper CLI: {args[1]}")

            fake_build(runtime, {}, recipe_template, {})
            with patch.dict(prepare_module.PINS, pins), \
                 patch.object(prepare_module, "build_curated_routes", side_effect=fake_build), \
                 patch.object(prepare_module, "_baseline_verifier_audit", return_value={"status": "passed", "returncode": 0, "diagnostics": []}), \
                 patch.object(prepare_module, "_verify_staged", return_value={"status": "passed", "diagnostics": [], "results": []}), \
                 patch.object(prepare_module.subprocess, "run", side_effect=fake_cli):
                result = prepare_release(root, recipe_path, staging, preview_reference=reference_path)
                for name, path in (("sourceLines", source_path), ("runtimeLines", runtime_path)):
                    original_bytes = path.read_bytes()
                    drift_stage = root / f"candidate-drift-{name}"

                    def mutate_during_verification(*args, _path=path, _bytes=original_bytes, **kwargs):
                        _path.write_bytes(_bytes + b" ")
                        return {"status": "passed", "diagnostics": [], "results": []}

                    with patch.object(prepare_module, "_verify_staged", side_effect=mutate_during_verification):
                        with self.assertRaisesRegex(ValueError, "input identity changed"):
                            prepare_release(root, recipe_path, drift_stage, preview_reference=reference_path)
                    self.assertFalse((drift_stage / "prepared-manifest.json").exists())
                    path.write_bytes(original_bytes)
                self.assertEqual(runtime_path.read_bytes(), runtime_bytes)
                for role, target in prepare_module.ROLE_PATHS.items():
                    destination = root / target
                    destination.parent.mkdir(parents=True, exist_ok=True)
                    destination.write_bytes((staging / result["manifest"]["targets"][
                        next(i for i, item in enumerate(result["manifest"]["targets"]) if item["role"] == role)]["stage"]).read_bytes())
                active_stage = root / "candidate-active-noop"
                active = prepare_release(root, recipe_path, active_stage, mode="prepare")
                self.assertEqual(active["mode"], "exact_active_89")
                self.assertTrue(active["publishable"])
                active_preimages = {item["role"]: item["preImageSha256"] for item in active["manifest"]["targets"]}
                self.assertEqual(active_preimages["source_lines"], hashlib.sha256((root / prepare_module.SOURCE).read_bytes()).hexdigest())
                self.assertEqual(active_preimages["processed_lines"], hashlib.sha256((root / prepare_module.RUNTIME).read_bytes()).hexdigest())
            self.assertEqual(result["status"], "prepared")
            self.assertTrue(result["publishable"])
            self.assertEqual(output_holder["features"], 89)
            self.assertEqual(result["curation"]["counts"], {"features": 89, "confirmed": 68, "unconfirmed": 21})
            self.assertEqual(len(result["previewReconciliation"]["comparedOperations"]), 18)

    def test_rejects_any_affected_vertex_more_than_two_metres(self):
        operations = [
            {"feature_id": 1001, "kind": "trim_first_crossing"},
            {"feature_id": 1013, "parent_id": 23, "kind": "new_approach", "shape": "origin_direction"},
        ]
        actual = {1001: [[0, 0], [10, 0]], 1013: [[0, 0], [10, 2.01]]}
        reference = {
            "routes": [
                {"id": 1001, "proposed": [[0, 0], [10, 0]]},
                {"id": 23, "proposed": [[0, 0], [10, 0], [20, 0]]},
            ]
        }
        with self.assertRaisesRegex(ValueError, "preview operation 1013 exceeds 2m: 2.01"):
            reconcile_preview(actual, reference, operations)

    def test_new_direction_emitted_approach_and_road_candidate_are_compared_like_for_like(self):
        operations = [
            {"feature_id": 1013, "parent_id": 23, "kind": "new_approach", "shape": "origin_direction"},
            {"feature_id": 1021, "parent_id": 32, "kind": "new_approach", "shape": "road_polyline"},
        ]
        actual = {1013: [[0, 0], [10, 0]], 1021: [[0, 0], [10, 0], [20, 0]]}
        reference = {
            "routes": [
                {"id": 23, "proposed": [[0, 0], [10, 0], [5, 0]]},
                {"id": 32, "roadCandidate": {"coords": [[0, 0], [10, 0], [20, 0]]}},
            ]
        }
        result = reconcile_preview(actual, reference, operations)
        self.assertEqual(result["status"], "passed")
        self.assertEqual(result["comparedOperations"], [1013, 1021])
        self.assertLessEqual(result["maximumDeviationMeters"], 2.0)

if __name__ == "__main__":
    unittest.main()
