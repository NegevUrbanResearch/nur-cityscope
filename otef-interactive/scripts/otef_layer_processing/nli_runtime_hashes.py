"""Keep NLI release-metadata hashes in sync with processed runtime files."""

from __future__ import annotations

import hashlib
import json
import os
from pathlib import Path

PEOPLE_RUNTIME_ARTIFACT = "people.geojson"
METADATA_NAME = "release-metadata.json"


def sha256_hex_upper(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest().upper()


def stamp_nli_runtime_artifact_hash(
    pack_output: Path, artifact_name: str = PEOPLE_RUNTIME_ARTIFACT
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
        os.replace(tmp, metadata_path)
    finally:
        if tmp.exists():
            tmp.unlink(missing_ok=True)
    return True
