"""Prepare the approved local NLI presentation assets."""

import argparse
import hashlib
import json
import os
import re
import shutil
import subprocess
import uuid
import zipfile
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
EXPECTED_PDF_SHA256 = "1ce060dd9bb53d155c95f70f95b86e9ae36d013d3b4535fbb27c5fa8e4054b8c"
EXPECTED_PPTX_SHA256 = "6ed3d98badcaf8d48dc17334a599783349e008dfd04ea1c59e4b420e33a86837"
EXPECTED_SLIDES = tuple(f"ppt/slides/slide{number}.xml" for number in range(1, 35))
VIDEO_MEMBERS = {
    2: "ppt/media/media1.mp4",
    10: "ppt/media/media2.mp4",
    18: "ppt/media/media3.mp4",
    23: "ppt/media/media4.mp4",
    24: "ppt/media/media5.mp4",
}


def sha256_file(path):
    digest = hashlib.sha256()
    with open(path, "rb") as source:
        for block in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def _command(executable, *arguments):
    if isinstance(executable, (list, tuple)):
        return [*map(str, executable), *map(str, arguments)]
    return [str(executable), *map(str, arguments)]


def pdf_page_count(pdf, pdfinfo):
    result = subprocess.run(
        _command(pdfinfo, pdf), check=True, capture_output=True, text=True
    )
    match = re.search(r"^Pages:\s+(\d+)\s*$", result.stdout, re.MULTILINE)
    if match is None:
        raise ValueError("pdfinfo did not report the PDF page count")
    return int(match.group(1))


def validate_sources(pdf, pptx, pdfinfo):
    if sha256_file(pdf) != EXPECTED_PDF_SHA256:
        raise ValueError("PDF SHA-256 does not match the approved source")
    if sha256_file(pptx) != EXPECTED_PPTX_SHA256:
        raise ValueError("PPTX SHA-256 does not match the approved source")
    if pdf_page_count(pdf, pdfinfo) != 34:
        raise ValueError("PDF must contain exactly 34 pages")
    try:
        with zipfile.ZipFile(pptx) as archive:
            members = set(archive.namelist())
            slides = {
                name
                for name in members
                if re.fullmatch(r"ppt/slides/slide\d+\.xml", name)
            }
            if slides != set(EXPECTED_SLIDES):
                raise ValueError("PPTX must contain exactly slides 1–34")
            for slide, member in VIDEO_MEMBERS.items():
                if member not in members:
                    raise ValueError(f"PPTX is missing the video for slide {slide}")
    except zipfile.BadZipFile as error:
        raise ValueError("PPTX is not a valid ZIP archive") from error


def _expected_slide_names():
    return [f"slide-{number:02}.png" for number in range(1, 35)]


def _create_staging_directory(parent):
    for _attempt in range(10):
        staged = parent / f".nli-presentation-stage-{uuid.uuid4().hex}"
        try:
            staged.mkdir()
            return staged
        except FileExistsError:
            continue
    raise FileExistsError("could not create a unique presentation staging directory")


def _replace_directories(staged, output, names):
    backups = {}
    installed = []
    try:
        for name in names:
            destination = output / name
            if destination.exists():
                backup = staged / f"previous-{name}"
                os.replace(destination, backup)
                backups[name] = backup
            os.replace(staged / name, destination)
            installed.append(name)
    except Exception:
        for name in reversed(installed):
            shutil.rmtree(output / name, ignore_errors=True)
        for name, backup in backups.items():
            if backup.exists():
                os.replace(backup, output / name)
        raise


def prepare_assets(pdf, pptx, output, pdfinfo="pdfinfo", pdftoppm="pdftoppm"):
    pdf = Path(pdf)
    pptx = Path(pptx)
    output = Path(output)
    validate_sources(pdf, pptx, pdfinfo)

    output.parent.mkdir(parents=True, exist_ok=True)
    output.mkdir(parents=True, exist_ok=True)
    staged = _create_staging_directory(output.parent)
    try:
        slides = staged / "slides"
        videos = staged / "videos"
        slides.mkdir()
        videos.mkdir()

        prefix = slides / "slide"
        subprocess.run(
            _command(pdftoppm, "-png", "-f", 1, "-l", 34, pdf, prefix),
            check=True,
            capture_output=True,
            text=True,
        )
        rendered = sorted(slides.glob("slide-*.png"))
        if [path.name for path in rendered] != _expected_slide_names():
            raise ValueError("PDF renderer must produce exactly slide-01.png through slide-34.png")

        with zipfile.ZipFile(pptx) as archive:
            for slide, member in VIDEO_MEMBERS.items():
                destination = videos / f"slide-{slide:02}.mp4"
                with archive.open(member) as source, destination.open("wb") as target:
                    shutil.copyfileobj(source, target)

        staged_videos = sorted(videos.glob("*.mp4"))
        expected_videos = [f"slide-{slide:02}.mp4" for slide in VIDEO_MEMBERS]
        if [path.name for path in staged_videos] != expected_videos:
            raise ValueError("video extraction did not produce the exact approved files")

        _replace_directories(staged, output, ("slides", "videos"))
        return {
            "slides": [output / "slides" / name for name in _expected_slide_names()],
            "videos": [output / "videos" / name for name in expected_videos],
        }
    finally:
        shutil.rmtree(staged, ignore_errors=True)


def main(argv=None):
    source = ROOT / "public" / "local" / "presentations" / "nli" / "source"
    output = ROOT / "public" / "local" / "presentations" / "nli"
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--pdf", type=Path, default=source / "nur-model.pdf")
    parser.add_argument("--pptx", type=Path, default=source / "nur-model.pptx")
    parser.add_argument("--output", type=Path, default=output)
    parser.add_argument("--pdfinfo", default="pdfinfo")
    parser.add_argument("--pdftoppm", default="pdftoppm")
    args = parser.parse_args(argv)
    result = prepare_assets(args.pdf, args.pptx, args.output, args.pdfinfo, args.pdftoppm)
    print(json.dumps({key: [str(path) for path in paths] for key, paths in result.items()}, indent=2))


if __name__ == "__main__":
    main()
