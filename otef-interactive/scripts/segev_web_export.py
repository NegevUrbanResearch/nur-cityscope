"""Render the first eight pages of an NLI-supplied PDF for the Segev web slice."""

from __future__ import annotations

import argparse
import shutil
import subprocess
import tempfile
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "public/processed/presentations/nli/nur-model.pdf"
OUTPUT = ROOT / "public/processed/presentations/nli/segev-web"


def export_slides(source: Path, output: Path,
                  pdftoppm: str = "pdftoppm") -> list[Path]:
    """Render PDF pages 1–8 to PNG without starting a presentation app."""
    source = Path(source)
    output = Path(output)
    if not source.is_file():
        raise FileNotFoundError(f"Source PDF not found: {source}")
    with source.open("rb") as stream:
        if stream.read(5) != b"%PDF-":
            raise ValueError(f"Source is not a PDF: {source}")

    with tempfile.TemporaryDirectory(prefix="segev-slide-export-") as temp:
        temp_dir = Path(temp)
        prefix = temp_dir / "slide"
        subprocess.run([
            pdftoppm, "-f", "1", "-l", "8", "-png", "-r", "150",
            str(source), str(prefix),
        ], check=True, capture_output=True, text=True)
        generated = sorted(temp_dir.glob("slide-*.png"))
        if len(generated) != 8:
            raise RuntimeError(f"Poppler produced {len(generated)} PNGs for pages 1–8; expected 8")
        output.mkdir(parents=True, exist_ok=True)
        rendered = []
        for number, image in enumerate(generated, start=1):
            destination = output / f"slide-{number:02}.png"
            shutil.copyfile(image, destination)
            rendered.append(destination)
    return rendered


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", type=Path, default=SOURCE)
    parser.add_argument("--output", type=Path, default=OUTPUT)
    parser.add_argument("--pdftoppm", default=shutil.which("pdftoppm") or shutil.which("pdftoppm.exe"))
    args = parser.parse_args()
    if not args.pdftoppm:
        parser.error("Poppler pdftoppm is required (install it or pass --pdftoppm)")
    for path in export_slides(args.source, args.output, args.pdftoppm):
        print(path)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
