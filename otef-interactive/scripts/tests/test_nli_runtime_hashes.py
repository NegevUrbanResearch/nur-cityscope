import hashlib
import json
import tempfile
import unittest
from pathlib import Path

from otef_layer_processing.orchestrator import ProcessingOrchestrator

PEOPLE = {
    "type": "FeatureCollection",
    "features": [
        {
            "type": "Feature",
            "properties": {"pid": 801, "name": "Shani Louk", "status": "Murdered in captivity"},
            "geometry": {"type": "Point", "coordinates": [34.55, 31.5]},
        }
    ],
}


def _sha256_upper(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest().upper()


class NliRuntimeHashStampTests(unittest.TestCase):
    def test_processing_people_overwrites_stale_runtime_geojson_hash(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source_gis = root / "source" / "source" / "layers" / "nli" / "gis"
            source_styles = root / "source" / "source" / "layers" / "nli" / "styles"
            output = root / "processed" / "layers" / "nli"
            source_gis.mkdir(parents=True)
            source_styles.mkdir(parents=True)
            output.mkdir(parents=True)
            (source_gis / "people.geojson").write_text(json.dumps(PEOPLE), encoding="utf-8")
            (output / "release-metadata.json").write_text(
                json.dumps(
                    {
                        "datasetVersion": "v1",
                        "runtimeArtifactHashes": {
                            "people.geojson": "DEADBEEF",
                            "people-search-index.json": "KEEPME",
                        },
                    }
                ),
                encoding="utf-8",
            )
            orchestrator = ProcessingOrchestrator(
                root / "source", output.parent, no_cache=True, max_workers=1
            )
            result = orchestrator.process_single_layer(
                {
                    "pack_id": "nli",
                    "geo_file": source_gis / "people.geojson",
                    "styles_dir": source_styles,
                    "pack_output": output,
                },
                30,
            )
            self.assertIsNotNone(result)
            written = output / "people.geojson"
            self.assertTrue(written.is_file())
            metadata = json.loads((output / "release-metadata.json").read_text(encoding="utf-8"))
            hashes = metadata["runtimeArtifactHashes"]
            self.assertEqual(hashes["people.geojson"], _sha256_upper(written))
            self.assertEqual(hashes["people-search-index.json"], "KEEPME")

    def test_stamp_is_a_no_op_when_release_metadata_is_missing(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source_gis = root / "source" / "source" / "layers" / "nli" / "gis"
            source_styles = root / "source" / "source" / "layers" / "nli" / "styles"
            output = root / "processed" / "layers" / "nli"
            source_gis.mkdir(parents=True)
            source_styles.mkdir(parents=True)
            output.mkdir(parents=True)
            (source_gis / "people.geojson").write_text(json.dumps(PEOPLE), encoding="utf-8")
            orchestrator = ProcessingOrchestrator(
                root / "source", output.parent, no_cache=True, max_workers=1
            )
            result = orchestrator.process_single_layer(
                {
                    "pack_id": "nli",
                    "geo_file": source_gis / "people.geojson",
                    "styles_dir": source_styles,
                    "pack_output": output,
                },
                30,
            )
            self.assertIsNotNone(result)
            self.assertFalse((output / "release-metadata.json").is_file())

    def test_stamp_people_search_index_hash_overwrites_keepme(self):
        from otef_layer_processing.nli_runtime_hashes import stamp_nli_runtime_artifact_hash
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory)
            (output / "people-search-index.json").write_text('{"people":[]}\n', encoding="utf-8")
            (output / "release-metadata.json").write_text(
                json.dumps({"datasetVersion": "v1", "runtimeArtifactHashes": {"people-search-index.json": "KEEPME"}}),
                encoding="utf-8",
            )
            self.assertTrue(stamp_nli_runtime_artifact_hash(output, "people-search-index.json"))
            hashes = json.loads((output / "release-metadata.json").read_text(encoding="utf-8"))["runtimeArtifactHashes"]
            self.assertEqual(hashes["people-search-index.json"], _sha256_upper(output / "people-search-index.json"))


if __name__ == "__main__":
    unittest.main()
