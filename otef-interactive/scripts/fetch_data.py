#!/usr/bin/env python3
import os
import sys
import zipfile
import requests
import shutil
from pathlib import Path
from tqdm import tqdm
import argparse

def download_file(url, target_path):
    """Download a file with a progress bar."""
    response = requests.get(url, stream=True)
    response.raise_for_status()
    total_size = int(response.headers.get('content-length', 0))

    with open(target_path, 'wb') as f, tqdm(
        desc=f"Downloading {os.path.basename(url)}",
        total=total_size,
        unit='B',
        unit_scale=True,
        unit_divisor=1024,
    ) as bar:
        for chunk in response.iter_content(chunk_size=8192):
            size = f.write(chunk)
            bar.update(size)

DEFAULT_SOURCE_URL = "https://github.com/NegevUrbanResearch/nur-cityscope/releases/download/layers/source.zip"
DEFAULT_PROCESSED_URL = "https://github.com/NegevUrbanResearch/nur-cityscope/releases/download/layers/processed.zip"


def pack_has_data(pack_dir):
    for path in pack_dir.rglob("*"):
        if path.is_file() and path.name != ".gitkeep":
            return True
    return False


def data_exists(output_dir):
    check_path = output_dir / "layers"
    if not check_path.exists():
        return False
    for entry in check_path.iterdir():
        if entry.is_dir() and entry.name != "example_layer_group" and pack_has_data(entry):
            return True
    return False


def fetch_zip(url, output_dir, force=False):
    if data_exists(output_dir) and not force:
        print(f"Data already exists at {output_dir / 'layers'}. Skipping (use --force to overwrite).")
        return

    output_dir.mkdir(parents=True, exist_ok=True)
    temp_zip = output_dir / "temp_data.zip"

    try:
        print(f"Fetching data from {url}...")
        download_file(url, temp_zip)

        print(f"Extracting to {output_dir}...")
        extract_zip(temp_zip, output_dir)

        print("Cleanup...")
        if temp_zip.exists():
            temp_zip.unlink()

        print(f"Successfully updated {output_dir}")
    except Exception as e:
        print(f"Error fetching data: {e}")
        if temp_zip.exists():
            temp_zip.unlink()
        raise


def extract_zip(zip_path, extract_path):
    """Extract a zip file, flattening if it contains a single top-level directory matching the target."""
    with zipfile.ZipFile(zip_path, 'r') as zip_ref:
        files = zip_ref.namelist()

        # Determine if we should flatten (if zip has a single root folder that matches target's basename)
        root_dirs = set(f.split('/')[0] for f in files if '/' in f)
        flatten_prefix = ""
        if len(root_dirs) == 1:
            root_dir = list(root_dirs)[0]
            if root_dir == os.path.basename(extract_path):
                flatten_prefix = root_dir + "/"

        with tqdm(desc="Extracting", total=len(files), unit='file') as bar:
            for file in files:
                # Skip the root directory entry itself if flattening
                if flatten_prefix and file == flatten_prefix:
                    bar.update(1)
                    continue

                # Strip prefix if flattening
                target_name = file[len(flatten_prefix):] if flatten_prefix else file
                if not target_name:
                    bar.update(1)
                    continue

                target_file_path = extract_path / target_name

                if file.endswith('/'):
                    target_file_path.mkdir(parents=True, exist_ok=True)
                else:
                    target_file_path.parent.mkdir(parents=True, exist_ok=True)
                    with zip_ref.open(file) as source, open(target_file_path, "wb") as target:
                        shutil.copyfileobj(source, target)
                bar.update(1)

def main():
    parser = argparse.ArgumentParser(description="Fetch and extract OTEF layer data")
    parser.add_argument("--url", default=DEFAULT_SOURCE_URL, help="URL of the zip file to download")
    parser.add_argument("--output", required=True, help="Output directory for extraction")
    parser.add_argument("--force", action="store_true", help="Force download even if data exists")

    args = parser.parse_args()
    output_dir = Path(args.output).resolve()

    try:
        fetch_zip(args.url, output_dir, force=args.force)
        if args.url == DEFAULT_SOURCE_URL and output_dir.name == "source":
            fetch_zip(DEFAULT_PROCESSED_URL, output_dir.parent / "processed", force=args.force)
    except Exception:
        sys.exit(1)

if __name__ == "__main__":
    main()
