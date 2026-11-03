"""Restore matching original PPTX photos in a temporary PDF for rendering."""

import hashlib
import io
import posixpath
import xml.etree.ElementTree as ET
import zipfile

from PIL import Image, ImageChops, ImageStat
from pypdf import PdfReader, PdfWriter
from pypdf.generic import DecodedStreamObject, DictionaryObject, NameObject, NumberObject


def match_original(preview, candidates):
    """Require a unique visual match, larger dimensions and the same aspect ratio."""
    matches = []
    seen = set()
    thumbnail = preview.convert("RGB").resize((96, 96))
    for name, data in candidates:
        digest = hashlib.sha256(data).digest()
        if digest in seen:
            continue
        seen.add(digest)
        with Image.open(io.BytesIO(data)) as original:
            if original.mode != "RGB" or original.width <= preview.width or original.height <= preview.height:
                continue
            if abs((original.width / original.height) / (preview.width / preview.height) - 1) > 0.01:
                continue
            difference = ImageChops.difference(thumbnail, original.resize((96, 96)))
            error = sum(ImageStat.Stat(difference).mean) / 3
            matches.append((error, name, data))
    matches.sort(key=lambda match: match[0])
    if not matches or matches[0][0] > 5:
        return None
    if len(matches) > 1 and matches[1][0] - matches[0][0] < 2:
        return None
    return matches[0][1:]


def restore_pptx_photos(pdf, pptx, destination):
    """Only replace matching RGB JPEG resources; preserve every page content stream."""
    writer = PdfWriter(clone_from=pdf)
    report = []
    replaced = {}
    with zipfile.ZipFile(pptx) as archive:
        for number, page in enumerate(writer.pages, 1):
            relationships = ET.fromstring(archive.read(f"ppt/slides/_rels/slide{number}.xml.rels"))
            candidates = []
            for relationship in relationships:
                target = posixpath.normpath(posixpath.join("ppt/slides", relationship.get("Target", "")))
                if target.startswith("ppt/media/") and target.lower().endswith((".jpg", ".jpeg")):
                    candidates.append((target, archive.read(target)))
            for name, reference in page["/Resources"].get("/XObject", {}).items():
                image = reference.get_object()
                identity = id(image)
                if identity in replaced:
                    replaced[identity]["pages"].append(number)
                    continue
                if (image.get("/Subtype") != "/Image" or image.get("/Filter") != "/DCTDecode"
                        or image.get("/ColorSpace") != "/DeviceRGB" or image.get("/SMask") or image.get("/Decode")):
                    continue
                with Image.open(io.BytesIO(image.get_data())) as preview:
                    match = match_original(preview, candidates)
                    previous_size = list(preview.size)
                if match is None:
                    continue
                member, data = match
                with Image.open(io.BytesIO(data)) as original:
                    width, height = original.size
                # Keep the indirect resource and drawing commands, including clipping,
                # transforms and interpolation. JPEG data stays at its original quality.
                image[NameObject("/Width")] = NumberObject(width)
                image[NameObject("/Height")] = NumberObject(height)
                image[NameObject("/BitsPerComponent")] = NumberObject(8)
                image.pop("/DecodeParms", None)
                image._data = data
                image.decoded_self = None
                record = {"pages": [number], "resource": str(name), "original": member,
                          "previousSize": previous_size, "restoredSize": [width, height]}
                report.append(record)
                replaced[identity] = record
    writer.write(destination)
    rendered = PdfReader(destination)
    source = PdfReader(pdf)
    for before, after in zip(source.pages, rendered.pages, strict=True):
        if before.get_contents().get_data() != after.get_contents().get_data() or before.mediabox != after.mediabox:
            raise ValueError("Photo restoration must not change page content or dimensions")
    return report


def write_template_pdf(pdf, destination):
    """Render the approved shared background alone, without slide text or photos."""
    source = PdfReader(pdf).pages[0]
    backgrounds = [(name, reference) for name, reference in source["/Resources"]["/XObject"].items()
                   if reference.get_object().get("/Width") == 2844 and reference.get_object().get("/Height") == 1600]
    if not backgrounds:
        raise ValueError("Approved NLI slide background is missing")
    name, reference = backgrounds[0]
    writer = PdfWriter()
    page = writer.add_blank_page(960, 540)
    page[NameObject("/Resources")] = DictionaryObject({NameObject("/XObject"): DictionaryObject({
        name: reference.clone(writer),
    })})
    content = DecodedStreamObject()
    content.set_data(f"q 960 0 0 540 0 0 cm {name} Do Q".encode("ascii"))
    page[NameObject("/Contents")] = writer._add_object(content)
    writer.write(destination)
