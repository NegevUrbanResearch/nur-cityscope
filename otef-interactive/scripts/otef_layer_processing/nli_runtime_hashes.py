"""Keep NLI release-metadata hashes in sync with processed runtime files."""

from __future__ import annotations

import hashlib
import json
import os
from pathlib import Path
try:
    from .nli_processing_recovery import file_sha256, record_owned_postimage
except ImportError:  # Support script-directory imports used by preparation tools.
    from nli_processing_recovery import file_sha256, record_owned_postimage

try:
    from .nli_mutation_lock import nli_mutation_lock
except ImportError:  # Support script-directory imports used by preparation tools.
    from nli_mutation_lock import nli_mutation_lock

PEOPLE_RUNTIME_ARTIFACT = "people.geojson"
METADATA_NAME = "release-metadata.json"


def sha256_hex_upper(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest().upper()


def stamp_nli_runtime_artifact_hash(
    pack_output: Path,
    artifact_name: str = PEOPLE_RUNTIME_ARTIFACT,
    *,
    mutation_token: str | None = None,
    processed_layers_root: Path | None = None,
    curation_recipe_path: Path | None = None,
    curation_lock_path: Path | None = None,
    recovery_journal_path: Path | None = None,
) -> bool:
    """Stamp one artifact hash while owning or joining its NLI pack lock."""
    output = Path(pack_output).resolve()
    root = Path(processed_layers_root).resolve() if processed_layers_root is not None else output
    if root != output:
        raise ValueError("processed_layers_root must identify the NLI pack being stamped")
    with nli_mutation_lock(root, owner_token=mutation_token):
        if artifact_name == "lines.geojson":
            try:
                from .nli_active_route_evidence import (
                    validate_active_route_candidate,
                    validate_active_route_source,
                )
            except ImportError:  # Support script-directory imports used by preparation tools.
                from nli_active_route_evidence import (
                    validate_active_route_candidate,
                    validate_active_route_source,
                )

            default_scripts = Path(__file__).resolve().parents[1]
            lock = (Path(curation_lock_path).resolve() if curation_lock_path is not None
                    else default_scripts / "nli-border-route-curation.lock.json")
            recipe = (Path(curation_recipe_path).resolve() if curation_recipe_path is not None
                      else lock.with_name("nli-border-route-curation.json"))
            if lock.is_file():
                repo = recipe.parent.parent.parent
                source = repo / "otef-interactive/public/source/layers/nli/gis/lines.geojson"
                evidence = validate_active_route_source(
                    source, recipe, lock, processed_layers_root=root
                )
                if evidence is None:
                    raise ValueError("active route line stamp has no curation evidence")
                validate_active_route_candidate(output / artifact_name, evidence)
        return _stamp_nli_runtime_artifact_hash(output, artifact_name, recovery_journal_path=recovery_journal_path)


def _stamp_nli_runtime_artifact_hash(
    pack_output: Path, artifact_name: str = PEOPLE_RUNTIME_ARTIFACT,
    *, recovery_journal_path: Path | None = None,
) -> bool:
    """Set runtimeArtifactHashes[artifact_name] to the SHA-256 of that processed file.

    No-op if release-metadata.json or the artifact is missing. Returns True when
    metadata was rewritten.
    """
    metadata_path = pack_output / METADATA_NAME
    artifact_path = pack_output / artifact_name
    if not metadata_path.is_file() or not artifact_path.is_file():
        return False
    metadata = json.loads(metadata_path.read_text(encoding="utf-8"))
    if not isinstance(metadata, dict):
        return False
    hashes = metadata.get("runtimeArtifactHashes")
    if not isinstance(hashes, dict):
        hashes = {}
        metadata["runtimeArtifactHashes"] = hashes
    hashes[artifact_name] = sha256_hex_upper(artifact_path)
    tmp = metadata_path.with_name(metadata_path.name + ".tmp")
    try:
        tmp.write_text(
            json.dumps(metadata, indent=2, ensure_ascii=False) + "\n",
            encoding="utf-8",
        )
        if recovery_journal_path is not None:
            record_owned_postimage(recovery_journal_path, metadata_path, file_sha256(tmp))
        os.replace(tmp, metadata_path)
    finally:
        if tmp.exists():
            tmp.unlink(missing_ok=True)
    return True
