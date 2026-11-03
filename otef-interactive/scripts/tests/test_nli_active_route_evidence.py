from __future__ import annotations

import hashlib
import json
import os
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch
from pathlib import Path

SCRIPTS = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(SCRIPTS))
sys.path.insert(0, str(SCRIPTS / "otef_layer_processing"))

from nli_border_route_release import (  # noqa: E402
    validate_active_route_candidate,
    validate_active_route_source,
)


def _sha(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


class ActiveRouteEvidenceTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.repo = Path(self.temp.name)
        self.interactive = self.repo / "otef-interactive"
        self.scripts = self.interactive / "scripts"
        self.processed = self.interactive / "public/processed/layers/nli"
        self.source = self.interactive / "public/source/layers/nli/gis/lines.geojson"
        self.recipe = self.scripts / "nli-border-route-curation.json"
        self.lock = self.scripts / "nli-border-route-curation.lock.json"
        self.metadata = self.processed / "release-metadata.json"
        self.presenter = self.interactive / "frontend/src/remote/nli-presenter-content.json"
        self.border = self.interactive / "frontend/src/shared/gaza-border-geometry.js"
        self.processed.mkdir(parents=True)
        self.source.parent.mkdir(parents=True)
        self.recipe.parent.mkdir(parents=True)
        self.presenter.parent.mkdir(parents=True)
        self.border.parent.mkdir(parents=True)
        source_bytes = b'{"type":"FeatureCollection","features":[]}\n'
        self.source.write_bytes(source_bytes)
        border_bytes = b"export default {}\n"
        self.border.write_bytes(border_bytes)
        border_sha = _sha(border_bytes)
        recipe_bytes = json.dumps({"schema_version": 1, "expected_inputs": {
            "source_lines_sha256": "18b0e3445c771da9c3e7995270601f7a1187501bd3bfdf6b3e0fa2c6cedc6462",
            "runtime_lines_sha256": "934bd4be7a1d6a4f1b6a0f62337384d06624e571a6efe44da366ab6062afa3c1",
            "confirmed_features_sha256": "c2d3ec3f50f0c016e6665b39ed93ed758020cf0c2a8339153cb1f51326039358",
            "border_module_sha256_lf": border_sha}}).encode() + b"\n"
        self.recipe.write_bytes(recipe_bytes)
        curation = {
            "schemaVersion": 1,
            "recipeSha256": _sha(recipe_bytes),
            "baseSourceSha256": "18b0e3445c771da9c3e7995270601f7a1187501bd3bfdf6b3e0fa2c6cedc6462",
            "baseRuntimeSha256": "934bd4be7a1d6a4f1b6a0f62337384d06624e571a6efe44da366ab6062afa3c1",
            "confirmedFeaturesSha256": "c2d3ec3f50f0c016e6665b39ed93ed758020cf0c2a8339153cb1f51326039358",
            "borderSha256": border_sha,
            "roadSha256": "e" * 64,
            "derivedSourceSha256": _sha(source_bytes),
            "runtimeByteSha256": "f" * 64,
            "runtimeFeatureSha256": "1" * 64,
            "counts": {"features": 89, "confirmed": 68, "unconfirmed": 21},
            "addedObjectIds": list(range(1013, 1022)),
            "editedObjectIds": [1001, 1002, 1005, 1006, 1008, 1009, 1010, 1011, 1012],
        }
        self.lock.write_text(json.dumps({"curation": curation}), encoding="utf-8")
        self.evidence = curation
        self.provenance = self.scripts / "nli-presenter-provenance.json"
        self._write_release_evidence()

    def _write_release_evidence(self):
        source_sha = "accepted-source-sha"
        dataset_version = "dataset-v1"
        package_sha = "accepted-package-sha"
        self.metadata.write_text(json.dumps({
            "sourceSha256": source_sha,
            "datasetVersion": dataset_version,
            "counts": {"lines": 89},
            "runtimeArtifactHashes": {"lines.geojson": self.evidence["runtimeByteSha256"].upper()},
            "routeBorderCuration": self.evidence,
        }), encoding="utf-8")
        self.presenter.write_text(json.dumps({
            "acceptedSourceSha256": source_sha,
            "datasetVersion": dataset_version,
            "requiredArtifacts": {"nli.lines": self.evidence["runtimeFeatureSha256"]},
            "sourceEvidence": {
                "acceptedSourceSha256": source_sha,
                "datasetVersion": dataset_version,
                "acceptedPackageSha256": package_sha,
                "packageSha256": package_sha,
                "routeBorderCuration": self.evidence,
                "artifacts": {"nli.lines": {
                    "runtimeByteSha256": self.evidence["runtimeByteSha256"],
                    "runtimeFeatureSha256": self.evidence["runtimeFeatureSha256"],
                    "packagedByteSha256": "packaged-line-sha",
                    "captionFields": ["OBJECTID"],
                    "acceptedCaptionSha256": "accepted-caption-sha",
                }},
            },
        }), encoding="utf-8")
        self.provenance.write_text(json.dumps({
            "acceptedSourceSha256": source_sha,
            "datasetVersion": dataset_version,
            "packageSha256": package_sha,
            "artifacts": {"nli.lines": {
                "packagedByteSha256": "packaged-line-sha",
                "captionFields": ["OBJECTID"],
                "acceptedCaptionSha256": "accepted-caption-sha",
            }},
        }), encoding="utf-8")

    def tearDown(self):
        self.temp.cleanup()

    def test_valid_active_source_returns_shared_curation_evidence(self):
        evidence = validate_active_route_source(self.source, self.recipe, self.lock)
        self.assertEqual(evidence["curation"], self.evidence)
        self.assertEqual(evidence["processedLayersRoot"], str(self.processed.resolve()))

    def test_active_source_rejects_changed_recipe_or_border(self):
        self.recipe.write_bytes(self.recipe.read_bytes() + b" ")
        with self.assertRaisesRegex(ValueError, "recipe"):
            validate_active_route_source(self.source, self.recipe, self.lock)
        border_sha = _sha(self.border.read_bytes())
        self.recipe.write_bytes(json.dumps({"schema_version": 1, "expected_inputs": {
            "source_lines_sha256": "18b0e3445c771da9c3e7995270601f7a1187501bd3bfdf6b3e0fa2c6cedc6462",
            "runtime_lines_sha256": "934bd4be7a1d6a4f1b6a0f62337384d06624e571a6efe44da366ab6062afa3c1",
            "confirmed_features_sha256": "c2d3ec3f50f0c016e6665b39ed93ed758020cf0c2a8339153cb1f51326039358",
            "border_module_sha256_lf": border_sha}}).encode())
        self.evidence["borderSha256"] = border_sha
        self.evidence["recipeSha256"] = _sha(self.recipe.read_bytes())
        self.lock.write_text(json.dumps({"curation": self.evidence}), encoding="utf-8")
        self._write_release_evidence()
        self.border.write_bytes(b"changed border")
        with self.assertRaisesRegex(ValueError, "border"):
            validate_active_route_source(self.source, self.recipe, self.lock)

    def test_active_source_rejects_missing_metadata_and_stale_raw_source(self):
        self.metadata.unlink()
        with self.assertRaisesRegex(ValueError, "metadata"):
            validate_active_route_source(self.source, self.recipe, self.lock)
        self._write_release_evidence()
        self.source.write_bytes(b"raw prepared source")
        with self.assertRaisesRegex(ValueError, "source"):
            validate_active_route_source(self.source, self.recipe, self.lock)

    def test_active_source_requires_all_published_line_and_acceptance_evidence(self):
        mutations = (
            ("metadata line hash", lambda metadata, presenter: metadata["runtimeArtifactHashes"].pop("lines.geojson")),
            ("presenter required line", lambda metadata, presenter: presenter["requiredArtifacts"].pop("nli.lines")),
            ("presenter line evidence", lambda metadata, presenter: presenter["sourceEvidence"]["artifacts"].pop("nli.lines")),
            ("accepted source", lambda metadata, presenter: metadata.__setitem__("sourceSha256", "foreign-source")),
            ("dataset", lambda metadata, presenter: metadata.__setitem__("datasetVersion", "foreign-version")),
            ("package", lambda metadata, presenter: presenter["sourceEvidence"].__setitem__("packageSha256", "foreign-package")),
        )
        for label, mutate in mutations:
            with self.subTest(identity=label):
                self._write_release_evidence()
                metadata = json.loads(self.metadata.read_text(encoding="utf-8"))
                presenter = json.loads(self.presenter.read_text(encoding="utf-8"))
                mutate(metadata, presenter)
                self.metadata.write_text(json.dumps(metadata), encoding="utf-8")
                self.presenter.write_text(json.dumps(presenter), encoding="utf-8")
                with self.assertRaises(ValueError):
                    validate_active_route_source(self.source, self.recipe, self.lock)

    def test_active_source_allows_runtime_absence_and_corruption_for_repair(self):
        runtime = self.processed / "lines.geojson"
        runtime.unlink(missing_ok=True)
        self.assertIsNotNone(validate_active_route_source(self.source, self.recipe, self.lock))
        runtime.write_bytes(b"corrupt runtime output")
        self.assertIsNotNone(validate_active_route_source(self.source, self.recipe, self.lock))

    def test_active_source_allows_owned_people_hash_update(self):
        metadata = json.loads(self.metadata.read_text(encoding="utf-8"))
        metadata["runtimeArtifactHashes"]["people-search-index.json"] = "updated-people-hash"
        metadata["otherMetadata"] = {"preserved": True}
        self.metadata.write_text(json.dumps(metadata), encoding="utf-8")
        self.assertIsNotNone(validate_active_route_source(self.source, self.recipe, self.lock))

    def test_processor_identity_detects_presenter_byte_changes_allowed_by_source_guard(self):
        from otef_layer_processing.orchestrator import ProcessingOrchestrator

        evidence = validate_active_route_source(self.source, self.recipe, self.lock)
        output_root = self.processed.parent
        orchestrator = ProcessingOrchestrator(
            self.interactive / "public/source/layers", output_root,
            curation_recipe_path=self.recipe, curation_lock_path=self.lock,
        )
        starting_identity = orchestrator._active_metadata_identity(evidence)
        presenter = json.loads(self.presenter.read_text(encoding="utf-8"))
        presenter["records"] = [{"caption": "new presenter record"}]
        self.presenter.write_text(json.dumps(presenter), encoding="utf-8")

        self.assertEqual(validate_active_route_source(self.source, self.recipe, self.lock), evidence)
        self.assertNotEqual(
            starting_identity, orchestrator._active_metadata_identity(evidence),
            "whole presenter bytes must participate in processor recheck identity",
        )

    def test_active_line_stamp_rejects_foreign_runtime_without_changing_metadata(self):
        from nli_runtime_hashes import stamp_nli_runtime_artifact_hash

        runtime = self.processed / "lines.geojson"
        runtime.write_bytes(b"foreign runtime lines")
        before = self.metadata.read_bytes()
        with self.assertRaises(ValueError):
            stamp_nli_runtime_artifact_hash(
                self.processed, "lines.geojson", processed_layers_root=self.processed,
                curation_recipe_path=self.recipe, curation_lock_path=self.lock,
            )
        self.assertEqual(self.metadata.read_bytes(), before)

    def test_source_guard_checks_unfinished_marker_without_derived_lock(self):
        self.lock.unlink()
        marker = self.processed.parent / ".nli-route-release-unfinished.json"
        marker.write_text("{}", encoding="utf-8")
        with self.assertRaisesRegex(RuntimeError, "unfinished NLI release"):
            validate_active_route_source(self.source, self.recipe, self.lock)

    def test_candidate_guard_rejects_runtime_bytes_that_differ_from_active_release(self):
        candidate = self.repo / "candidate.geojson"
        candidate.write_text('{"type":"FeatureCollection","features":[]}\n', encoding="utf-8")
        repo = Path(__file__).resolve().parents[3]
        with self.assertRaisesRegex(ValueError, "runtime byte hash"):
            validate_active_route_candidate(candidate, {
                "curation": self.evidence,
                "repoRoot": str(repo),
            })

    def test_candidate_uses_the_shared_node_digest_and_reviewed_counts(self):
        candidate = self.repo / "candidate.geojson"
        features = [{"type": "Feature", "properties": {
            "OBJECTID": 1001 + index - 68 if index >= 68 else index + 1,
            "route_confidence": "unconfirmed" if index >= 68 else "confirmed",
        }, "geometry": {"type": "LineString", "coordinates": [[34, 31], [34.1, 31.1]]}}
            for index in range(89)]
        candidate.write_text(json.dumps({"type": "FeatureCollection", "features": features}), encoding="utf-8")
        repo = Path(__file__).resolve().parents[3]
        cli = repo / "otef-interactive/scripts/nli-route-curation-digests.mjs"
        node = os.environ.get("NODE", "node")
        result = subprocess.run([node, str(cli), "--file", str(candidate)],
                                capture_output=True, text=True, check=True)
        digest = json.loads(result.stdout)
        evidence = {"curation": {
            **self.evidence,
            "runtimeByteSha256": digest["byteSha256"],
            "runtimeFeatureSha256": digest["featureSha256"],
            "confirmedFeaturesSha256": digest["confirmedFeaturesSha256"],
        }, "repoRoot": str(repo)}
        with self.assertRaisesRegex(ValueError, "confirmed-feature hash"):
            validate_active_route_candidate(candidate, evidence)
        import nli_active_route_evidence as active_evidence
        with patch.object(active_evidence, "CONFIRMED", digest["confirmedFeaturesSha256"]):
            validate_active_route_candidate(candidate, evidence)

    def test_source_import_refuses_active_curation_before_writing(self):
        from nli_pack_prep import prepare_nli_pack

        pack_dir = self.source.parent.parent
        before = self.source.read_bytes()
        with self.assertRaisesRegex(RuntimeError, "blocked while route curation is active"):
            prepare_nli_pack(
                self.repo / "missing.zip", pack_dir,
                processed_layers_root=self.processed,
                curation_recipe_path=self.recipe,
                curation_lock_path=self.lock,
            )
        self.assertEqual(self.source.read_bytes(), before)

    def test_prepared_source_restore_refuses_active_curation_before_extraction(self):
        from nli_prepared_pack import restore_prepared_pack

        destination = self.repo / "restore/nli"
        destination.parent.mkdir()
        with self.assertRaisesRegex(ValueError, "source bytes"):
            restore_prepared_pack(
                self.repo / "missing.zip", destination, "0" * 64,
                processed_layers_root=self.processed,
                curation_recipe_path=self.recipe,
                curation_lock_path=self.lock,
            )
        self.assertFalse(destination.exists())


if __name__ == "__main__":
    unittest.main()
