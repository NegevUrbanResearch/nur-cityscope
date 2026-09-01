import json
import subprocess
import sys
import tempfile
import unittest
import zipfile
import warnings
from pathlib import Path


SCRIPTS_DIR = Path(__file__).resolve().parents[1]
if str(SCRIPTS_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPTS_DIR))

from nli_prepared_pack import (  # noqa: E402
    PreparedPackError,
    inspect_prepared_pack,
    restore_prepared_pack,
    sha256_file,
)


EXPECTED_SHA = "a" * 64
GIS_NAMES = (
    "alarms",
    "investigation_polygons",
    "lines",
    "people",
    "people_names",
)
EXPECTED_FILES = {
    "nli/",
    "nli/gis/",
    "nli/styles/",
    "nli/gis/.gitkeep",
    "nli/styles/.gitkeep",
    *(f"nli/gis/{name}.geojson" for name in GIS_NAMES),
    *(f"nli/styles/{name}.lyrx" for name in GIS_NAMES),
}
EXPECTED_DIRECTORIES = {"nli/", "nli/gis/", "nli/styles/"}
EXPECTED_ENTRIES = EXPECTED_FILES | EXPECTED_DIRECTORIES
EXPECTED_FEATURE_COUNTS = {
    "investigation_polygons": 223,
    "lines": 68,
    "people": 1394,
    "people_names": 1394,
    "alarms": 190,
}


def _geojson(count=1):
    return {
        "type": "FeatureCollection",
        "features": [
            {
                "type": "Feature",
                "properties": {"OBJECTID": index + 1},
                "geometry": {"type": "Point", "coordinates": [34.0, 31.0]},
            }
            for index in range(count)
        ],
    }


def _write_fixture(path, entries=None, directory_payload=b"", directory_mode=None):
    supplied_entries = entries
    entries = entries or {
        name: (
            json.dumps(_geojson()).encode("utf-8")
            if name.endswith(".geojson")
            else b"{}"
        )
        for name in EXPECTED_FILES
        if not name.endswith("/")
    }
    with zipfile.ZipFile(path, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        names = EXPECTED_ENTRIES if supplied_entries is None else EXPECTED_DIRECTORIES | set(entries)
        for name in sorted(names):
            if name.endswith("/"):
                if directory_mode is None:
                    archive.writestr(name, directory_payload)
                else:
                    info = zipfile.ZipInfo(name)
                    info.external_attr = directory_mode << 16
                    archive.writestr(info, directory_payload)
            else:
                archive.writestr(name, entries[name])


class PreparedPackSafetyTests(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        self.root = Path(self.temp_dir.name)

    def tearDown(self):
        self.temp_dir.cleanup()

    def archive(self, entries=None, **fixture_options):
        path = self.root / "pack.zip"
        _write_fixture(path, entries, **fixture_options)
        return path

    def expected_hash(self, path):
        return sha256_file(path)

    def test_accepts_exact_allowlist_and_reports_entries(self):
        entries = {
            name: (
                json.dumps(_geojson(EXPECTED_FEATURE_COUNTS[Path(name).stem])).encode("utf-8")
                if name.endswith(".geojson")
                else b"{}"
            )
            for name in EXPECTED_FILES
            if not name.endswith("/")
        }
        path = self.archive(entries)
        report = inspect_prepared_pack(path, self.expected_hash(path))
        self.assertEqual(set(report.normalized_entry_names), EXPECTED_FILES)
        self.assertEqual(len(report.entries), len(EXPECTED_FILES))
        self.assertEqual(set(report.feature_counts), set(GIS_NAMES))

    def test_rejects_extra_entry(self):
        entries = {name: b"{}" for name in EXPECTED_FILES if not name.endswith("/")}
        entries["nli/gis/extra.geojson"] = b"{}"
        with self.assertRaises(PreparedPackError):
            inspect_prepared_pack(self.archive(entries), self.expected_hash(self.archive(entries)))

    def test_rejects_duplicate_name(self):
        path = self.root / "duplicate.zip"
        with warnings.catch_warnings():
            warnings.simplefilter("ignore", UserWarning)
            with zipfile.ZipFile(path, "w") as archive:
                for name in sorted(EXPECTED_FILES):
                    archive.writestr(name, b"" if name.endswith("/") else (b"{}" if name.endswith(".lyrx") else json.dumps(_geojson()).encode()))
                archive.writestr("nli/gis/people.geojson", json.dumps(_geojson()).encode())
        with self.assertRaises(PreparedPackError):
            inspect_prepared_pack(path, self.expected_hash(path))

    def test_rejects_case_collision(self):
        entries = {name: b"{}" for name in EXPECTED_FILES if not name.endswith("/")}
        entries["nli/gis/PEOPLE.geojson"] = b"{}"
        with self.assertRaises(PreparedPackError):
            inspect_prepared_pack(self.archive(entries), self.expected_hash(self.archive(entries)))

    def test_rejects_parent_traversal(self):
        path = self.root / "traversal.zip"
        with zipfile.ZipFile(path, "w") as archive:
            archive.writestr("../outside.txt", b"x")
        with self.assertRaises(PreparedPackError):
            inspect_prepared_pack(path, self.expected_hash(path))

    def test_rejects_absolute_path(self):
        path = self.root / "absolute.zip"
        with zipfile.ZipFile(path, "w") as archive:
            archive.writestr("/outside.txt", b"x")
        with self.assertRaises(PreparedPackError):
            inspect_prepared_pack(path, self.expected_hash(path))

    def test_rejects_encrypted_entry(self):
        path = self.archive()
        encrypted = self.root / "encrypted.zip"
        data = bytearray(path.read_bytes())
        # Set the encrypted bit on the first local and central headers.
        local = data.find(b"PK\x03\x04")
        central = data.find(b"PK\x01\x02")
        self.assertGreaterEqual(local, 0)
        self.assertGreaterEqual(central, 0)
        data[local + 6] |= 0x01
        data[central + 8] |= 0x01
        encrypted.write_bytes(data)
        with self.assertRaises(PreparedPackError):
            inspect_prepared_pack(encrypted, self.expected_hash(encrypted))

    def test_rejects_oversized_uncompressed_content(self):
        entries = {name: b"{}" for name in EXPECTED_FILES if not name.endswith("/")}
        entries["nli/gis/people.geojson"] = b"x" * (16 * 1024 * 1024 + 1)
        path = self.archive(entries)
        with self.assertRaises(PreparedPackError):
            inspect_prepared_pack(path, self.expected_hash(path))

    def test_rejects_nonempty_allowlisted_directory(self):
        path = self.archive(directory_payload=b"unexpected payload")
        with self.assertRaises(PreparedPackError):
            inspect_prepared_pack(path, self.expected_hash(path))

    def test_rejects_allowlisted_directory_with_invalid_mode(self):
        path = self.archive(directory_mode=0o120777)
        with self.assertRaises(PreparedPackError):
            inspect_prepared_pack(path, self.expected_hash(path))

    def test_rejects_wrong_source_hash(self):
        path = self.archive()
        with self.assertRaises(PreparedPackError):
            inspect_prepared_pack(path, "b" * 64)

    def test_restore_requires_new_destination_and_never_writes_public(self):
        path = self.archive()
        existing = self.root / "existing"
        existing.mkdir()
        with self.assertRaises(PreparedPackError):
            restore_prepared_pack(path, existing, self.expected_hash(path))

        public = SCRIPTS_DIR.parent / "public" / "review-source"
        with self.assertRaises(PreparedPackError):
            restore_prepared_pack(path, public, self.expected_hash(path))

    def test_restore_verifies_hashes_in_a_new_destination(self):
        entries = {
            name: (
                json.dumps(_geojson(EXPECTED_FEATURE_COUNTS[Path(name).stem])).encode("utf-8")
                if name.endswith(".geojson")
                else b"{}"
            )
            for name in EXPECTED_FILES
            if not name.endswith("/")
        }
        path = self.archive(entries)
        destination = self.root / "review-source" / "nli"
        destination.parent.mkdir()
        report = restore_prepared_pack(path, destination, self.expected_hash(path))
        self.assertEqual(report.restored_destination, destination.resolve())
        for entry in report.entries:
            if entry.name.endswith("/"):
                continue
            restored = destination / Path(entry.name).relative_to("nli")
            self.assertEqual(sha256_file(restored), entry.sha256)

    def test_restore_rejects_traversal_before_extraction(self):
        path = self.root / "traversal.zip"
        with zipfile.ZipFile(path, "w") as archive:
            archive.writestr("../escape.txt", b"not allowed")
        destination = self.root / "new-destination"
        with self.assertRaises(PreparedPackError):
            restore_prepared_pack(path, destination, self.expected_hash(path))
        self.assertFalse((self.root / "escape.txt").exists())


class PreparedPackCountTests(unittest.TestCase):
    def test_rejects_feature_count_mismatch(self):
        with tempfile.TemporaryDirectory() as temporary:
            path = Path(temporary) / "mismatched.zip"
            _write_fixture(path)
            with self.assertRaisesRegex(PreparedPackError, r"people_names.*1394"):
                inspect_prepared_pack(path, sha256_file(path))

    def test_expected_fixture_counts_are_part_of_the_contract(self):
        with tempfile.TemporaryDirectory() as temporary:
            path = Path(temporary) / "counted.zip"
            counts = {
                "investigation_polygons": 223,
                "lines": 68,
                "people": 1394,
                "people_names": 1394,
                "alarms": 190,
            }
            entries = {
                name: (
                    json.dumps(_geojson(counts[Path(name).stem])).encode("utf-8")
                    if name.endswith(".geojson")
                    else b"{}"
                )
                for name in EXPECTED_FILES
                if not name.endswith("/")
            }
            _write_fixture(path, entries)
            report = inspect_prepared_pack(path, sha256_file(path))
            self.assertEqual(report.feature_counts, counts)


class PreparedPackCliTests(unittest.TestCase):
    def test_cli_requires_explicit_artifact_and_hash(self):
        result = subprocess.run(
            [sys.executable, str(SCRIPTS_DIR / "nli_prepared_pack.py"), "inspect"],
            capture_output=True,
            text=True,
        )
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("--artifact", result.stderr)
        self.assertIn("--expected-sha256", result.stderr)


if __name__ == "__main__":
    unittest.main()
