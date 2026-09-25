import sys
import tempfile
import unittest
import zipfile
from pathlib import Path


SCRIPTS_DIR = Path(__file__).resolve().parents[1]
if str(SCRIPTS_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPTS_DIR))

from segev_video_extract import extract_video  # noqa: E402


class SegevVideoExtractTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.source = self.root / "source.pptx"
        self.output = self.root / "segev-slide-02.mp4"

    def tearDown(self):
        self.temp.cleanup()

    def make_deck(self, relationships, slide=b'<p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"/>', media=None):
        with zipfile.ZipFile(self.source, "w") as deck:
            deck.writestr("ppt/slides/slide2.xml", slide)
            deck.writestr("ppt/slides/_rels/slide2.xml.rels", relationships)
            for name, content in (media or {}).items():
                deck.writestr(name, content)

    def test_extracts_slide_two_video_using_relationship_target(self):
        rels = b'''<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
          <Relationship Id="rId9" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/video" Target="../media/renamed-video.mp4"/>
        </Relationships>'''
        self.make_deck(rels, b'<p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><a:videoFile r:link="rId9"/></p:sld>', {"ppt/media/renamed-video.mp4": b"real mp4 bytes"})

        result = extract_video(self.source, self.output)

        self.assertEqual(result, self.output)
        self.assertEqual(self.output.read_bytes(), b"real mp4 bytes")

    def test_reports_when_slide_two_has_no_video_relationship(self):
        self.make_deck(b'<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"/>')

        with self.assertRaisesRegex(ValueError, "video relationship"):
            extract_video(self.source, self.output)

    def test_reports_when_video_relationship_points_to_missing_media(self):
        rels = b'''<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
          <Relationship Id="rId9" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/video" Target="../media/missing.mp4"/>
        </Relationships>'''
        self.make_deck(rels, b'<p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><a:videoFile r:link="rId9"/></p:sld>')

        with self.assertRaisesRegex(ValueError, "media target"):
            extract_video(self.source, self.output)


if __name__ == "__main__":
    unittest.main()
