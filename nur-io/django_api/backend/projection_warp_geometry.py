import math
from copy import deepcopy

from .projection_warp_schema import SIDES, validate_projection_warp


EPSILON = 1e-9
AREA_EPSILON = 1e-5
RANGE_EPSILON = 1e-5


def _solve(matrix, values):
    rows = [row[:] + [values[index]] for index, row in enumerate(matrix)]
    for column in range(8):
        pivot = max(range(column, 8), key=lambda index: abs(rows[index][column]))
        if abs(rows[pivot][column]) <= EPSILON: raise ValueError('keystone corners produce a singular homography')
        rows[column], rows[pivot] = rows[pivot], rows[column]
        for row in range(column + 1, 8):
            factor = rows[row][column] / rows[column][column]
            for item in range(column, 9): rows[row][item] -= factor * rows[column][item]
    result = [0.0] * 8
    for row in range(7, -1, -1):
        result[row] = (rows[row][8] - sum(rows[row][column] * result[column] for column in range(row + 1, 8))) / rows[row][row]
    return result + [1.0]


def _homography(corners):
    matrix = []
    values = []
    for (x, y), (u, v) in zip(((0, 0), (1, 0), (0, 1), (1, 1)), corners):
        matrix.append([x, y, 1, 0, 0, 0, -x * u, -y * u]); values.append(u)
        matrix.append([0, 0, 0, x, y, 1, -x * v, -y * v]); values.append(v)
    return _solve(matrix, values)


def interpolate_grid_offset(s, t, grid):
    columns, rows = grid['columns'], grid['rows']
    x = min(1, max(0, s)) * (columns - 1)
    y = min(1, max(0, t)) * (rows - 1)
    x0, y0 = math.floor(x), math.floor(y)
    x1, y1 = min(columns - 1, x0 + 1), min(rows - 1, math.floor(y) + 1)
    fx, fy = x - x0, y - y0
    at = lambda column, row: grid['offsets'][row * columns + column]
    a, b, c, d = at(x0, y0), at(x1, y0), at(x0, y1), at(x1, y1)
    return [
        (a[0] * (1 - fx) + b[0] * fx) * (1 - fy) + (c[0] * (1 - fx) + d[0] * fx) * fy,
        (a[1] * (1 - fx) + b[1] * fx) * (1 - fy) + (c[1] * (1 - fx) + d[1] * fx) * fy,
    ]


def _side(warp, fallback='left'):
    return warp.get('side') or ('right' if warp.get('grid', {}).get('columns') == 8 else fallback)


def evaluate_warp_point(x, y, warp, s=None, t=None):
    errors = validate_projection_warp(warp, _side(warp))
    if errors: raise ValueError('invalid warp: ' + '; '.join(f'{path} {message}' for path, message in errors.items()))
    return _create_evaluator(warp)(x, y, x if s is None else s, y if t is None else t)


def _create_evaluator(warp):
    h = _homography(warp['keystone']['corners'])
    def evaluate(x, y, s, t):
        if not all(isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value) for value in (x, y)): raise ValueError('warp point must be finite')
        denominator = h[6] * x + h[7] * y + h[8]
        if not math.isfinite(denominator) or abs(denominator) <= EPSILON: raise ValueError('keystone projective denominator is invalid')
        point = [(h[0] * x + h[1] * y + h[2]) / denominator, (h[3] * x + h[4] * y + h[5]) / denominator]
        offset = interpolate_grid_offset(s, t, warp['grid'])
        result = [point[0] + offset[0], point[1] + offset[1]]
        if not all(math.isfinite(value) and -1 <= value <= 2 for value in result): raise ValueError('warped point is outside safe extent [-1, 2]')
        return result
    return evaluate


def validate_warp_mesh(mesh):
    if not isinstance(mesh, dict) or mesh.get('width') != 1920 or mesh.get('height') != 1080: raise ValueError('projection mesh must be 1920x1080')
    vertices, triangles = mesh.get('vertices'), mesh.get('triangles')
    if not isinstance(vertices, list) or len(vertices) < 3 or not isinstance(triangles, list) or len(triangles) < 3 or len(triangles) % 3: raise ValueError('projection mesh geometry is incomplete')
    for index, point in enumerate(vertices):
        if not isinstance(point, dict) or not all(isinstance(point.get(key), (int, float)) and not isinstance(point.get(key), bool) and math.isfinite(point[key]) for key in ('s', 't', 'x', 'y', 'u', 'v')): raise ValueError(f'projection mesh vertex {index} is non-finite')
        if not all(-RANGE_EPSILON <= point[key] <= 1 + RANGE_EPSILON for key in ('s', 't', 'u', 'v')): raise ValueError(f'projection mesh vertex {index} has invalid parameter coordinates')
        if not all(-1 - RANGE_EPSILON <= point[key] <= 2 + RANGE_EPSILON for key in ('x', 'y')): raise ValueError(f'projection mesh vertex {index} is outside safe extent [-1, 2]')
    for offset in range(0, len(triangles), 3):
        indices = triangles[offset:offset + 3]
        if not all(isinstance(value, int) and not isinstance(value, bool) and 0 <= value < len(vertices) for value in indices): raise ValueError(f'projection mesh triangle {offset // 3} has an invalid index')
        a, b, c = (vertices[index] for index in indices)
        area = (b['x'] - a['x']) * (c['y'] - a['y']) - (b['y'] - a['y']) * (c['x'] - a['x'])
        if not area > AREA_EPSILON: raise ValueError(f'projection mesh triangle {offset // 3} is inverted or degenerate')
    return mesh


def create_full_frame_projection_mesh(side='left'):
    return {
        'version': 1,
        'type': 'tdMesh',
        'side': side,
        'width': 1920,
        'height': 1080,
        'origin': 'top-left',
        'vertices': [
            {'s': 0, 't': 0, 'x': 0, 'y': 0, 'u': 0, 'v': 0},
            {'s': 1, 't': 0, 'x': 1, 'y': 0, 'u': 1, 'v': 0},
            {'s': 0, 't': 1, 'x': 0, 'y': 1, 'u': 0, 'v': 1},
            {'s': 1, 't': 1, 'x': 1, 'y': 1, 'u': 1, 'v': 1},
        ],
        'triangles': [0, 1, 2, 2, 1, 3],
    }


def create_identity_projection_mesh(side='left'):
    dimensions = SIDES.get(side)
    if dimensions is None: raise ValueError('side must be left or right')
    vertices = []
    for row in range(dimensions['rows']):
        for column in range(dimensions['columns']):
            s = column / (dimensions['columns'] - 1)
            t = row / (dimensions['rows'] - 1)
            vertices.append({'s': s, 't': t, 'x': s, 'y': t, 'u': s, 'v': t})
    triangles = []
    for row in range(dimensions['rows'] - 1):
        for column in range(dimensions['columns'] - 1):
            a = row * dimensions['columns'] + column
            b = a + 1
            c = a + dimensions['columns']
            d = c + 1
            triangles.extend((a, b, c, c, b, d))
    return {'version': 1, 'type': 'tdMesh', 'side': side, 'width': 1920, 'height': 1080, 'origin': 'top-left', 'logicalGrid': dimensions, 'vertices': vertices, 'triangles': triangles}


def evaluate_warp_mesh(mesh, warp):
    if warp.get('enabled') is False:
        side = mesh.get('side') if isinstance(mesh, dict) else _side(warp)
        return validate_warp_mesh(create_full_frame_projection_mesh(side))
    baseline = warp.get('baseline')
    if mesh is None and isinstance(baseline, dict) and baseline.get('type') == 'identity': mesh = create_identity_projection_mesh(_side(warp))
    validate_warp_mesh(mesh)
    errors = validate_projection_warp(warp, _side(warp, mesh.get('side', 'left')))
    if errors: raise ValueError('invalid warp: ' + '; '.join(f'{path} {message}' for path, message in errors.items()))
    evaluate = _create_evaluator(warp)
    result = deepcopy(mesh)
    for point in result['vertices']:
        point['x'], point['y'] = evaluate(point['x'], point['y'], point['s'], point['t'])
    return validate_warp_mesh(result)
