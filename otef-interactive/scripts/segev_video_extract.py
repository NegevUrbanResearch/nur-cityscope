"""Extract slide 2's embedded MP4 from the source PowerPoint package."""

from __future__ import annotations

import argparse
import posixpath
import shutil
import zipfile
from pathlib import Path
from xml.etree import ElementTree


ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "public/processed/presentations/nli/nur-model-with-video.pptx"
OUTPUT = ROOT / "public/processed/presentations/nli/segev-web/segev-slide-02.mp4"
REL_NS = "http://schemas.openxmlformats.org/package/2006/relationships"
P_NS = "http://schemas.openxmlformats.org/presentationml/2006/main"
A_NS = "http://schemas.openxmlformats.org/drawingml/2006/main"
R_NS = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"
VIDEO_REL_TYPE = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/video"


def extract_video(source: Path, output: Path) -> Path:
    """Copy slide 2's linked video media to output using its OOXML relationship."""
    source = Path(source)
    output = Path(output)
    if not source.is_file():
        raise FileNotFoundError(f"Source PPTX not found: {source}")

    slide_name = "ppt/slides/slide2.xml"
    rels_name = "ppt/slides/_rels/slide2.xml.rels"
    try:
        with zipfile.ZipFile(source) as deck:
            slide = ElementTree.fromstring(deck.read(slide_name))
            rels = ElementTree.fromstring(deck.read(rels_name))
            video_nodes = slide.findall(f".//{{{A_NS}}}videoFile")
            linked_ids = {node.get(f"{{{R_NS}}}link") for node in video_nodes}
            linked_ids.discard(None)
            relationships = {
                rel.get("Id"): rel
                for rel in rels.findall(f"{{{REL_NS}}}Relationship")
                if rel.get("Type") == VIDEO_REL_TYPE and rel.get("Id") in linked_ids
            }
            if not relationships:
                raise ValueError("Slide 2 has no linked video relationship")
            if len(relationships) > 1:
                raise ValueError("Slide 2 has multiple linked video relationships")

            target = next(iter(relationships.values())).get("Target")
            media_name = posixpath.normpath(posixpath.join("ppt/slides", target or ""))
            if media_name.startswith("../") or media_name.startswith("/"):
                raise ValueError(f"Slide 2 video relationship has invalid media target: {target}")
            try:
                media = deck.open(media_name)
            except KeyError as exc:
                raise ValueError(f"Slide 2 video relationship media target is missing: {media_name}") from exc

            output.parent.mkdir(parents=True, exist_ok=True)
            with media, output.open("wb") as destination:
                shutil.copyfileobj(media, destination)
    except KeyError as exc:
        raise ValueError(f"PPTX is missing required slide 2 package entry: {exc}") from exc
    except zipfile.BadZipFile as exc:
        raise ValueError(f"Source is not a valid PPTX archive: {source}") from exc
    return output


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", type=Path, default=SOURCE)
    parser.add_argument("--output", type=Path, default=OUTPUT)
    args = parser.parse_args()
    try:
        print(extract_video(args.source, args.output))
    except (FileNotFoundError, ValueError) as exc:
        parser.error(str(exc))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
