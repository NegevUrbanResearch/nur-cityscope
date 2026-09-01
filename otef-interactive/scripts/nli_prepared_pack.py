"""Inspect and restore the immutable NLI prepared source pack."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import tempfile
import zipfile
from dataclasses import dataclass, replace
from pathlib import Path, PurePosixPath
from typing import Iterable


GIS_DATASETS = (
    "alarms",
    "investigation_polygons",
    "lines",
    "people",
    "people_names",
)
EXPECTED_FEATURE_COUNTS = {
    "investigation_polygons": 223,
    "lines": 68,
    "people": 1394,
    "people_names": 1394,
    "alarms": 190,
}
EXPECTED_FILES = frozenset(
    {
        "nli/gis/.gitkeep",
        "nli/styles/.gitkeep",
        *(f"nli/gis/{name}.geojson" for name in GIS_DATASETS),
        *(f"nli/styles/{name}.lyrx" for name in GIS_DATASETS),
    }
)
EXPECTED_DIRECTORIES = frozenset({"nli/", "nli/gis/", "nli/styles/"})
EXPECTED_ENTRIES = EXPECTED_FILES | EXPECTED_DIRECTORIES
MAX_UNCOMPRESSED_SIZE = 16 * 1024 * 1024
MAX_TOTAL_UNCOMPRESSED_SIZE = 64 * 1024 * 1024


class PreparedPackError(ValueError):
    """Raised when a source pack fails an integrity or safety check."""


@dataclass(frozen=True)
class PreparedPackEntry:
    name: str
    sha256: str
    compressed_size: int
    uncompressed_size: int


@dataclass(frozen=True)
class PreparedPackReport:
    source_sha256: str
    normalized_entry_names: tuple[str, ...]
    entries: tuple[PreparedPackEntry, ...]
    feature_counts: dict[str, int]
    restored_destination: Path | None = None

    @property
    def source_hash(self) -> str:
        """Return the source hash using the concise field name used by reports."""

        return self.source_sha256

    @property
    def entry_hashes(self) -> dict[str, str]:
        """Return per-entry SHA-256 values keyed by normalized archive name."""

        return {entry.name: entry.sha256 for entry in self.entries}

    @property
    def entry_sizes(self) -> dict[str, tuple[int, int]]:
        """Return compressed and uncompressed sizes keyed by normalized archive name."""

        return {
            entry.name: (entry.compressed_size, entry.uncompressed_size)
            for entry in self.entries
        }


def sha256_file(path: Path) -> str:
    """Calculate a file's SHA-256 digest using bounded reads."""

    digest = hashlib.sha256()
    try:
        with path.open("rb") as stream:
            for chunk in iter(lambda: stream.read(1024 * 1024), b""):
                digest.update(chunk)
    except OSError as exc:
        raise PreparedPackError(f"Cannot read artifact {path}: {exc}") from exc
    return digest.hexdigest()


def _validate_expected_hash(expected_sha256: str) -> str:
    normalized = expected_sha256.strip().lower()
    if len(normalized) != 64 or any(character not in "0123456789abcdef" for character in normalized):
        raise PreparedPackError("Expected SHA-256 must be exactly 64 hexadecimal characters")
    return normalized


def _source_hash(zip_path: Path, expected_sha256: str) -> str:
    if not zip_path.is_file():
        raise PreparedPackError(f"Artifact does not exist or is not a file: {zip_path}")
    actual = sha256_file(zip_path)
    if actual != _validate_expected_hash(expected_sha256):
        raise PreparedPackError(f"Artifact SHA-256 mismatch: expected {expected_sha256}, got {actual}")
    return actual


def _normalize_entry_name(info: zipfile.ZipInfo) -> str:
    name = info.filename
    if not name or "\x00" in name or "\\" in name:
        raise PreparedPackError(f"Unsafe ZIP entry name: {name!r}")
    if name.startswith("/") or (len(name) >= 2 and name[1] == ":"):
        raise PreparedPackError(f"Absolute ZIP entry name: {name!r}")
    path = PurePosixPath(name)
    if any(part in {"", ".", ".."} for part in path.parts):
        raise PreparedPackError(f"Non-canonical ZIP entry name: {name!r}")
    normalized = "/".join(path.parts)
    if info.is_dir():
        normalized += "/"
    if normalized != name:
        raise PreparedPackError(f"Non-canonical ZIP entry name: {name!r}")
    return normalized


def _zip_infos(archive: zipfile.ZipFile) -> list[tuple[zipfile.ZipInfo, str]]:
    seen: set[str] = set()
    seen_casefold: set[str] = set()
    pairs: list[tuple[zipfile.ZipInfo, str]] = []
    total_size = 0
    for info in archive.infolist():
        name = _normalize_entry_name(info)
        if name in seen:
            raise PreparedPackError(f"Duplicate ZIP entry: {name}")
        if name.casefold() in seen_casefold:
            raise PreparedPackError(f"Case-colliding ZIP entry: {name}")
        seen.add(name)
        seen_casefold.add(name.casefold())
        if name not in EXPECTED_ENTRIES:
            raise PreparedPackError(f"ZIP entry is outside the prepared-pack allowlist: {name}")
        if info.flag_bits & 0x1:
            raise PreparedPackError(f"Encrypted ZIP entry is not allowed: {name}")
        if info.file_size < 0 or info.file_size > MAX_UNCOMPRESSED_SIZE:
            raise PreparedPackError(f"ZIP entry is too large: {name}")
        if info.is_dir() != (name in EXPECTED_DIRECTORIES):
            raise PreparedPackError(f"ZIP entry type does not match the contract: {name}")
        mode = (info.external_attr >> 16) & 0o170000
        if info.is_dir():
            if info.file_size != 0:
                raise PreparedPackError(f"Allowlisted directory has a payload: {name}")
            if mode not in (0, 0o040000):
                raise PreparedPackError(f"Allowlisted directory has an invalid mode: {name}")
        elif mode and mode != 0o100000:
            raise PreparedPackError(f"Special ZIP entry is not allowed: {name}")
        total_size += info.file_size
        if total_size > MAX_TOTAL_UNCOMPRESSED_SIZE:
            raise PreparedPackError("ZIP exceeds the total uncompressed-size limit")
        pairs.append((info, name))
    if {name for _, name in pairs} != EXPECTED_ENTRIES:
        missing = sorted(EXPECTED_ENTRIES - {name for _, name in pairs})
        raise PreparedPackError(f"ZIP does not match the exact entry allowlist; missing: {missing}")
    return pairs


def _entry_digest(archive: zipfile.ZipFile, info: zipfile.ZipInfo) -> str:
    digest = hashlib.sha256()
    total_read = 0
    try:
        with archive.open(info, "r") as stream:
            for chunk in iter(lambda: stream.read(1024 * 1024), b""):
                total_read += len(chunk)
                if total_read > MAX_UNCOMPRESSED_SIZE:
                    raise PreparedPackError(f"ZIP entry is too large while reading: {info.filename}")
                digest.update(chunk)
    except (OSError, RuntimeError, zipfile.BadZipFile, zipfile.LargeZipFile) as exc:
        raise PreparedPackError(f"Cannot read ZIP entry {info.filename}: {exc}") from exc
    return digest.hexdigest()


def _feature_counts(archive: zipfile.ZipFile, pairs: Iterable[tuple[zipfile.ZipInfo, str]]) -> dict[str, int]:
    counts: dict[str, int] = {}
    by_name = {name: info for info, name in pairs}
    for dataset in GIS_DATASETS:
        name = f"nli/gis/{dataset}.geojson"
        try:
            with archive.open(by_name[name], "r") as stream:
                content = bytearray()
                for chunk in iter(lambda: stream.read(1024 * 1024), b""):
                    if len(content) + len(chunk) > MAX_UNCOMPRESSED_SIZE:
                        raise PreparedPackError(f"ZIP entry is too large while parsing: {name}")
                    content.extend(chunk)
                document = json.loads(content)
        except (OSError, RuntimeError, ValueError, zipfile.BadZipFile) as exc:
            raise PreparedPackError(f"Invalid GeoJSON entry {name}: {exc}") from exc
        if not isinstance(document, dict) or document.get("type") != "FeatureCollection":
            raise PreparedPackError(f"GeoJSON entry is not a FeatureCollection: {name}")
        features = document.get("features")
        if not isinstance(features, list):
            raise PreparedPackError(f"GeoJSON entry has no feature list: {name}")
        counts[dataset] = len(features)
    return counts


def inspect_prepared_pack(zip_path: Path, expected_sha256: str) -> PreparedPackReport:
    """Validate, hash, and count a prepared pack without extracting it."""

    source_sha256 = _source_hash(zip_path, expected_sha256)
    try:
        with zipfile.ZipFile(zip_path, "r") as archive:
            pairs = _zip_infos(archive)
            entries = tuple(
                PreparedPackEntry(
                    name=name,
                    sha256=hashlib.sha256(b"").hexdigest() if info.is_dir() else _entry_digest(archive, info),
                    compressed_size=info.compress_size,
                    uncompressed_size=info.file_size,
                )
                for info, name in pairs
            )
            counts = _feature_counts(archive, pairs)
            mismatches = [
                f"{dataset}: expected {expected}, got {counts.get(dataset)}"
                for dataset, expected in EXPECTED_FEATURE_COUNTS.items()
                if counts.get(dataset) != expected
            ]
            if mismatches:
                raise PreparedPackError("Feature count mismatch: " + "; ".join(mismatches))
    except (OSError, zipfile.BadZipFile, zipfile.LargeZipFile) as exc:
        raise PreparedPackError(f"Invalid ZIP artifact {zip_path}: {exc}") from exc
    return PreparedPackReport(
        source_sha256=source_sha256,
        normalized_entry_names=tuple(name for _, name in pairs),
        entries=entries,
        feature_counts=counts,
    )


def _destination_is_public(destination: Path) -> bool:
    public = (Path(__file__).resolve().parent.parent / "public").resolve()
    try:
        destination.relative_to(public)
    except ValueError:
        return False
    return True


def _safe_destination(destination: Path) -> Path:
    target = destination.expanduser().resolve(strict=False)
    if target.exists():
        raise PreparedPackError(f"Restore destination already exists: {target}")
    if _destination_is_public(target):
        raise PreparedPackError(f"Restore destination must be outside otef-interactive/public: {target}")
    if not target.parent.is_dir():
        raise PreparedPackError(f"Restore destination parent does not exist: {target.parent}")
    return target


def _restore_relative_name(name: str) -> str:
    """Map the archive's top-level nli directory to the requested destination root."""

    if name == "nli/":
        return ""
    return name.removeprefix("nli/")


def restore_prepared_pack(zip_path: Path, destination: Path, expected_sha256: str) -> PreparedPackReport:
    """Validate a pack, restore it into a new guarded staging destination, and verify hashes."""

    target = _safe_destination(destination)
    report = inspect_prepared_pack(zip_path, expected_sha256)
    entry_by_name = {entry.name: entry for entry in report.entries}
    staging_root: Path | None = None
    try:
        with tempfile.TemporaryDirectory(prefix=".nli-restore-", dir=str(target.parent)) as staging:
            staging_root = Path(staging).resolve()
            with zipfile.ZipFile(zip_path, "r") as archive:
                pairs = _zip_infos(archive)
                for info, name in pairs:
                    relative_name = _restore_relative_name(name)
                    path = (staging_root / relative_name).resolve(strict=False)
                    try:
                        path.relative_to(staging_root)
                    except ValueError as exc:
                        raise PreparedPackError(f"ZIP entry escapes staging root: {name}") from exc
                    if info.is_dir():
                        path.mkdir(parents=True, exist_ok=True)
                        continue
                    path.parent.mkdir(parents=True, exist_ok=True)
                    total_read = 0
                    with archive.open(info, "r") as source, path.open("wb") as output:
                        for chunk in iter(lambda: source.read(1024 * 1024), b""):
                            total_read += len(chunk)
                            if total_read > MAX_UNCOMPRESSED_SIZE:
                                raise PreparedPackError(f"ZIP entry is too large while restoring: {name}")
                            output.write(chunk)
                    if path.stat().st_size != entry_by_name[name].uncompressed_size:
                        raise PreparedPackError(f"Restored size mismatch: {name}")
                    if sha256_file(path) != entry_by_name[name].sha256:
                        raise PreparedPackError(f"Restored hash mismatch: {name}")
            if target.exists():
                raise PreparedPackError(f"Restore destination appeared during restore: {target}")
            os.rename(staging_root, target)
            staging_root = None
    except (OSError, zipfile.BadZipFile, zipfile.LargeZipFile, RuntimeError) as exc:
        raise PreparedPackError(f"Could not restore prepared pack: {exc}") from exc
    return replace(report, restored_destination=target)


def _report_json(report: PreparedPackReport) -> str:
    return json.dumps(
        {
            "source_sha256": report.source_sha256,
            "normalized_entry_names": list(report.normalized_entry_names),
            "entries": [entry.__dict__ for entry in report.entries],
            "feature_counts": report.feature_counts,
            "restored_destination": str(report.restored_destination) if report.restored_destination else None,
        },
        indent=2,
        sort_keys=True,
    )


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    subparsers = parser.add_subparsers(dest="command", required=True)
    for command in ("inspect", "restore"):
        subparser = subparsers.add_parser(command)
        subparser.add_argument("--artifact", required=True, type=Path)
        subparser.add_argument("--expected-sha256", required=True)
        if command == "restore":
            subparser.add_argument("--destination", required=True, type=Path)
    args = parser.parse_args(argv)
    try:
        if args.command == "inspect":
            report = inspect_prepared_pack(args.artifact, args.expected_sha256)
        else:
            report = restore_prepared_pack(args.artifact, args.destination, args.expected_sha256)
    except PreparedPackError as exc:
        parser.error(str(exc))
    print(_report_json(report))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
