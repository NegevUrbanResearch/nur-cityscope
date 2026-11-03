import io
import random
import tempfile
import unittest
import zipfile
from pathlib import Path

from PIL import Image
from pypdf import PdfReader, PdfWriter
from pypdf.generic import DecodedStreamObject, DictionaryObject, NameObject, NumberObject

from scripts import nli_presentation_photos as photos


def jpeg(image):
    output = io.BytesIO()
    image.save(output, "JPEG", quality=95)
    return output.getvalue()


class NliPresentationPhotoTests(unittest.TestCase):
    def setUp(self):
        rng = random.Random(12)
        small = Image.frombytes("RGB", (8, 6), rng.randbytes(8 * 6 * 3))
        self.original = small.resize((256, 192))
        self.preview = self.original.resize((128, 96))
        self.candidate = ("ppt/media/photo.jpeg", jpeg(self.original))

    def test_matches_same_photo_at_higher_resolution(self):
        self.assertEqual(photos.match_original(self.preview, [self.candidate])[0], self.candidate[0])

    def test_rejects_unrelated_photos_and_smaller_originals(self):
        wrong = ("wrong.jpeg", jpeg(Image.new("RGB", (256, 192), "red")))
        smaller = ("small.jpeg", jpeg(self.preview.resize((64, 48))))
        self.assertIsNone(photos.match_original(self.preview, [wrong, smaller]))

    def test_rejects_ambiguous_matches(self):
        similar = ("similar.jpeg", jpeg(self.original.point(lambda value: min(255, value + 1))))
        self.assertIsNone(photos.match_original(self.preview, [self.candidate, similar]))

    def test_restores_image_without_changing_text_or_page_content(self):
        with tempfile.TemporaryDirectory() as directory:
            directory = Path(directory)
            pdf, pptx, output = [directory / name for name in ("source.pdf", "source.pptx", "render.pdf")]
            writer = PdfWriter()
            page = writer.add_blank_page(960, 540)
            image = DecodedStreamObject()
            image.set_data(jpeg(self.preview))
            image.update({NameObject(key): value for key, value in {
                "/Type": NameObject("/XObject"), "/Subtype": NameObject("/Image"),
                "/Filter": NameObject("/DCTDecode"), "/ColorSpace": NameObject("/DeviceRGB"),
                "/BitsPerComponent": NumberObject(8), "/Width": NumberObject(128), "/Height": NumberObject(96),
            }.items()})
            page[NameObject("/Resources")] = DictionaryObject({NameObject("/XObject"): DictionaryObject({NameObject("/Photo"): writer._add_object(image)})})
            content = DecodedStreamObject()
            content.set_data(b"q 240 0 0 180 100 100 cm /Photo Do Q")
            page[NameObject("/Contents")] = writer._add_object(content)
            writer.write(pdf)
            with zipfile.ZipFile(pptx, "w") as archive:
                archive.writestr("ppt/slides/_rels/slide1.xml.rels", '<Relationships><Relationship Target="../media/photo.jpeg" /></Relationships>')
                archive.writestr(*self.candidate)
            report = photos.restore_pptx_photos(pdf, pptx, output)
            result = PdfReader(output).pages[0]
            self.assertEqual(result.get_contents().get_data(), PdfReader(pdf).pages[0].get_contents().get_data())
            self.assertEqual(tuple(result.mediabox), (0, 0, 960, 540))
            self.assertEqual(result['/Resources']['/XObject']['/Photo']['/Width'], 256)
            self.assertEqual(len(report), 1)
            self.assertEqual(PdfReader(pdf).pages[0]['/Resources']['/XObject']['/Photo']['/Width'], 128)


if __name__ == "__main__":
    unittest.main()
