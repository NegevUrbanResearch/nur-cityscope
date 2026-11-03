import sys
import tempfile
import unittest
import zipfile
from pathlib import Path


SCRIPTS_DIR = Path(__file__).resolve().parents[1]
if str(SCRIPTS_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPTS_DIR))

from pack_layer_release import build_archives  # noqa: E402


class PackLayerReleaseTests(unittest.TestCase):
    def test_archives_preserve_every_file_under_extraction_roots(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            public = root / "public"
            (public / "source" / "layers" / "nli" / "gis").mkdir(parents=True)
            (public / "processed" / "layers" / "nli").mkdir(parents=True)
            (public / "source" / "popup-config.json").write_text("{}", encoding="utf-8")
            (public / "source" / "layers" / "nli" / "gis" / "אנשים.geojson").write_text("source", encoding="utf-8")
            (public / "processed" / "layers" / ".layer-cache.json").write_text("{}", encoding="utf-8")
            (public / "processed" / "layers" / "nli" / "people.geojson").write_text("processed", encoding="utf-8")

            build_archives(public, root / "release")

            with zipfile.ZipFile(root / "release" / "source.zip") as archive:
                self.assertEqual(
                    {entry.filename for entry in archive.infolist() if not entry.is_dir()},
                    {"source/popup-config.json", "source/layers/nli/gis/אנשים.geojson"},
                )
            with zipfile.ZipFile(root / "release" / "processed.zip") as archive:
                self.assertEqual(
                    {entry.filename for entry in archive.infolist() if not entry.is_dir()},
                    {"processed/layers/.layer-cache.json", "processed/layers/nli/people.geojson"},
                )

    def test_rejects_output_inside_a_layer_tree(self):
        with tempfile.TemporaryDirectory() as directory:
            public = Path(directory)
            (public / "source" / "layers").mkdir(parents=True)
            (public / "processed" / "layers").mkdir(parents=True)
            with self.assertRaises(ValueError):
                build_archives(public, public / "source" / "layers" / "release")


if __name__ == "__main__":
    unittest.main()
