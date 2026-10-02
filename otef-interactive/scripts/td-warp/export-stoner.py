"""Read-only TouchDesigner Stoner baseline exporter.

Run this source in TouchDesigner Python (the ``op`` function is provided by TD).
It deliberately only reads evaluated DAT tables and parameters; it never saves,
changes parameters, or opens/closes projector windows.
"""

import hashlib
import json
import os
import re
from datetime import date


def _table(path):
    node = op(path)
    return node.text


def _node_metadata(path):
    node = op(path)
    return {
        "path": path,
        "type": node.type,
        "family": node.family,
        "parameters": {parameter.name: str(parameter.eval()) for parameter in node.pars()},
    }


def _evaluated_mesh(path):
    node = op(path)
    points = [[float(value) for value in point.P] for point in node.points]
    primitives = []
    for primitive in node.prims:
        vertices = []
        for vertex in primitive:
            vertices.append({"point": int(vertex.point.index), "uv": [float(vertex.uv.val[index]) for index in range(3)]})
        primitives.append(vertices)
    return {"points": points, "primitives": primitives}


def _matrix_values(matrix):
    values = [float(value) for value in matrix.vals]
    if len(values) != 16:
        raise ValueError("TD camera matrix must contain 16 values")
    return values


def _camera_snapshot(root, width, height):
    camera = op(root + "/render/cam1")
    geometry = op(root + "/render/offset")
    passthrough = op(root + "/render/passthrough")
    return {
        "width": width,
        "height": height,
        "projection": _matrix_values(camera.projection(width, height)),
        "world": _matrix_values(camera.worldTransform),
        "geometryWorld": _matrix_values(geometry.worldTransform),
        "passthroughWorld": _matrix_values(passthrough.worldTransform),
    }


def _table_fingerprints(tables):
    return {name: hashlib.sha256(text.encode("utf-8")).hexdigest() for name, text in tables.items()}


def logical_grid_from_topology(text):
    if not isinstance(text, str) or not text.strip():
        raise ValueError("Stoner logical topology is missing")
    lines = [line for line in text.replace("\r", "").split("\n") if line.strip()]
    headers = [value.strip() for value in lines[0].split("\t")]
    required = ("index", "rIndex", "l", "r", "t", "b")
    if (not headers or any(not value for value in headers) or len(set(headers)) != len(headers)
            or any(key not in headers for key in required)):
        raise ValueError("Stoner logical topology has unsupported headers")
    indexes = {key: headers.index(key) for key in required}
    records = []
    try:
        for line in lines[1:]:
            row = line.split("\t")
            if len(row) != len(headers):
                raise ValueError("Stoner logical topology has an invalid row width")
            record = {}
            for key, column in indexes.items():
                value = row[column].strip()
                if not re.fullmatch(r"[+-]?[0-9]+", value):
                    raise ValueError("Stoner topology requires textual integers")
                number = int(value)
                if abs(number) > 9007199254740991:
                    raise ValueError("Stoner topology IDs exceed the safe integer range")
                record[key] = number
            records.append(record)
    except (TypeError, ValueError, KeyError):
        raise ValueError("Stoner logical topology requires integer IDs and neighbors") from None
    records.sort(key=lambda row: row["index"])
    count = len(records)
    if not 4 <= count <= 65536:
        raise ValueError("Stoner logical topology has an unsupported point count")
    if [row["index"] for row in records] != list(range(count)):
        raise ValueError("Stoner logical indexes must cover every point exactly once")
    if len({row["rIndex"] for row in records}) != count or any(row["rIndex"] < 0 for row in records):
        raise ValueError("Stoner lattice indexes must be unique and nonnegative")
    if any(row[key] < -1 for row in records for key in ("l", "r", "t", "b")):
        raise ValueError("Stoner neighbor IDs must be >= -1")
    columns = sum(row["b"] == -1 for row in records)
    rows = sum(row["l"] == -1 for row in records)
    if columns < 2 or rows < 2 or columns * rows != count:
        raise ValueError("Stoner logical topology is not a supported rectangular grid")
    for index, row in enumerate(records):
        expected = {
            "l": index % columns == 0,
            "r": index % columns == columns - 1,
            "b": index // columns == 0,
            "t": index // columns == rows - 1,
        }
        if any((row[key] == -1) != absent for key, absent in expected.items()):
            raise ValueError("Stoner logical boundary pattern is inconsistent")
    return {"columns": columns, "rows": rows}


def export_side(side, root, output_directory):
    if side not in ("left", "right"):
        raise ValueError("side must be left or right")
    table_paths = {
        "evaluatedPositions": root + "/ui/controls/positions",
        "undeformedLattice": root + "/project/uvOffset",
        "topology": root + "/ui/controls/mainPoints",
        "pointOffsets": root + "/project/pointOffset",
        "keyOffsets": root + "/project/keyOffset",
    }
    before = _table_fingerprints({name: _table(path) for name, path in table_paths.items()})
    tables = {name: _table(path) for name, path in table_paths.items()}
    camera = _camera_snapshot(root, 1920, 1080)
    settings = _node_metadata(root + "/settingsUI")
    mesh = _evaluated_mesh(root + "/ui/controls/finalGeo")
    after = _table_fingerprints({name: _table(path) for name, path in table_paths.items()})
    if before != after:
        raise RuntimeError("TD tables changed during read-only capture")
    try:
        logical = logical_grid_from_topology(tables.get("topology"))
    except ValueError as error:
        raise ValueError("{} Stoner topology at {}: {}".format(side, table_paths["topology"], error)) from error
    payload = {
        "schemaVersion": 1,
        "side": side,
        "root": root,
        "capturedAt": date.today().isoformat(),
        "width": 1920,
        "height": 1080,
        "logicalGrid": logical,
        "camera": camera,
        "tableFingerprints": {"before": before, "after": after},
        "tables": tables,
        "settings": settings,
        "nodes": [
            _node_metadata(root + "/ui/controls/finalGeo"),
            _node_metadata(root + "/render"),
            _node_metadata(root + "/ui/controls/camTransform"),
            _node_metadata(root + "/render/cam1"),
            _node_metadata(root + "/render/offset"),
        ],
        "evaluatedMesh": mesh,
    }
    unsigned = json.dumps(payload, ensure_ascii=False, indent=2, sort_keys=True).encode("utf-8")
    payload["sha256"] = hashlib.sha256(unsigned).hexdigest()
    os.makedirs(output_directory, exist_ok=True)
    path = os.path.join(output_directory, side + "-raw.json")
    with open(path, "w", encoding="utf-8") as handle:
        json.dump(payload, handle, ensure_ascii=False, indent=2, sort_keys=True)
    return path


def export_active_baselines(output_directory):
    paths = {
        "left": "/project1/split_view/stoner",
        "right": "/project1/split_view/stoner1",
    }
    return {side: export_side(side, root, output_directory) for side, root in paths.items()}
