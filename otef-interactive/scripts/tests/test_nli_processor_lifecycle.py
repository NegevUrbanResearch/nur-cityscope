import hashlib
import json
import hashlib
import threading
import tempfile
import unittest
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import Mock, patch

import otef_layer_processing.orchestrator as orchestrator_module
import otef_layer_processing.nli_border_route_release as release_module
from otef_layer_processing.nli_processing_recovery import file_sha256, record_owned_postimage, restore_owned_outputs
from otef_layer_processing.orchestrator import ProcessingOrchestrator
from otef_layer_processing.nli_mutation_lock import nli_mutation_lock
from otef_layer_processing.nli_runtime_hashes import stamp_nli_runtime_artifact_hash


class NliProcessorLifecycleTests(unittest.TestCase):
    def test_prepare_release_export_lazily_preserves_arguments(self):
        repo = Path("temporary-repo")
        recipe = Path("temporary-recipe.json")
        staging = Path("temporary-staging")
        preview = Path("temporary-preview.json")
        preparer = SimpleNamespace(prepare_release=Mock(return_value={"status": "mocked"}))
        with patch.object(release_module.importlib, "import_module", return_value=preparer) as load:
            result = release_module.prepare_release(
                repo, recipe, staging, preview_reference=preview,
                mode="check", audit_only=True,
            )
        self.assertEqual(result, {"status": "mocked"})
        load.assert_called_once_with(".nli_border_route_prepare", package="otef_layer_processing")
        preparer.prepare_release.assert_called_once_with(
            repo, recipe, staging, preview_reference=preview,
            mode="check", audit_only=True,
        )

    def test_full_run_holds_owner_before_snapshot_and_through_rollback(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            output = root / "processed" / "layers"
            nli = output / "nli"
            nli.mkdir(parents=True)
            orchestrator = ProcessingOrchestrator(root / "source", output, max_workers=1)
            owner_record = nli.parent / ".nli-route-mutation-owner.json"
            phases = []

            def snapshot(pack_ids):
                phases.append("snapshot")
                owner = json.loads(owner_record.read_text(encoding="utf-8"))
                self.assertEqual(owner["root"], str(nli.resolve()))
                return {"pack_ids": pack_ids}

            def fail(*, stuck_timeout, _snapshot, _nli_token, _nli_evidence,
                     _nli_metadata_identity, _packs):
                phases.append("worker-run")
                self.assertTrue(_nli_token)
                self.assertEqual(json.loads(owner_record.read_text(encoding="utf-8"))["token"], _nli_token)
                raise RuntimeError("forced full-run failure")

            def restore(_snapshot):
                phases.append("rollback")
                self.assertTrue(owner_record.is_file(), "NLI ownership ended before whole-pack rollback")

            with patch.object(orchestrator, "scan_packs", return_value=[SimpleNamespace(name="nli")]), \
                 patch.object(orchestrator, "_validate_active_nli_source", return_value=None), \
                 patch.object(orchestrator, "_begin_output_snapshot", side_effect=snapshot), \
                 patch.object(orchestrator, "_process_all_impl", side_effect=fail), \
                 patch.object(orchestrator, "_restore_output_snapshot", side_effect=restore), \
                 patch.object(orchestrator, "_finish_output_snapshot"):
                with self.assertRaisesRegex(RuntimeError, "forced full-run failure"):
                    orchestrator.process_all()

            self.assertEqual(phases, ["snapshot", "worker-run", "rollback"])
            self.assertFalse(owner_record.exists(), "owner record should be cleared after rollback completes")

    def test_full_run_prewrite_identity_abort_preserves_atomic_metadata_edit(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory); output=root/"processed"/"layers"; nli=output/"nli"
            nli.mkdir(parents=True); source=root/"source"/"nli"; source.mkdir(parents=True)
            metadata=nli/"release-metadata.json"
            original=b'{"fileHashes":{"immutable":"before"},"runtimeArtifactHashes":{}}\n'
            metadata.write_bytes(original)
            recipe=root/"recipe.json"; recipe.write_text("recipe",encoding="utf-8")
            lock=root/"lock.json"; lock.write_text("lock",encoding="utf-8")
            presenter=root/"otef-interactive"/"frontend"/"src"/"remote"/"nli-presenter-content.json"
            presenter.parent.mkdir(parents=True); presenter.write_text("{}",encoding="utf-8")
            evidence={"processedLayersRoot":str(nli.resolve()),"repoRoot":str(root.resolve())}
            orchestrator=ProcessingOrchestrator(root/"source",output,max_workers=1,
                curation_recipe_path=recipe,curation_lock_path=lock)
            orchestrator.scan_packs=lambda:[SimpleNamespace(name="nli")]
            orchestrator._validate_active_nli_source=lambda:evidence
            real_snapshot=orchestrator._begin_output_snapshot
            foreign=original.replace(b"before",b"foreign")
            def snapshot_then_replace(pack_ids):
                snapshot=real_snapshot(pack_ids)
                temp=metadata.with_suffix(".foreign"); temp.write_bytes(foreign); temp.replace(metadata)
                return snapshot
            owner=output/".nli-route-mutation-owner.json"
            real_restore=orchestrator._restore_output_snapshot
            def restore_while_locked(snapshot,pack_ids=None):
                self.assertTrue(owner.is_file())
                return real_restore(snapshot,pack_ids)
            def identity_guard(*, _nli_evidence, _nli_metadata_identity, **_kwargs):
                if orchestrator._active_metadata_identity(_nli_evidence)!=_nli_metadata_identity:
                    raise RuntimeError("active NLI release metadata changed before worker processing")
            with patch.object(orchestrator,"_begin_output_snapshot",side_effect=snapshot_then_replace), \
                 patch.object(orchestrator,"_restore_output_snapshot",side_effect=restore_while_locked), \
                 patch.object(orchestrator,"_process_all_impl",side_effect=identity_guard):
                with self.assertRaisesRegex(RuntimeError,"active NLI release metadata changed"):
                    orchestrator.process_all()
            self.assertEqual(metadata.read_bytes(),foreign)
            self.assertFalse(owner.exists())

    def test_full_run_failure_restores_owned_output_but_preserves_atomic_metadata_edit(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory); output=root/"processed"/"layers"; nli=output/"nli"
            nli.mkdir(parents=True); source=root/"source"/"nli"; source.mkdir(parents=True)
            lines=nli/"lines.geojson"; lines.write_bytes(b"original-lines")
            metadata=nli/"release-metadata.json"; original_metadata=b'{"fileHashes":{"immutable":"before"}}'
            metadata.write_bytes(original_metadata)
            recipe=root/"recipe.json"; recipe.write_text("recipe",encoding="utf-8")
            lock=root/"lock.json"; lock.write_text("lock",encoding="utf-8")
            presenter=root/"otef-interactive"/"frontend"/"src"/"remote"/"nli-presenter-content.json"
            presenter.parent.mkdir(parents=True); presenter.write_text("{}",encoding="utf-8")
            evidence={"processedLayersRoot":str(nli.resolve()),"repoRoot":str(root.resolve())}
            orchestrator=ProcessingOrchestrator(root/"source",output,max_workers=1,
                curation_recipe_path=recipe,curation_lock_path=lock)
            orchestrator.scan_packs=lambda:[SimpleNamespace(name="nli")]
            orchestrator._validate_active_nli_source=lambda:evidence
            foreign=original_metadata.replace(b"before",b"external")
            saved_preimages=[]; owner=output/".nli-route-mutation-owner.json"
            def write_then_fail(*, _snapshot, **_kwargs):
                post=b"worker-lines"
                record_owned_postimage(_snapshot["recovery_journal"],lines,hashlib.sha256(post).hexdigest())
                lines.write_bytes(post)
                temp=metadata.with_suffix(".foreign"); temp.write_bytes(foreign); temp.replace(metadata)
                raise RuntimeError("forced full-run failure after owned output write")
            real_restore=orchestrator._restore_output_snapshot
            def restore_while_locked(snapshot,pack_ids=None):
                self.assertTrue(owner.is_file())
                saved=Path(snapshot["file_copies"][str(lines.resolve())]); saved_preimages.append(saved.read_bytes())
                return real_restore(snapshot,pack_ids)
            with patch.object(orchestrator,"_process_all_impl",side_effect=write_then_fail), \
                 patch.object(orchestrator,"_restore_output_snapshot",side_effect=restore_while_locked):
                with self.assertRaisesRegex(RuntimeError,"forced full-run failure"):
                    orchestrator.process_all()
            self.assertEqual(lines.read_bytes(),b"original-lines")
            self.assertEqual(metadata.read_bytes(),foreign)
            self.assertEqual(saved_preimages,[b"original-lines"])
            self.assertFalse(owner.exists())

    def test_targeted_failure_restores_owned_output_and_preserves_foreign_metadata(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory); source=root/"source"/"nli"; gis=source/"gis"; styles=source/"styles"
            gis.mkdir(parents=True); styles.mkdir(); output_root=root/"processed"/"layers"; output=output_root/"nli"
            output.mkdir(parents=True); (gis/"lines.geojson").write_text("source",encoding="utf-8")
            lines=output/"lines.geojson"; lines.write_bytes(b"original-lines")
            metadata=output/"release-metadata.json"; original_metadata=b'{"fileHashes":{"immutable":"before"}}'
            metadata.write_bytes(original_metadata)
            recipe=root/"recipe.json"; recipe.write_text("recipe",encoding="utf-8")
            lock=root/"lock.json"; lock.write_text("lock",encoding="utf-8")
            presenter=root/"otef-interactive"/"frontend"/"src"/"remote"/"nli-presenter-content.json"
            presenter.parent.mkdir(parents=True); presenter.write_text("{}",encoding="utf-8")
            evidence={"curation":{"release":"stable"},"processedLayersRoot":str(output.resolve()),"repoRoot":str(root.resolve())}
            orchestrator=ProcessingOrchestrator(root/"source",output_root,max_workers=1,
                curation_recipe_path=recipe,curation_lock_path=lock)
            orchestrator._validate_active_nli_source=lambda:evidence
            foreign=original_metadata.replace(b"before",b"external")
            snapshot_seen=[]; owner=output_root/".nli-route-mutation-owner.json"
            saved_preimages=[]
            real_snapshot=orchestrator._begin_output_snapshot
            def save_snapshot(pack_ids):
                snapshot=real_snapshot(pack_ids); snapshot_seen.append(snapshot); return snapshot
            def write_then_foreign_edit(*_args, _nli_recovery_journal, **_kwargs):
                post=b"worker-lines"
                record_owned_postimage(_nli_recovery_journal,lines,hashlib.sha256(post).hexdigest())
                lines.write_bytes(post)
                temp=metadata.with_suffix(".foreign"); temp.write_bytes(foreign); temp.replace(metadata)
                raise RuntimeError("forced failure after owned output write")
            real_restore=orchestrator._restore_output_snapshot
            def restore_while_locked(snapshot,pack_ids=None):
                self.assertTrue(owner.is_file())
                saved_path=Path(snapshot["file_copies"][str(lines.resolve())])
                saved_preimages.append(saved_path.read_bytes())
                return real_restore(snapshot,pack_ids)
            with patch.object(orchestrator,"_begin_output_snapshot",side_effect=save_snapshot), \
                 patch.object(orchestrator,"_restore_output_snapshot",side_effect=restore_while_locked), \
                 patch.object(orchestrator,"_process_single_layer_merged_impl",side_effect=write_then_foreign_edit):
                with self.assertRaisesRegex(RuntimeError,"forced failure after owned output write"):
                    orchestrator.process_single_layer_merged("nli","lines")
            self.assertEqual(lines.read_bytes(),b"original-lines")
            self.assertEqual(metadata.read_bytes(),foreign)
            self.assertEqual(saved_preimages,[b"original-lines"], "snapshot preimage must stay immutable")
            self.assertFalse(owner.exists())

    def test_recovery_retains_evidence_when_owned_output_was_foreign_edited(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory); pack=root/"processed"/"layers"/"nli"; pack.mkdir(parents=True)
            target=pack/"lines.geojson"; target.write_bytes(b"before")
            snapshot_dir=root/".layer-publish"; snapshot_dir.mkdir()
            saved=snapshot_dir/"lines.geojson"; saved.write_bytes(b"before")
            journal=snapshot_dir/"owned-postimages.jsonl"
            (snapshot_dir/"preimages.json").write_text(json.dumps({str(target.resolve()):hashlib.sha256(b"before").hexdigest()}),encoding="utf-8")
            snapshot={"dir":snapshot_dir,"recovery_journal":journal,"file_copies":{str(target.resolve()):str(saved)}}
            post=b"worker-output"; record_owned_postimage(journal,target,hashlib.sha256(post).hexdigest()); target.write_bytes(post)
            foreign=b"external-output"; target.write_bytes(foreign)
            conflicts=restore_owned_outputs(snapshot)
            self.assertEqual(target.read_bytes(),foreign)
            self.assertTrue(conflicts and "foreign output" in conflicts[0])
            self.assertTrue((snapshot_dir/"recovery-conflicts.json").is_file())
            self.assertTrue(snapshot_dir.is_dir(),"recovery evidence must remain available")

    def test_buffered_rollback_preserves_foreign_data_edit_and_outer_recovers_other_outputs(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            output_root = root / "processed" / "layers"
            pack = output_root / "nli"
            pack.mkdir(parents=True)
            final_data = pack / "investigation_polygons.geojson"
            final_sidecar = pack / "investigation_polygons.buffered-gradient.geojson"
            final_pmtiles = pack / "investigation_polygons.pmtiles"
            other_owned = pack / "styles.json"
            for path, value in ((final_data, b"old-data"), (final_sidecar, b"old-sidecar"),
                                (final_pmtiles, b"old-pmtiles"), (other_owned, b"old-style")):
                path.write_bytes(value)
            staged_dir = root / "staged"
            staged_dir.mkdir()
            staged_data = staged_dir / final_data.name
            staged_sidecar = staged_dir / final_sidecar.name
            staged_pmtiles = staged_dir / final_pmtiles.name
            staged_data.write_bytes(b"new-data")
            staged_sidecar.write_bytes(b"new-sidecar")
            orchestrator = ProcessingOrchestrator(root / "source", output_root, max_workers=1)
            owner = output_root / ".nli-route-mutation-owner.json"

            with nli_mutation_lock(pack):
                snapshot = orchestrator._begin_output_snapshot(["nli"])
                journal = snapshot["recovery_journal"]
                style_postimage = b"owned-style"
                record_owned_postimage(journal, other_owned, hashlib.sha256(style_postimage).hexdigest())
                other_owned.write_bytes(style_postimage)
                foreign_data = b"external-atomic-data"
                real_replace = orchestrator_module._replace_transaction_file

                def replace_then_edit_and_fail(source_path, destination_path):
                    source_path, destination_path = Path(source_path), Path(destination_path)
                    if source_path == staged_sidecar and destination_path == final_sidecar:
                        raise OSError("injected sidecar replacement failure")
                    result = real_replace(source_path, destination_path)
                    if source_path == staged_data and destination_path == final_data:
                        foreign_temp = pack / "foreign-data.tmp"
                        foreign_temp.write_bytes(foreign_data)
                        foreign_temp.replace(final_data)
                    return result

                with patch.object(orchestrator_module, "_replace_transaction_file",
                                  side_effect=replace_then_edit_and_fail):
                    with self.assertRaisesRegex(RuntimeError, "foreign output"):
                        orchestrator_module._commit_buffered_gradient_transaction(
                            staged_data, staged_sidecar, staged_pmtiles,
                            final_data, final_sidecar, final_pmtiles,
                            recovery_journal_path=journal,
                        )

                self.assertTrue(owner.is_file(), "NLI lock must remain held through outer recovery")
                with self.assertRaisesRegex(RuntimeError, "foreign output"):
                    orchestrator._restore_output_snapshot(snapshot)
                self.assertEqual(final_data.read_bytes(), foreign_data)
                self.assertEqual(final_sidecar.read_bytes(), b"old-sidecar")
                self.assertEqual(final_pmtiles.read_bytes(), b"old-pmtiles")
                self.assertEqual(other_owned.read_bytes(), b"old-style")
                saved_data = Path(snapshot["file_copies"][str(final_data.resolve())])
                self.assertEqual(saved_data.read_bytes(), b"old-data", "snapshot preimage must remain immutable")
                self.assertTrue((snapshot["dir"] / "recovery-conflicts.json").is_file())
                self.assertTrue(snapshot["dir"].is_dir(), "conflict evidence must be retained")
                orchestrator._finish_output_snapshot(snapshot)

    def test_pack_set_discovered_after_first_scan_cannot_dispatch_unsnapshotted_nli(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source_pack = root / "source" / "nli"
            gis = source_pack / "gis"
            styles = source_pack / "styles"
            output_root = root / "processed" / "layers"
            output = output_root / "nli"
            gis.mkdir(parents=True)
            styles.mkdir(parents=True)
            output.mkdir(parents=True)
            (gis / "lines.geojson").write_text('{"type":"FeatureCollection","features":[]}\n', encoding="utf-8")
            (output / "manifest.json").write_text('{"prior":"release"}', encoding="utf-8")
            orchestrator = ProcessingOrchestrator(root / "source", output_root, no_cache=False, max_workers=1)
            scans = [[], [source_pack]]
            orchestrator.scan_packs = lambda: scans.pop(0)
            with patch.object(orchestrator_module, "ProcessPoolExecutor", ThreadPoolExecutor), \
                 patch.object(orchestrator, "process_single_layer", return_value=None) as worker:
                orchestrator.process_all()

            self.assertTrue(output.is_dir(), "a failed unsnapshotted NLI pack must not be removed")
            self.assertEqual((output / "manifest.json").read_text(encoding="utf-8"), '{"prior":"release"}')
            worker.assert_not_called()

    def test_targeted_worker_rejects_metadata_drift_since_its_snapshot(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source_pack = root / "source" / "nli"
            gis = source_pack / "gis"
            styles = source_pack / "styles"
            output_root = root / "processed" / "layers"
            output = output_root / "nli"
            gis.mkdir(parents=True)
            styles.mkdir(parents=True)
            output.mkdir(parents=True)
            (gis / "lines.geojson").write_text("source", encoding="utf-8")
            metadata_path = output / "release-metadata.json"
            metadata_path.write_text(json.dumps({"fileHashes": {"immutable": "before"},
                                                 "runtimeArtifactHashes": {"people.geojson": "people-before"}}),
                                     encoding="utf-8")
            original_metadata = metadata_path.read_bytes()
            recipe = root / "recipe.json"
            lock = root / "lock.json"
            recipe.write_text("recipe", encoding="utf-8")
            lock.write_text("lock", encoding="utf-8")
            presenter = root / "otef-interactive" / "frontend" / "src" / "remote" / "nli-presenter-content.json"
            presenter.parent.mkdir(parents=True)
            presenter.write_text("{}", encoding="utf-8")
            evidence = {"curation": {"release": "starting"},
                        "processedLayersRoot": str(output.resolve()),
                        "repoRoot": str(root.resolve())}
            orchestrator = ProcessingOrchestrator(
                root / "source", output_root, max_workers=1,
                curation_recipe_path=recipe, curation_lock_path=lock,
            )
            orchestrator._validate_active_nli_source = lambda: evidence
            real_snapshot = orchestrator._begin_output_snapshot

            def snapshot_then_foreign_edit(pack_ids):
                result = real_snapshot(pack_ids)
                replacement = metadata_path.with_name("release-metadata.foreign")
                replacement.write_bytes(original_metadata.replace(b"before", b"after"))
                replacement.replace(metadata_path)
                return result

            worker_entered = []
            real_restore = orchestrator._restore_output_snapshot
            owner_record = output_root / ".nli-route-mutation-owner.json"
            def restore_while_owned(snapshot, pack_ids=None):
                self.assertTrue(owner_record.is_file(), "shared owner must remain held during recovery")
                return real_restore(snapshot, pack_ids)
            with patch.object(orchestrator, "_begin_output_snapshot", side_effect=snapshot_then_foreign_edit), \
                 patch.object(orchestrator, "_restore_output_snapshot", side_effect=restore_while_owned), \
                 patch.object(orchestrator, "_process_single_layer_impl",
                              side_effect=lambda *_args, **_kwargs: worker_entered.append(True)):
                with self.assertRaisesRegex(RuntimeError, "active NLI release metadata changed"):
                    orchestrator.process_single_layer_merged("nli", "lines")

            self.assertEqual(worker_entered, [], "worker must reject changed immutable metadata before conversion")
            self.assertEqual(metadata_path.read_bytes(), original_metadata.replace(b"before", b"after"),
                             "prewrite rejection must preserve the atomic foreign replacement")

    def test_targeted_run_holds_owner_before_snapshot_and_worker(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            output = root / "processed" / "layers"
            nli = output / "nli"
            nli.mkdir(parents=True)
            orchestrator = ProcessingOrchestrator(root / "source", output, max_workers=1)
            owner_record = nli.parent / ".nli-route-mutation-owner.json"

            def snapshot(pack_ids):
                self.assertEqual(json.loads(owner_record.read_text(encoding="utf-8"))["root"], str(nli.resolve()))
                return {"pack_ids": pack_ids}

            def worker(pack_id, layer_stem, stuck_timeout, *, _nli_token,
                       _nli_start_evidence, _nli_metadata_identity, _nli_recovery_journal=None):
                self.assertTrue(owner_record.is_file())
                self.assertEqual(json.loads(owner_record.read_text(encoding="utf-8"))["token"], _nli_token)

            with patch.object(orchestrator, "_validate_active_nli_source", return_value=None), \
                 patch.object(orchestrator, "_begin_output_snapshot", side_effect=snapshot), \
                 patch.object(orchestrator, "_process_single_layer_merged_impl", side_effect=worker), \
                 patch.object(orchestrator, "_finish_output_snapshot"):
                orchestrator.process_single_layer_merged("nli", "lines")
            self.assertFalse(owner_record.exists())

    def test_curated_lines_cache_hit_is_validated_and_corrupt_output_is_rebuilt_staged(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source = root / "source" / "nli" / "gis" / "lines.geojson"
            styles = root / "source" / "nli" / "styles"
            output = root / "processed" / "layers" / "nli"
            source.parent.mkdir(parents=True)
            styles.mkdir(parents=True)
            output.mkdir(parents=True)
            source.write_text("source", encoding="utf-8")
            recipe = root / "recipe.json"
            lock = root / "lock.json"
            recipe.write_text("recipe", encoding="utf-8")
            lock.write_text("lock-a", encoding="utf-8")
            evidence = {"curation": {"recipeSha256": "recipe-sha"}}
            orchestrator = ProcessingOrchestrator(
                root / "source", output.parent, max_workers=1,
                curation_recipe_path=recipe, curation_lock_path=lock,
            )
            orchestrator._validate_active_nli_source = lambda: evidence
            orchestrator._active_metadata_identity = lambda _evidence: {"release": "same"}
            task = {"pack_id": "nli", "geo_file": source, "styles_dir": styles,
                    "pack_output": output}
            transforms = []
            validations = []

            def transform(_source, destination):
                transforms.append(destination)
                destination.write_text("accepted", encoding="utf-8")
                return True

            def validate(candidate, _evidence):
                validations.append(candidate)
                if candidate.read_text(encoding="utf-8") != "accepted":
                    raise ValueError("bad cached route output")

            with patch.object(orchestrator, "_resolve_style_for_geo_file", return_value=({"color": "red"}, "LineString")), \
                 patch.object(orchestrator, "_get_popup_config_for_layer", return_value=None), \
                 patch.object(orchestrator_module, "transform_to_wgs84", side_effect=transform), \
                 patch.object(orchestrator_module, "validate_active_route_candidate", side_effect=validate), \
                 patch.object(orchestrator_module, "resolve_pmtiles_lifecycle",
                              return_value=SimpleNamespace(pmtiles_file=None, tiling_preset=None, metadata=None)):
                first = orchestrator.process_single_layer(task, 30)
                orchestrator.cache[first[2]] = first[3]
                orchestrator.process_single_layer(task, 30)
                self.assertEqual(len(transforms), 1, "valid cache output should avoid reconversion")
                self.assertTrue(validations[-1].samefile(output / "lines.geojson"))

                lock.write_text("lock-b", encoding="utf-8")
                changed_lock = orchestrator.process_single_layer(task, 30)
                self.assertEqual(len(transforms), 2, "changed lock identity should invalidate the cache")
                orchestrator.cache[changed_lock[2]] = changed_lock[3]

                (output / "lines.geojson").write_text("corrupt", encoding="utf-8")
                repaired = orchestrator.process_single_layer(task, 30)
                orchestrator.cache[repaired[2]] = repaired[3]

                (output / "lines.geojson").unlink()
                orchestrator.process_single_layer(task, 30)

            self.assertEqual(len(transforms), 4, "corrupt and missing output should rebuild from source")
            self.assertTrue(validations[-1].parent.name.startswith(".nli-lines-"))
            self.assertEqual((output / "lines.geojson").read_text(encoding="utf-8"), "accepted")

    def test_people_stamp_joins_owner_while_publisher_waits_for_line_promotion(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source = root / "source" / "nli" / "gis" / "lines.geojson"
            styles = root / "source" / "nli" / "styles"
            output = root / "processed" / "layers" / "nli"
            source.parent.mkdir(parents=True)
            styles.mkdir(parents=True)
            output.mkdir(parents=True)
            source.write_text("source", encoding="utf-8")
            (output / "people.geojson").write_text('{"features":[]}\n', encoding="utf-8")
            metadata_path = output / "release-metadata.json"
            metadata_path.write_text(json.dumps({
                "sourceSha256": "source-pin",
                "runtimeArtifactHashes": {"people.geojson": "old-people", "lines.geojson": "line-pin"},
                "routeBorderCuration": {"release": "accepted"},
            }), encoding="utf-8")
            recipe = root / "recipe.json"
            lock = root / "lock.json"
            recipe.write_text("recipe", encoding="utf-8")
            lock.write_text("lock", encoding="utf-8")
            evidence = {"curation": {"recipeSha256": "recipe-sha"}}
            orchestrator = ProcessingOrchestrator(
                root / "source", output.parent, max_workers=1,
                curation_recipe_path=recipe, curation_lock_path=lock,
            )
            orchestrator._validate_active_nli_source = lambda: evidence
            task = {"pack_id": "nli", "geo_file": source, "styles_dir": styles,
                    "pack_output": output}
            publisher_started = threading.Event()
            publisher_entered = threading.Event()
            stamp_finished = threading.Event()
            publisher_thread = None

            def metadata_identity(_evidence):
                metadata = json.loads(metadata_path.read_text(encoding="utf-8"))
                metadata["runtimeArtifactHashes"].pop("people.geojson", None)
                return {"metadata": metadata, "lockSha256": hashlib.sha256(lock.read_bytes()).hexdigest()}

            orchestrator._active_metadata_identity = metadata_identity

            def transform(_source, destination):
                nonlocal publisher_thread
                destination.write_text("accepted", encoding="utf-8")
                token = json.loads((output.parent / ".nli-route-mutation-owner.json").read_text(encoding="utf-8"))["token"]

                def stamp_people():
                    stamp_nli_runtime_artifact_hash(
                        output, mutation_token=token, processed_layers_root=output,
                        curation_recipe_path=recipe, curation_lock_path=lock,
                    )
                    stamp_finished.set()

                def publish_later():
                    publisher_started.set()
                    with nli_mutation_lock(output):
                        publisher_entered.set()
                        (output / "published-after-processing.txt").write_text("published", encoding="utf-8")

                threading.Thread(target=stamp_people, daemon=True).start()
                publisher_thread = threading.Thread(target=publish_later, daemon=True)
                publisher_thread.start()
                self.assertTrue(stamp_finished.wait(3), "people worker did not stamp under inherited ownership")
                self.assertTrue(publisher_started.wait(3))
                return True

            def validate(candidate, _evidence):
                self.assertEqual(candidate.read_text(encoding="utf-8"), "accepted")
                self.assertFalse(publisher_entered.is_set(), "publication interleaved before route promotion")

            with patch.object(orchestrator, "_resolve_style_for_geo_file", return_value=({"color": "red"}, "LineString")), \
                 patch.object(orchestrator, "_get_popup_config_for_layer", return_value=None), \
                 patch.object(orchestrator_module, "transform_to_wgs84", side_effect=transform), \
                 patch.object(orchestrator_module, "validate_active_route_candidate", side_effect=validate), \
                 patch.object(orchestrator_module, "resolve_pmtiles_lifecycle",
                              return_value=SimpleNamespace(pmtiles_file=None, tiling_preset=None, metadata=None)):
                with nli_mutation_lock(output) as token:
                    task.update({"_nli_mutation_token": token, "_nli_start_evidence": evidence,
                                 "_nli_metadata_identity": metadata_identity(evidence)})
                    result = orchestrator.process_single_layer(task, 30)
                    self.assertIsNotNone(result)
                    self.assertFalse(publisher_entered.is_set())

            publisher_thread.join(3)
            self.assertFalse(publisher_thread.is_alive(), "publisher stayed blocked after processing released ownership")
            self.assertTrue(publisher_entered.is_set())
            self.assertEqual((output / "lines.geojson").read_text(encoding="utf-8"), "accepted")
            self.assertEqual((output / "published-after-processing.txt").read_text(encoding="utf-8"), "published")
            metadata = json.loads(metadata_path.read_text(encoding="utf-8"))
            self.assertNotEqual(metadata["runtimeArtifactHashes"]["people.geojson"], "old-people")
            self.assertEqual(metadata["runtimeArtifactHashes"]["lines.geojson"], "line-pin")
            self.assertEqual(metadata["routeBorderCuration"], {"release": "accepted"})


if __name__ == "__main__":
    unittest.main()
