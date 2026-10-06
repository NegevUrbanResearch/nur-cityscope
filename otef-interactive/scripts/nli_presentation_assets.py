"""Prepare the approved local NLI presentation assets."""

import argparse
import hashlib
import json
import os
import re
import shutil
import subprocess
import struct
import uuid
import zipfile
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
EXPECTED_PDF_SHA256 = "cadc48656462a3d968a0ded6616dd5c380be6588399c68b9f3dbf637dc7b5114"
EXPECTED_PPTX_SHA256 = "edf994532d8e190ea45f5c7f5f7c26ebe27d2ef87cb574b65cb1ac1a0a31847c"
EXPECTED_SLIDES = tuple(f"ppt/slides/slide{number}.xml" for number in range(1, 35))
VIDEO_MEMBERS = {
    2: "ppt/media/media1.mp4",
    10: "ppt/media/media2.mp4",
    18: "ppt/media/media3.mp4",
    21: "ppt/media/media4.mp4",
    23: "ppt/media/media5.mp4",
    24: "ppt/media/media6.mp4",
}
SLIDE_WIDTH = 3840
SLIDE_HEIGHT = 2160


def validate_slide_resolution(path):
    with open(path, "rb") as image:
        header = image.read(24)
    if (len(header) != 24 or header[:8] != b"\x89PNG\r\n\x1a\n" or header[12:16] != b"IHDR"
            or struct.unpack(">II", header[16:24]) != (SLIDE_WIDTH, SLIDE_HEIGHT)):
        raise ValueError(f"Presentation PNG must be {SLIDE_WIDTH} x {SLIDE_HEIGHT}: {path.name}")


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


def _replace_artifacts(staged, output, names, extra_files=()):
    backups = {}
    installed = []
    try:
        artifacts = [(staged / name, output / name) for name in names] + list(extra_files)
        for index, (source, destination) in enumerate(artifacts):
            destination.parent.mkdir(parents=True, exist_ok=True)
            if destination.exists():
                backup = staged / f"previous-{index}"
                os.replace(destination, backup)
                backups[destination] = backup
            os.replace(source, destination)
            installed.append(destination)
    except Exception:
        for destination in reversed(installed):
            if destination.is_dir():
                shutil.rmtree(destination)
            else:
                destination.unlink()
        for destination, backup in backups.items():
            if backup.exists():
                os.replace(backup, destination)
        raise


def prepare_assets(pdf, pptx, output, pdfinfo="pdfinfo", pdftoppm="pdftoppm", restore_photos=False, manifest_path=None):
    pdf = Path(pdf)
    pptx = Path(pptx)
    output = Path(output)
    manifest = None
    if manifest_path is not None:
        manifest_path = Path(manifest_path)
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
        if not isinstance(manifest, dict) or not isinstance(manifest.get("deck"), dict):
            raise ValueError("Runtime manifest must have a deck object")
    validate_sources(pdf, pptx, pdfinfo)

    output.parent.mkdir(parents=True, exist_ok=True)
    output.mkdir(parents=True, exist_ok=True)
    staged = _create_staging_directory(output.parent)
    try:
        slides = staged / "slides"
        videos = staged / "videos"
        slides.mkdir()
        videos.mkdir()

        render_pdf = pdf
        photo_report = []
        if restore_photos:
            if __package__:
                from .nli_presentation_photos import restore_pptx_photos, write_template_pdf
            else:
                from nli_presentation_photos import restore_pptx_photos, write_template_pdf
            render_pdf = staged / "render.pdf"
            photo_report = restore_pptx_photos(pdf, pptx, render_pdf)
            template_pdf = staged / "template.pdf"
            write_template_pdf(pdf, template_pdf)
            subprocess.run(
                _command(pdftoppm, "-png", "-singlefile", "-scale-to-x", SLIDE_WIDTH,
                         "-scale-to-y", SLIDE_HEIGHT, template_pdf, staged / "slide-background"),
                check=True, capture_output=True, text=True,
            )
            validate_slide_resolution(staged / "slide-background.png")

        prefix = slides / "slide"
        subprocess.run(
            _command(pdftoppm, "-png", "-f", 1, "-l", 34, "-scale-to-x", SLIDE_WIDTH,
                     "-scale-to-y", SLIDE_HEIGHT, render_pdf, prefix),
            check=True,
            capture_output=True,
            text=True,
        )
        rendered = sorted(slides.glob("slide-*.png"))
        if [path.name for path in rendered] != _expected_slide_names():
            raise ValueError("PDF renderer must produce exactly slide-01.png through slide-34.png")
        for slide in rendered:
            validate_slide_resolution(slide)

        with zipfile.ZipFile(pptx) as archive:
            for slide, member in VIDEO_MEMBERS.items():
                destination = videos / f"slide-{slide:02}.mp4"
                with archive.open(member) as source, destination.open("wb") as target:
                    shutil.copyfileobj(source, target)

        staged_videos = sorted(videos.glob("*.mp4"))
        expected_videos = [f"slide-{slide:02}.mp4" for slide in VIDEO_MEMBERS]
        if [path.name for path in staged_videos] != expected_videos:
            raise ValueError("video extraction did not produce the exact approved files")

        names = ["slides", "videos"]
        version = hashlib.sha256()
        for path in rendered:
            version.update(bytes.fromhex(sha256_file(path)))
        if restore_photos:
            supplements = staged / "supplements"
            supplements.mkdir()
            background = supplements / "slide-background.png"
            os.replace(staged / "slide-background.png", background)
            version.update(bytes.fromhex(sha256_file(background)))
            names.append("supplements/slide-background.png")
        (staged / "photo-restoration.json").write_text(json.dumps(photo_report, indent=2) + "\n", encoding="utf-8")
        (staged / "asset-version.txt").write_text(version.hexdigest() + "\n", encoding="utf-8")
        names.extend(("photo-restoration.json", "asset-version.txt"))
        extra_files = []
        if manifest is not None:
            manifest["deck"]["assetVersion"] = version.hexdigest()
            staged_manifest = staged / "runtime-manifest.json"
            staged_manifest.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
            extra_files.append((staged_manifest, manifest_path))
        _replace_artifacts(staged, output, names, extra_files)
        result = {
            "slides": [output / "slides" / name for name in _expected_slide_names()],
            "videos": [output / "videos" / name for name in expected_videos],
        }
        if restore_photos:
            result["background"] = [output / "supplements" / "slide-background.png"]
        return result
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
    parser.add_argument("--restore-pptx-photos", action="store_true", help="Restore matching full-resolution PPTX photos before rendering (requires pypdf and Pillow)")
    parser.add_argument("--manifest", type=Path, help="Update this runtime manifest's image cache version after successful preparation")
    args = parser.parse_args(argv)
    result = prepare_assets(args.pdf, args.pptx, args.output, args.pdfinfo, args.pdftoppm,
                            args.restore_pptx_photos, args.manifest)
    print(json.dumps({key: [str(path) for path in paths] for key, paths in result.items()}, indent=2))


if __name__ == "__main__":
    main()
