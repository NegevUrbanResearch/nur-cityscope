#!/usr/bin/env python3
"""Install a matching source/processed pair from the newest layer release."""

import argparse
import hashlib
import json
import re
import shutil
import sys
import tempfile
import zipfile
from pathlib import Path, PurePosixPath
from urllib.error import URLError
from urllib.request import Request, urlopen


RELEASES_API = "https://api.github.com/repos/NegevUrbanResearch/nur-cityscope/releases?per_page=100"
TAG_PATTERN = re.compile(r"layers-v(\d+)\.(\d+)\.(\d+)$")
ASSET_NAMES = ("source.zip", "processed.zip")
RECEIPT_NAME = ".layer-release.json"


def choose_layer_release(releases):
    candidates = []
    for release in releases:
        match = TAG_PATTERN.fullmatch(release.get("tag_name", ""))
        if not match or release.get("draft") or release.get("prerelease"):
            continue
        if set(ASSET_NAMES) <= {asset.get("name") for asset in release.get("assets", [])}:
            candidates.append((tuple(map(int, match.groups())), release))
    if not candidates:
        raise ValueError("No versioned layer release with source.zip and processed.zip was found")
    return max(candidates, key=lambda item: item[0])[1]


def latest_layer_release():
    request = Request(RELEASES_API, headers={"Accept": "application/vnd.github+json", "User-Agent": "nur-cityscope-layer-updater"})
    with urlopen(request, timeout=30) as response:
        return choose_layer_release(json.load(response))


def data_exists(output_dir):
    layers = Path(output_dir) / "layers"
    return layers.is_dir() and any(
        path.is_file() and path.name != ".gitkeep" for path in layers.rglob("*")
    )


def download_file(url, target_path, expected_digest=None):
    digest = hashlib.sha256()
    request = Request(url, headers={"User-Agent": "nur-cityscope-layer-updater"})
    with urlopen(request, timeout=120) as response, Path(target_path).open("wb") as output:
        while chunk := response.read(1024 * 1024):
            output.write(chunk)
            digest.update(chunk)
    actual = digest.hexdigest()
    if expected_digest and expected_digest != f"sha256:{actual}":
        raise ValueError(f"Download digest mismatch for {target_path}")
    return actual


def extract_zip(zip_path, extract_path):
    """Extract an archive whose sole top-level directory matches the target."""
    extract_path = Path(extract_path)
    seen = set()
    with zipfile.ZipFile(zip_path) as archive:
        for info in archive.infolist():
            parts = PurePosixPath(info.filename).parts
            if not parts or parts[0] != extract_path.name or any(part in (".", "..") for part in parts):
                raise ValueError(f"Unsafe or unexpected archive entry: {info.filename}")
            if (info.external_attr >> 16) & 0o170000 == 0o120000:
                raise ValueError(f"Symlink in archive: {info.filename}")
            relative = Path(*parts[1:])
            key = str(relative).casefold()
            if key in seen and relative != Path():
                raise ValueError(f"Duplicate archive entry: {info.filename}")
            seen.add(key)
            destination = extract_path / relative
            if info.is_dir():
                destination.mkdir(parents=True, exist_ok=True)
            elif relative != Path():
                destination.parent.mkdir(parents=True, exist_ok=True)
                with archive.open(info) as source, destination.open("wb") as target:
                    shutil.copyfileobj(source, target)
            else:
                raise ValueError(f"Invalid archive root file: {info.filename}")


def install_staged(staging, public_dir, force=False):
    staging, public_dir = Path(staging), Path(public_dir)
    names = ("source", "processed")
    if any((public_dir / name).exists() for name in names) and not force:
        raise FileExistsError("Existing layer directories require --force to replace")
    old, installed = [], []
    try:
        for name in names:
            current = public_dir / name
            if current.exists():
                backup = staging / f"backup-{name}"
                current.rename(backup)
                old.append((backup, current))
        for name in names:
            target = public_dir / name
            (staging / name).rename(target)
            installed.append((target, staging / name))
    except Exception:
        for target, original_stage in reversed(installed):
            target.rename(original_stage)
        for backup, original in reversed(old):
            backup.rename(original)
        raise


def fetch_latest(public_dir, force=False):
    public_dir = Path(public_dir)
    source, processed = public_dir / "source", public_dir / "processed"
    release = latest_layer_release()
    tag = release["tag_name"]
    receipt = processed / RECEIPT_NAME
    installed_tag = json.loads(receipt.read_text(encoding="utf-8")).get("tag") if receipt.is_file() else None
    if not force and data_exists(source) and data_exists(processed) and installed_tag == tag:
        print(f"Layer release {tag} is already installed.")
        return False

    assets = {asset["name"]: asset for asset in release["assets"] if asset.get("name") in ASSET_NAMES}
    public_dir.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="layer-release-", dir=public_dir) as temporary:
        staging = Path(temporary)
        digests = {}
        for name in ASSET_NAMES:
            asset = assets[name]
            archive_path = staging / name
            digests[name] = download_file(asset["browser_download_url"], archive_path, asset.get("digest"))
            extract_zip(archive_path, staging / name[:-4])
        if not all(data_exists(staging / name) for name in ("source", "processed")):
            raise ValueError("The release does not contain both populated layer trees")
        (staging / "processed" / RECEIPT_NAME).write_text(
            json.dumps({"tag": tag, "assets": digests}, indent=2) + "\n", encoding="utf-8"
        )
        install_staged(staging, public_dir, force=True)
    print(f"Installed source and processed layers from {tag}.")
    return True


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, required=True, help="Path to public/source")
    parser.add_argument("--force", action="store_true", help="Reinstall even when the latest release is already present")
    args = parser.parse_args()
    if args.output.name != "source":
        parser.error("--output must be the public/source directory")
    try:
        fetch_latest(args.output.parent, force=args.force)
    except (URLError, ValueError, OSError, zipfile.BadZipFile) as error:
        if not args.force and data_exists(args.output) and data_exists(args.output.parent / "processed"):
            print(f"Could not check layer releases ({error}); retaining existing local layers.")
            return
        print(f"Layer download failed: {error}", file=sys.stderr)
        raise SystemExit(1) from error


if __name__ == "__main__":
    main()
