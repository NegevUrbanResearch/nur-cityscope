import copy
import json
import tempfile
from pathlib import Path
from unittest import TestCase

from backend.otef_narrative import load_presentation_manifest, presentation_segment


def valid_manifest():
    return {
        "version": 1,
        "deck": {"this": "is no longer validated by Django"},
        "videos": [],
        "segments": [
            {"id": "segev", "requiredNarrative": "segev", "range": [1, 8]},
            {"id": "nova_mor", "requiredNarrative": "nova", "range": [9, 11]},
            {"id": "nova_memorial", "requiredNarrative": "nova", "range": [12, 16]},
            {"id": "sderot", "requiredNarrative": "sderot", "range": [17, 21]},
            {"id": "shura", "requiredNarrative": None, "range": [22, 28]},
            {"id": "hostages", "requiredNarrative": "hostages", "range": [29, 34]},
        ],
    }


class OtefPresentationManifestTests(TestCase):
    def load_value(self, value):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "manifest.json"
            path.write_text(json.dumps(value), encoding="utf-8")
            return load_presentation_manifest(path)

    def test_loads_manifest_without_validating_unused_deck_fields(self):
        manifest = self.load_value(valid_manifest())
        self.assertEqual(manifest["segments"], valid_manifest()["segments"])

    def test_rejects_duplicate_or_empty_segment_ids(self):
        for label, mutate in (
            ("duplicate", lambda value: value["segments"][1].update(id="segev")),
            ("empty", lambda value: value["segments"][0].update(id="")),
        ):
            invalid = copy.deepcopy(valid_manifest())
            mutate(invalid)
            with self.subTest(label=label), self.assertRaisesRegex(ValueError, "segment IDs"):
                self.load_value(invalid)

    def test_rejects_unsupported_required_narratives(self):
        invalid = copy.deepcopy(valid_manifest())
        invalid["segments"][0]["requiredNarrative"] = "unknown"
        with self.assertRaisesRegex(ValueError, "unsupported required presentation narrative"):
            self.load_value(invalid)

    def test_segment_lookup_uses_only_fields_needed_by_narrative_command(self):
        manifest = valid_manifest()
        manifest["segments"][0].pop("range")
        self.assertEqual(self.load_value(manifest)["segments"][0]["id"], "segev")

        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "manifest.json"
            path.write_text(json.dumps(valid_manifest()), encoding="utf-8")
            nova_mor = presentation_segment("nova_mor", path)
            nova_memorial = presentation_segment("nova_memorial", path)
        self.assertEqual(nova_mor["requiredNarrative"], "nova")
        self.assertEqual(nova_memorial["requiredNarrative"], "nova")
