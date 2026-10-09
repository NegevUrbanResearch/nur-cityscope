from __future__ import annotations

import hashlib
import json
import os
import re
import subprocess
import tempfile
from pathlib import Path
from typing import Any

from pyproj import Transformer

try:
    from .nli_border_route_curation import build_curated_routes, validate_base_pair
    from .nli_border_route_identity import (REQUIRED_INPUT_NAMES, capture_input_snapshot,
                                           validate_input_snapshot)
    from .nli_mutation_lock import nli_mutation_lock
    from .nli_runtime_hashes import stamp_nli_runtime_artifact_hash
    from .geo import transform_to_wgs84
except ImportError:  # Script-directory imports used by preparation CLI tools.
    from nli_border_route_curation import build_curated_routes, validate_base_pair
    from nli_border_route_identity import (REQUIRED_INPUT_NAMES, capture_input_snapshot,
                                           validate_input_snapshot)
    from nli_mutation_lock import nli_mutation_lock
    from nli_runtime_hashes import stamp_nli_runtime_artifact_hash
    from geo import transform_to_wgs84

PINS = {
    "source": "18b0e3445c771da9c3e7995270601f7a1187501bd3bfdf6b3e0fa2c6cedc6462",
    "runtime": "934bd4be7a1d6a4f1b6a0f62337384d06624e571a6efe44da366ab6062afa3c1",
    "border": "eaa77f9e0e3572487efc3b3d597530c885cbf86baf6ce1ee51b04b378da8e23b",
    "confirmed": "c2d3ec3f50f0c016e6665b39ed93ed758020cf0c2a8339153cb1f51326039358",
    "road": "db6a72f9b5361089f75564de8a198cf5df2514023588aacb5d6dbe0a6ed1a8af",
}
BASE = Path("otef-interactive")
SOURCE = BASE / "public/source/layers/nli/gis/lines.geojson"
RUNTIME = BASE / "public/processed/layers/nli/lines.geojson"
PROCESSED = BASE / "public/processed/layers/nli"
ROAD = BASE / "public/processed/layers/muniplicity_transport/דרכים_ארציות.geojson"
BORDER = BASE / "frontend/src/shared/gaza-border-geometry.js"
METADATA = PROCESSED / "release-metadata.json"
PRESENTER = BASE / "frontend/src/remote/nli-presenter-content.json"
PROVENANCE = BASE / "scripts/nli-presenter-provenance.json"
RECIPE = BASE / "scripts/nli-border-route-curation.json"
LOCK = BASE / "scripts/nli-border-route-curation.lock.json"
DIGEST_CLI = BASE / "scripts/nli-route-curation-digests.mjs"
ASSEMBLER_CLI = BASE / "scripts/assemble-nli-presenter-manifest.mjs"
VERIFIER_CLI = BASE / "scripts/verify-nli-presenter-content.mjs"
ROLE_PATHS = {
    "source_lines": "otef-interactive/public/source/layers/nli/gis/lines.geojson",
    "processed_lines": "otef-interactive/public/processed/layers/nli/lines.geojson",
    "release_metadata": "otef-interactive/public/processed/layers/nli/release-metadata.json",
    "presenter_json": "otef-interactive/frontend/src/remote/nli-presenter-content.json",
    "derived_lock": "otef-interactive/scripts/nli-border-route-curation.lock.json",
}


def _sha_bytes(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


def _sha(path: Path) -> str:
    return _sha_bytes(path.read_bytes())


def _json(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))


def _write_json(path: Path, value: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8", newline="\n")


def _repo_path(repo_root: Path, relative: Path | str) -> Path:
    result = (repo_root / relative).resolve()
    root = repo_root.resolve()
    if not result.is_relative_to(root):
        raise ValueError(f"input path escapes repository root: {relative}")
    return result


def _validate_staging_location(repo_root: Path, staging_dir: Path) -> None:
    stage = staging_dir.resolve()
    protected = [SOURCE, RUNTIME, METADATA, PRESENTER, LOCK]
    for relative in protected:
        target = _repo_path(repo_root, relative)
        if stage == target or stage.is_relative_to(target) or target.is_relative_to(stage):
            raise ValueError(f"staging directory overlaps an active release path: {relative}")


def _invalidate_existing_manifest(staging_dir: Path) -> None:
    manifest_path = staging_dir / "prepared-manifest.json"
    if not manifest_path.is_file():
        return
    try:
        manifest = _json(manifest_path)
    except (OSError, ValueError):
        return
    if not isinstance(manifest, dict):
        return
    manifest["readiness"] = {"status": "blocked", "diagnostics": [
        "previous bundle invalidated by a subsequent prepare attempt"]}
    _write_json(manifest_path, manifest)


def _invalidate_manifest_locked(repo_root: Path, staging_dir: Path) -> None:
    manifest = staging_dir / "prepared-manifest.json"
    if not manifest.is_file():
        return
    with nli_mutation_lock(_repo_path(repo_root, PROCESSED)):
        _invalidate_existing_manifest(staging_dir)


def _border_document_bytes(raw: bytes) -> tuple[dict, str, str]:
    text = raw.decode("utf-8").replace("\r\n", "\n")
    start = text.find("export default")
    prefix = "export default"
    if start < 0:
        raise ValueError("canonical border module must use a JSON-compatible default export")
    body = text[start + len(prefix):].strip()
    if body.endswith(";"):
        body = body[:-1].rstrip()
    try:
        document = json.loads(body)
    except json.JSONDecodeError as exc:
        raise ValueError("canonical border default export is not valid JSON") from exc
    return document, _sha_bytes(raw), _sha_bytes(text.encode("utf-8"))


def _border_document(path: Path) -> tuple[dict, str, str]:
    return _border_document_bytes(path.read_bytes())


def _node_digest(repo_root: Path, path: Path) -> dict:
    node = os.environ.get("NODE", "node")
    result = subprocess.run(
        [node, str(_repo_path(repo_root, DIGEST_CLI)), "--file", str(path)],
        cwd=repo_root, capture_output=True, text=True, check=False,
    )
    if result.returncode:
        raise RuntimeError(f"Task 3A digest CLI failed: {result.stderr.strip()}")
    return json.loads(result.stdout)


def _validate_baseline(repo_root: Path, recipe_path: Path, snapshot: dict[str, bytes]) -> tuple[dict, dict, dict, dict]:
    recipe_bytes = snapshot["recipe"]
    recipe = json.loads(recipe_bytes.decode("utf-8"))
    source_path, runtime_path = _repo_path(repo_root, SOURCE), _repo_path(repo_root, RUNTIME)
    road_path, border_path = _repo_path(repo_root, ROAD), _repo_path(repo_root, BORDER)
    for label, key, expected in (("source lines", "sourceLines", PINS["source"]),
                                 ("runtime lines", "runtimeLines", PINS["runtime"]),
                                 ("road GeoJSON", "road", PINS["road"])):
        if _sha_bytes(snapshot[key]) != expected:
            raise ValueError(f"{label} is missing or differs from its pinned before identity")
    border, border_raw_hash, border_lf_hash = _border_document_bytes(snapshot["border"])
    if border_lf_hash != PINS["border"]:
        raise ValueError("canonical border module differs from its pinned normalized-LF identity")
    expected_inputs = recipe.get("expected_inputs", {})
    if expected_inputs.get("source_lines_sha256") != PINS["source"]:
        raise ValueError("recipe source input identity differs from the pinned baseline")
    if expected_inputs.get("runtime_lines_sha256") != PINS["runtime"]:
        raise ValueError("recipe runtime input identity differs from the pinned baseline")
    if expected_inputs.get("border_module_sha256_lf") != border_lf_hash:
        raise ValueError("recipe border input pin differs from canonical border identity")
    source, runtime = json.loads(snapshot["sourceLines"]), json.loads(snapshot["runtimeLines"])
    runtime_digests = _node_digest(repo_root, runtime_path)
    if _sha(runtime_path) != _sha_bytes(snapshot["runtimeLines"]):
        raise ValueError("runtime lines changed while the shared digest was being calculated")
    if runtime_digests.get("byteSha256") != _sha_bytes(snapshot["runtimeLines"]):
        raise ValueError("shared runtime digest does not describe the validated runtime snapshot")
    if runtime_digests.get("confirmedFeaturesSha256") != PINS["confirmed"]:
        raise ValueError("confirmed runtime feature digest differs from its independent pin")
    if recipe.get("expected_inputs", {}).get("confirmed_features_sha256") != PINS["confirmed"]:
        raise ValueError("recipe confirmed feature input pin differs from its independent pin")
    validate_base_pair(source, runtime, recipe)
    road = json.loads(snapshot["road"])
    road["sha256"] = _sha_bytes(snapshot["road"])
    return recipe, source, runtime, {"collection": road, "sha256": road["sha256"], "border": border,
                                   "borderRawSha256": border_raw_hash, "recipeSha256": _sha_bytes(recipe_bytes),
                                   "runtimeDigests": runtime_digests}


def _operation_paths(actual: dict[int, list[list[float]]], reference: dict, operations: list[dict]) -> list[dict]:
    references = {item.get("id"): item for item in reference.get("routes", []) if isinstance(item, dict)}
    by_approach = {item.get("approach"): item for item in reference.get("routes", [])
                   if isinstance(item, dict) and item.get("approach") is not None}
    rows = []
    for operation in operations:
        fid = operation["feature_id"]
        if operation["kind"] == "new_approach":
            reviewed = references.get(operation["parent_id"]) or by_approach.get(operation["parent_id"])
            if not isinstance(reviewed, dict):
                raise ValueError(f"preview reference has no reviewed parent route {operation['parent_id']}")
            expected = reviewed.get("roadCandidate", {}).get("coords") if operation.get("shape") == "road_polyline" else reviewed.get("proposed")
            candidate = actual[fid]
            if operation.get("shape") != "road_polyline":
                expected = expected[:2] if isinstance(expected, list) else expected
        else:
            reviewed = references.get(fid) or by_approach.get(fid)
            expected = reviewed.get("proposed") if reviewed else None
            candidate = actual[fid]
        if not isinstance(expected, list) or len(expected) < 2 or len(candidate) != len(expected):
            raise ValueError(f"preview reference lacks a like-for-like proposed path for operation {fid}")
        deviations = [((a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2) ** 0.5 for a, b in zip(candidate, expected)]
        maximum = max(deviations, default=0.0)
        rows.append({"featureId": fid, "referenceRouteId": operation.get("parent_id", fid),
                     "maximumDeviationMeters": round(maximum, 6), "verticesCompared": len(deviations)})
    return rows


def reconcile_preview(actual: dict[int, list[list[float]]], reference: dict,
                       operations: list[dict], crs: str = "EPSG:2039") -> dict:
    """Compare every reviewed operation in its original projected coordinate system."""
    rows = _operation_paths(actual, reference, operations)
    failures = [row for row in rows if row["maximumDeviationMeters"] > 2.0]
    if failures:
        first = max(failures, key=lambda row: row["maximumDeviationMeters"])
        raise ValueError(f"preview operation {first['featureId']} exceeds 2m: {first['maximumDeviationMeters']} m")
    return {"status": "passed", "crs": crs, "toleranceMeters": 2.0,
            "comparedOperations": [row["featureId"] for row in rows],
            "maximumDeviationMeters": max((row["maximumDeviationMeters"] for row in rows), default=0.0),
            "operations": rows}


def _stage_roles(repo_root: Path, staging_dir: Path, artifacts: dict[str, Path], recipe_hash: str,
                 derived_lock_identity: str, evidence: dict, inputs: list[dict],
                 preimages: dict[str, str | None] | None = None) -> dict:
    targets = []
    for role, relative in ROLE_PATHS.items():
        candidate = artifacts[role]
        target = _repo_path(repo_root, relative)
        preimage = preimages[role] if preimages is not None else (_sha(target) if target.is_file() else None)
        targets.append({"role": role, "target": relative, "stage": candidate.relative_to(staging_dir).as_posix(),
                        "candidateSha256": _sha(candidate), "preImageSha256": preimage})
    manifest = {"schemaVersion": 1, "repoRoot": str(repo_root.resolve()),
                "processedLayersRoot": str(_repo_path(repo_root, PROCESSED)), "recipeSha256": recipe_hash,
                "derivedLockIdentity": derived_lock_identity, "targets": targets,
                "inputIdentities": inputs, "preparationEvidence": evidence}
    _write_json(staging_dir / "prepared-manifest.json", manifest)
    return manifest


def _input_paths(repo_root: Path, recipe_path: Path,
                 preview_reference: Path | None = None) -> list[tuple[str, Path]]:
    paths = [("recipe", recipe_path), ("border", _repo_path(repo_root, BORDER)),
             ("road", _repo_path(repo_root, ROAD)), ("provenance", _repo_path(repo_root, PROVENANCE)),
             ("metadata", _repo_path(repo_root, METADATA)), ("presenter", _repo_path(repo_root, PRESENTER)),
             ("sourceLines", _repo_path(repo_root, SOURCE)), ("runtimeLines", _repo_path(repo_root, RUNTIME)),
             ("alarms", _repo_path(repo_root, PROCESSED / "alarms.geojson")),
             ("investigationPolygons", _repo_path(repo_root, PROCESSED / "investigation_polygons.geojson")),
             ("navigationFixture", _repo_path(repo_root, "otef-interactive/tests/fixtures/nli-presenter-navigation.json")),
             ("verifier", _repo_path(repo_root, VERIFIER_CLI)),
             ("digestCli", _repo_path(repo_root, DIGEST_CLI)),
             ("beatClock", _repo_path(repo_root, "otef-interactive/frontend/src/shared/nli-investigation-clock.js")),
             ("timelineTransport", _repo_path(repo_root, "otef-interactive/frontend/src/remote/nli-timeline-transport.js"))]
    if preview_reference is not None:
        paths.append(("previewReference", preview_reference))
    return paths


def _input_identities(repo_root: Path, recipe_path: Path,
                      preview_reference: Path | None = None) -> tuple[list[dict], dict[str, bytes]]:
    return capture_input_snapshot(repo_root, _input_paths(repo_root, recipe_path, preview_reference))


def _candidate_preview(repo_root: Path, runtime: dict, inputs: dict, recipe: dict,
                       reference: dict) -> tuple[dict, dict, dict]:
    route_result, audit = build_curated_routes(runtime, inputs["border"], recipe, inputs["collection"])
    projected = Transformer.from_crs("EPSG:4326", recipe["construction_crs"], always_xy=True)
    feature_paths = {}
    for feature in route_result["features"]:
        fid = int(feature["properties"]["OBJECTID"])
        geom = feature["geometry"]
        if geom.get("type") != "LineString":
            raise ValueError("preview reconciliation requires LineString route output")
        feature_paths[fid] = [list(point) for point in projected.itransform(geom["coordinates"])]
    preview = reconcile_preview(feature_paths, reference, recipe["operations"], recipe["construction_crs"])
    return route_result, audit, preview


def _active_runtime_preview(runtime: dict, recipe: dict, reference: dict) -> dict:
    projected = Transformer.from_crs("EPSG:4326", recipe["construction_crs"], always_xy=True)
    feature_paths = {}
    for feature in runtime["features"]:
        fid = int(feature["properties"]["OBJECTID"])
        feature_paths[fid] = [list(point) for point in projected.itransform(feature["geometry"]["coordinates"])]
    return reconcile_preview(feature_paths, reference, recipe["operations"], recipe["construction_crs"])


def _verifier_command(repo_root: Path, data_root: Path, manifest: Path, recipe_path: Path,
                      lock_path: Path | None = None) -> list[str]:
    command = [os.environ.get("NODE", "node"), str(_repo_path(repo_root, VERIFIER_CLI)),
               "--data-root", str(data_root), "--manifest", str(manifest),
               "--provenance", str(_repo_path(repo_root, PROVENANCE)),
               "--curation-recipe", str(recipe_path)]
    if lock_path is not None:
        command.extend(["--curation-lock", str(lock_path)])
    return command


def _run_verifier(repo_root: Path, command: list[str]) -> dict:
    result = subprocess.run(command, cwd=repo_root, capture_output=True, text=True, check=False)
    diagnostics = [line.removeprefix("ERROR: ") for line in (result.stdout + result.stderr).splitlines()
                   if line.startswith("ERROR: ")]
    return {"status": "passed" if result.returncode == 0 else "failed",
            "returncode": result.returncode, "diagnostics": diagnostics,
            "stdout": result.stdout, "stderr": result.stderr, "command": command}


def _verify_staged(repo_root: Path, staging_dir: Path, recipe_path: Path) -> dict:
    result = _run_verifier(repo_root, _verifier_command(repo_root, staging_dir / "runtime",
        staging_dir / "presenter.json", recipe_path, staging_dir / "derived-lock.json"))
    if result["returncode"]:
        raise ValueError(f"staged presenter evidence verification failed: {(result['stdout'] + result['stderr']).strip()}")
    return result


def _baseline_verifier_audit(repo_root: Path, recipe_path: Path) -> dict:
    return _run_verifier(repo_root, _verifier_command(repo_root, _repo_path(repo_root, PROCESSED),
        _repo_path(repo_root, PRESENTER), recipe_path))


def _beat_minutes(repo_root: Path, data_root: Path) -> list[int]:
    program = """
import fs from 'node:fs';
import { beatsForMembership } from './frontend/src/shared/nli-investigation-clock.js';
import { nliFeatureBagsFromCache } from './frontend/src/remote/nli-timeline-transport.js';
const root = process.argv[1];
const names = ['investigation_polygons.geojson', 'lines.geojson', 'alarms.geojson'];
const ids = ['nli.investigation_polygons', 'nli.lines', 'nli.alarms'];
const cache = Object.fromEntries(names.map((name, index) => [ids[index], JSON.parse(fs.readFileSync(`${root}/${name}`, 'utf8')).features]));
console.log(JSON.stringify(beatsForMembership(ids, nliFeatureBagsFromCache(cache))));
"""
    result = subprocess.run([os.environ.get("NODE", "node"), "--input-type=module", "-e", program,
                             str(data_root)], cwd=_repo_path(repo_root, BASE), capture_output=True, text=True, check=False)
    if result.returncode:
        raise RuntimeError(f"beat-minute diagnostic failed: {result.stderr.strip()}")
    return json.loads(result.stdout)


def _audit_only_readiness(repo_root: Path, staging_dir: Path, recipe_path: Path,
                          baseline: dict) -> dict:
    candidate = _run_verifier(repo_root, _verifier_command(repo_root, staging_dir / "runtime",
        staging_dir / "presenter.json", recipe_path, staging_dir / "derived-lock.json"))
    expected = ["Beat minutes differ from the tracked navigation fixture"]
    if baseline["diagnostics"] != expected or candidate["diagnostics"] != expected:
        raise ValueError("audit-only mode requires the same sole known beat-fixture verifier failure on baseline and candidate")
    baseline_minutes = _beat_minutes(repo_root, _repo_path(repo_root, PROCESSED))
    candidate_minutes = _beat_minutes(repo_root, staging_dir / "runtime")
    if baseline_minutes != candidate_minutes:
        raise ValueError("audit-only mode requires candidate beat minutes to exactly match the baseline")
    fixture_path = _repo_path(repo_root, BASE / "tests/fixtures/nli-presenter-navigation.json")
    fixture = _json(fixture_path) if fixture_path.is_file() else {}
    tracked = fixture.get("minutes", []) if isinstance(fixture, dict) else []
    return {"status": "blocked", "diagnostics": ["full presenter verifier failed: " + expected[0]],
            "auditOnly": True, "baselineDiagnostics": baseline["diagnostics"],
            "candidateDiagnostics": candidate["diagnostics"],
            "baselineVerifier": baseline, "candidateVerifier": candidate,
            "beatMinuteComparison": {"baseline": baseline_minutes, "candidate": candidate_minutes,
                "identical": True, "missingFromTrackedFixture": sorted(set(tracked) - set(candidate_minutes)),
                "extraAgainstTrackedFixture": sorted(set(candidate_minutes) - set(tracked))}}


def prepare_release(repo_root: Path, recipe_path: Path, staging_dir: Path,
                    *, preview_reference: Path | None = None, mode: str = "prepare",
                    audit_only: bool = False) -> dict:
    """Validate a baseline and create an isolated, auditable prepared release bundle."""
    repo_root, recipe_path, staging_dir = Path(repo_root).resolve(), Path(recipe_path).resolve(), Path(staging_dir).resolve()
    if mode not in {"check", "prepare"}:
        raise ValueError("mode must be check or prepare")
    if audit_only and mode != "prepare":
        raise ValueError("audit-only diagnostics require --prepare")
    if mode == "prepare":
        _validate_staging_location(repo_root, staging_dir)
        _invalidate_manifest_locked(repo_root, staging_dir)
    if not recipe_path.is_file() or not recipe_path.resolve().is_relative_to(repo_root):
        raise ValueError("recipe must be an existing file inside repo_root")
    preview_reference = Path(preview_reference).resolve() if preview_reference is not None else None
    input_identities, snapshot = _input_identities(repo_root, recipe_path, preview_reference)
    lock_path = _repo_path(repo_root, LOCK)
    if lock_path.exists():
        lock_bytes = lock_path.read_bytes()
        lock_before = _sha_bytes(lock_bytes)
        result = _prepare_active_noop(repo_root, recipe_path, staging_dir, mode,
                                      input_identities, snapshot, lock_before, lock_bytes,
                                      preview_reference)
        if _sha(lock_path) != lock_before:
            raise ValueError("active derived lock changed while validating the no-op")
        return result
    recipe, source, runtime, inputs = _validate_baseline(repo_root, recipe_path, snapshot)
    if mode == "check":
        if preview_reference is None:
            return {"status": "checked", "previewComparison": "not performed", "publishable": False,
                    "counts": {"features": 80, "confirmed": 68, "unconfirmed": 12}}
        reference = json.loads(snapshot["previewReference"])
        if reference.get("sourceSha256") != PINS["runtime"] or reference.get("borderSha256") != PINS["border"]:
            raise ValueError("preview reference source or border identity differs from the pinned baseline")
        _, audit, preview = _candidate_preview(repo_root, runtime, inputs, recipe, reference)
        validate_input_snapshot(input_identities, repo_root,
                                expected_names=REQUIRED_INPUT_NAMES | {"previewReference"})
        return {"status": "checked", "previewComparison": preview, "publishable": False,
                "counts": {"features": 89, "confirmed": 68, "unconfirmed": 21}, "audit": audit}
    _validate_staging_location(repo_root, staging_dir)
    if preview_reference is None:
        raise ValueError("first baseline-to-derived preparation requires --preview-reference")
    try:
        reference = json.loads(snapshot["previewReference"])
    except (OSError, ValueError) as exc:
        raise ValueError("preview reference must be valid JSON") from exc
    if reference.get("sourceSha256") != PINS["runtime"] or reference.get("borderSha256") != PINS["border"]:
        raise ValueError("preview reference source or border identity differs from the pinned baseline")
    metadata = json.loads(snapshot["metadata"])
    presenter = json.loads(snapshot["presenter"])
    json.loads(snapshot["provenance"])
    if (str(metadata.get("sourceSha256", "")).lower() != str(presenter.get("acceptedSourceSha256", "")).lower()
            or str(metadata.get("datasetVersion", "")).lower() != str(presenter.get("datasetVersion", "")).lower()
            or not isinstance(metadata.get("counts"), dict)
            or not isinstance(presenter.get("records"), dict)):
        raise ValueError("release metadata and presenter baseline identities are missing or inconsistent")
    baseline_verifier = _baseline_verifier_audit(repo_root, recipe_path)
    known_baseline_block = ["Beat minutes differ from the tracked navigation fixture"]
    if baseline_verifier["returncode"] and (not audit_only or baseline_verifier["diagnostics"] != known_baseline_block):
        raise ValueError("baseline presenter evidence verification failed: " +
                         "\n".join(baseline_verifier["diagnostics"]))
    route_result, audit, preview = _candidate_preview(repo_root, runtime, inputs, recipe, reference)
    staging_dir.mkdir(parents=True, exist_ok=True)
    if any(staging_dir.iterdir()):
        raise ValueError(f"staging directory must be empty: {staging_dir}")
    paths = {"source_lines": staging_dir / "source/lines.geojson",
             "processed_lines": staging_dir / "runtime/lines.geojson",
             "runtime": staging_dir / "runtime",
             "release_metadata": staging_dir / "runtime/release-metadata.json",
             "presenter_json": staging_dir / "presenter.json",
             "derived_lock": staging_dir / "derived-lock.json"}
    _write_json(paths["source_lines"], route_result)
    if not transform_to_wgs84(paths["source_lines"], paths["processed_lines"]):
        raise RuntimeError("ordinary NLI transform_to_wgs84 serialization failed")
    if _node_digest(repo_root, paths["processed_lines"])["confirmedFeaturesSha256"] != PINS["confirmed"]:
        raise ValueError("derived runtime changed confirmed feature identities")
    runtime_digest = _node_digest(repo_root, paths["processed_lines"])
    source_hash = _sha(paths["source_lines"])
    recipe_hash = inputs["recipeSha256"]
    curation = {"schemaVersion": 1, "recipeSha256": recipe_hash, "baseSourceSha256": PINS["source"],
                "baseRuntimeSha256": PINS["runtime"], "confirmedFeaturesSha256": PINS["confirmed"],
                "borderSha256": PINS["border"], "roadSha256": PINS["road"],
                "derivedSourceSha256": source_hash, "runtimeByteSha256": runtime_digest["byteSha256"],
                "runtimeFeatureSha256": runtime_digest["featureSha256"],
                "counts": {"features": 89, "confirmed": 68, "unconfirmed": 21},
                "addedObjectIds": [1013,1014,1015,1016,1017,1018,1019,1020,1021],
                "editedObjectIds": [1001,1002,1005,1006,1008,1009,1010,1011,1012]}
    lock = {"curation": curation}
    _write_json(paths["derived_lock"], lock)
    metadata["routeBorderCuration"] = curation
    _write_json(paths["release_metadata"], metadata)
    if not stamp_nli_runtime_artifact_hash(paths["runtime"], "lines.geojson"):
        raise ValueError("release metadata could not be stamped with staged runtime line hash")
    # The stamp must preserve the original accepted-source metadata fields.
    stamped = _json(paths["release_metadata"])
    original_metadata = json.loads(snapshot["metadata"])
    for key in ("sourceSha256", "datasetVersion", "fileHashes", "artifactHashes", "counts", "reviewProvenance"):
        if stamped.get(key) != original_metadata.get(key):
            raise ValueError(f"metadata refresh changed immutable accepted-source field {key}")
    presenter.setdefault("sourceEvidence", {})["routeBorderCuration"] = curation
    _write_json(staging_dir / "presenter-seed.json", presenter)
    refresh_metadata = dict(stamped)
    if str(refresh_metadata.get("sourceSha256", "")).lower() != str(presenter.get("acceptedSourceSha256", "")).lower():
        raise ValueError("presenter and release metadata source identities differ")
    # Task 3A's refresh helper compares these hex strings case-sensitively;
    # normalize only its temporary input because the digests are case-insensitive.
    refresh_metadata["sourceSha256"] = presenter["acceptedSourceSha256"]
    refresh_metadata_path = staging_dir / "refresh-metadata.json"
    _write_json(refresh_metadata_path, refresh_metadata)
    command = [os.environ.get("NODE", "node"), str(_repo_path(repo_root, ASSEMBLER_CLI)),
               "--refresh-route-evidence", "--manifest", str(staging_dir / "presenter-seed.json"),
               "--metadata", str(refresh_metadata_path), "--provenance", str(_repo_path(repo_root, PROVENANCE)),
               "--recipe", str(recipe_path), "--lock", str(paths["derived_lock"]),
               "--runtime-dir", str(paths["runtime"]), "--output", str(paths["presenter_json"])]
    result = subprocess.run(command, cwd=repo_root, capture_output=True, text=True, check=False)
    if result.returncode:
        raise ValueError(f"presenter evidence refresh failed: {(result.stdout + result.stderr).strip()}")
    # Preserve a byte-for-byte copy of every runtime artifact required by the verifier.
    for name, key in (("alarms.geojson", "alarms"),
                      ("investigation_polygons.geojson", "investigationPolygons")):
        (paths["runtime"] / name).write_bytes(snapshot[key])
    verifier = None
    readiness = {"status": "ready", "diagnostics": []}
    try:
        verifier = _verify_staged(repo_root, staging_dir, recipe_path)
        verifier["baseline"] = baseline_verifier
    except ValueError as exc:
        if not audit_only:
            raise
        diagnostic = str(exc)
        if "Beat minutes differ from the tracked navigation fixture" not in diagnostic:
            raise
        readiness = _audit_only_readiness(repo_root, staging_dir, recipe_path, baseline_verifier)
        verifier = readiness["candidateVerifier"]
        verifier["baseline"] = baseline_verifier
    preview["referenceSha256"] = _sha(preview_reference)
    preview["referencePath"] = str(preview_reference)
    expected_names = REQUIRED_INPUT_NAMES | {"previewReference"}
    validate_input_snapshot(input_identities, repo_root, expected_names=expected_names)
    if lock_path.exists():
        raise ValueError("derived lock appeared while the baseline candidate was being prepared")
    evidence = {"mode": "baseline_to_derived", "previewReconciliation": preview,
                "verifier": verifier,
                "inputIdentities": input_identities}
    evidence["inputIdentities"] = input_identities
    preimages = {"source_lines": _sha_bytes(snapshot["sourceLines"]),
                 "processed_lines": _sha_bytes(snapshot["runtimeLines"]),
                 "release_metadata": _sha_bytes(snapshot["metadata"]),
                 "presenter_json": _sha_bytes(snapshot["presenter"]), "derived_lock": None}
    manifest = _stage_roles(repo_root, staging_dir, paths, recipe_hash,
                            _sha(paths["derived_lock"]),
                            evidence, input_identities, preimages)
    manifest["readiness"] = readiness
    _write_json(staging_dir / "prepared-manifest.json", manifest)
    return {"status": "audit_only" if readiness["status"] == "blocked" else "prepared",
            "publishable": readiness["status"] == "ready", "readiness": readiness,
            "preparedDir": str(staging_dir),
            "manifest": manifest, "curation": curation, "previewReconciliation": preview, "audit": audit}



def _prepare_active_noop(repo_root: Path, recipe_path: Path, staging_dir: Path, mode: str,
                         identities: list[dict], snapshot: dict[str, bytes],
                         lock_hash: str, lock_bytes: bytes,
                         preview_reference: Path | None = None) -> dict:
    recipe_hash = _sha_bytes(snapshot["recipe"])
    lock_path = _repo_path(repo_root, LOCK)
    lock = json.loads(lock_bytes)
    curation = lock.get("curation")
    if not isinstance(curation, dict) or curation.get("recipeSha256") != recipe_hash:
        raise ValueError("active derived lock does not match the exact reviewed recipe")
    if curation.get("baseSourceSha256") != PINS["source"] or curation.get("baseRuntimeSha256") != PINS["runtime"]:
        raise ValueError("active curation proof has an unknown baseline identity")
    if _sha_bytes(snapshot["sourceLines"]) != curation.get("derivedSourceSha256"):
        raise ValueError("active derived source bytes differ from the locked release")
    if _sha_bytes(snapshot["runtimeLines"]) != curation.get("runtimeByteSha256"):
        raise ValueError("active runtime bytes differ from the locked release")
    identity_by_name = {item["name"]: item for item in identities}
    if identity_by_name["border"].get("normalizedLfSha256") != PINS["border"]:
        raise ValueError("active canonical border identity changed")
    if identity_by_name["road"]["byteSha256"] != PINS["road"]:
        raise ValueError("active road identity changed")
    metadata = json.loads(snapshot["metadata"])
    presenter = json.loads(snapshot["presenter"])
    if metadata.get("routeBorderCuration") != curation or presenter.get("sourceEvidence", {}).get("routeBorderCuration") != curation:
        raise ValueError("active metadata and presenter evidence do not match the derived lock")
    expected_names = REQUIRED_INPUT_NAMES | ({"previewReference"} if preview_reference is not None else set())
    validate_input_snapshot(identities, repo_root, expected_names=expected_names)
    if _sha(lock_path) != lock_hash:
        raise ValueError("active derived lock changed while validating the no-op")
    if mode == "check":
        command = [os.environ.get("NODE", "node"), str(_repo_path(repo_root, VERIFIER_CLI)),
                   "--data-root", str(_repo_path(repo_root, PROCESSED)),
                   "--manifest", str(_repo_path(repo_root, PRESENTER)),
                   "--provenance", str(_repo_path(repo_root, PROVENANCE)),
                   "--curation-recipe", str(recipe_path), "--curation-lock", str(lock_path)]
        result = subprocess.run(command, cwd=repo_root, capture_output=True, text=True, check=False)
        if result.returncode:
            raise ValueError(f"active presenter proof verification failed: {(result.stdout + result.stderr).strip()}")
        preview = None
        if preview_reference is not None:
            reference = json.loads(snapshot["previewReference"])
            if reference.get("sourceSha256") != PINS["runtime"] or reference.get("borderSha256") != PINS["border"]:
                raise ValueError("preview reference source or border identity differs from the pinned baseline")
            recipe = json.loads(snapshot["recipe"])
            preview = _active_runtime_preview(json.loads(snapshot["runtimeLines"]), recipe, reference)
        validate_input_snapshot(identities, repo_root, expected_names=expected_names)
        if _sha(lock_path) != lock_hash:
            raise ValueError("active derived lock changed while verifying the no-op")
    if mode == "check":
        return {"status": "checked", "mode": "exact_active_89",
                "previewComparison": preview if preview_reference is not None else "validated prior release proof",
                "publishable": False, "curation": curation}
    _validate_staging_location(repo_root, staging_dir)
    staging_dir.mkdir(parents=True, exist_ok=True)
    if any(staging_dir.iterdir()):
        raise ValueError(f"staging directory must be empty: {staging_dir}")
    paths = {"source_lines": staging_dir / "source/lines.geojson",
             "processed_lines": staging_dir / "runtime/lines.geojson",
             "release_metadata": staging_dir / "runtime/release-metadata.json",
             "presenter_json": staging_dir / "presenter.json",
             "derived_lock": staging_dir / "derived-lock.json"}
    snapshot_roles = {"source_lines": "sourceLines", "processed_lines": "runtimeLines",
                      "release_metadata": "metadata", "presenter_json": "presenter"}
    for role, relative in ROLE_PATHS.items():
        source_path = _repo_path(repo_root, relative)
        paths[role].parent.mkdir(parents=True, exist_ok=True)
        data = lock_bytes if role == "derived_lock" else snapshot[snapshot_roles[role]]
        paths[role].write_bytes(data)
    (paths["processed_lines"].parent / "alarms.geojson").write_bytes(snapshot["alarms"])
    (paths["processed_lines"].parent / "investigation_polygons.geojson").write_bytes(snapshot["investigationPolygons"])
    verifier = _verify_staged(repo_root, staging_dir, recipe_path)
    validate_input_snapshot(identities, repo_root, expected_names=expected_names)
    if _sha(lock_path) != lock_hash:
        raise ValueError("active derived lock changed while staging the no-op")
    evidence = {"mode": "exact_active_noop", "activeProof": curation, "verifier": verifier}
    if preview_reference is not None:
        reference = json.loads(snapshot["previewReference"])
        if reference.get("sourceSha256") != PINS["runtime"] or reference.get("borderSha256") != PINS["border"]:
            raise ValueError("preview reference source or border identity differs from the pinned baseline")
        evidence["previewReconciliation"] = _active_runtime_preview(json.loads(snapshot["runtimeLines"]),
                                                                     json.loads(snapshot["recipe"]), reference)
    preimages = {"source_lines": identity_by_name["sourceLines"]["byteSha256"],
                 "processed_lines": identity_by_name["runtimeLines"]["byteSha256"],
                 "release_metadata": identity_by_name["metadata"]["byteSha256"],
                 "presenter_json": identity_by_name["presenter"]["byteSha256"], "derived_lock": lock_hash}
    manifest = _stage_roles(repo_root, staging_dir, paths, recipe_hash, _sha(paths["derived_lock"]),
                            evidence, identities, preimages)
    manifest["readiness"] = {"status": "ready", "diagnostics": []}
    _write_json(staging_dir / "prepared-manifest.json", manifest)
    return {"status": "prepared", "mode": "exact_active_89", "publishable": True,
            "preparedDir": str(staging_dir), "manifest": manifest, "curation": curation,
            "previewReconciliation": evidence.get("previewReconciliation", {"status": "validated prior release proof"})}
