import os
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path
import sys
from unittest.mock import patch

from scripts import nli_presentation_assets as assets


class NliPresentationAssetsTests(unittest.TestCase):
    def setUp(self):
        local_root = assets.ROOT / "public" / "local"
        local_root.mkdir(parents=True, exist_ok=True)
        self.temp = tempfile.TemporaryDirectory(dir=local_root)
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.pdf = self.root / "source.pdf"
        self.pptx = self.root / "source.pptx"
        self.pdf.write_bytes(b"synthetic pdf")
        self.create_deck(self.pptx)
        self.output = self.root / "local" / "presentations" / "nli"

    def create_deck(self, path, without=None):
        import zipfile

        with zipfile.ZipFile(path, "w") as archive:
            for slide in assets.EXPECTED_SLIDES:
                archive.writestr(slide, "<slide/>")
            for video in assets.VIDEO_MEMBERS.values():
                if video != without:
                    archive.writestr(video, b"video")

    def approved_fixture_hashes(self, pptx=None):
        return patch.object(
            assets,
            "sha256_file",
            side_effect=lambda path: (
                assets.EXPECTED_PPTX_SHA256
                if Path(path) == (pptx or self.pptx)
                else assets.EXPECTED_PDF_SHA256
            ),
        )

    def fake_pdfinfo(self, pages):
        script = self.root / f"pdfinfo-{pages}.py"
        script.write_text(
            "import sys\nprint('Pages: %s')\n" % pages,
            encoding="utf-8",
        )
        return [sys.executable, str(script)]

    def fake_pdftoppm(self, pages):
        script = self.root / f"pdftoppm-{pages}.py"
        script.write_text(
            "import pathlib, sys\n"
            "prefix = pathlib.Path(sys.argv[-1])\n"
            f"for page in range(1, {pages + 1}):\n"
            "    (prefix.parent / f'{prefix.name}-{page:02}.png').write_bytes(b'png')\n",
            encoding="utf-8",
        )
        return [sys.executable, str(script)]

    def deck_without(self, member):
        path = self.root / "deck-without-video.pptx"
        self.create_deck(path, without=member)
        return path

    def test_rejects_wrong_hash_before_creating_output(self):
        with patch.object(assets, "sha256_file", return_value="0" * 64):
            with self.assertRaisesRegex(ValueError, "PDF SHA-256"):
                assets.prepare_assets(self.pdf, self.pptx, self.output, self.fake_pdfinfo(34), self.fake_pdftoppm(34))
        self.assertFalse(self.output.exists())

    def test_rejects_33_or_35_pdf_pages(self):
        for pages in (33, 35):
            with self.subTest(pages=pages), self.approved_fixture_hashes(), self.assertRaisesRegex(ValueError, "exactly 34 pages"):
                assets.prepare_assets(self.pdf, self.pptx, self.output, self.fake_pdfinfo(pages), self.fake_pdftoppm(34))

    def test_rejects_missing_known_video_member(self):
        deck = self.deck_without("ppt/media/media5.mp4")
        with self.approved_fixture_hashes(pptx=deck), self.assertRaisesRegex(ValueError, "slide 24"):
            assets.prepare_assets(self.pdf, deck, self.output, self.fake_pdfinfo(34), self.fake_pdftoppm(34))

    def test_publishes_exact_runtime_names_only_after_complete_staging(self):
        with self.approved_fixture_hashes():
            result = assets.prepare_assets(self.pdf, self.pptx, self.output, self.fake_pdfinfo(34), self.fake_pdftoppm(34))
        self.assertEqual([path.name for path in result["slides"]], [f"slide-{n:02}.png" for n in range(1, 35)])
        self.assertEqual([path.name for path in result["videos"]], [
            "slide-02.mp4", "slide-10.mp4", "slide-18.mp4", "slide-23.mp4", "slide-24.mp4",
        ])

    @unittest.skipUnless(os.name == "nt" and shutil.which("node"), "Windows Node ACL check")
    def test_published_directories_are_readable_by_node(self):
        with self.approved_fixture_hashes():
            assets.prepare_assets(self.pdf, self.pptx, self.output, self.fake_pdfinfo(34), self.fake_pdftoppm(34))
        subprocess.run(
            ["node", "-e", "require('fs').readdirSync(process.argv[1])", str(self.output / "slides")],
            check=True,
            capture_output=True,
            text=True,
        )

if __name__ == "__main__":
    unittest.main()
