import sys
import tempfile
import unittest
import zipfile
from pathlib import Path
from unittest.mock import patch


SCRIPTS_DIR = Path(__file__).resolve().parents[1]
if str(SCRIPTS_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPTS_DIR))

from fetch_data import choose_layer_release, data_exists, extract_zip, fetch_latest, install_staged  # noqa: E402


class FetchDataTests(unittest.TestCase):
    def test_chooses_latest_versioned_layer_release_with_both_assets(self):
        releases = [
            {"tag_name": "app-v9.0.0", "assets": []},
            {"tag_name": "layers-v1.2.0", "assets": [{"name": "source.zip"}]},
            {"tag_name": "layers-v1.0.0", "assets": [{"name": "source.zip"}, {"name": "processed.zip"}]},
            {"tag_name": "layers-v1.1.0", "assets": [{"name": "source.zip"}, {"name": "processed.zip"}]},
        ]
        self.assertEqual(choose_layer_release(releases)["tag_name"], "layers-v1.1.0")

    def test_existing_data_requires_real_files_not_gitkeep(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory) / "source"
            (root / "layers" / "nli").mkdir(parents=True)
            (root / "layers" / "nli" / ".gitkeep").touch()
            self.assertFalse(data_exists(root))
            (root / "layers" / "nli" / "people.geojson").write_text("{}", encoding="utf-8")
            self.assertTrue(data_exists(root))

    def test_extract_zip_flattens_matching_root_and_rejects_escape(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            good = root / "good.zip"
            with zipfile.ZipFile(good, "w") as archive:
                archive.writestr("source/layers/nli/people.geojson", "{}")
            extract_zip(good, root / "source")
            self.assertEqual((root / "source/layers/nli/people.geojson").read_text(), "{}")

            bad = root / "bad.zip"
            with zipfile.ZipFile(bad, "w") as archive:
                archive.writestr("source/../outside.txt", "bad")
            with self.assertRaises(ValueError):
                extract_zip(bad, root / "other")
            self.assertFalse((root / "outside.txt").exists())

    def test_install_staged_preserves_existing_data_without_force(self):
        with tempfile.TemporaryDirectory() as directory:
            public = Path(directory) / "public"
            staging = Path(directory) / "staging"
            for base in (public, staging):
                for name in ("source", "processed"):
                    (base / name / "layers").mkdir(parents=True)
                    (base / name / "layers" / "marker.txt").write_text(base.name)
            with self.assertRaises(FileExistsError):
                install_staged(staging, public, force=False)
            self.assertEqual((public / "source/layers/marker.txt").read_text(), "public")
            self.assertEqual((public / "processed/layers/marker.txt").read_text(), "public")

            install_staged(staging, public, force=True)
            self.assertEqual((public / "source/layers/marker.txt").read_text(), "staging")
            self.assertEqual((public / "processed/layers/marker.txt").read_text(), "staging")

    def test_fetch_latest_replaces_outdated_source_and_processed_as_a_pair(self):
        with tempfile.TemporaryDirectory() as directory:
            public = Path(directory) / "public"
            for name in ("source", "processed"):
                (public / name / "layers").mkdir(parents=True)
                (public / name / "layers" / "old.txt").write_text("old")

            def fake_download(_url, target, _digest):
                name = Path(target).stem
                with zipfile.ZipFile(target, "w") as archive:
                    archive.writestr(f"{name}/layers/new.txt", name)
                return "a" * 64

            release = {
                "tag_name": "layers-v1.1.0",
                "assets": [
                    {"name": "source.zip", "browser_download_url": "source", "digest": None},
                    {"name": "processed.zip", "browser_download_url": "processed", "digest": None},
                ],
            }
            with patch("fetch_data.latest_layer_release", return_value=release), patch(
                "fetch_data.download_file", side_effect=fake_download
            ) as download:
                self.assertTrue(fetch_latest(public))
                self.assertEqual(download.call_count, 2)
                self.assertFalse((public / "source/layers/old.txt").exists())
                self.assertFalse((public / "processed/layers/old.txt").exists())
                self.assertEqual((public / "source/layers/new.txt").read_text(), "source")
                self.assertEqual((public / "processed/layers/new.txt").read_text(), "processed")
                self.assertFalse(fetch_latest(public))
                self.assertEqual(download.call_count, 2)


if __name__ == "__main__":
    unittest.main()
