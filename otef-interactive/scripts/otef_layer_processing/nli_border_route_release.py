from __future__ import annotations

import hashlib
import importlib
import json
import os
import re
import secrets
import subprocess
from pathlib import Path

try:
    from .nli_mutation_lock import nli_mutation_lock
    from .nli_active_route_evidence import validate_active_route_candidate, validate_active_route_source
    from .nli_border_route_identity import (REQUIRED_INPUT_NAMES, validate_input_snapshot)
except ImportError:  # Script-directory imports used by preparation and CLI tools.
    from nli_mutation_lock import nli_mutation_lock
    from nli_active_route_evidence import validate_active_route_candidate, validate_active_route_source
    from nli_border_route_identity import (REQUIRED_INPUT_NAMES, validate_input_snapshot)

MARKER = ".nli-route-release-unfinished.json"
JOURNAL_PREFIX = ".nli-route-release-"
ROLE_PATHS = {
    "source_lines": "otef-interactive/public/source/layers/nli/gis/lines.geojson",
    "processed_lines": "otef-interactive/public/processed/layers/nli/lines.geojson",
    "release_metadata": "otef-interactive/public/processed/layers/nli/release-metadata.json",
    "presenter_json": "otef-interactive/frontend/src/remote/nli-presenter-content.json",
    "derived_lock": "otef-interactive/scripts/nli-border-route-curation.lock.json",
}


def prepare_release(repo_root: Path, recipe_path: Path, staging_dir: Path,
                    *, preview_reference: Path | None = None, mode: str = "prepare",
                    audit_only: bool = False) -> dict:
    """Lazily preserve the approved preparation API in package and script imports."""
    if __package__:
        preparer = importlib.import_module(".nli_border_route_prepare", package=__package__)
    else:
        preparer = importlib.import_module("nli_border_route_prepare")
    return preparer.prepare_release(
        repo_root, recipe_path, staging_dir,
        preview_reference=preview_reference, mode=mode, audit_only=audit_only,
    )


def _sha(path: Path) -> str | None:
    if not path.exists(): return None
    if not path.is_file(): raise RuntimeError(f"publication target is not a file: {path}")
    return hashlib.sha256(path.read_bytes()).hexdigest()


def _sync_directory(path: Path) -> None:
    """Flush a POSIX directory entry; Windows directory flush is unsupported here."""
    if os.name != "nt":
        fd = os.open(path, os.O_RDONLY)
        try: os.fsync(fd)
        finally: os.close(fd)


def _sync_file(path: Path) -> None:
    """Flush file bytes before rename; this does not flush Windows directory metadata."""
    with path.open("rb+") as stream:
        stream.flush()
        os.fsync(stream.fileno())


def _durable_replace(source: Path, destination: Path) -> None:
    source, destination = Path(source), Path(destination)
    _sync_file(source)
    os.replace(source, destination)
    _sync_directory(source.parent)
    if source.parent != destination.parent:
        _sync_directory(destination.parent)


def _unlink_durable(path: Path) -> None:
    path.unlink(missing_ok=True)
    _sync_directory(path.parent)


def _flush(path: Path, data: dict) -> None:
    tmp = path.with_name(path.name + ".tmp")
    with tmp.open("w", encoding="utf-8", newline="\n") as stream:
        json.dump(data, stream, indent=2, ensure_ascii=False)
        stream.write("\n"); stream.flush(); os.fsync(stream.fileno())
    os.replace(tmp, path)
    _sync_directory(path.parent)


def _bundle(prepared_dir: Path) -> tuple[dict, Path, Path, Path]:
    base = Path(prepared_dir).resolve()
    manifest_path = base / "prepared-manifest.json"
    raw_manifest = manifest_path.read_bytes()
    manifest = json.loads(raw_manifest.decode("utf-8"))
    manifest["_savedManifestSha256"] = hashlib.sha256(raw_manifest).hexdigest()
    if manifest.get("schemaVersion") != 1 or not isinstance(manifest.get("targets"), list) or not manifest["targets"]:
        raise ValueError("prepared manifest schemaVersion 1 and nonempty targets are required")
    repo = Path(manifest.get("repoRoot", "")).resolve()
    processed = Path(manifest.get("processedLayersRoot", "")).resolve()
    expected_processed = (repo / "otef-interactive/public/processed/layers/nli").resolve()
    if not repo.is_dir() or not processed.is_dir() or processed != expected_processed:
        raise ValueError("prepared roots are invalid or processedLayersRoot is not the NLI pack")
    recipe_hash = manifest.get("recipeSha256")
    if not isinstance(recipe_hash, str) or re.fullmatch(r"[0-9a-f]{64}", recipe_hash) is None:
        raise ValueError("prepared manifest recipeSha256 must be a 64-character lowercase SHA-256")
    if not isinstance(manifest.get("derivedLockIdentity"), str) or not manifest["derivedLockIdentity"]:
        raise ValueError("prepared manifest must identify the derived lock")
    seen = set()
    for item in manifest["targets"]:
        if not isinstance(item, dict) or item.get("role") not in ROLE_PATHS:
            raise ValueError("each target requires an approved publication role")
        required = {"role", "target", "stage", "candidateSha256", "preImageSha256"}
        if not required.issubset(item):
            raise ValueError("prepared target is missing a required manifest field")
        target_rel, stage_rel = Path(item.get("target", "")), Path(item.get("stage", ""))
        if target_rel.is_absolute() or stage_rel.is_absolute() or ".." in target_rel.parts or ".." in stage_rel.parts:
            raise ValueError("absolute or parent-traversal paths are forbidden")
        if target_rel.as_posix() != ROLE_PATHS[item["role"]]:
            raise ValueError(f"target path is not approved for role {item['role']}: {target_rel}")
        target, stage = (repo / target_rel).resolve(), (base / stage_rel).resolve()
        if not target.is_relative_to(repo) or not stage.is_relative_to(base) or target in seen:
            raise ValueError("target/stage path escapes its root or duplicates another target")
        seen.add(target)
        item["_target_path"], item["_stage_path"] = target, stage
    if {item["role"] for item in manifest["targets"]} != set(ROLE_PATHS):
        raise ValueError("prepared release must include exactly the five approved target roles")
    _validate_preparation_manifest(manifest, base, repo)
    return manifest, repo, processed, manifest_path


def publish_release(prepared_dir: Path, *, outputs_closed: bool) -> dict:
    if not outputs_closed:
        return {"status": "unchanged", "reason": "outputs are not closed"}
    manifest, repo, processed, _ = _bundle(prepared_dir)
    control = processed.parent
    marker = control / MARKER
    with nli_mutation_lock(processed):
        try:
            current, current_repo, current_processed, current_manifest_path = _bundle(Path(prepared_dir).resolve())
        except (OSError, ValueError) as exc:
            try:
                locked_bytes = (Path(prepared_dir).resolve() / "prepared-manifest.json").read_bytes()
            except OSError as missing:
                raise RuntimeError("prepared manifest disappeared while waiting for the NLI mutation lock") from missing
            if hashlib.sha256(locked_bytes).hexdigest() != manifest["_savedManifestSha256"]:
                raise RuntimeError("prepared manifest changed while waiting for the NLI mutation lock") from exc
            if "preview reference" in str(exc):
                raise RuntimeError(f"prepared input identity changed while waiting for the NLI mutation lock: previewReference: {exc}") from exc
            if "input identity validation failed" in str(exc):
                raise RuntimeError(f"prepared input identity changed while waiting for the NLI mutation lock: {exc}") from exc
            raise RuntimeError("prepared manifest failed locked revalidation") from exc
        if (current_repo != repo or current_processed != processed
                or current["_savedManifestSha256"] != manifest["_savedManifestSha256"]):
            raise RuntimeError("prepared manifest changed while waiting for the NLI mutation lock")
        manifest, repo, processed = current, current_repo, current_processed
        _require_publishable_readiness(manifest)
        _recheck_preparation_inputs(manifest, repo)
        _run_bundle_verifier(manifest, Path(prepared_dir).resolve(), repo)
        if marker.exists(): raise RuntimeError(f"unfinished NLI release blocks publication: {marker}")
        targets = manifest["targets"]
        # Derived lock is always the final visible target.
        ordered = [x for x in targets if x["role"] != "derived_lock"] + [x for x in targets if x["role"] == "derived_lock"]
        if sum(x["role"] == "derived_lock" for x in ordered) != 1:
            raise ValueError("prepared release requires exactly one derived_lock target")
        if {x["role"] for x in ordered} != set(ROLE_PATHS):
            raise ValueError("prepared release must include exactly the five approved target roles")
        if all(_sha(x["_target_path"]) == x.get("candidateSha256") for x in ordered):
            for prior in control.glob(f"{JOURNAL_PREFIX}*.json"):
                try: previous = json.loads(prior.read_text(encoding="utf-8"))
                except (OSError, ValueError): continue
                if (previous.get("state") == "committed"
                    and previous.get("recipeSha256") == manifest["recipeSha256"]
                    and previous.get("derivedLockIdentity") == manifest["derivedLockIdentity"]
                    and {t.get("role"): t.get("postImageSha256") for t in previous.get("targets", [])}
                        == {x["role"]: x.get("candidateSha256") for x in ordered}):
                    return {"status": "unchanged", "reason": "same prepared release is already installed"}
            if manifest["preparationEvidence"]["mode"] == "exact_active_noop":
                return {"status": "unchanged", "reason": "validated exact active release is already installed"}
            raise RuntimeError("installed candidates match bytes but release identity differs; refusing silent rebase")
        for item in ordered:
            target, stage = item["_target_path"], item["_stage_path"]
            if not stage.is_file() or _sha(stage) != item.get("candidateSha256"):
                raise ValueError(f"missing candidate or candidate hash mismatch: {stage}")
            if _sha(target) != item.get("preImageSha256"):
                raise RuntimeError(f"pre-image drift at {target}")
        transaction = {"version": 1, "transactionID": secrets.token_hex(16),
                       "repoRoot": str(repo), "processedLayersRoot": str(processed),
                       "recipeSha256": manifest.get("recipeSha256"),
                       "derivedLockIdentity": manifest.get("derivedLockIdentity"),
                       "targets": [{k: v for k, v in x.items() if not k.startswith("_")} | {
                           "preImageExists": _sha(x["_target_path"]) is not None,
                           "preImageSha256": _sha(x["_target_path"]),
                           "postImageSha256": x["candidateSha256"],
                           "backupPath": None, "backupSha256": None, "state": "prepared"} for x in ordered],
                       "state": "prepared"}
        journal = control / f"{JOURNAL_PREFIX}{transaction['transactionID']}.json"
        _flush(journal, transaction)
        _flush(marker, {"journal": journal.name, "transactionID": transaction["transactionID"]})
        try:
            for record in transaction["targets"]:
                target = repo / record["target"]
                stage = Path(prepared_dir).resolve() / record["stage"]
                if target.exists():
                    backup = control / f"{journal.stem}-{secrets.token_hex(4)}.backup"
                    with backup.open("wb") as f:
                        f.write(target.read_bytes()); f.flush(); os.fsync(f.fileno())
                    _sync_directory(control)
                    record["backupPath"], record["backupSha256"] = str(backup), _sha(backup)
                    _flush(journal, transaction)
                transaction["state"] = "writing"; record["state"] = "writing"; _flush(journal, transaction)
                _durable_replace(stage, target)
                if _sha(target) != record["postImageSha256"]:
                    raise RuntimeError(f"installed candidate hash mismatch: {target}")
                record["state"] = "written"; _flush(journal, transaction)
            transaction["state"] = "verified"; _flush(journal, transaction)
            transaction["state"] = "committed"; _flush(journal, transaction)
            _unlink_durable(marker)
            return {"status": "published", "transactionID": transaction["transactionID"], "journal": str(journal)}
        except BaseException:
            transaction["state"] = "rolling_back"; _flush(journal, transaction)
            _restore(transaction, journal, repo)
            _unlink_durable(marker)
            raise


def _restore(transaction: dict, journal: Path, repo: Path) -> None:
    processed = Path(transaction["processedLayersRoot"]).resolve()
    control = processed.parent
    expected_processed = (repo / "otef-interactive/public/processed/layers/nli").resolve()
    if processed != expected_processed or not journal.resolve().is_relative_to(control):
        raise RuntimeError("journal root or location is outside its processed NLI control directory")
    transaction["state"] = "rolling_back"; _flush(journal, transaction)
    for record in reversed(transaction["targets"]):
        if record.get("role") not in ROLE_PATHS or record.get("target") != ROLE_PATHS[record["role"]]:
            raise RuntimeError("journal contains an unapproved publication target")
        target = (repo / record["target"]).resolve()
        if not target.is_relative_to(repo): raise RuntimeError("journal target escapes repository root")
        backup_value = record.get("backupPath")
        if backup_value and not Path(backup_value).resolve().is_relative_to(control):
            raise RuntimeError("journal backup escapes the NLI control directory")
        current = _sha(target)
        pre, post = record["preImageSha256"], record["postImageSha256"]
        if current == pre:
            if current is not None: _sync_file(target)
            _sync_directory(target.parent)
            continue
        if current != post:
            raise RuntimeError(f"foreign edit blocks rollback at {target}: current={current}, expected pre={pre} or post={post}")
        if record["preImageExists"]:
            backup = Path(record["backupPath"] or "")
            if not backup.is_file() or _sha(backup) != record["backupSha256"] or record["backupSha256"] != pre:
                raise RuntimeError(f"verified rollback backup missing or invalid for {target}")
            temp = target.with_name(target.name + ".rollback")
            with temp.open("wb") as stream:
                stream.write(backup.read_bytes())
                stream.flush()
                os.fsync(stream.fileno())
            _durable_replace(temp, target)
        else:
            _unlink_durable(target)
    for record in transaction["targets"]:
        target = repo / record["target"]
        if _sha(target) != record["preImageSha256"]:
            raise RuntimeError(f"rollback verification failed at {target}")
        record["state"] = "rolled_back"
    transaction["state"] = "rolled_back"; _flush(journal, transaction)


def rollback_release(journal_path: Path) -> None:
    journal = Path(journal_path).resolve()
    transaction = json.loads(journal.read_text(encoding="utf-8"))
    if transaction.get("version") != 1: raise ValueError("unsupported journal version")
    repo, processed = Path(transaction["repoRoot"]).resolve(), Path(transaction["processedLayersRoot"]).resolve()
    expected_processed = (repo / "otef-interactive/public/processed/layers/nli").resolve()
    control = processed.parent
    if processed != expected_processed or not journal.is_relative_to(control) or not journal.name.startswith(JOURNAL_PREFIX):
        raise ValueError("rollback journal or processed root is outside the approved NLI control area")
    marker = control / MARKER
    with nli_mutation_lock(processed, recovery=True):
        current = json.loads(journal.read_text(encoding="utf-8"))
        if (current.get("transactionID") != transaction.get("transactionID")
                or Path(current.get("repoRoot", "")).resolve() != repo
                or Path(current.get("processedLayersRoot", "")).resolve() != processed
                or current.get("version") != 1):
            raise RuntimeError("journal identity or roots changed while waiting for recovery lock")
        if marker.exists():
            marker_data = json.loads(marker.read_text(encoding="utf-8"))
            if marker_data.get("journal") != journal.name or marker_data.get("transactionID") != current.get("transactionID"):
                raise RuntimeError("unfinished marker points to a different transaction")
        _restore(current, journal, repo)
        _unlink_durable(marker)


def _validate_preparation_manifest(manifest: dict, base: Path, repo: Path) -> None:
    readiness = manifest.get("readiness")
    if (not isinstance(readiness, dict) or readiness.get("status") not in {"ready", "blocked"}
            or not isinstance(readiness.get("diagnostics"), list)):
        raise ValueError("prepared manifest requires explicit readiness status and diagnostics")
    if readiness["status"] == "ready" and readiness["diagnostics"]:
        raise ValueError("ready preparation cannot contain readiness diagnostics")
    if readiness["status"] == "blocked" and not readiness["diagnostics"]:
        raise ValueError("blocked preparation must explain its readiness failure")
    evidence = manifest.get("preparationEvidence")
    if not isinstance(evidence, dict) or evidence.get("mode") not in {"baseline_to_derived", "exact_active_noop"}:
        raise ValueError("prepared manifest requires validated preparation evidence")
    if evidence["mode"] == "baseline_to_derived":
        preview = evidence.get("previewReconciliation")
        if (not isinstance(preview, dict) or preview.get("status") != "passed"
                or not isinstance(preview.get("crs"), str) or preview.get("toleranceMeters") != 2.0
                or len(preview.get("comparedOperations", [])) != 18
                or not re.fullmatch(r"[0-9a-f]{64}", str(preview.get("referenceSha256", "")))):
            raise ValueError("first release is not publishable without successful 2m preview reconciliation")
        reference_path = Path(preview.get("referencePath", "")).resolve()
        preview_identity = next((item for item in manifest.get("inputIdentities", [])
                                 if isinstance(item, dict) and item.get("name") == "previewReference"), None)
        if (not reference_path.is_relative_to(repo) or not reference_path.is_file()
                or _sha(reference_path) != preview.get("referenceSha256")
                or not preview_identity or Path(preview_identity.get("path", "")).resolve() != reference_path
                or preview_identity.get("byteSha256") != preview.get("referenceSha256")):
            raise ValueError("first-release preview reference is missing or its pinned bytes changed")
    elif not isinstance(evidence.get("activeProof"), dict):
        raise ValueError("active-release no-op requires a validated curation proof")
    verifier = evidence.get("verifier")
    if not isinstance(verifier, dict) or not isinstance(verifier.get("diagnostics"), list):
        raise ValueError("prepared release requires recorded full-verifier evidence")
    known_block = ["Beat minutes differ from the tracked navigation fixture"]
    if readiness["status"] == "ready":
        if verifier.get("status") != "passed" or verifier["diagnostics"]:
            raise ValueError("ready release does not contain successful full-verifier evidence")
        if evidence["mode"] == "baseline_to_derived":
            baseline = verifier.get("baseline")
            if not isinstance(baseline, dict) or baseline.get("status") != "passed" or baseline.get("diagnostics"):
                raise ValueError("ready first release does not contain successful baseline-verifier evidence")
    elif (readiness.get("auditOnly") is not True or verifier.get("status") != "failed"
          or verifier.get("diagnostics") != known_block
          or not isinstance(verifier.get("baseline"), dict)
          or verifier["baseline"].get("diagnostics") != known_block):
        raise ValueError("blocked audit bundle does not record the sole baseline-equal verifier failure")
    identities = manifest.get("inputIdentities")
    expected_names = set(REQUIRED_INPUT_NAMES)
    if evidence["mode"] == "baseline_to_derived" or any(
            isinstance(item, dict) and item.get("name") == "previewReference" for item in identities or []):
        expected_names.add("previewReference")
    if not isinstance(identities, list):
        raise ValueError("prepared release must pin recipe, border, road, provenance, metadata, and presenter inputs")
    early_roles = {item.get("role"): item for item in manifest["targets"]}
    installed_candidates = {}
    for name, role in (("sourceLines", "source_lines"), ("runtimeLines", "processed_lines"),
                       ("metadata", "release_metadata"), ("presenter", "presenter_json")):
        if role in early_roles:
            installed_candidates[name] = early_roles[role].get("candidateSha256")
    try:
        validate_input_snapshot(identities, repo, expected_names=expected_names,
                                installed_candidates=installed_candidates)
    except ValueError as exc:
        raise ValueError(f"prepared release input identity validation failed: {exc}") from exc
    by_role = {item["role"]: item for item in manifest["targets"]}
    staged = {}
    for role, item in by_role.items():
        candidate = (base / item["stage"]).resolve()
        target = (repo / item["target"]).resolve()
        if not candidate.is_file() and _sha(target) == item["candidateSha256"]:
            candidate = target
        if not candidate.is_file() or _sha(candidate) != item["candidateSha256"]:
            raise ValueError(f"missing candidate or candidate hash mismatch for role {role}")
        staged[role] = candidate
    lock = json.loads(staged["derived_lock"].read_text(encoding="utf-8"))
    metadata = json.loads(staged["release_metadata"].read_text(encoding="utf-8"))
    presenter = json.loads(staged["presenter_json"].read_text(encoding="utf-8"))
    curation = lock.get("curation")
    if not isinstance(curation, dict) or metadata.get("routeBorderCuration") != curation or presenter.get("sourceEvidence", {}).get("routeBorderCuration") != curation:
        raise ValueError("staged curation evidence differs between lock, metadata, and presenter manifest")
    if (curation.get("recipeSha256") != manifest.get("recipeSha256")
            or curation.get("derivedSourceSha256") != manifest["targets"][next(i for i,x in enumerate(manifest["targets"]) if x["role"] == "source_lines")]["candidateSha256"]
            or curation.get("runtimeByteSha256") != manifest["targets"][next(i for i,x in enumerate(manifest["targets"]) if x["role"] == "processed_lines")]["candidateSha256"]
            or _sha(staged["derived_lock"]) != manifest.get("derivedLockIdentity")):
        raise ValueError("prepared curation identities do not match staged bytes: " + json.dumps({
            "recipe": [curation.get("recipeSha256"), manifest.get("recipeSha256")],
            "source": [curation.get("derivedSourceSha256"), by_role["source_lines"]["candidateSha256"]],
            "runtime": [curation.get("runtimeByteSha256"), by_role["processed_lines"]["candidateSha256"]],
            "lock": [_sha(staged["derived_lock"]), manifest.get("derivedLockIdentity")]}))

    from nli_border_route_prepare import PINS
    expected_pins = {"baseSourceSha256": PINS["source"], "baseRuntimeSha256": PINS["runtime"],
                     "confirmedFeaturesSha256": PINS["confirmed"], "borderSha256": PINS["border"],
                     "roadSha256": PINS["road"]}
    if (curation.get("schemaVersion") != 1
            or any(curation.get(field) != value for field, value in expected_pins.items())
            or curation.get("counts") != {"features": 89, "confirmed": 68, "unconfirmed": 21}
            or curation.get("addedObjectIds") != list(range(1013, 1022))
            or curation.get("editedObjectIds") != [1001,1002,1005,1006,1008,1009,1010,1011,1012]):
        raise ValueError("prepared curation proof differs from Task 3A's pinned route set")
    identities_by_name = {item["name"]: item for item in identities}
    if evidence["mode"] == "exact_active_noop" and "previewReference" in identities_by_name:
        preview = evidence.get("previewReconciliation")
        reference_path = Path(identities_by_name["previewReference"]["path"]).resolve()
        if (not isinstance(preview, dict) or preview.get("status") != "passed"
                or not reference_path.is_relative_to(repo) or not reference_path.is_file()
                or _sha(reference_path) != identities_by_name["previewReference"].get("byteSha256")):
            raise ValueError("active preview check is missing or its pinned bytes changed")
    for role, input_name in (("source_lines", "sourceLines"), ("processed_lines", "runtimeLines"),
                             ("release_metadata", "metadata"), ("presenter_json", "presenter")):
        if by_role[role].get("preImageSha256") != identities_by_name[input_name].get("byteSha256"):
            raise ValueError(f"prepared {role} pre-image is not the validated input snapshot")
    if (curation.get("recipeSha256") != identities_by_name["recipe"]["byteSha256"]
            or curation.get("borderSha256") != identities_by_name["border"].get("normalizedLfSha256")
            or curation.get("roadSha256") != identities_by_name["road"]["byteSha256"]):
        raise ValueError("prepared curation proof does not match pinned recipe, border, and road inputs")
    _validate_candidate_runtime(repo, staged["processed_lines"], identities_by_name["digestCli"], curation)


def _validate_candidate_runtime(repo: Path, runtime_path: Path, digest_identity: dict, curation: dict) -> dict:
    """Use Task 3A's Node digest implementation and independently verify route counts/IDs."""
    from nli_border_route_prepare import PINS

    node = os.environ.get("NODE", "node")
    digest_cli = Path(digest_identity["path"]).resolve()
    result = subprocess.run([node, str(digest_cli), "--file", str(runtime_path)],
                            cwd=repo, capture_output=True, text=True, check=False)
    if result.returncode:
        raise ValueError(f"shared route digest CLI failed for candidate runtime: {result.stderr.strip()}")
    digests = json.loads(result.stdout)
    expected = {"byteSha256": curation.get("runtimeByteSha256"),
                "featureSha256": curation.get("runtimeFeatureSha256"),
                "confirmedFeaturesSha256": curation.get("confirmedFeaturesSha256")}
    if any(digests.get(key) != value for key, value in expected.items()):
        raise ValueError("shared Node digests do not match candidate runtime curation proof")
    if digests["byteSha256"] != hashlib.sha256(runtime_path.read_bytes()).hexdigest():
        raise ValueError("shared Node byte digest does not match candidate runtime bytes")
    document = json.loads(runtime_path.read_text(encoding="utf-8"))
    features = document.get("features")
    if not isinstance(features, list):
        raise ValueError("candidate runtime GeoJSON must contain a feature array")
    confirmed = [feature for feature in features if feature.get("properties", {}).get("route_confidence") != "unconfirmed"]
    unconfirmed = [feature for feature in features if feature.get("properties", {}).get("route_confidence") == "unconfirmed"]
    ids = [feature.get("properties", {}).get("OBJECTID") for feature in unconfirmed]
    if (len(features) != 89 or len(confirmed) != 68 or len(unconfirmed) != 21
            or sorted(ids) != list(range(1001, 1022)) or len(set(ids)) != len(ids)
            or curation.get("counts") != {"features": 89, "confirmed": 68, "unconfirmed": 21}
            or curation.get("confirmedFeaturesSha256") != PINS["confirmed"]
            or curation.get("addedObjectIds") != list(range(1013, 1022))
            or curation.get("editedObjectIds") != [1001, 1002, 1005, 1006, 1008, 1009, 1010, 1011, 1012]):
        raise ValueError("candidate runtime feature counts, confirmed digest, or unconfirmed IDs differ from reviewed route set")
    return {**digests, "counts": {"features": len(features), "confirmed": len(confirmed),
                                   "unconfirmed": len(unconfirmed)}, "unconfirmedObjectIds": sorted(ids)}


def _candidate_path(manifest: dict, base: Path, repo: Path, role: str) -> Path:
    item = next(item for item in manifest["targets"] if item["role"] == role)
    staged = (base / item["stage"]).resolve()
    target = (repo / item["target"]).resolve()
    return staged if staged.is_file() else target


def _run_bundle_verifier(manifest: dict, base: Path, repo: Path) -> None:
    identities = {item["name"]: item for item in manifest["inputIdentities"]}
    runtime = _candidate_path(manifest, base, repo, "processed_lines")
    metadata = _candidate_path(manifest, base, repo, "release_metadata")
    presenter = _candidate_path(manifest, base, repo, "presenter_json")
    lock = _candidate_path(manifest, base, repo, "derived_lock")
    verifier_metadata = (runtime.parent / "release-metadata.json").resolve()
    metadata_role = next(item for item in manifest["targets"] if item["role"] == "release_metadata")
    metadata_sha = _sha(metadata)
    if (not verifier_metadata.is_relative_to(base) and not verifier_metadata.is_relative_to(repo)):
        raise RuntimeError("strict verifier metadata path escapes the prepared bundle and repository")
    if (metadata_sha != metadata_role.get("candidateSha256") or not verifier_metadata.is_file()
            or _sha(verifier_metadata) != metadata_sha):
        raise RuntimeError("strict verifier metadata bytes do not match the selected release metadata candidate")
    command = [os.environ.get("NODE", "node"), identities["verifier"]["path"],
               "--data-root", str(runtime.parent), "--manifest", str(presenter),
               "--provenance", identities["provenance"]["path"],
               "--curation-recipe", identities["recipe"]["path"], "--curation-lock", str(lock)]
    result = subprocess.run(command, cwd=repo, capture_output=True, text=True, check=False)
    if result.returncode:
        raise RuntimeError("strict presenter verifier rejected the locked candidate: " +
                           (result.stdout + result.stderr).strip())


def _require_publishable_readiness(manifest: dict) -> None:
    readiness = manifest.get("readiness")
    if not isinstance(readiness, dict) or readiness.get("status") != "ready" or readiness.get("diagnostics"):
        diagnostics = readiness.get("diagnostics", []) if isinstance(readiness, dict) else []
        raise RuntimeError("prepared release readiness is not publishable: " + json.dumps(diagnostics, ensure_ascii=False))


def _recheck_preparation_inputs(manifest: dict, repo: Path) -> None:
    by_role = {item["role"]: item for item in manifest["targets"]}
    target_name = {"sourceLines": "source_lines", "runtimeLines": "processed_lines",
                   "metadata": "release_metadata", "presenter": "presenter_json"}
    installed = {name: by_role[role]["candidateSha256"] for name, role in target_name.items()}
    try:
        validate_input_snapshot(manifest["inputIdentities"], repo,
                                expected_names=REQUIRED_INPUT_NAMES |
                                ({"previewReference"} if any(x["name"] == "previewReference" for x in manifest["inputIdentities"]) else set()),
                                installed_candidates=installed)
    except ValueError as exc:
        raise RuntimeError(f"prepared input identity changed before publication: {exc}") from exc
