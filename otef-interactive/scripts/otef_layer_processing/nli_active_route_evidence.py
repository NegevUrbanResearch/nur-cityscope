"""Validation helpers for an installed NLI route curation release."""

from __future__ import annotations

import hashlib
import json
import os
import subprocess
from pathlib import Path

try:
    from .nli_mutation_lock import UNFINISHED_MARKER_NAME
except ImportError:  # Support script-directory imports used by preparation tools.
    from nli_mutation_lock import UNFINISHED_MARKER_NAME

DIGEST_CLI = Path("otef-interactive/scripts/nli-route-curation-digests.mjs")
BASE_SOURCE = "18b0e3445c771da9c3e7995270601f7a1187501bd3bfdf6b3e0fa2c6cedc6462"
BASE_RUNTIME = "934bd4be7a1d6a4f1b6a0f62337384d06624e571a6efe44da366ab6062afa3c1"
CONFIRMED = "c2d3ec3f50f0c016e6665b39ed93ed758020cf0c2a8339153cb1f51326039358"
COUNTS = {"features": 89, "confirmed": 68, "unconfirmed": 21}
ADDED_IDS = list(range(1013, 1022))
EDITED_IDS = [1001, 1002, 1005, 1006, 1008, 1009, 1010, 1011, 1012]


def _sha_bytes(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


def _json(path: Path, label: str) -> dict:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError) as exc:
        raise ValueError(f"active route {label} is missing or invalid: {path}") from exc
    if not isinstance(value, dict):
        raise ValueError(f"active route {label} must be a JSON object: {path}")
    return value


def _repo_root(recipe_path: Path, lock_path: Path) -> Path:
    recipe = Path(recipe_path).resolve()
    lock = Path(lock_path).resolve()
    if recipe.parent != lock.parent or recipe.parent.name != "scripts":
        raise ValueError("active route recipe and lock must be in the same scripts directory")
    interactive = recipe.parent.parent
    if interactive.name != "otef-interactive":
        raise ValueError("active route recipe must be below otef-interactive/scripts")
    return interactive.parent


def validate_active_route_source(
    source_path: Path, recipe_path: Path, lock_path: Path, *,
    processed_layers_root: Path | None = None,
) -> dict | None:
    """Validate the installed derived source and its release evidence, if active.

    A missing lock means legacy source processing. The unfinished publication
    marker is checked first so no source replacement can bypass recovery.
    """
    source_path = Path(source_path).resolve()
    recipe_path = Path(recipe_path).resolve()
    lock_path = Path(lock_path).resolve()
    repo = _repo_root(recipe_path, lock_path)
    interactive = repo / "otef-interactive"
    processed = (Path(processed_layers_root).resolve() if processed_layers_root is not None
                 else (interactive / "public/processed/layers/nli").resolve())
    marker = processed.parent / UNFINISHED_MARKER_NAME
    if marker.exists():
        raise RuntimeError(f"unfinished NLI release blocks source replacement: {marker}")
    if not lock_path.is_file():
        return None

    lock = _json(lock_path, "derived lock")
    curation = lock.get("curation")
    if not isinstance(curation, dict):
        raise ValueError("active derived lock has no curation evidence")
    recipe_bytes = recipe_path.read_bytes()
    if _sha_bytes(recipe_bytes) != curation.get("recipeSha256"):
        raise ValueError("active route recipe identity differs from the derived lock")
    recipe = _json(recipe_path, "recipe")
    expected = recipe.get("expected_inputs")
    if not isinstance(expected, dict):
        raise ValueError("active route recipe has no expected_inputs")
    if curation.get("baseSourceSha256") != expected.get("source_lines_sha256") or curation.get("baseSourceSha256") != BASE_SOURCE:
        raise ValueError("active route recipe baseline source identity changed")
    if curation.get("baseRuntimeSha256") != expected.get("runtime_lines_sha256") or curation.get("baseRuntimeSha256") != BASE_RUNTIME:
        raise ValueError("active route recipe baseline runtime identity changed")
    if curation.get("confirmedFeaturesSha256") != expected.get("confirmed_features_sha256") or curation.get("confirmedFeaturesSha256") != CONFIRMED:
        raise ValueError("active route confirmed-feature identity changed")
    border_path = interactive / "frontend/src/shared/gaza-border-geometry.js"
    try:
        border_bytes = border_path.read_bytes()
    except OSError as exc:
        raise ValueError("active route canonical border is missing") from exc
    normalized_border_sha = _sha_bytes(border_bytes.replace(b"\r\n", b"\n"))
    if (normalized_border_sha != expected.get("border_module_sha256_lf")
            or normalized_border_sha != curation.get("borderSha256")):
        raise ValueError("active route canonical border identity changed")
    if curation.get("counts") != COUNTS or curation.get("addedObjectIds") != ADDED_IDS or curation.get("editedObjectIds") != EDITED_IDS:
        raise ValueError("active route reviewed IDs or counts differ from the approved release")
    source_sha = _sha_bytes(source_path.read_bytes()) if source_path.is_file() else None
    if source_sha != curation.get("derivedSourceSha256"):
        raise ValueError("active route source bytes differ from the locked derived source")
    metadata = _json(processed / "release-metadata.json", "release metadata")
    if metadata.get("routeBorderCuration") != curation:
        raise ValueError("active route release metadata evidence is missing or mismatched")
    presenter = _json(interactive / "frontend/src/remote/nli-presenter-content.json", "presenter evidence")
    if not isinstance(presenter.get("sourceEvidence"), dict) or presenter["sourceEvidence"].get("routeBorderCuration") != curation:
        raise ValueError("active route presenter evidence is missing or mismatched")
    runtime_hashes = metadata.get("runtimeArtifactHashes")
    if not isinstance(runtime_hashes, dict) or str(runtime_hashes.get("lines.geojson", "")).lower() != curation.get("runtimeByteSha256"):
        raise ValueError("active route metadata line byte hash is missing or mismatched")
    required_artifacts = presenter.get("requiredArtifacts")
    if not isinstance(required_artifacts, dict) or str(required_artifacts.get("nli.lines", "")).lower() != curation.get("runtimeFeatureSha256"):
        raise ValueError("active route presenter required line feature hash is missing or mismatched")
    source_evidence = presenter["sourceEvidence"]
    presenter_artifacts = source_evidence.get("artifacts")
    line_evidence = presenter_artifacts.get("nli.lines") if isinstance(presenter_artifacts, dict) else None
    if not isinstance(line_evidence, dict):
        raise ValueError("active route presenter line evidence is missing")
    if (str(line_evidence.get("runtimeByteSha256", "")).lower() != curation.get("runtimeByteSha256")
            or str(line_evidence.get("runtimeFeatureSha256", "")).lower() != curation.get("runtimeFeatureSha256")):
        raise ValueError("active route presenter line byte or feature evidence is mismatched")

    accepted_source = metadata.get("sourceSha256")
    dataset_version = metadata.get("datasetVersion")
    package_sha = source_evidence.get("acceptedPackageSha256")
    if not isinstance(accepted_source, str) or not accepted_source.strip() or not isinstance(dataset_version, str) or not dataset_version.strip():
        raise ValueError("active route accepted source or dataset identity is missing from metadata")
    provenance = _json(interactive / "scripts/nli-presenter-provenance.json", "accepted provenance")
    if (str(presenter.get("acceptedSourceSha256", "")).lower() != accepted_source.lower()
            or str(source_evidence.get("acceptedSourceSha256", "")).lower() != accepted_source.lower()
            or str(presenter.get("datasetVersion", "")).lower() != dataset_version.lower()
            or str(source_evidence.get("datasetVersion", "")).lower() != dataset_version.lower()
            or str(provenance.get("acceptedSourceSha256", "")).lower() != accepted_source.lower()
            or str(provenance.get("datasetVersion", "")).lower() != dataset_version.lower()):
        raise ValueError("active route accepted source or dataset identity differs from presenter provenance")
    provenance_package = provenance.get("packageSha256")
    if (not isinstance(package_sha, str) or not package_sha
            or source_evidence.get("packageSha256") != package_sha
            or provenance_package != package_sha):
        raise ValueError("active route accepted package identity differs from presenter provenance")
    provenance_line = (provenance.get("artifacts") or {}).get("nli.lines")
    if not isinstance(provenance_line, dict):
        raise ValueError("active route accepted package line provenance is missing")
    packaged_hash = provenance_line.get("packagedByteSha256")
    caption_fields = provenance_line.get("captionFields")
    caption_hash = provenance_line.get("acceptedCaptionSha256")
    if (not isinstance(packaged_hash, str) or not packaged_hash
            or not isinstance(caption_fields, list)
            or not isinstance(caption_hash, str) or not caption_hash):
        raise ValueError("active route accepted package line provenance is incomplete")
    if (str(line_evidence.get("packagedByteSha256", "")).lower()
            != str(provenance_line.get("packagedByteSha256", "")).lower()
            or line_evidence.get("captionFields") != provenance_line.get("captionFields")
            or str(line_evidence.get("acceptedCaptionSha256", "")).lower()
            != str(provenance_line.get("acceptedCaptionSha256", "")).lower()):
        raise ValueError("active route packaged line evidence differs from accepted provenance")
    return {"curation": curation, "repoRoot": str(repo), "processedLayersRoot": str(processed)}


def validate_active_route_candidate(candidate_path: Path, evidence: dict) -> None:
    """Validate staged runtime routes with the shared canonical Node digest."""
    if not isinstance(evidence, dict) or not isinstance(evidence.get("curation"), dict):
        raise ValueError("active route candidate evidence is invalid")
    curation = evidence["curation"]
    candidate = Path(candidate_path).resolve()
    if not candidate.is_file():
        raise ValueError(f"active route candidate is missing: {candidate}")
    repo = Path(evidence.get("repoRoot", "")).resolve()
    digest_cli = repo / DIGEST_CLI
    node = os.environ.get("NODE", "node")
    result = subprocess.run([node, str(digest_cli), "--file", str(candidate)],
                            cwd=repo, capture_output=True, text=True, check=False)
    if result.returncode:
        raise ValueError(f"active route candidate digest failed: {(result.stdout + result.stderr).strip()}")
    try:
        digest = json.loads(result.stdout)
    except ValueError as exc:
        raise ValueError("active route candidate digest returned invalid JSON") from exc
    if not isinstance(digest, dict):
        raise ValueError("active route candidate digest returned an invalid object")
    if digest.get("byteSha256") != curation.get("runtimeByteSha256"):
        raise ValueError("active route candidate runtime byte hash differs from the release")
    if digest.get("featureSha256") != curation.get("runtimeFeatureSha256"):
        raise ValueError("active route candidate runtime feature hash differs from the release")
    if (curation.get("confirmedFeaturesSha256") != CONFIRMED
            or digest.get("confirmedFeaturesSha256") != CONFIRMED):
        raise ValueError("active route candidate confirmed-feature hash differs from the release")
    try:
        features = json.loads(candidate.read_text(encoding="utf-8")).get("features")
    except (OSError, ValueError, AttributeError) as exc:
        raise ValueError("active route candidate has invalid GeoJSON") from exc
    if not isinstance(features, list):
        raise ValueError("active route candidate has no feature list")
    confirmed = sum(
        1 for feature in features
        if not isinstance(feature, dict)
        or not isinstance(feature.get("properties"), dict)
        or feature["properties"].get("route_confidence") != "unconfirmed"
    )
    unconfirmed = len(features) - confirmed
    counts = {"features": len(features), "confirmed": confirmed, "unconfirmed": unconfirmed}
    if counts != curation.get("counts"):
        raise ValueError(f"active route candidate counts differ from the release: {counts}")
    unconfirmed_ids = []
    for feature in features:
        properties = feature.get("properties") if isinstance(feature, dict) else None
        if not isinstance(properties, dict) or properties.get("route_confidence") != "unconfirmed":
            continue
        try:
            object_id = int(properties.get("OBJECTID"))
        except (TypeError, ValueError):
            unconfirmed_ids = []
            break
        if object_id != properties.get("OBJECTID"):
            unconfirmed_ids = []
            break
        unconfirmed_ids.append(object_id)
    unconfirmed_ids.sort()
    if unconfirmed_ids != list(range(1001, 1022)):
        raise ValueError("active route candidate unconfirmed route IDs differ from the reviewed set")
