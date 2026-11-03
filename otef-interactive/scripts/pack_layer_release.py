#!/usr/bin/env python3
"""Build and verify source.zip and processed.zip for a versioned layers release."""

import argparse
import hashlib
import zipfile
from pathlib import Path


def _sha256(stream):
    digest = hashlib.sha256()
    while chunk := stream.read(1024 * 1024):
        digest.update(chunk)
    return digest.hexdigest()


def _entries(root):
    if not (root / "layers").is_dir():
        raise ValueError(f"Missing layer directory: {root / 'layers'}")
    entries = sorted(root.rglob("*"), key=lambda path: path.relative_to(root).as_posix())
    for path in entries:
        if path.is_symlink():
            raise ValueError(f"Layer release cannot contain a symlink: {path}")
        if not (path.is_dir() or path.is_file()):
            raise ValueError(f"Unsupported layer entry: {path}")
    if not any(path.is_file() and path.name != ".gitkeep" for path in entries):
        raise ValueError(f"Layer directory contains no data: {root}")
    return entries


def _verify_archive(archive_path, root, entries):
    expected = {
        f"{root.name}/{path.relative_to(root).as_posix()}{'/' if path.is_dir() else ''}"
        for path in entries
    }
    expected.add(f"{root.name}/")
    with zipfile.ZipFile(archive_path) as archive:
        names = [info.filename for info in archive.infolist()]
        if len(names) != len(set(names)) or set(names) != expected:
            raise ValueError(f"Archive inventory differs from {root}")
        for path in entries:
            if not path.is_file():
                continue
            name = f"{root.name}/{path.relative_to(root).as_posix()}"
            if archive.getinfo(name).file_size != path.stat().st_size:
                raise ValueError(f"Archive size differs for {name}")
            with path.open("rb") as original, archive.open(name) as packed:
                if _sha256(original) != _sha256(packed):
                    raise ValueError(f"Archive contents differ for {name}")


def build_archives(public_dir, output_dir):
    public_dir = Path(public_dir).resolve()
    output_dir = Path(output_dir).resolve()
    roots = [public_dir / "source", public_dir / "processed"]
    if any(output_dir == root or root in output_dir.parents for root in roots):
        raise ValueError("Output directory must be outside source and processed trees")
    inventories = {root.name: _entries(root) for root in roots}
    output_dir.mkdir(parents=True, exist_ok=True)
    outputs = [output_dir / f"{root.name}.zip" for root in roots]
    if any(path.exists() for path in outputs):
        raise FileExistsError("Release archive already exists; use a new output directory")

    for root, output in zip(roots, outputs):
        try:
            with zipfile.ZipFile(output, "w", compression=zipfile.ZIP_DEFLATED, allowZip64=True) as archive:
                archive.writestr(f"{root.name}/", b"")
                for path in inventories[root.name]:
                    name = f"{root.name}/{path.relative_to(root).as_posix()}"
                    archive.write(path, name + ("/" if path.is_dir() else ""))
            _verify_archive(output, root, inventories[root.name])
        except Exception:
            output.unlink(missing_ok=True)
            raise
        print(f"Verified {output}: {sum(path.is_file() for path in inventories[root.name])} files")
    return outputs


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--public-dir", type=Path, default=Path(__file__).resolve().parents[1] / "public")
    parser.add_argument("--output-dir", type=Path, required=True)
    args = parser.parse_args()
    build_archives(args.public_dir, args.output_dir)


if __name__ == "__main__":
    main()
