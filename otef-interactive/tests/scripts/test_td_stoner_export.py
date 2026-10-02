import importlib.util
import hashlib
import json
import tempfile
import unittest
from contextlib import ExitStack
from pathlib import Path
from unittest.mock import patch


ROOT = Path(__file__).resolve().parents[2]
EXPORTER_PATH = ROOT / "scripts" / "td-warp" / "export-stoner.py"
FIXTURE_PATH = ROOT / "tests" / "fixtures" / "td-variable-grid.json"
SPEC = importlib.util.spec_from_file_location("td_stoner_export", EXPORTER_PATH)
exporter = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(exporter)


def fixture_capture(side="left"):
    return json.loads(FIXTURE_PATH.read_text(encoding="utf-8"))[side]["capture"]


def fixture_side(side="left"):
    return json.loads(FIXTURE_PATH.read_text(encoding="utf-8"))[side]


def patch_capture_helpers(stack, capture, topology_text=None):
    supplied = {
        "evaluatedPositions": "index\tP(0)\tP(1)\tP(2)\n0\t0\t0\t0",
        "undeformedLattice": "index\tvindex\tuv(0)\tuv(1)\tuv(2)\n0\t0\t0\t0\t0",
        "topology": topology_text if topology_text is not None else capture["tables"]["topology"],
        "pointOffsets": "index\toffset\n0\t0",
        "keyOffsets": "index\toffset\n0\t0",
    }
    paths = {
        "/ui/controls/positions": "evaluatedPositions",
        "/project/uvOffset": "undeformedLattice",
        "/ui/controls/mainPoints": "topology",
        "/project/pointOffset": "pointOffsets",
        "/project/keyOffset": "keyOffsets",
    }
    stack.enter_context(patch.object(exporter, "_table", side_effect=lambda path: supplied[next(key for suffix, key in paths.items() if path.endswith(suffix))]))
    stack.enter_context(patch.object(exporter, "_camera_snapshot", return_value=capture["camera"]))
    stack.enter_context(patch.object(exporter, "_node_metadata", side_effect=lambda path: {"path": path, "parameters": capture["settings"]["parameters"]}))
    stack.enter_context(patch.object(exporter, "_evaluated_mesh", return_value=capture["evaluatedMesh"]))
    return supplied


def topology(columns, rows):
    headers = "index\trIndex\tl\tr\tt\tb"
    records = []
    for index in range(columns * rows):
        row, column = divmod(index, columns)
        rid = index * 10
        records.append("\t".join(map(str, [
            index, rid,
            -1 if column == 0 else rid - 1,
            -1 if column == columns - 1 else rid + 1,
            -1 if row == rows - 1 else rid + 2,
            -1 if row == 0 else rid + 3,
        ])))
    return "\n".join([headers, *records])


class LogicalGridTopologyTests(unittest.TestCase):
    def test_derives_variable_and_historical_rectangular_grids(self):
        for columns, rows in [(3, 4), (5, 3), (7, 7), (8, 7)]:
            with self.subTest(columns=columns, rows=rows):
                self.assertEqual(exporter.logical_grid_from_topology(topology(columns, rows)),
                                 {"columns": columns, "rows": rows})

    def test_reordered_rows_remain_valid_when_indexes_are_preserved(self):
        lines = topology(3, 4).splitlines()
        self.assertEqual(exporter.logical_grid_from_topology("\n".join([lines[0], *reversed(lines[1:])])),
                         {"columns": 3, "rows": 4})

    def test_rejects_invalid_indexes_boundaries_neighbors_and_ids(self):
        valid = topology(3, 4).splitlines()
        duplicate = valid.copy(); duplicate[-1] = valid[-2]
        missing = valid[:-1]
        sentinel = valid.copy(); cells = sentinel[2].split("\t"); cells[2] = "-1"; sentinel[2] = "\t".join(cells)
        noninteger = valid.copy(); noninteger[1] = "x" + "\t".join(valid[1].split("\t")[1:])
        too_negative = valid.copy(); cells = too_negative[1].split("\t"); cells[2] = "-2"; too_negative[1] = "\t".join(cells)
        cases = {
            "duplicate indexes": "\n".join(duplicate),
            "missing index": "\n".join(missing),
            "illegal boundary sentinel": "\n".join(sentinel),
            "noninteger ID": "\n".join(noninteger),
            "neighbor below sentinel": "\n".join(too_negative),
            "mismatched opposite boundaries": topology(3, 4).replace("1\t10\t9\t11", "1\t10\t-1\t11", 1),
        }
        for label, text in cases.items():
            with self.subTest(label=label), self.assertRaises(ValueError):
                exporter.logical_grid_from_topology(text)

    def test_rejects_ambiguous_tsv_shapes_and_unsafe_integer_text(self):
        valid = topology(3, 4)
        cases = [
            valid.replace("index\trIndex", "index\tindex"),
            valid.replace("0\t0\t-1", "0.0\t0\t-1", 1),
            valid.replace("0\t0\t-1", "0e0\t0\t-1", 1),
            valid.replace("0\t0\t-1", "0_0\t0\t-1", 1),
            valid.replace("0\t0\t-1", "9007199254740992\t0\t-1", 1),
            "index\trIndex\tl\tr\tt\tb\textra\n" + "\n".join(valid.splitlines()[1:]),
            "index\trIndex\tl\tr\tt\tb\n" + "\n".join(
                line + "\tignored" for line in valid.splitlines()[1:]),
            "index\trIndex\tl\tr\tt\tb\n" + "\n".join(
                line.rsplit("\t", 1)[0] for line in valid.splitlines()[1:]),
        ]
        for text in cases:
            with self.subTest(text=text[:80]), self.assertRaises(ValueError):
                exporter.logical_grid_from_topology(text)
        self.assertEqual(exporter.logical_grid_from_topology(valid + "\n\t \t \t \t \t "),
                         {"columns": 3, "rows": 4})

    def test_export_side_emits_captured_topology_without_mutating_source_tables(self):
        fixture = fixture_side("right")
        capture = fixture["capture"]
        with ExitStack() as stack, tempfile.TemporaryDirectory() as directory:
            supplied = patch_capture_helpers(stack, capture)
            source_copy = supplied.copy()
            path = exporter.export_side("right", "/fixture", directory)
            payload = json.loads(Path(path).read_text(encoding="utf-8"))
        self.assertEqual(payload["logicalGrid"], fixture["expectedMesh"]["logicalGrid"])
        self.assertEqual(payload["tables"]["topology"], capture["tables"]["topology"])
        self.assertEqual(payload["tableFingerprints"]["before"], payload["tableFingerprints"]["after"])
        self.assertEqual(payload["tableFingerprints"]["before"]["topology"],
                         hashlib.sha256(capture["tables"]["topology"].encode("utf-8")).hexdigest())
        self.assertEqual(Path(path).name, "right-raw.json")
        self.assertEqual(Path(path).parent, Path(directory))
        self.assertEqual(supplied, source_copy)
        self.assertEqual(len(payload["evaluatedMesh"]["points"]), len(capture["evaluatedMesh"]["points"]))

    def test_python_consumes_shared_json_fixture_and_checks_supplied_table_fingerprint(self):
        for side in ("left", "right"):
            with self.subTest(side=side):
                capture = fixture_capture(side)
                expected = fixture_side(side)["expectedMesh"]["logicalGrid"]
                self.assertEqual(exporter.logical_grid_from_topology(capture["tables"]["topology"]), expected)
                expected_hash = hashlib.sha256(capture["tables"]["topology"].encode("utf-8")).hexdigest()
                self.assertEqual(capture["tableFingerprints"]["before"], {"topology": expected_hash})
                self.assertEqual(capture["tableFingerprints"]["after"], {"topology": expected_hash})

    def test_export_side_wraps_topology_errors_with_side_and_operator_path(self):
        capture = fixture_capture("left")
        with ExitStack() as stack, tempfile.TemporaryDirectory() as directory:
            patch_capture_helpers(stack, capture, topology_text="invalid")
            with self.assertRaisesRegex(ValueError, r"left.*\/fixture\/ui\/controls\/mainPoints"):
                exporter.export_side("left", "/fixture", directory)


if __name__ == "__main__":
    unittest.main()
