"""Read-only TouchDesigner Stoner baseline exporter.

Run this source in TouchDesigner Python (the ``op`` function is provided by TD).
It deliberately only reads evaluated DAT tables and parameters; it never saves,
changes parameters, or opens/closes projector windows.
"""

import hashlib
import json
import os
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
    logical = {"columns": 7 if side == "left" else 8, "rows": 7}
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
