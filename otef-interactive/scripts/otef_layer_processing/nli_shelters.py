"""Pinned original Oct7Database shelters; a hidden resource of the 232 layer."""

from __future__ import annotations

import hashlib
import json
import math
import os
import shutil
import tempfile
from pathlib import Path

from .nli_runtime_hashes import stamp_nli_runtime_artifact_hash

DEFAULT_FIXTURE = Path(__file__).resolve().parents[1] / "fixtures/nli-shelters-232.json"
ARTIFACT = "shelters_232.geojson"


def _canonical(value):
    return (
        json.dumps(
            value,
            sort_keys=True,
            ensure_ascii=False,
            separators=(",", ":"),
            allow_nan=False,
        )
        + "\n"
    ).encode("utf-8")


def _atomic_write(path, raw):
    path.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile(
        dir=path.parent, prefix=path.name + ".", delete=False
    ) as stream:
        temporary = Path(stream.name)
        stream.write(raw)
    try:
        os.replace(temporary, path)
    finally:
        temporary.unlink(missing_ok=True)


def prepare_shelters_232(
    fixture_path: Path, people_path: Path, output_dir: Path
) -> dict:
    fixture = json.loads(Path(fixture_path).read_text(encoding="utf-8"))
    records = fixture.get("shelters", [])
    if fixture.get("schemaVersion") != 1 or len(records) != 9:
        raise ValueError("Shelters require schema 1 and exactly nine groups")
    people = json.loads(Path(people_path).read_text(encoding="utf-8"))
    known = {
        str(f.get("properties", {}).get("pid")) for f in people.get("features", [])
    }
    ids, members, canonical = set(), set(), []
    for record in records:
        sid = record.get("id")
        xy = record.get("coordinates", [])
        if not isinstance(sid, str) or not sid.startswith("nli-shelter-") or sid in ids:
            raise ValueError("Shelter IDs must be unique and permanent")
        if (
            len(xy) != 2
            or not all(isinstance(n, (int, float)) and math.isfinite(n) for n in xy)
            or not (-180 <= xy[0] <= 180 and -90 <= xy[1] <= 90)
        ):
            raise ValueError("Invalid WGS84 shelter coordinate")
        pids = [str(p) for p in record.get("personPids", [])]
        if (
            not pids
            or len(set(pids)) != len(pids)
            or not set(pids) <= known
            or members.intersection(pids)
        ):
            raise ValueError(
                "Direct shelter PIDs must resolve uniquely in accepted people data"
            )
        ids.add(sid)
        members.update(pids)
        canonical.append({**record, "personPids": sorted(pids)})
    if len(members) != 84:
        raise ValueError("Expected 84 distinct direct shelter people")
    canonical.sort(key=lambda r: r["id"])
    accepted = {
        **fixture,
        "shelters": canonical,
        "nearbyPersonPids": sorted(map(str, fixture.get("nearbyPersonPids", []))),
    }
    version = hashlib.sha256(_canonical(accepted)).hexdigest()
    features = [
        {
            "type": "Feature",
            "id": r["id"],
            "geometry": {"type": "Point", "coordinates": r["coordinates"]},
            "properties": {
                k: v for k, v in r.items() if k not in ("id", "coordinates")
            },
        }
        for r in canonical
    ]
    wrapper = {
        "type": "FeatureCollection",
        "schemaVersion": 1,
        "shelterVersion": version,
        "sourceUrls": fixture["sourceUrls"],
        "sourceSnapshotHashes": fixture["sourceSnapshotHashes"],
        "nearbyPersonPids": accepted["nearbyPersonPids"],
        "features": features,
    }
    raw = _canonical(wrapper)
    _atomic_write(Path(output_dir) / ARTIFACT, raw)
    return {
        "file": ARTIFACT,
        "format": "geojson",
        "sha256": hashlib.sha256(raw).hexdigest(),
        "shelterVersion": version,
        "schemaVersion": 1,
    }


def merge_shelter_resource(resources, pack_output: Path) -> dict:
    # Full/no-cache processing has no cached resource bag. Retain declarations
    # already owned by the parent layer before refreshing the shelter entry.
    if resources is None:
        manifest_path = Path(pack_output) / "manifest.json"
        if manifest_path.is_file():
            manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
            parent = next(
                (
                    layer
                    for layer in manifest.get("layers", [])
                    if layer.get("id") == "ציר_232"
                ),
                {},
            )
            resources = parent.get("resources")
    result = dict(resources or {})
    result.pop("shelters232", None)
    path = Path(pack_output) / ARTIFACT
    if path.is_file():
        raw = path.read_bytes()
        wrapper = json.loads(raw)
        if (
            wrapper.get("schemaVersion") != 1
            or len(wrapper.get("features", [])) != 9
            or not wrapper.get("shelterVersion")
        ):
            raise ValueError("Invalid shelter resource wrapper")
        result["shelters232"] = {
            "file": ARTIFACT,
            "format": "geojson",
            "sha256": hashlib.sha256(raw).hexdigest(),
            "shelterVersion": wrapper["shelterVersion"],
            "schemaVersion": 1,
        }
    return result


def stage_shelter_cohort(
    accepted_dir: Path, destination: Path, fixture_path: Path = DEFAULT_FIXTURE
) -> dict:
    """Create a new independently copied cohort; never alter the accepted pack."""
    accepted_dir, destination = (
        Path(accepted_dir).resolve(),
        Path(destination).resolve(),
    )
    if (
        destination.exists()
        or destination == accepted_dir
        or accepted_dir in destination.parents
    ):
        raise ValueError("Destination must be new and outside the accepted cohort")
    destination.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(
        dir=destination.parent, prefix="shelter-cohort-"
    ) as temporary:
        stage = Path(temporary) / "nli"
        shutil.copytree(accepted_dir, stage, copy_function=shutil.copy2)
        resource = prepare_shelters_232(fixture_path, stage / "people.geojson", stage)
        manifest_path = stage / "manifest.json"
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
        road = next(
            (l for l in manifest.get("layers", []) if l.get("id") == "ציר_232"), None
        )
        if road is None:
            raise ValueError("Accepted pack has no 232 layer")
        road["resources"] = merge_shelter_resource(road.get("resources"), stage)
        _atomic_write(manifest_path, _canonical(manifest))
        if not stamp_nli_runtime_artifact_hash(stage, ARTIFACT):
            raise ValueError("Accepted cohort requires release metadata")
        metadata = json.loads(
            (stage / "release-metadata.json").read_text(encoding="utf-8")
        )
        if metadata["runtimeArtifactHashes"][ARTIFACT].lower() != resource["sha256"]:
            raise ValueError("Shelter cohort hash mismatch")
        os.replace(stage, destination)
    return resource
