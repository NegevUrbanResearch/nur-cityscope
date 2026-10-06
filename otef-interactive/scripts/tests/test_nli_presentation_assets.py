import os
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path
import sys
import struct
from unittest.mock import patch

from scripts import nli_presentation_assets as assets


class NliPresentationAssetsTests(unittest.TestCase):
    def test_pins_the_october_6_sources_used_by_the_runtime_manifest(self):
        import json

        manifest = json.loads((assets.ROOT / "public/presentation/nli-presentation-manifest.json").read_text(encoding="utf-8"))
        self.assertEqual(assets.EXPECTED_PDF_SHA256, "cadc48656462a3d968a0ded6616dd5c380be6588399c68b9f3dbf637dc7b5114")
        self.assertEqual(assets.EXPECTED_PPTX_SHA256, "edf994532d8e190ea45f5c7f5f7c26ebe27d2ef87cb574b65cb1ac1a0a31847c")
        self.assertEqual(assets.EXPECTED_PDF_SHA256, manifest["deck"]["pdfSha256"])
        self.assertEqual(assets.EXPECTED_PPTX_SHA256, manifest["deck"]["pptxSha256"])

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

    def fake_pdftoppm(self, pages, dimensions=None):
        script = self.root / f"pdftoppm-{pages}.py"
        script.write_text(
            "import pathlib, sys, struct\n"
            "prefix = pathlib.Path(sys.argv[-1])\n" +
            (f"width, height = {dimensions!r}\n" if dimensions else
             "width = int(sys.argv[sys.argv.index('-scale-to-x') + 1]) if '-scale-to-x' in sys.argv else 2000\n"
             "height = int(sys.argv[sys.argv.index('-scale-to-y') + 1]) if '-scale-to-y' in sys.argv else 1125\n") +
            f"for page in range(1, {pages + 1}):\n"
            "    (prefix.parent / f'{prefix.name}-{page:02}.png').write_bytes(b'\\x89PNG\\r\\n\\x1a\\n' + struct.pack('>I',13) + b'IHDR' + struct.pack('>II',width,height))\n",
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
        deck = self.deck_without("ppt/media/media4.mp4")
        with self.approved_fixture_hashes(pptx=deck), self.assertRaisesRegex(ValueError, "slide 21"):
            assets.prepare_assets(self.pdf, deck, self.output, self.fake_pdfinfo(34), self.fake_pdftoppm(34))

    def test_publishes_exact_runtime_names_only_after_complete_staging(self):
        with self.approved_fixture_hashes():
            result = assets.prepare_assets(self.pdf, self.pptx, self.output, self.fake_pdfinfo(34), self.fake_pdftoppm(34))
        self.assertEqual([path.name for path in result["slides"]], [f"slide-{n:02}.png" for n in range(1, 35)])
        self.assertEqual([path.name for path in result["videos"]], [
            "slide-02.mp4", "slide-10.mp4", "slide-18.mp4", "slide-21.mp4", "slide-23.mp4", "slide-24.mp4",
        ])

    def test_renders_every_source_slide_at_3840_by_2160(self):
        with self.approved_fixture_hashes():
            result = assets.prepare_assets(self.pdf, self.pptx, self.output, self.fake_pdfinfo(34), self.fake_pdftoppm(34))
        for slide in result["slides"]:
            self.assertEqual(struct.unpack(">II", slide.read_bytes()[16:24]), (3840, 2160))

    def test_wrong_resolution_does_not_replace_existing_slides(self):
        previous = self.output / "slides" / "slide-01.png"
        previous.parent.mkdir(parents=True)
        previous.write_bytes(b"previous release")
        with self.approved_fixture_hashes(), self.assertRaisesRegex(ValueError, "3840.*2160"):
            assets.prepare_assets(self.pdf, self.pptx, self.output, self.fake_pdfinfo(34), self.fake_pdftoppm(34, (2000, 1125)))
        self.assertEqual(previous.read_bytes(), b"previous release")

    def test_publish_failure_rolls_back_slides_and_preserves_supplement_videos(self):
        staged = self.root / "staged"
        for base, data in ((staged, b"new"), (self.output, b"old")):
            for name in ("slides/slide-01.png", "supplements/slide-background.png", "supplements/video.mp4"):
                path = base / name
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_bytes(data)
        original_replace = os.replace
        def fail_background(source, destination):
            if Path(source) == staged / "supplements/slide-background.png":
                raise OSError("simulated publish failure")
            return original_replace(source, destination)
        with patch.object(assets.os, "replace", side_effect=fail_background), self.assertRaisesRegex(OSError, "publish failure"):
            assets._replace_artifacts(staged, self.output, ("slides", "supplements/slide-background.png"))
        for name in ("slides/slide-01.png", "supplements/slide-background.png", "supplements/video.mp4"):
            self.assertEqual((self.output / name).read_bytes(), b"old")

    def test_missing_manifest_does_not_publish_new_assets(self):
        previous = self.output / "slides" / "slide-01.png"
        previous.parent.mkdir(parents=True)
        previous.write_bytes(b"previous release")
        with self.approved_fixture_hashes(), self.assertRaises(FileNotFoundError):
            assets.prepare_assets(self.pdf, self.pptx, self.output, self.fake_pdfinfo(34), self.fake_pdftoppm(34),
                                  manifest_path=self.root / "missing.json")
        self.assertEqual(previous.read_bytes(), b"previous release")

    def test_manifest_publish_failure_rolls_back_images_and_cache_version(self):
        manifest = self.root / "runtime-manifest.json"
        manifest.write_text('{"deck":{"assetVersion":"previous"}}', encoding="utf-8")
        previous = self.output / "slides" / "slide-01.png"
        previous.parent.mkdir(parents=True)
        previous.write_bytes(b"previous release")
        original_replace = os.replace
        def fail_manifest(source, destination):
            if Path(source).name == "runtime-manifest.json" and Path(destination) == manifest:
                raise OSError("manifest replacement denied")
            return original_replace(source, destination)
        with self.approved_fixture_hashes(), patch.object(assets.os, "replace", side_effect=fail_manifest), self.assertRaisesRegex(OSError, "replacement denied"):
            assets.prepare_assets(self.pdf, self.pptx, self.output, self.fake_pdfinfo(34), self.fake_pdftoppm(34),
                                  manifest_path=manifest)
        self.assertEqual(previous.read_bytes(), b"previous release")
        self.assertEqual(manifest.read_text(encoding="utf-8"), '{"deck":{"assetVersion":"previous"}}')

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
