import math
from copy import deepcopy

from .projection_warp_schema import SIDES, validate_projection_warp, validate_projection_warp_v7
from .projection_relative_mesh import relative_triangle_error


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
    columns, rows = int(grid['columns']), int(grid['rows'])
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


def _uniform_v7_grid(grid, side):
    dimensions = SIDES.get(side)
    if dimensions is None or grid['columns'] != dimensions['columns'] or grid['rows'] != dimensions['rows']:
        return False
    return all(len(axis) == count and all(abs(value - index / (count - 1)) <= 1e-12 for index, value in enumerate(axis))
               for axis, count in ((grid['columnPositions'], grid['columns']), (grid['rowPositions'], grid['rows'])))


def _has_grid_control_vertices(mesh, grid):
    if not isinstance(mesh, dict) or not isinstance(mesh.get('vertices'), list) or not isinstance(mesh.get('triangles'), list):
        return False
    connected = set(mesh['triangles'])
    return all(any(index in connected and abs(point['s'] - s) <= 1e-12 and abs(point['t'] - t) <= 1e-12
                   for index, point in enumerate(mesh['vertices']))
               for t in grid['rowPositions'] for s in grid['columnPositions'])


def _requires_grid_preparation(mesh, warp, side):
    return (not _uniform_v7_grid(warp['grid'], side) or
            (warp.get('baseline', {}).get('type') == 'tdMesh' and
             not _has_grid_control_vertices(mesh, warp['grid'])))


def _prepare_v7_warp(warp, side, schema_version=None):
    grid = warp.get('grid') if isinstance(warp, dict) else None
    has_axes = isinstance(grid, dict) and ('columnPositions' in grid or 'rowPositions' in grid)
    if schema_version != 7 and not has_axes:
        return warp, False
    if side not in SIDES:
        raise ValueError('v7 warp evaluation requires explicit side')
    errors = validate_projection_warp_v7(warp, side)
    if errors: raise ValueError('invalid warp: ' + '; '.join(f'{path} {message}' for path, message in errors.items()))
    if warp['enabled'] and not _uniform_v7_grid(warp['grid'], side):
        return deepcopy(warp), True
    legacy = deepcopy(warp)
    legacy['grid'].pop('columnPositions')
    legacy['grid'].pop('rowPositions')
    return legacy, True


def evaluate_warp_point(x, y, warp, s=None, t=None, *, side=None, schema_version=None, mesh=None):
    """Evaluate a warp point: x/y are baseline destination and s/t are source coordinates.

    V7 evaluation requires explicit ``side``; ``schema_version=7`` also forces
    v7 validation when axis arrays are absent. Disabled v7 warps return [x, y]
    unchanged. Enabled uniform v7 grids use the legacy evaluator. Enabled
    nonlegacy grids require ``mesh`` to be the trusted original source TD
    baseline; the evaluator preserves triangle provenance and rejects a
    missing mesh rather than treating a prepared output as a new baseline.
    """
    prepared, is_v7 = _prepare_v7_warp(warp, side, schema_version)
    if is_v7 and warp.get('enabled') is False:
        return [x, y]
    if is_v7 and warp.get('enabled') and not _uniform_v7_grid(warp['grid'], side):
        if mesh is None: raise ValueError('configurable grid point evaluation requires a trusted source mesh')
        from .projection_grid_mesh import evaluate_grid_warp_point
        point=evaluate_grid_warp_point(mesh, warp, x if s is None else s, y if t is None else t)
        return [point['x'], point['y']]
    errors = validate_projection_warp(prepared, side or _side(prepared))
    if errors: raise ValueError('invalid warp: ' + '; '.join(f'{path} {message}' for path, message in errors.items()))
    return _create_evaluator(prepared)(x, y, x if s is None else s, y if t is None else t)


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
    if mesh.get('validationProfile') not in (None, 'relative-source-v1'): raise ValueError('projection mesh validation profile is unknown')
    vertices, triangles = mesh.get('vertices'), mesh.get('triangles')
    if not isinstance(vertices, list) or len(vertices) < 3 or not isinstance(triangles, list) or len(triangles) < 3 or len(triangles) % 3: raise ValueError('projection mesh geometry is incomplete')
    if len(vertices) > 65536: raise ValueError('projection mesh exceeds unsigned-short vertex capacity')
    for index, point in enumerate(vertices):
        if not isinstance(point, dict) or not all(isinstance(point.get(key), (int, float)) and not isinstance(point.get(key), bool) and math.isfinite(point[key]) for key in ('s', 't', 'x', 'y', 'u', 'v')): raise ValueError(f'projection mesh vertex {index} is non-finite')
        if not all(-RANGE_EPSILON <= point[key] <= 1 + RANGE_EPSILON for key in ('s', 't', 'u', 'v')): raise ValueError(f'projection mesh vertex {index} has invalid parameter coordinates')
        if not all(-1 - RANGE_EPSILON <= point[key] <= 2 + RANGE_EPSILON for key in ('x', 'y')): raise ValueError(f'projection mesh vertex {index} is outside safe extent [-1, 2]')
    for offset in range(0, len(triangles), 3):
        indices = triangles[offset:offset + 3]
        if not all(isinstance(value, int) and not isinstance(value, bool) and 0 <= value <= 65535 and value < len(vertices) for value in indices): raise ValueError(f'projection mesh triangle {offset // 3} has an invalid index')
        a, b, c = (vertices[index] for index in indices)
        area = (b['x'] - a['x']) * (c['y'] - a['y']) - (b['y'] - a['y']) * (c['x'] - a['x'])
        if mesh.get('validationProfile') == 'relative-source-v1':
            relative_error = relative_triangle_error(a, b, c)
            if relative_error == 'render': raise ValueError('render precision collapses or inverts a grid triangle')
            if relative_error: raise ValueError(f'projection mesh triangle {offset // 3} is inverted or degenerate')
        elif not area > AREA_EPSILON: raise ValueError(f'projection mesh triangle {offset // 3} is inverted or degenerate')
    if mesh.get('validationProfile') not in (None,'relative-source-v1'): raise ValueError('projection mesh validation profile is unknown')
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


def evaluate_warp_mesh(mesh, warp, *, side=None, schema_version=None):
    prepared, is_v7 = _prepare_v7_warp(warp, side, schema_version)
    resolved_side = side or (mesh.get('side') if isinstance(mesh, dict) else _side(prepared))
    source_validated = False
    if is_v7 and warp.get('enabled') is False:
        return validate_warp_mesh(create_full_frame_projection_mesh(resolved_side))
    if is_v7 and warp.get('enabled') and mesh is not None:
        validate_warp_mesh(mesh)
        source_validated = True
    if is_v7 and warp.get('enabled') and _requires_grid_preparation(mesh, warp, side):
        baseline=warp.get('baseline')
        if mesh is None and isinstance(baseline,dict) and baseline.get('type')=='identity': mesh=create_full_frame_projection_mesh(resolved_side)
        from .projection_grid_mesh import prepare_grid_warp_mesh
        return validate_warp_mesh(prepare_grid_warp_mesh(mesh, warp, side=resolved_side))
    warp = prepared
    if warp.get('enabled') is False:
        return validate_warp_mesh(create_full_frame_projection_mesh(resolved_side))
    baseline = warp.get('baseline')
    if mesh is None and isinstance(baseline, dict) and baseline.get('type') == 'identity': mesh = create_identity_projection_mesh(resolved_side)
    if not source_validated: validate_warp_mesh(mesh)
    errors = validate_projection_warp(warp, resolved_side or _side(warp, mesh.get('side', 'left')))
    if errors: raise ValueError('invalid warp: ' + '; '.join(f'{path} {message}' for path, message in errors.items()))
    evaluate = _create_evaluator(warp)
    result = deepcopy(mesh)
    for point in result['vertices']:
        point['x'], point['y'] = evaluate(point['x'], point['y'], point['s'], point['t'])
    return validate_warp_mesh(result)
