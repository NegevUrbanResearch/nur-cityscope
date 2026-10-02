"""Deterministic arbitrary source-coordinate sampling for trusted TD meshes."""

import math
import json

BIN_COUNT = 64
BARYCENTRIC_TOLERANCE = 1e-12
SOURCE_BOUND_TOLERANCE = BARYCENTRIC_TOLERANCE * 2
_CACHE_LIMIT = 8
_INDEX_CACHE = []


def fingerprint_baseline_mesh(mesh):
    """Return an exact JSON signature for source, destination, UV and triangle data."""
    if not isinstance(mesh, dict) or not isinstance(mesh.get('vertices'), list) or not isinstance(mesh.get('triangles'), list):
        return None
    values = [[vertex.get(key) if isinstance(vertex, dict) else None for key in ('s', 't', 'x', 'y', 'u', 'v')] for vertex in mesh['vertices']]
    return json.dumps([values, mesh['triangles']], separators=(',', ':'))


def _finite(value, label):
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise TypeError(f'{label} must be finite')
    if isinstance(value, float) and not math.isfinite(value):
        raise ValueError(f'{label} must be finite')


def _barycentric(point_s, point_t, a, b, c):
    area = (b['s'] - a['s']) * (c['t'] - a['t']) - (b['t'] - a['t']) * (c['s'] - a['s'])
    wa = ((b['s'] - point_s) * (c['t'] - point_t) - (b['t'] - point_t) * (c['s'] - point_s)) / area
    wb = ((point_s - a['s']) * (c['t'] - a['t']) - (point_t - a['t']) * (c['s'] - a['s'])) / area
    wc = 1 - wa - wb
    raw = (wa, wb, wc)
    if any(weight < -BARYCENTRIC_TOLERANCE or weight > 1 + BARYCENTRIC_TOLERANCE for weight in raw):
        return None
    weights = []
    for weight in raw:
        if abs(weight) <= BARYCENTRIC_TOLERANCE:
            weights.append(0)
        elif abs(weight - 1) <= BARYCENTRIC_TOLERANCE:
            weights.append(1)
        else:
            weights.append(weight)
    total = weights[0] + weights[1] + weights[2]
    return tuple(weight / total for weight in weights)


def _build_index(mesh, fingerprint):
    if not isinstance(mesh, dict) or not isinstance(mesh.get('vertices'), list):
        raise TypeError('baseline mesh must contain vertices and triangle indices')
    flat = mesh.get('triangles')
    vertices = mesh['vertices']
    if not isinstance(flat, list) or len(flat) % 3:
        raise TypeError('baseline mesh must contain a flat triangle index list')
    for vertex_index, vertex in enumerate(vertices):
        if not isinstance(vertex, dict):
            raise TypeError(f'baseline vertex {vertex_index} must be an object')
        for key in ('s', 't', 'x', 'y', 'u', 'v'):
            _finite(vertex.get(key), f'vertex {vertex_index}.{key}')
    bins = [[] for _ in range(BIN_COUNT * BIN_COUNT)]
    triangles = []
    for triangle_id in range(len(flat) // 3):
        ids = flat[triangle_id * 3:triangle_id * 3 + 3]
        if any(isinstance(value, bool) or not isinstance(value, int) or value < 0 or value >= len(vertices) for value in ids):
            raise ValueError(f'baseline triangle {triangle_id} has an invalid vertex index')
        points = tuple(vertices[index] for index in ids)
        area = (points[1]['s'] - points[0]['s']) * (points[2]['t'] - points[0]['t']) - (points[1]['t'] - points[0]['t']) * (points[2]['s'] - points[0]['s'])
        if not math.isfinite(area) or area <= 0:
            raise ValueError(f'baseline triangle {triangle_id} must have positive source orientation')
        triangles.append(points)
        raw_min_s = min(point['s'] for point in points)
        raw_max_s = max(point['s'] for point in points)
        raw_min_t = min(point['t'] for point in points)
        raw_max_t = max(point['t'] for point in points)
        s_expansion = SOURCE_BOUND_TOLERANCE * max(1, raw_max_s - raw_min_s)
        t_expansion = SOURCE_BOUND_TOLERANCE * max(1, raw_max_t - raw_min_t)
        min_s = max(0, raw_min_s - s_expansion)
        max_s = min(1, raw_max_s + s_expansion)
        min_t = max(0, raw_min_t - t_expansion)
        max_t = min(1, raw_max_t + t_expansion)
        if min_s > max_s or min_t > max_t:
            continue
        x0 = min(BIN_COUNT - 1, math.floor(min_s * BIN_COUNT))
        x1 = min(BIN_COUNT - 1, math.floor(max_s * BIN_COUNT))
        y0 = min(BIN_COUNT - 1, math.floor(min_t * BIN_COUNT))
        y1 = min(BIN_COUNT - 1, math.floor(max_t * BIN_COUNT))
        for y in range(y0, y1 + 1):
            for x in range(x0, x1 + 1):
                bins[y * BIN_COUNT + x].append(triangle_id)
    return {'mesh': mesh, 'fingerprint': fingerprint, 'vertices': vertices, 'triangles': triangles, 'bins': bins}


def _mesh_index(mesh, fingerprint=None):
    source_fingerprint = fingerprint if fingerprint is not None else fingerprint_baseline_mesh(mesh)
    for index, item in enumerate(_INDEX_CACHE):
        if item['mesh'] is mesh:
            if item['fingerprint'] == source_fingerprint:
                _INDEX_CACHE.append(_INDEX_CACHE.pop(index))
                return _INDEX_CACHE[-1]
            del _INDEX_CACHE[index]
            break
    item = _build_index(mesh, source_fingerprint)
    _INDEX_CACHE.append(item)
    if len(_INDEX_CACHE) > _CACHE_LIMIT:
        del _INDEX_CACHE[0]
    return item


def create_baseline_sampler(mesh, *, fingerprint=None):
    """Return ``sample(s, t, triangle_id=None)`` with x/y/u/v interpolation.

    An explicit triangle ID forces that provenance region and raises if it does
    not contain the point. Without one, all accepted candidates are examined
    and the lowest containing triangle ID wins.
    """
    if not isinstance(mesh, dict):
        raise TypeError('baseline mesh must be an object')
    index = _mesh_index(mesh, fingerprint)

    def sample(s, t, triangle_id=None):
        _finite(s, 's')
        _finite(t, 't')
        if s < 0 or s > 1 or t < 0 or t > 1:
            raise ValueError('source point is outside the covered [0, 1] domain')
        if triangle_id is not None:
            if isinstance(triangle_id, bool) or not isinstance(triangle_id, int) or not 0 <= triangle_id < len(index['triangles']):
                raise ValueError('triangle hint is invalid')
            candidates = (triangle_id,)
        else:
            x = min(BIN_COUNT - 1, math.floor(s * BIN_COUNT))
            y = min(BIN_COUNT - 1, math.floor(t * BIN_COUNT))
            candidates = sorted(set(index['bins'][y * BIN_COUNT + x]))
        for current_id in candidates:
            points = index['triangles'][current_id]
            weights = _barycentric(s, t, *points)
            if weights is None:
                if triangle_id is not None:
                    raise ValueError('requested triangle does not contain source point')
                continue
            result = {'s': s, 't': t, 'triangleId': current_id}
            for key in ('x', 'y', 'u', 'v'):
                result[key] = points[0][key] * weights[0] + points[1][key] * weights[1] + points[2][key] * weights[2]
            return result
        raise ValueError('source point is not covered by the baseline mesh')

    return sample
