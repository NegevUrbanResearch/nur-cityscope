from __future__ import annotations

import hashlib
import json
import os
import secrets
import subprocess
import tempfile
import unittest
from contextlib import contextmanager
from unittest.mock import patch
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "otef_layer_processing"))
from nli_border_route_release import publish_release, rollback_release
from nli_mutation_lock import nli_mutation_lock
import nli_border_route_release as release_module
import nli_border_route_prepare as prepare_module

class ReleaseTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name).resolve()
        self.processed = self.root / "otef-interactive/public/processed/layers/nli"
        self.processed.mkdir(parents=True)
        self.prepared = self.root / "prepared"
        self.prepared.mkdir()
        self.fixture_pins = prepare_module.PINS
        self._semantic_patcher = patch.object(release_module, "_validate_candidate_runtime", return_value={})
        self._verifier_patcher = patch.object(release_module, "_run_bundle_verifier", return_value=None)
        self._semantic_patcher.start(); self._verifier_patcher.start()

    def tearDown(self):
        self._semantic_patcher.stop(); self._verifier_patcher.stop(); self.temp.cleanup()

    def bundle(self, *, drift=False):
        items = [
            ("source_lines", "otef-interactive/public/source/layers/nli/gis/lines.geojson", "source", b"source new"),
            ("processed_lines", "otef-interactive/public/processed/layers/nli/lines.geojson", "processed", b"processed new"),
            ("release_metadata", "otef-interactive/public/processed/layers/nli/release-metadata.json", "metadata", b"metadata new"),
            ("presenter_json", "otef-interactive/frontend/src/remote/nli-presenter-content.json", "presenter", b"presenter new"),
            ("derived_lock", "otef-interactive/scripts/nli-border-route-curation.lock.json", "lock", b"lock new"),
        ]
        source_root = Path(__file__).resolve().parents[3] / "otef-interactive"
        recipe = self.root / "recipe.json"; recipe.write_bytes((source_root / "scripts/nli-border-route-curation.json").read_bytes())
        border = self.root / "border.js"; border.write_bytes((source_root / "frontend/src/shared/gaza-border-geometry.js").read_bytes())
        road = self.root / "road.geojson"; road.write_bytes((source_root / "public/processed/layers/muniplicity_transport/דרכים_ארציות.geojson").read_bytes())
        provenance = self.root / "provenance.json"; provenance.write_bytes((source_root / "scripts/nli-presenter-provenance.json").read_bytes())
        preview_reference = self.root / "preview.json"; preview_reference.write_text("{}", encoding="utf-8")
        proof_inputs = {}
        for name in ("navigationFixture", "verifier", "digestCli", "beatClock", "timelineTransport"):
            path = self.root / f"{name}.proof"
            path.write_text(f"{name} proof", encoding="utf-8")
            proof_inputs[name] = {"name": name, "path": str(path),
                                  "byteSha256": hashlib.sha256(path.read_bytes()).hexdigest()}
        recipe_sha = hashlib.sha256(recipe.read_bytes()).hexdigest()
        border_normalized = hashlib.sha256(border.read_bytes().replace(b"\r\n", b"\n")).hexdigest()
        curation = {"schemaVersion": 1, "recipeSha256": recipe_sha,
                    "baseSourceSha256": self.fixture_pins["source"],
                    "baseRuntimeSha256": self.fixture_pins["runtime"],
                    "confirmedFeaturesSha256": self.fixture_pins["confirmed"],
                    "borderSha256": border_normalized,
                    "roadSha256": self.fixture_pins["road"], "derivedSourceSha256": hashlib.sha256(b"source new").hexdigest(),
                    "runtimeByteSha256": hashlib.sha256(b"processed new").hexdigest(),
                    "runtimeFeatureSha256": "6" * 64,
                    "counts": {"features": 89, "confirmed": 68, "unconfirmed": 21},
                    "addedObjectIds": list(range(1013, 1022)),
                    "editedObjectIds": [1001,1002,1005,1006,1008,1009,1010,1011,1012]}
        lock_bytes = json.dumps({"curation": curation}).encode()
        targets = []
        for role, target, stage, candidate in items:
            dest = self.root / target
            dest.parent.mkdir(parents=True, exist_ok=True)
            before = b"old:" + role.encode()
            if before is not None: dest.write_bytes(before)
            if drift and role == "processed_lines": dest.write_bytes(b"foreign")
            if role == "derived_lock":
                candidate = lock_bytes
            if role == "release_metadata":
                candidate = json.dumps({"routeBorderCuration": curation}).encode()
            if role == "presenter_json":
                candidate = json.dumps({"sourceEvidence": {"routeBorderCuration": curation}}).encode()
            staged = self.prepared / stage
            staged.write_bytes(candidate)
            targets.append({"role": role, "target": target, "stage": stage,
                            "candidateSha256": hashlib.sha256(candidate).hexdigest(),
                            "preImageSha256": hashlib.sha256(before).hexdigest() if before is not None else None})
        for name in ("alarms.geojson", "investigation_polygons.geojson"):
            (self.processed / name).write_text('{"type":"FeatureCollection","features":[]}', encoding="utf-8")
        input_identities = [
            {"name": "recipe", "path": str(recipe), "byteSha256": hashlib.sha256(recipe.read_bytes()).hexdigest()},
            {"name": "border", "path": str(border), "byteSha256": hashlib.sha256(border.read_bytes()).hexdigest(),
             "normalizedLfSha256": border_normalized},
            {"name": "road", "path": str(road), "byteSha256": hashlib.sha256(road.read_bytes()).hexdigest()},
            {"name": "provenance", "path": str(provenance), "byteSha256": hashlib.sha256(provenance.read_bytes()).hexdigest()},
            {"name": "metadata", "path": str(self.root / targets[2]["target"]), "byteSha256": targets[2]["preImageSha256"]},
            {"name": "presenter", "path": str(self.root / targets[3]["target"]), "byteSha256": targets[3]["preImageSha256"]},
            {"name": "sourceLines", "path": str(self.root / targets[0]["target"]), "byteSha256": targets[0]["preImageSha256"]},
            {"name": "runtimeLines", "path": str(self.root / targets[1]["target"]), "byteSha256": targets[1]["preImageSha256"]},
            *[{"name": input_name,
               "path": str(self.processed / name),
               "byteSha256": hashlib.sha256((self.processed / name).read_bytes()).hexdigest()}
              for input_name, name in (("alarms", "alarms.geojson"),
                                       ("investigationPolygons", "investigation_polygons.geojson"))],
            *proof_inputs.values(),
            {"name": "previewReference", "path": str(preview_reference),
             "byteSha256": hashlib.sha256(preview_reference.read_bytes()).hexdigest()},
        ]
        data = {"schemaVersion": 1, "repoRoot": str(self.root), "processedLayersRoot": str(self.processed),
                "recipeSha256": recipe_sha, "derivedLockIdentity": hashlib.sha256(lock_bytes).hexdigest(), "targets": targets,
                "readiness": {"status": "ready", "diagnostics": []},
                "inputIdentities": input_identities,
                "preparationEvidence": {"mode": "baseline_to_derived",
                    "verifier": {"status": "passed", "diagnostics": [],
                                 "baseline": {"status": "passed", "diagnostics": []}},
                    "previewReconciliation": {"status": "passed", "crs": "EPSG:2039", "toleranceMeters": 2.0,
                        "comparedOperations": list(range(18)), "referenceSha256": hashlib.sha256(preview_reference.read_bytes()).hexdigest(),
                        "referencePath": str(preview_reference)}}}
        (self.prepared / "prepared-manifest.json").write_text(json.dumps(data), encoding="utf-8")
        return data

    def test_closed_outputs_guard_and_success_second_apply_noop(self):
        self.bundle()
        self.assertEqual(publish_release(self.prepared, outputs_closed=False)["status"], "unchanged")
        first = publish_release(self.prepared, outputs_closed=True)
        self.assertEqual(first["status"], "published")
        self.assertEqual(publish_release(self.prepared, outputs_closed=True)["status"], "unchanged")
        manifest_path = self.prepared / "prepared-manifest.json"
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
        manifest["derivedLockIdentity"] = "different-lock-identity"
        manifest_path.write_text(json.dumps(manifest), encoding="utf-8")
        with self.assertRaisesRegex(ValueError, "curation identities"):
            publish_release(self.prepared, outputs_closed=True)

    def test_blocked_audit_bundle_is_rejected_under_lock_before_any_target_write(self):
        manifest = self.bundle()
        before = {item["target"]: (self.root / item["target"]).read_bytes()
                  if (self.root / item["target"]).exists() else None for item in manifest["targets"]}
        manifest["readiness"] = {"status": "blocked", "diagnostics": ["known verifier mismatch"],
                                  "auditOnly": True}
        manifest["readiness"]["diagnostics"] = ["full presenter verifier failed: Beat minutes differ from the tracked navigation fixture"]
        manifest["preparationEvidence"]["verifier"] = {
            "status": "failed", "diagnostics": ["Beat minutes differ from the tracked navigation fixture"],
            "baseline": {"status": "failed", "diagnostics": ["Beat minutes differ from the tracked navigation fixture"]}}
        (self.prepared / "prepared-manifest.json").write_text(json.dumps(manifest), encoding="utf-8")
        with self.assertRaisesRegex(RuntimeError, "readiness is not publishable"):
            publish_release(self.prepared, outputs_closed=True)
        after = {item["target"]: (self.root / item["target"]).read_bytes()
                 if (self.root / item["target"]).exists() else None for item in manifest["targets"]}
        self.assertEqual(after, before)
        self.assertFalse(list(self.processed.parent.glob(".nli-route-release-*.json")))

    def test_all_input_identities_are_rechecked_under_lock_before_any_target_write(self):
        for name in ("recipe", "border", "road", "provenance", "metadata", "presenter",
                     "sourceLines", "runtimeLines", "alarms", "investigationPolygons",
                     "navigationFixture", "verifier", "digestCli", "beatClock", "timelineTransport"):
            with self.subTest(input=name):
                manifest = self.bundle()
                identity = next(item for item in manifest["inputIdentities"] if item["name"] == name)
                before = {item["target"]: (self.root / item["target"]).read_bytes()
                          if (self.root / item["target"]).exists() else None for item in manifest["targets"]}
                original_lock = release_module.nli_mutation_lock
                after_injected_change = {}

                @contextmanager
                def mutate_identity_after_load(processed, **kwargs):
                    with original_lock(processed, **kwargs):
                        Path(identity["path"]).write_bytes(b"changed after preparation")
                        after_injected_change.update({item["target"]:
                            (self.root / item["target"]).read_bytes() if (self.root / item["target"]).exists() else None
                            for item in manifest["targets"]})
                        yield "test-owner"

                with patch.object(release_module, "nli_mutation_lock", side_effect=mutate_identity_after_load):
                    with self.assertRaisesRegex(RuntimeError, f"input identity changed.*{name}"):
                        publish_release(self.prepared, outputs_closed=True)
                after = {item["target"]: (self.root / item["target"]).read_bytes()
                         if (self.root / item["target"]).exists() else None for item in manifest["targets"]}
                self.assertEqual(after, after_injected_change or before)

    def test_preview_reference_is_rechecked_after_waiting_for_release_lock(self):
        manifest = self.bundle()
        identity = next(item for item in manifest["inputIdentities"] if item["name"] == "previewReference")
        original_lock = release_module.nli_mutation_lock

        @contextmanager
        def mutate_after_bundle_validation(processed, **kwargs):
            with original_lock(processed, **kwargs):
                Path(identity["path"]).write_bytes(b"changed while waiting for lock")
                yield "test-owner"

        with patch.object(release_module, "nli_mutation_lock", side_effect=mutate_after_bundle_validation):
            with self.assertRaisesRegex(RuntimeError, "input identity changed.*previewReference"):
                publish_release(self.prepared, outputs_closed=True)

    def test_saved_manifest_is_reloaded_after_lock_for_first_and_repeated_apply(self):
        for repeated in (False, True):
            with self.subTest(repeated=repeated):
                self.tearDown(); self.setUp()
                self.bundle()
                if repeated:
                    self.assertEqual(publish_release(self.prepared, outputs_closed=True)["status"], "published")
                manifest_path = self.prepared / "prepared-manifest.json"
                before = {item["target"]: (self.root / item["target"]).read_bytes()
                          if (self.root / item["target"]).exists() else None
                          for item in json.loads(manifest_path.read_text(encoding="utf-8"))["targets"]}
                original_lock = release_module.nli_mutation_lock

                @contextmanager
                def invalidate_after_manifest_load(processed, **kwargs):
                    with original_lock(processed, **kwargs):
                        if repeated:
                            manifest_path.unlink()
                        else:
                            saved = json.loads(manifest_path.read_text(encoding="utf-8"))
                            saved["readiness"] = {"status": "blocked", "diagnostics": ["reprepare failed"]}
                            manifest_path.write_text(json.dumps(saved), encoding="utf-8")
                        yield "test-owner"

                with patch.object(release_module, "nli_mutation_lock", side_effect=invalidate_after_manifest_load):
                    with self.assertRaisesRegex((ValueError, RuntimeError), "manifest|readiness"):
                        publish_release(self.prepared, outputs_closed=True)
                after = {target: (self.root / target).read_bytes() if (self.root / target).exists() else None
                         for target in before}
                self.assertEqual(after, before)

    def test_alarm_and_polygon_inputs_are_rechecked_after_lock_wait(self):
        for name in ("alarms.geojson", "investigation_polygons.geojson"):
            with self.subTest(input=name):
                self.tearDown(); self.setUp()
                (self.processed / name).write_text('{"type":"FeatureCollection","features":[]}', encoding="utf-8")
                manifest = self.bundle()
                original_lock = release_module.nli_mutation_lock

                @contextmanager
                def mutate_auxiliary_after_load(processed, **kwargs):
                    with original_lock(processed, **kwargs):
                        (self.processed / name).write_bytes(b"changed while waiting")
                        yield "test-owner"

                before = {item["target"]: (self.root / item["target"]).read_bytes()
                          if (self.root / item["target"]).exists() else None for item in manifest["targets"]}
                with patch.object(release_module, "nli_mutation_lock", side_effect=mutate_auxiliary_after_load):
                    expected_name = "alarms" if name == "alarms.geojson" else "investigationPolygons"
                    with self.assertRaisesRegex(RuntimeError, f"input identity changed.*{expected_name}"):
                        publish_release(self.prepared, outputs_closed=True)
                after = {item["target"]: (self.root / item["target"]).read_bytes()
                         if (self.root / item["target"]).exists() else None for item in manifest["targets"]}
                self.assertEqual(after, before)

    def test_shared_node_runtime_digest_rejects_mismatched_feature_and_confirmed_content(self):
        source_root = Path(__file__).resolve().parents[3] / "otef-interactive"
        baseline = json.loads((source_root / "tests/fixtures/nli-route-curation-runtime-baseline.geojson").read_text(encoding="utf-8"))
        for i, object_id in enumerate(range(1013, 1022)):
            feature = json.loads(json.dumps(baseline["features"][0]))
            feature["id"] = object_id
            feature["properties"]["OBJECTID"] = object_id
            feature["properties"]["route_confidence"] = "unconfirmed"
            baseline["features"].append(feature)
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp).resolve()
            runtime = root / "candidate.geojson"
            digest_cli = root / "nli-route-curation-digests.mjs"
            digest_cli.write_bytes((source_root / "scripts/nli-route-curation-digests.mjs").read_bytes())
            runtime.write_text(json.dumps(baseline, ensure_ascii=False), encoding="utf-8")
            identity = {"name": "digestCli", "path": str(digest_cli),
                        "byteSha256": hashlib.sha256(digest_cli.read_bytes()).hexdigest()}
            digest_command = [os.environ.get("NODE", "node"), str(digest_cli), "--file", str(runtime)]
            digests = json.loads(subprocess.run(digest_command, capture_output=True, text=True, check=True).stdout)
            curation = {"runtimeByteSha256": digests["byteSha256"],
                        "runtimeFeatureSha256": digests["featureSha256"],
                        "confirmedFeaturesSha256": digests["confirmedFeaturesSha256"],
                        "counts": {"features": 89, "confirmed": 68, "unconfirmed": 21},
                        "addedObjectIds": list(range(1013, 1022)),
                        "editedObjectIds": [1001, 1002, 1005, 1006, 1008, 1009, 1010, 1011, 1012]}
            self._semantic_patcher.stop()
            try:
                self.assertEqual(release_module._validate_candidate_runtime(root, runtime, identity, curation)["counts"],
                                 curation["counts"])
                wrong_feature = dict(curation, runtimeFeatureSha256="f" * 64)
                with self.assertRaisesRegex(ValueError, "shared Node digests"):
                    release_module._validate_candidate_runtime(root, runtime, identity, wrong_feature)
                altered = json.loads(runtime.read_text(encoding="utf-8"))
                altered["features"][0]["geometry"]["coordinates"][0][0] += 0.001
                runtime.write_text(json.dumps(altered, ensure_ascii=False), encoding="utf-8")
                changed_digests = json.loads(subprocess.run(digest_command, capture_output=True,
                                                            text=True, check=True).stdout)
                changed_curation = dict(curation, runtimeByteSha256=changed_digests["byteSha256"],
                                        runtimeFeatureSha256=changed_digests["featureSha256"])
                with self.assertRaisesRegex(ValueError, "shared Node digests"):
                    release_module._validate_candidate_runtime(root, runtime, identity, changed_curation)
            finally:
                self._semantic_patcher.start()

    def test_strict_verifier_metadata_is_the_selected_publication_candidate(self):
        manifest = self.bundle()
        metadata_target = next(item for item in manifest["targets"] if item["role"] == "release_metadata")
        runtime_target = next(item for item in manifest["targets"] if item["role"] == "processed_lines")
        runtime_dir = self.prepared / "runtime"
        runtime_dir.mkdir()
        runtime_target["stage"] = "runtime/lines.geojson"
        (runtime_dir / "lines.geojson").write_bytes((self.prepared / "processed").read_bytes())

        curation = json.loads((self.prepared / metadata_target["stage"]).read_text(encoding="utf-8"))["routeBorderCuration"]
        implicit_metadata = runtime_dir / "release-metadata.json"
        implicit_metadata.write_text(json.dumps({"sourceSha256": "a" * 64,
                                                  "routeBorderCuration": curation}), encoding="utf-8")
        alternate_metadata = runtime_dir / "alternate-metadata.json"
        alternate_metadata.write_text(json.dumps({"sourceSha256": "0" * 64,
                                                   "routeBorderCuration": curation}), encoding="utf-8")
        alternate_sha = hashlib.sha256(alternate_metadata.read_bytes()).hexdigest()
        metadata_target["stage"] = "runtime/alternate-metadata.json"
        metadata_target["candidateSha256"] = alternate_sha
        (self.prepared / "prepared-manifest.json").write_text(json.dumps(manifest), encoding="utf-8")

        verifier_seen = []
        def verifier(command, **kwargs):
            data_root = Path(command[command.index("--data-root") + 1])
            consumed_metadata = data_root / "release-metadata.json"
            verifier_seen.append((consumed_metadata, json.loads(consumed_metadata.read_text(encoding="utf-8"))))
            return subprocess.CompletedProcess(command, 0, "verified", "")

        self._verifier_patcher.stop()
        try:
            with patch.object(release_module.subprocess, "run", side_effect=verifier):
                with self.assertRaisesRegex(RuntimeError, "metadata candidate"):
                    publish_release(self.prepared, outputs_closed=True)
                self.assertEqual(verifier_seen, [], "verifier must not run against a different metadata file")

                valid_metadata = {"sourceSha256": self.fixture_pins["source"],
                                  "routeBorderCuration": curation}
                implicit_metadata.write_text(json.dumps(valid_metadata), encoding="utf-8")
                valid_alternate = runtime_dir / "valid-alternate-metadata.json"
                valid_alternate.write_bytes(implicit_metadata.read_bytes())
                valid_alternate_data = valid_alternate.read_bytes()
                metadata_target["stage"] = "runtime/valid-alternate-metadata.json"
                metadata_target["candidateSha256"] = hashlib.sha256(valid_alternate.read_bytes()).hexdigest()
                (self.prepared / "prepared-manifest.json").write_text(json.dumps(manifest), encoding="utf-8")
                self.assertEqual(publish_release(self.prepared, outputs_closed=True)["status"], "published")
                self.assertEqual(publish_release(self.prepared, outputs_closed=True)["status"], "unchanged")
        finally:
            self._verifier_patcher.start()
        self.assertEqual(len(verifier_seen), 2)
        self.assertEqual(verifier_seen[0][0], implicit_metadata)
        self.assertEqual(verifier_seen[1][0], self.root / metadata_target["target"])
        self.assertTrue(all(item[1]["sourceSha256"] == self.fixture_pins["source"] for item in verifier_seen))
        self.assertEqual(verifier_seen[0][1], json.loads(valid_alternate_data.decode("utf-8")))
        self.assertEqual(alternate_sha, hashlib.sha256(alternate_metadata.read_bytes()).hexdigest())
        self.assertEqual(json.loads((self.root / metadata_target["target"]).read_text(encoding="utf-8")), valid_metadata)
        self.assertFalse((self.processed.parent / release_module.MARKER).exists())
        journal_files = list(self.processed.parent.glob(f"{release_module.JOURNAL_PREFIX}*.json"))
        self.assertEqual(len(journal_files), 1)

    def test_recipe_hash_requires_64_lowercase_hex_characters(self):
        manifest = self.bundle()
        manifest_path = self.prepared / "prepared-manifest.json"
        for bad_hash in ("z" * 64, "A" * 64, "a" * 63):
            with self.subTest(recipeSha256=bad_hash):
                manifest["recipeSha256"] = bad_hash
                manifest_path.write_text(json.dumps(manifest), encoding="utf-8")
                with self.assertRaisesRegex(ValueError, "recipeSha256.*lowercase SHA-256"):
                    publish_release(self.prepared, outputs_closed=True)
    def test_confinement_missing_candidate_and_preimage_drift(self):
        manifest = self.bundle()
        manifest["targets"][0]["target"] = "../../outside"
        (self.prepared / "prepared-manifest.json").write_text(json.dumps(manifest))
        with self.assertRaisesRegex(ValueError, "traversal"): publish_release(self.prepared, outputs_closed=True)
        self.bundle(drift=True)
        with self.assertRaisesRegex((RuntimeError, ValueError), "pre-image drift|input identity"): publish_release(self.prepared, outputs_closed=True)

    def test_missing_candidate_and_missing_release_metadata_are_rejected(self):
        manifest = self.bundle()
        (self.prepared / manifest["targets"][0]["stage"]).unlink()
        with self.assertRaisesRegex(ValueError, "missing candidate"):
            publish_release(self.prepared, outputs_closed=True)
        manifest = self.bundle()
        manifest["targets"] = [item for item in manifest["targets"] if item["role"] != "release_metadata"]
        (self.prepared / "prepared-manifest.json").write_text(json.dumps(manifest), encoding="utf-8")
        with self.assertRaisesRegex(ValueError, "five approved target roles"):
            publish_release(self.prepared, outputs_closed=True)
    def test_caught_exception_before_and_after_each_exact_target_replace_restores_all_bytes(self):
        targets = [
            ("source_lines", "otef-interactive/public/source/layers/nli/gis/lines.geojson", b"old:source_lines"),
            ("processed_lines", "otef-interactive/public/processed/layers/nli/lines.geojson", b"old:processed_lines"),
            ("release_metadata", "otef-interactive/public/processed/layers/nli/release-metadata.json", b"old:release_metadata"),
            ("presenter_json", "otef-interactive/frontend/src/remote/nli-presenter-content.json", b"old:presenter_json"),
            ("derived_lock", "otef-interactive/scripts/nli-border-route-curation.lock.json", b"old:derived_lock"),
        ]
        import nli_border_route_release as release
        original = release.os.replace
        for role, relative, expected in targets:
            for after in (False, True):
                with self.subTest(target=role, after=after):
                    self.bundle()
                    fault_target = (self.root / relative).resolve()
                    injected = False
                    def fail_target_once(source, destination):
                        nonlocal injected
                        if Path(destination).resolve() == fault_target and not injected:
                            injected = True
                            if after: original(source, destination)
                            raise OSError(f"injected at {role} after={after}")
                        return original(source, destination)
                    release.os.replace = fail_target_once
                    try:
                        with self.assertRaisesRegex(OSError, f"injected at {role}"):
                            publish_release(self.prepared, outputs_closed=True)
                    finally:
                        release.os.replace = original
                    self.assertTrue(injected, f"fault point was not reached for {role}")
                    for check_role, rel, preimage in targets:
                        path = self.root / rel
                        self.assertEqual(path.read_bytes() if path.exists() else None, preimage,
                                         f"wrong restored bytes for {check_role}")
                    marker = self.processed.parent / ".nli-route-release-unfinished.json"
                    self.assertFalse(marker.exists())
                    journals = list(self.processed.parent.glob(".nli-route-release-*.json"))
                    completed = max(journals, key=lambda path: path.stat().st_mtime_ns)
                    journal_data = json.loads(completed.read_text(encoding="utf-8"))
                    self.assertEqual(journal_data["state"], "rolled_back")
                    self.assertTrue(all(record["state"] == "rolled_back" for record in journal_data["targets"]))
                    rollback_release(completed)
                    self.assertFalse(marker.exists())
                    for check_role, rel, preimage in targets:
                        path = self.root / rel
                        self.assertEqual(path.read_bytes() if path.exists() else None, preimage,
                                         f"idempotent recovery changed {check_role}")

    def test_unfinished_foreign_edit_keeps_marker_and_blocks_until_idempotent_recovery(self):
        self.bundle()
        module_dir = str(Path(__file__).resolve().parents[1] / "otef_layer_processing")
        target = (self.root / "otef-interactive/public/processed/layers/nli/lines.geojson").resolve()
        code = r'''
import os, sys
from pathlib import Path
sys.path.insert(0, sys.argv[1])
import nli_border_route_release as release
wanted = Path(sys.argv[3]).resolve()
replace = release.os.replace
def crash_after_target(source, destination):
    if Path(destination).resolve() == wanted:
        replace(source, destination)
        os._exit(73)
    return replace(source, destination)
release.os.replace = crash_after_target
release._validate_candidate_runtime = lambda *args, **kwargs: {}
release._run_bundle_verifier = lambda *args, **kwargs: None
release.publish_release(Path(sys.argv[2]), outputs_closed=True)
'''
        child = subprocess.run([sys.executable, "-c", code, module_dir, str(self.prepared), str(target)],
                               capture_output=True, text=True, timeout=10)
        self.assertEqual(child.returncode, 73, child.stderr)
        marker = self.processed.parent / ".nli-route-release-unfinished.json"
        self.assertTrue(marker.is_file())
        journal = self.processed.parent / json.loads(marker.read_text(encoding="utf-8"))["journal"]
        target.write_bytes(b"foreign human edit")
        with self.assertRaisesRegex(RuntimeError, "foreign edit"):
            rollback_release(journal)
        self.assertEqual(target.read_bytes(), b"foreign human edit")
        self.assertTrue(marker.is_file())
        with self.assertRaisesRegex(RuntimeError, "unfinished NLI release"):
            with nli_mutation_lock(self.processed): pass
        target.write_bytes(b"processed new")
        rollback_release(journal)
        self.assertFalse(marker.exists())
        rollback_release(journal)
        self.assertEqual(target.read_bytes(), b"old:processed_lines")
        for role, relative, expected in [
            ("source_lines", "otef-interactive/public/source/layers/nli/gis/lines.geojson", b"old:source_lines"),
            ("release_metadata", "otef-interactive/public/processed/layers/nli/release-metadata.json", b"old:release_metadata"),
            ("presenter_json", "otef-interactive/frontend/src/remote/nli-presenter-content.json", b"old:presenter_json"),
            ("derived_lock", "otef-interactive/scripts/nli-border-route-curation.lock.json", b"old:derived_lock")]:
            path = self.root / relative
            self.assertEqual(path.read_bytes() if path.exists() else None, expected, role)
    def test_competing_standalone_waits_while_inherited_worker_joins_owner(self):
        import time
        self.processed.mkdir(parents=True, exist_ok=True)
        module_dir = str(Path(__file__).resolve().parents[1] / "otef_layer_processing")
        started, acquired = self.root / "started", self.root / "acquired"
        code = r'''
import sys
from pathlib import Path
sys.path.insert(0, sys.argv[1])
from nli_mutation_lock import nli_mutation_lock
root = Path(sys.argv[2])
(root / sys.argv[3]).write_text("started")
with nli_mutation_lock(root / "otef-interactive/public/processed/layers/nli",
                       owner_token=sys.argv[4] if sys.argv[4] else None) as token:
    (root / sys.argv[5]).write_text(token)
'''
        with nli_mutation_lock(self.processed) as owner_token:
            blocked = subprocess.Popen([sys.executable, "-c", code, module_dir, str(self.root),
                                        "started", "", "acquired"], stdout=subprocess.PIPE,
                                       stderr=subprocess.PIPE, text=True)
            deadline = time.monotonic() + 5
            while not started.exists() and time.monotonic() < deadline: time.sleep(0.01)
            self.assertTrue(started.exists(), "competing child did not start")
            self.assertFalse(acquired.exists(), "standalone publisher entered while owner held lock")
            joined = subprocess.run([sys.executable, "-c", code, module_dir, str(self.root),
                                     "worker-started", owner_token, "worker-acquired"],
                                    capture_output=True, text=True, timeout=5)
            self.assertEqual(joined.returncode, 0, joined.stderr)
            self.assertEqual((self.root / "worker-acquired").read_text(), owner_token)
            self.assertFalse(acquired.exists(), "standalone publisher bypassed owner lock")
        stdout, stderr = blocked.communicate(timeout=5)
        self.assertEqual(blocked.returncode, 0, stderr or stdout)
        self.assertTrue(acquired.is_file())
    def test_recovery_infers_pre_or_post_image_before_and_after_each_replace(self):
        roles = [
            ("source_lines", "otef-interactive/public/source/layers/nli/gis/lines.geojson", b"new source"),
            ("processed_lines", "otef-interactive/public/processed/layers/nli/lines.geojson", b"new processed"),
            ("release_metadata", "otef-interactive/public/processed/layers/nli/release-metadata.json", b"new metadata"),
            ("presenter_json", "otef-interactive/frontend/src/remote/nli-presenter-content.json", b"new presenter"),
            ("derived_lock", "otef-interactive/scripts/nli-border-route-curation.lock.json", b"new lock"),
        ]
        for _, target_rel, _ in roles:
            for installed in (False, True):
                with self.subTest(target=target_rel, installed=installed):
                    self.bundle()
                    records = []
                    for role, rel, post in roles:
                        target = self.root / rel
                        pre = b"old:" + role.encode()
                        if pre is None: target.unlink(missing_ok=True)
                        else: target.write_bytes(pre)
                        backup = None
                        if pre is not None:
                            backup = self.processed.parent / ("backup-" + role)
                            backup.write_bytes(pre)
                        if rel == target_rel and installed: target.write_bytes(post)
                        records.append({"role": role, "target": rel, "stage": role,
                            "preImageExists": pre is not None,
                            "preImageSha256": hashlib.sha256(pre).hexdigest() if pre is not None else None,
                            "postImageSha256": hashlib.sha256(post).hexdigest(),
                            "backupPath": str(backup) if backup else None,
                            "backupSha256": hashlib.sha256(pre).hexdigest() if pre is not None else None,
                            "state": "writing" if rel == target_rel else "prepared"})
                    journal = self.processed.parent / ".nli-route-release-synthetic.json"
                    journal.write_text(json.dumps({"version": 1, "transactionID": "synthetic",
                        "repoRoot": str(self.root), "processedLayersRoot": str(self.processed),
                        "targets": records, "state": "writing"}), encoding="utf-8")
                    marker = self.processed.parent / ".nli-route-release-unfinished.json"
                    marker.write_text(json.dumps({"journal": journal.name, "transactionID": "synthetic"}))
                    rollback_release(journal)
                    for role, rel, _ in roles:
                        target = self.root / rel
                        expected = b"old:" + role.encode()
                        self.assertEqual(target.read_bytes() if target.exists() else None, expected)
    def test_owned_temp_child_exits_immediately_before_and_after_each_replace(self):
        roles = [
            ("source_lines", "otef-interactive/public/source/layers/nli/gis/lines.geojson"),
            ("processed_lines", "otef-interactive/public/processed/layers/nli/lines.geojson"),
            ("release_metadata", "otef-interactive/public/processed/layers/nli/release-metadata.json"),
            ("presenter_json", "otef-interactive/frontend/src/remote/nli-presenter-content.json"),
            ("derived_lock", "otef-interactive/scripts/nli-border-route-curation.lock.json"),
        ]
        for _, target_rel in roles:
            for after in (False, True):
                with self.subTest(target=target_rel, after=after):
                    self.bundle()
                    module_dir = str(Path(__file__).resolve().parents[1] / "otef_layer_processing")
                    target_abs = str((self.root / target_rel).resolve())
                    child_code = r'''
import os, sys
from pathlib import Path
sys.path.insert(0, sys.argv[1])
import nli_border_route_release as release
wanted, after = Path(sys.argv[3]).resolve(), sys.argv[4] == "1"
replace = release.os.replace
def faultpoint(source, destination):
    if Path(destination).resolve() == wanted:
        if after:
            replace(source, destination)
            os._exit(72)
        os._exit(71)
    return replace(source, destination)
release.os.replace = faultpoint
release._validate_candidate_runtime = lambda *args, **kwargs: {}
release._run_bundle_verifier = lambda *args, **kwargs: None
release.publish_release(Path(sys.argv[2]), outputs_closed=True)
'''
                    child = subprocess.run([sys.executable, "-c", child_code, module_dir,
                                            str(self.prepared.resolve()), target_abs,
                                            "1" if after else "0"], capture_output=True,
                                           text=True, timeout=20)
                    self.assertEqual(child.returncode, 72 if after else 71, child.stderr)
                    marker = self.processed.parent / ".nli-route-release-unfinished.json"
                    self.assertTrue(marker.is_file())
                    journal = self.processed.parent / json.loads(marker.read_text(encoding="utf-8"))["journal"]
                    rollback_release(journal)
                    self.assertFalse(marker.exists())
                    for role, rel in roles:
                        target = self.root / rel
                        expected = b"old:" + role.encode()
                        self.assertEqual(target.read_bytes() if target.exists() else None, expected)
    def test_wrong_inherited_token_does_not_remove_parent_owner_record(self):
        with nli_mutation_lock(self.processed) as owner_token:
            owner_path = self.processed.parent / ".nli-route-mutation-owner.json"
            original = json.loads(owner_path.read_text(encoding="utf-8"))
            with self.assertRaisesRegex(RuntimeError, "token"):
                with nli_mutation_lock(self.processed, owner_token="wrong-token"):
                    pass
            self.assertEqual(json.loads(owner_path.read_text(encoding="utf-8")), original)
            with nli_mutation_lock(self.processed, owner_token=owner_token) as worker_token:
                self.assertEqual(worker_token, owner_token)

    def test_stale_inherited_token_is_rejected_after_owner_child_exits(self):
        token_file = self.root / "owner-token.txt"
        module_dir = str(Path(__file__).resolve().parents[1] / "otef_layer_processing")
        code = r'''
import os, sys
from pathlib import Path
sys.path.insert(0, sys.argv[1])
from nli_mutation_lock import nli_mutation_lock
with nli_mutation_lock(Path(sys.argv[2])) as token:
    Path(sys.argv[3]).write_text(token)
    os._exit(79)
'''
        child = subprocess.run([sys.executable, "-c", code, module_dir, str(self.processed),
                                str(token_file)], capture_output=True, text=True, timeout=10)
        self.assertEqual(child.returncode, 79, child.stderr)
        stale_token = token_file.read_text(encoding="utf-8")
        self.assertFalse((self.processed.parent / ".nli-route-release-unfinished.json").exists())
        with self.assertRaisesRegex(RuntimeError, "active|stale|held"):
            with nli_mutation_lock(self.processed, owner_token=stale_token):
                self.fail("stale owner token entered after its OS lock was released")
        with nli_mutation_lock(self.processed) as new_token:
            self.assertNotEqual(new_token, stale_token)

    def test_candidate_directory_is_synced_before_committed_journal_and_marker_clear(self):
        self.bundle()
        import nli_border_route_release as release
        events = []
        sync = release._sync_directory
        flush = release._flush
        unlink = release._unlink_durable
        candidate_dirs = { (self.root / item).parent for item in (
            "otef-interactive/public/source/layers/nli/gis/lines.geojson",
            "otef-interactive/public/processed/layers/nli/lines.geojson",
            "otef-interactive/public/processed/layers/nli/release-metadata.json",
            "otef-interactive/frontend/src/remote/nli-presenter-content.json",
            "otef-interactive/scripts/nli-border-route-curation.lock.json") }
        def observed_sync(path):
            events.append(("sync", Path(path).resolve()))
            return sync(path)
        def observed_flush(path, data):
            if data.get("state") == "committed": events.append(("committed", Path(path)))
            return flush(path, data)
        def observed_unlink(path):
            if Path(path).name == release.MARKER: events.append(("marker_clear", Path(path)))
            return unlink(path)
        release._sync_directory = observed_sync
        release._flush = observed_flush
        release._unlink_durable = observed_unlink
        try: publish_release(self.prepared, outputs_closed=True)
        finally:
            release._sync_directory, release._flush, release._unlink_durable = sync, flush, unlink
        synced = [i for i, item in enumerate(events) if item[0] == "sync" and item[1] in candidate_dirs]
        committed = next(i for i, item in enumerate(events) if item[0] == "committed")
        cleared = next(i for i, item in enumerate(events) if item[0] == "marker_clear")
        self.assertEqual({events[i][1] for i in synced}, candidate_dirs)
        self.assertLess(max(synced), committed)
        self.assertLess(committed, cleared)

    def test_restoration_and_absent_target_removal_are_synced_before_rollback_completion(self):
        self.bundle()
        result = publish_release(self.prepared, outputs_closed=True)
        journal = Path(result["journal"])
        import nli_border_route_release as release
        events = []
        sync, flush, unlink = release._sync_directory, release._flush, release._unlink_durable
        target_dirs = {
            (self.root / "otef-interactive/public/source/layers/nli/gis").resolve(),
            (self.root / "otef-interactive/public/processed/layers/nli").resolve(),
            (self.root / "otef-interactive/frontend/src/remote").resolve(),
            (self.root / "otef-interactive/scripts").resolve(),
        }
        def observed_sync(path):
            events.append(("sync", Path(path).resolve()))
            return sync(path)
        def observed_flush(path, data):
            if data.get("state") == "rolled_back": events.append(("rolled_back", Path(path)))
            return flush(path, data)
        def observed_unlink(path):
            if Path(path).name == release.MARKER: events.append(("marker_clear", Path(path)))
            return unlink(path)
        release._sync_directory, release._flush, release._unlink_durable = observed_sync, observed_flush, observed_unlink
        try: rollback_release(journal)
        finally: release._sync_directory, release._flush, release._unlink_durable = sync, flush, unlink
        synced = {path for kind, path in events if kind == "sync" and path in target_dirs}
        rolled_back = next(i for i, event in enumerate(events) if event[0] == "rolled_back")
        cleared = next(i for i, event in enumerate(events) if event[0] == "marker_clear")
        self.assertEqual(synced, target_dirs)
        self.assertLess(max(i for i, event in enumerate(events) if event[0] == "sync" and event[1] in target_dirs), rolled_back)
        self.assertLess(rolled_back, cleared)
        self.assertEqual((self.root / "otef-interactive/scripts/nli-border-route-curation.lock.json").read_bytes(), b"old:derived_lock")

    def test_retry_after_rename_or_unlink_sync_failure_flushes_already_preimage(self):
        import nli_border_route_release as release
        original_root = self.root
        cases = [
            ("existing", "otef-interactive/scripts/nli-border-route-curation.lock.json", b"old:derived_lock"),
            ("absent", "otef-interactive/scripts/nli-border-route-curation.lock.json", None),
        ]
        original_sync = release._sync_directory
        for name, relative, preimage in cases:
            with self.subTest(preimage=name):
                self.root = original_root / ("retry-" + name)
                self.root.mkdir()
                self.processed = self.root / "otef-interactive/public/processed/layers/nli"
                self.processed.mkdir(parents=True)
                self.prepared = self.root / "prepared"
                self.prepared.mkdir()
                self.bundle()
                if preimage is None:
                    (self.root / relative).unlink(missing_ok=True)
                    manifest_path = self.prepared / "prepared-manifest.json"
                    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
                    lock_target = next(item for item in manifest["targets"] if item["role"] == "derived_lock")
                    lock_target["preImageSha256"] = None
                    manifest_path.write_text(json.dumps(manifest), encoding="utf-8")
                result = publish_release(self.prepared, outputs_closed=True)
                journal = Path(result["journal"])
                journal_data = json.loads(journal.read_text(encoding="utf-8"))
                journal_data["state"] = "rolling_back"
                journal.write_text(json.dumps(journal_data), encoding="utf-8")
                marker = self.processed.parent / ".nli-route-release-unfinished.json"
                marker.write_text(json.dumps({"journal": journal.name, "transactionID": journal_data["transactionID"]}), encoding="utf-8")
                target = self.root / relative
                target_dir = target.parent.resolve()
                failed_after_namespace = False
                def fail_after_namespace(path):
                    nonlocal failed_after_namespace
                    if Path(path).resolve() == target_dir and not failed_after_namespace:
                        failed_after_namespace = True
                        raise OSError("injected after namespace change, before directory fsync")
                    return original_sync(path)
                release._sync_directory = fail_after_namespace
                try:
                    with self.assertRaisesRegex(OSError, "before directory fsync"):
                        rollback_release(journal)
                finally:
                    release._sync_directory = original_sync
                self.assertTrue(failed_after_namespace)
                self.assertEqual(target.read_bytes() if target.exists() else None, preimage)
                marker = self.processed.parent / ".nli-route-release-unfinished.json"
                self.assertTrue(marker.is_file())
                events = []
                original_flush, original_unlink = release._flush, release._unlink_durable
                def observed_sync(path):
                    resolved = Path(path).resolve()
                    events.append(("sync", resolved))
                    return original_sync(path)
                def observed_flush(path, data):
                    if data.get("state") == "rolled_back": events.append(("rolled_back", Path(path)))
                    return original_flush(path, data)
                def observed_unlink(path):
                    if Path(path).name == release.MARKER: events.append(("marker_clear", Path(path)))
                    return original_unlink(path)
                release._sync_directory, release._flush, release._unlink_durable = observed_sync, observed_flush, observed_unlink
                try:
                    rollback_release(journal)
                finally:
                    release._sync_directory, release._flush, release._unlink_durable = original_sync, original_flush, original_unlink
                sync_index = next(i for i, event in enumerate(events) if event == ("sync", target_dir))
                complete_index = next(i for i, event in enumerate(events) if event[0] == "rolled_back")
                clear_index = next(i for i, event in enumerate(events) if event[0] == "marker_clear")
                self.assertLess(sync_index, complete_index)
                self.assertLess(complete_index, clear_index)
                self.assertEqual(target.read_bytes() if target.exists() else None, preimage)
                self.assertFalse(marker.exists())
        self.root = original_root

    def test_recovery_rereads_completed_journal_after_waiting_for_publisher_lock(self):
        import contextlib, threading
        self.bundle()
        import nli_border_route_release as release
        gate = threading.Lock()
        first_target = (self.root / "otef-interactive/public/source/layers/nli/gis/lines.geojson").resolve()
        publisher_paused, resume_publisher, recovery_waiting = threading.Event(), threading.Event(), threading.Event()
        errors = []
        real_replace = release.os.replace
        @contextlib.contextmanager
        def controlled_lock(root, *, owner_token=None, recovery=False):
            if recovery: recovery_waiting.set()
            gate.acquire()
            try: yield owner_token or "test-owner"
            finally: gate.release()
        def pause_after_first_target(source, destination):
            result = real_replace(source, destination)
            if Path(destination).resolve() == first_target:
                publisher_paused.set()
                if not resume_publisher.wait(5): raise TimeoutError("recovery did not enter wait")
            return result
        release.nli_mutation_lock = controlled_lock
        release.os.replace = pause_after_first_target
        def publish():
            try: publish_release(self.prepared, outputs_closed=True)
            except BaseException as exc: errors.append(exc)
        def recover(journal):
            try: rollback_release(journal)
            except BaseException as exc: errors.append(exc)
        publisher = threading.Thread(target=publish)
        publisher.start()
        self.assertTrue(publisher_paused.wait(5), "publisher did not reach first target replace")
        marker = self.processed.parent / ".nli-route-release-unfinished.json"
        journal = self.processed.parent / json.loads(marker.read_text(encoding="utf-8"))["journal"]
        recovery = threading.Thread(target=recover, args=(journal,))
        recovery.start()
        self.assertTrue(recovery_waiting.wait(5), "recovery did not wait for publication lock")
        resume_publisher.set()
        publisher.join(5); recovery.join(5)
        release.nli_mutation_lock = nli_mutation_lock
        release.os.replace = real_replace
        self.assertFalse(publisher.is_alive() or recovery.is_alive())
        self.assertEqual(errors, [])
        self.assertFalse(marker.exists())
        for role, rel, _candidate in [
            ("source_lines", "otef-interactive/public/source/layers/nli/gis/lines.geojson", b"source new"),
            ("processed_lines", "otef-interactive/public/processed/layers/nli/lines.geojson", b"processed new"),
            ("release_metadata", "otef-interactive/public/processed/layers/nli/release-metadata.json", b"metadata new"),
            ("presenter_json", "otef-interactive/frontend/src/remote/nli-presenter-content.json", b"presenter new"),
            ("derived_lock", "otef-interactive/scripts/nli-border-route-curation.lock.json", b"lock new")]:
            target = self.root / rel
            expected = b"old:" + role.encode()
            self.assertEqual(target.read_bytes() if target.exists() else None, expected)
    def test_lock_returns_and_validates_inherited_token_and_marker_blocks(self):
        with nli_mutation_lock(self.processed) as token:
            with nli_mutation_lock(self.processed, owner_token=token) as worker_token:
                self.assertEqual(worker_token, token)
        marker = self.processed.parent / ".nli-route-release-unfinished.json"
        marker.write_text("{}")
        with self.assertRaisesRegex(RuntimeError, "unfinished NLI release"):
            with nli_mutation_lock(self.processed): pass

if __name__ == "__main__": unittest.main()
