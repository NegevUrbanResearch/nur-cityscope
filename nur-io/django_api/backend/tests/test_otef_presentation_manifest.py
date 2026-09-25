import copy
import json
import tempfile
from pathlib import Path
from unittest import TestCase

from backend.otef_narrative import load_presentation_manifest, presentation_segment


def valid_manifest():
    return {
        "version": 1,
        "deck": {
            "path": "processed/presentations/nli/nur-model.pptx",
            "sha256": None,
            "slideCount": 33,
        },
        "segments": [
            {"id": "segev", "requiredNarrative": "segev", "range": [1, 8]},
            {"id": "nova_mor", "requiredNarrative": "nova", "range": [9, 11]},
            {"id": "nova_memorial", "requiredNarrative": "nova", "range": [12, 16]},
            {"id": "sderot", "requiredNarrative": "sderot", "range": [17, 20]},
            {"id": "shura", "requiredNarrative": None, "range": [21, 27]},
            {"id": "hostages", "requiredNarrative": "hostages", "range": [28, 33]},
        ],
    }


class OtefPresentationManifestTests(TestCase):
    def load_value(self, value):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "manifest.json"
            path.write_text(json.dumps(value), encoding="utf-8")
            return load_presentation_manifest(path)

    def test_loads_valid_pre_release_manifest(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "manifest.json"
            path.write_text(json.dumps(valid_manifest()), encoding="utf-8")
            manifest = load_presentation_manifest(path)
        self.assertEqual(manifest["segments"], valid_manifest()["segments"])

    def test_rejects_invalid_manifest_invariants(self):
        invalid_cases = []
        for label, mutate in (
            ("version", lambda value: value.update(version=2)),
            ("path", lambda value: value["deck"].update(path="../nur-model.pptx")),
            ("slide count", lambda value: value["deck"].update(slideCount=32)),
            ("hash", lambda value: value["deck"].update(sha256="G" * 64)),
            ("missing hash field", lambda value: value["deck"].pop("sha256")),
            ("duplicate IDs", lambda value: value["segments"][1].update(id="segev")),
            ("overlapping ranges", lambda value: value["segments"][1].update(range=[8, 11])),
            ("out-of-bounds ranges", lambda value: value["segments"][5].update(range=[28, 34])),
            ("unsupported narrative", lambda value: value["segments"][0].update(requiredNarrative="unknown")),
            ("missing narrative field", lambda value: value["segments"][0].pop("requiredNarrative")),
        ):
            invalid = copy.deepcopy(valid_manifest())
            mutate(invalid)
            invalid_cases.append((label, invalid))

        for label, invalid in invalid_cases:
            with self.subTest(label=label), self.assertRaises(ValueError):
                self.load_value(invalid)

    def test_nova_mor_and_memorial_have_distinct_ranges_and_same_narrative(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "manifest.json"
            path.write_text(json.dumps(valid_manifest()), encoding="utf-8")
            nova_mor = presentation_segment("nova_mor", path)
            nova_memorial = presentation_segment("nova_memorial", path)

        self.assertEqual(nova_mor["requiredNarrative"], "nova")
        self.assertEqual(nova_memorial["requiredNarrative"], "nova")
        self.assertNotEqual(nova_mor["range"], nova_memorial["range"])
