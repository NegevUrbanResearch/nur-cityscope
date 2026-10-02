"""Deterministic clipped/refined render topology for configurable projection grids."""
import hashlib
import json
import math
import struct
from copy import deepcopy
from collections import OrderedDict

from .projection_baseline_sampler import create_baseline_sampler, fingerprint_baseline_mesh
from .projection_relative_mesh import validate_relative_source_triangle

VERTEX_CAP = 65536
MAX_DEPTH = 12
TOLERANCE_PX = 0.45
_EPS = 2.220446049250313e-16
_TOPOLOGY_CACHE = OrderedDict()
_FINAL_EVALUATION_CACHE = OrderedDict()
_TOPOLOGY_CACHE_LIMIT = 2
_FINAL_CACHE_LIMIT = 4


def _cross(a, b, c, first='s', second='t'):
    return (b[first] - a[first]) * (c[second] - a[second]) - (b[second] - a[second]) * (c[first] - a[first])


def _homography(corners):
    matrix, values = [], []
    for (x, y), (u, v) in zip(((0, 0), (1, 0), (0, 1), (1, 1)), corners):
        matrix.extend(([x, y, 1, 0, 0, 0, -x * u, -y * u], [0, 0, 0, x, y, 1, -x * v, -y * v]))
        values.extend((u, v))
    rows = [row[:] + [values[i]] for i, row in enumerate(matrix)]
    for column in range(8):
        pivot = max(range(column, 8), key=lambda r: abs(rows[r][column]))
        if abs(rows[pivot][column]) <= 1e-9:
            raise ValueError('keystone corners produce a singular homography')
        rows[column], rows[pivot] = rows[pivot], rows[column]
        for row in range(column + 1, 8):
            factor = rows[row][column] / rows[column][column]
            for item in range(column, 9):
                rows[row][item] -= factor * rows[column][item]
    result = [0.0] * 8
    for row in range(7, -1, -1):
        result[row] = (rows[row][8] - sum(rows[row][c] * result[c] for c in range(row + 1, 8))) / rows[row][row]
    return result + [1.0]


def _exact(point, triangle_id, sample, h, grid, known_baseline=None):
    baseline = known_baseline or sample(point['s'], point['t'], triangle_id)
    denominator = h[6] * baseline['x'] + h[7] * baseline['y'] + h[8]
    if not math.isfinite(denominator) or abs(denominator) <= 1e-9:
        raise ValueError('keystone projective denominator is invalid')
    x = (h[0] * baseline['x'] + h[1] * baseline['y'] + h[2]) / denominator
    y = (h[3] * baseline['x'] + h[4] * baseline['y'] + h[5]) / denominator
    xs, ys = grid['columnPositions'], grid['rowPositions']
    def locate(axis, p):
        lo, hi = 0, len(axis) - 1
        while lo + 1 < hi:
            mid = (lo + hi) // 2
            if axis[mid] <= p: lo = mid
            else: hi = mid
        if p == 1: lo = len(axis) - 2
        return lo, (p - axis[lo]) / (axis[lo + 1] - axis[lo])
    i, a = locate(xs, point['s']); j, b = locate(ys, point['t']); cols = int(grid['columns'])
    at = lambda col, row: grid['offsets'][row * cols + col]
    p00, p10, p01, p11 = at(i, j), at(i + 1, j), at(i, j + 1), at(i + 1, j + 1)
    for k in range(2):
        offset = ((1-a)*p00[k] + a*p10[k])*(1-b) + ((1-a)*p01[k] + a*p11[k])*b
        if k == 0: x += offset
        else: y += offset
    if not math.isfinite(x + y) or not -1 <= x <= 2 or not -1 <= y <= 2:
        raise ValueError('warped point is outside safe extent [-1, 2]')
    return {**baseline, 'baseX': baseline['x'], 'baseY': baseline['y'], 'x': x, 'y': y}


def _clip(poly, key, bound, greater):
    out = []
    for index, a in enumerate(poly):
        b = poly[(index + 1) % len(poly)]
        av, bv = a[key] - bound, b[key] - bound
        ai = av >= -1e-14 if greater else av <= 1e-14
        bi = bv >= -1e-14 if greater else bv <= 1e-14
        if ai: out.append(a)
        if ai != bi:
            ratio = (bound - a[key]) / (b[key] - a[key])
            p = {name: a[name] + (b[name] - a[name]) * ratio for name in ('s', 't', 'x', 'y', 'u', 'v')}
            p[key] = bound
            out.append(p)
    return [p for i, p in enumerate(out) if i == 0 or math.hypot(p['s']-out[i-1]['s'], p['t']-out[i-1]['t']) > 1e-14]


def _relative_positive(a, b, c):
    validate_relative_source_triangle(a, b, c)


def _fingerprint(value):
    payload = json.dumps(value, sort_keys=True, separators=(',', ':'), allow_nan=False).encode('utf-8')
    return hashlib.sha256(payload).hexdigest()


def _source_weights(a, b, c, s, t):
    denominator = _cross(a, b, c)
    wb = _cross(a, {'s': s, 't': t}, c) / denominator
    wc = _cross(a, b, {'s': s, 't': t}) / denominator
    wa = 1 - wb - wc
    if any(weight < -1e-12 or weight > 1 + 1e-12 for weight in (wa, wb, wc)):
        return None
    snapped = tuple(0.0 if abs(weight) <= 1e-12 else 1.0 if abs(weight - 1) <= 1e-12 else weight for weight in (wa, wb, wc))
    total = sum(snapped)
    return tuple(weight / total for weight in snapped)


def _expanded_face_bins(vertices, faces):
    bins = [[] for _ in range(64 * 64)]
    for face_id, face in enumerate(faces):
        points = [vertices[index] for index in face['v']]
        min_s, max_s = min(p['s'] for p in points), max(p['s'] for p in points)
        min_t, max_t = min(p['t'] for p in points), max(p['t'] for p in points)
        tolerance_s = 2e-12 * max(1, max_s - min_s)
        tolerance_t = 2e-12 * max(1, max_t - min_t)
        x0 = max(0, math.floor((min_s - tolerance_s) * 64)); x1 = min(63, math.floor((max_s + tolerance_s) * 64))
        y0 = max(0, math.floor((min_t - tolerance_t) * 64)); y1 = min(63, math.floor((max_t + tolerance_t) * 64))
        for y in range(y0, y1 + 1):
            for x in range(x0, x1 + 1):
                bins[y * 64 + x].append(face_id)
    return bins


def _global_source_points(xs, ys):
    points = [(x / 32, y / 32) for y in range(33) for x in range(33)]
    points.extend((s, t) for t in ys for s in xs)
    for row in range(len(ys) - 1):
        for col in range(len(xs) - 1):
            x0, x1, y0, y1 = xs[col], xs[col + 1], ys[row], ys[row + 1]
            points.extend((((x0+x1)/2,(y0+y1)/2),((3*x0+x1)/4,(3*y0+y1)/4),((x0+3*x1)/4,(3*y0+y1)/4),((3*x0+x1)/4,(y0+3*y1)/4),((x0+3*x1)/4,(y0+3*y1)/4)))
    return list(dict.fromkeys(points))


def _compile_source_probe_state(vertices, faces, xs, ys, sample):
    points, point_ids = [], {}

    def intern(s, t, triangle_id, baseline):
        key = (triangle_id, float(s).hex(), float(t).hex())
        if key in point_ids:
            return point_ids[key]
        def locate(axis, value):
            lo, hi = 0, len(axis) - 1
            while lo + 1 < hi:
                middle = (lo + hi) // 2
                if axis[middle] <= value: lo = middle
                else: hi = middle
            if value == 1: lo = len(axis) - 2
            return lo, (value - axis[lo]) / (axis[lo + 1] - axis[lo])
        col, fx = locate(xs, s); row, fy = locate(ys, t)
        point_id = len(points)
        points.append({'s': s, 't': t, 'triangleId': triangle_id, 'baseline': baseline,
                       'cellId': row * (len(xs) - 1) + col, 'fx': fx, 'fy': fy})
        point_ids[key] = point_id
        return point_id

    bins = _expanded_face_bins(vertices, faces)
    corner_baselines = [[sample(vertices[index]['s'], vertices[index]['t'], face['tri']) for index in face['v']] for face in faces]
    face_checks = []
    for face in faces:
        a, b, c = (vertices[index] for index in face['v'])
        locations = (((a['s']+b['s'])/2,(a['t']+b['t'])/2),((b['s']+c['s'])/2,(b['t']+c['t'])/2),((c['s']+a['s'])/2,(c['t']+a['t'])/2),((a['s']+b['s']+c['s'])/3,(a['t']+b['t']+c['t'])/3))
        face_checks.append([{'pointId': intern(s,t,face['tri'],sample(s,t,face['tri']))} for s,t in locations])
    global_checks = []
    for s, t in _global_source_points(xs, ys):
        bx, by = min(63, math.floor(s * 64)), min(63, math.floor(t * 64))
        incident = []
        for face_id in bins[by * 64 + bx]:
            face = faces[face_id]; a, b, c = (vertices[index] for index in face['v'])
            weights = _source_weights(a, b, c, s, t)
            if weights is not None:
                incident.append({'faceId': face_id, 'weights': weights, 'baseline': sample(s, t, face['tri'])})
        if not incident:
            raise ValueError('source grid sample is not covered by prepared triangles')
        owner = incident[0]
        owner['pointId'] = intern(s, t, faces[owner['faceId']]['tri'], owner['baseline'])
        global_checks.append({'owner': owner, 'incident': incident})
    return {'points': points, 'faceChecks': face_checks, 'cornerBaselines': corner_baselines, 'globalChecks': global_checks}


def _evaluate_compiled_probe(probe, h, cells):
    base = probe['baseline']
    denominator = h[6] * base['x'] + h[7] * base['y'] + h[8]
    if not math.isfinite(denominator) or abs(denominator) <= 1e-9:
        raise ValueError('keystone projective denominator is invalid')
    numerator_x = h[0] * base['x'] + h[1] * base['y'] + h[2]
    numerator_y = h[3] * base['x'] + h[4] * base['y'] + h[5]
    cell = cells[probe['cellId']]; fx, fy = probe['fx'], probe['fy']
    offset_x = ((1-fx)*cell['p00'][0]+fx*cell['p10'][0])*(1-fy)+((1-fx)*cell['p01'][0]+fx*cell['p11'][0])*fy
    offset_y = ((1-fx)*cell['p00'][1]+fx*cell['p10'][1])*(1-fy)+((1-fx)*cell['p01'][1]+fx*cell['p11'][1])*fy
    x, y = numerator_x / denominator + offset_x, numerator_y / denominator + offset_y
    if not math.isfinite(x+y) or not -1 <= x <= 2 or not -1 <= y <= 2:
        raise ValueError('warped point is outside safe extent [-1, 2]')
    return {**base, 'baseX': base['x'], 'baseY': base['y'], 'x': x, 'y': y}


def _build_initial_topology(mesh, grid, xs, ys, sample, h):
    vertices, lookup, faces = [], {}, []

    def add(point):
        q_s, q_t = math.floor(point['s'] * 1e12 + .5), math.floor(point['t'] * 1e12 + .5)
        key = (q_s, q_t)
        if key not in lookup:
            for delta_s in (-1, 0, 1):
                for delta_t in (-1, 0, 1):
                    neighbor = (q_s + delta_s, q_t + delta_t)
                    if neighbor in lookup:
                        key = neighbor
                        break
                if key in lookup:
                    break
        if key in lookup:
            old = vertices[lookup[key]]
            if math.hypot(old['s']-point['s'], old['t']-point['t']) > 1e-12 or any(abs(old[k]-point[k]) > 1e-9 for k in ('x','y','u','v')):
                raise ValueError('source grid is numerically degenerate')
            return lookup[key]
        if len(vertices) >= VERTEX_CAP:
            raise ValueError('mesh vertex capacity exceeded')
        lookup[key] = len(vertices)
        vertices.append(point)
        return len(vertices) - 1

    controls = []
    for t in ys:
        for s in xs:
            baseline = sample(s, t)
            controls.append(add(_exact({'s': s, 't': t}, baseline['triangleId'], sample, h, grid)))

    for offset in range(0, len(mesh['triangles']), 3):
        triangle_id = offset // 3
        triangle = [mesh['vertices'][index] for index in mesh['triangles'][offset:offset + 3]]
        if _cross(*triangle) <= 0:
            raise ValueError('source grid is numerically degenerate')
        min_s, max_s = min(p['s'] for p in triangle), max(p['s'] for p in triangle)
        min_t, max_t = min(p['t'] for p in triangle), max(p['t'] for p in triangle)
        for row in range(len(ys) - 1):
            if ys[row + 1] < min_t - 1e-14 or ys[row] > max_t + 1e-14:
                continue
            for col in range(len(xs) - 1):
                if xs[col + 1] < min_s - 1e-14 or xs[col] > max_s + 1e-14:
                    continue
                polygon = [dict(point) for point in triangle]
                polygon = _clip(_clip(_clip(_clip(polygon, 's', xs[col], True), 's', xs[col + 1], False), 't', ys[row], True), 't', ys[row + 1], False)
                if len(polygon) < 3:
                    continue
                denominators = []
                for point in polygon:
                    base = sample(point['s'], point['t'], triangle_id)
                    denominators.append(h[6] * base['x'] + h[7] * base['y'] + h[8])
                if any(not math.isfinite(value) or abs(value) <= 1e-9 for value in denominators) or any(math.copysign(1, value) != math.copysign(1, denominators[0]) for value in denominators):
                    raise ValueError('keystone projective denominator crosses a clipped grid region')

                origin = polygon[0]
                area_terms = []
                for index in range(1, len(polygon) - 1):
                    ab_s, ab_t = polygon[index]['s'] - origin['s'], polygon[index]['t'] - origin['t']
                    ac_s, ac_t = polygon[index + 1]['s'] - origin['s'], polygon[index + 1]['t'] - origin['t']
                    area_terms.append(ab_s * ac_t - ab_t * ac_s)
                area = sum(area_terms)
                area_round = 32 * _EPS * sum(abs(value) for value in area_terms)
                if area <= area_round:
                    continue

                center = {'s': sum(p['s'] for p in polygon) / len(polygon), 't': sum(p['t'] for p in polygon) / len(polygon)}
                ring = [add(_exact(point, triangle_id, sample, h, grid)) for point in polygon]
                center_baseline = sample(center['s'], center['t'], triangle_id)
                center_id = add(_exact(center, triangle_id, sample, h, grid, center_baseline))
                for index in range(len(ring)):
                    ids = [center_id, ring[index], ring[(index + 1) % len(ring)]]
                    a, b, c = (vertices[vertex_id] for vertex_id in ids)
                    source_area = _cross(a, b, c)
                    source_round = 32 * _EPS * (abs((b['s']-a['s'])*(c['t']-a['t'])) + abs((b['t']-a['t'])*(c['s']-a['s'])))
                    if source_area > source_round:
                        faces.append({'v': ids, 'tri': triangle_id, 'cell': row * (len(xs) - 1) + col, 'depth': 0})
    connected_vertices = {vertex_id for face in faces for vertex_id in face['v']}
    if any(control_id not in connected_vertices for control_id in controls):
        raise ValueError('grid control point is not connected to prepared triangles')
    return vertices, faces, controls


def _prepare_grid_warp_mesh_uncached(mesh, warp, *, side, tolerance_px=TOLERANCE_PX, _source_fingerprint=None, _mesh_fingerprint=None):
    """Clip TD faces at residual cells, then conformingly refine to sampled pixel tolerance."""
    if side not in ('left', 'right'): raise ValueError('v7 warp evaluation requires explicit side')
    if not isinstance(mesh, dict): raise ValueError('configurable grid requires a trusted source mesh')
    source_fingerprint = _source_fingerprint if _source_fingerprint is not None else fingerprint_baseline_mesh(mesh)
    mesh_fingerprint = _mesh_fingerprint
    if mesh_fingerprint is None:
        metadata = {key: value for key, value in mesh.items() if key not in ('vertices', 'triangles')}
        mesh_fingerprint = _fingerprint({'source': source_fingerprint, 'metadata': metadata})
    grid, sample = warp['grid'], create_baseline_sampler(mesh, fingerprint=source_fingerprint)
    h, xs, ys = _homography(warp['keystone']['corners']), grid['columnPositions'], grid['rowPositions']
    if any(axis[i]-axis[i-1] <= 1e-10 for axis in (xs,ys) for i in range(1,len(axis))):
        raise ValueError('source grid is numerically degenerate')
    original = [[mesh['vertices'][mesh['triangles'][index + offset]] for offset in range(3)] for index in range(0, len(mesh['triangles']), 3)]
    triangle_gradients = []
    for a, b, c in original:
        ds_b, dt_b, ds_c, dt_c = b['s']-a['s'], b['t']-a['t'], c['s']-a['s'], c['t']-a['t']
        determinant = ds_b * dt_c - dt_b * ds_c
        roundoff = 32 * _EPS * (abs(ds_b * dt_c) + abs(dt_b * ds_c))
        if not determinant > roundoff: raise ValueError('source grid is numerically degenerate')
        def derivative(key):
            delta_b, delta_c = b[key]-a[key], c[key]-a[key]
            return ((delta_b*dt_c-delta_c*dt_b)/determinant, (ds_b*delta_c-ds_c*delta_b)/determinant)
        x_s, x_t = derivative('x'); y_s, y_t = derivative('y')
        triangle_gradients.append((x_s, x_t, y_s, y_t))

    column_count = int(grid['columns'])
    cells = []
    for row in range(len(ys)-1):
        for col in range(len(xs)-1):
            at = lambda x,y: grid['offsets'][y*column_count+x]
            cells.append({'dx':xs[col+1]-xs[col],'dy':ys[row+1]-ys[row],'sx0':xs[col],'ty0':ys[row],
                          'p00':at(col,row),'p10':at(col+1,row),'p01':at(col,row+1),'p11':at(col+1,row+1)})

    def jacobian(point, tri_id, cell_id):
        x_s, x_t, y_s, y_t = triangle_gradients[tri_id]
        base = {'x':point['baseX'],'y':point['baseY']} if 'baseX' in point else sample(point['s'],point['t'],tri_id)
        W=h[6]*base['x']+h[7]*base['y']+h[8]; U=h[0]*base['x']+h[1]*base['y']+h[2]; V=h[3]*base['x']+h[4]*base['y']+h[5]
        if not math.isfinite(W) or abs(W)<=1e-9: raise ValueError('keystone projective denominator is invalid')
        hx=(h[0]*W-h[6]*U)/(W*W); hy=(h[1]*W-h[7]*U)/(W*W); vx=(h[3]*W-h[6]*V)/(W*W); vy=(h[4]*W-h[7]*V)/(W*W)
        cell=cells[cell_id]; dx,dy=cell['dx'],cell['dy']; a=(point['s']-cell['sx0'])/dx; b=(point['t']-cell['ty0'])/dy
        p00,p10,p01,p11=cell['p00'],cell['p10'],cell['p01'],cell['p11']
        rx=((p10[0]-p00[0])*(1-b)+(p11[0]-p01[0])*b)/dx; rtx=((p01[0]-p00[0])*(1-a)+(p11[0]-p10[0])*a)/dy
        ry=((p10[1]-p00[1])*(1-b)+(p11[1]-p01[1])*b)/dx; rty=((p01[1]-p00[1])*(1-a)+(p11[1]-p10[1])*a)/dy
        fxs=hx*x_s+hy*y_s+rx; fxt=hx*x_t+hy*y_t+rtx; fys=vx*x_s+vy*y_s+ry; fyt=vx*x_t+vy*y_t+rty
        product_a,product_b=fxs*fyt,fxt*fys; determinant=product_a-product_b
        if not all(math.isfinite(value) for value in (fxs,fxt,fys,fyt,determinant)) or not determinant>max(1e-9,32*_EPS*(abs(product_a)+abs(product_b))):
            raise ValueError('grid warp folds or collapses a triangle')
    topology_key = _fingerprint({'mesh': mesh_fingerprint, 'columns': xs, 'rows': ys})
    topology = _TOPOLOGY_CACHE.get(topology_key)
    if topology is None:
        initial_vertices, initial_faces, controls = _build_initial_topology(mesh, grid, xs, ys, sample, h)
        source_vertices = [{'s': point['s'], 't': point['t'], 'triangleId': point['triangleId']} for point in initial_vertices]
        topology = {'sourceVertices': source_vertices, 'faces': initial_faces, 'controls': controls}
        topology['probeState'] = _compile_source_probe_state(initial_vertices, initial_faces, xs, ys, sample)
        _TOPOLOGY_CACHE[topology_key] = topology
        while len(_TOPOLOGY_CACHE) > _TOPOLOGY_CACHE_LIMIT:
            _TOPOLOGY_CACHE.popitem(last=False)
    else:
        _TOPOLOGY_CACHE.move_to_end(topology_key)
    vertices = [_exact({'s': spec['s'], 't': spec['t']}, spec['triangleId'], sample, h, grid) for spec in topology['sourceVertices']]
    faces = [dict(face, v=list(face['v'])) for face in topology['faces']]
    controls = list(topology['controls'])
    probe_state = topology['probeState']
    for baselines in probe_state['cornerBaselines']:
        denominators = [h[6] * base['x'] + h[7] * base['y'] + h[8] for base in baselines]
        if any(not math.isfinite(value) or abs(value) <= 1e-9 for value in denominators) or any(math.copysign(1, value) != math.copysign(1, denominators[0]) for value in denominators):
            raise ValueError('keystone projective denominator crosses a clipped grid region')
    lookup = {(math.floor(point['s'] * 1e12 + .5), math.floor(point['t'] * 1e12 + .5)): index for index, point in enumerate(vertices)}
    def add(point):
        key = (math.floor(point['s'] * 1e12 + .5), math.floor(point['t'] * 1e12 + .5))
        existing = lookup.get(key)
        if existing is not None:
            old = vertices[existing]
            if math.hypot(old['s'] - point['s'], old['t'] - point['t']) > 1e-12 or any(abs(old[name] - point[name]) > 1e-9 for name in ('x', 'y', 'u', 'v')):
                raise ValueError('source grid is numerically degenerate')
            return existing
        if len(vertices) >= VERTEX_CAP:
            raise ValueError('mesh vertex capacity exceeded')
        lookup[key] = len(vertices)
        vertices.append(point)
        return len(vertices) - 1
    def midpoint(a, b, tri_id):
        point = {'s': (a['s']+b['s'])/2, 't': (a['t']+b['t'])/2}
        return _exact(point, tri_id, sample, h, grid)
    render_cache={}
    def render_point(point):
        cached=render_cache.get(id(point))
        if cached is not None:return cached
        x=struct.unpack('f',struct.pack('f',2*point['x']-1))[0]
        y=struct.unpack('f',struct.pack('f',1-2*point['y']))[0]
        cached=((x+1)/2,(1-y)/2);render_cache[id(point)]=cached;return cached
    def gpu_error(point, triangle, weights):
        rendered=[render_point(p) for p in triangle]
        x=sum(p[0]*weights[i] for i,p in enumerate(rendered));y=sum(p[1]*weights[i] for i,p in enumerate(rendered))
        return math.hypot((point['x']-x)*1920,(point['y']-y)*1080)
    edge_key = lambda a,b: (min(a,b), max(a,b))
    sampled_max = math.inf
    for iteration in range(MAX_DEPTH+1):
        candidate_points = [_evaluate_compiled_probe(probe, h, cells) for probe in probe_state['points']]
        marks=[]; mark_set=set(); edge_owners={}
        def mark_face(face):
            for i in range(3):
                key=edge_key(face['v'][i],face['v'][(i+1)%3])
                if key not in mark_set:mark_set.add(key);marks.append(key)
                edge_owners.setdefault(key,face['tri'])
        global_max = 0.0
        face_weights = ((.5,.5,0),(0,.5,.5),(.5,0,.5),(1/3,1/3,1/3))
        for face_id, face in enumerate(faces):
            a,b,c=(vertices[i] for i in face['v'])
            errors = []
            for probe, weights in zip(probe_state['faceChecks'][face_id], face_weights):
                point = candidate_points[probe['pointId']]
                jacobian(point, face['tri'], face['cell'])
                errors.append(gpu_error(point,(a,b,c),weights))
            global_max = max(global_max, *errors)
            if any(error > tolerance_px for error in errors): mark_face(face)
        for check in probe_state['globalChecks']:
            owner = check['owner']; owner_face = faces[owner['faceId']]
            exact = candidate_points[owner['pointId']]
            reference = None; owner_vertices = None; owner_weights = None; seen_regions = set()
            for incident in check['incident']:
                face = faces[incident['faceId']]; a,b,c=(vertices[i] for i in face['v'])
                weights = incident['weights']
                x = a['x']*weights[0]+b['x']*weights[1]+c['x']*weights[2]
                y = a['y']*weights[0]+b['y']*weights[1]+c['y']*weights[2]
                if reference is None: reference = (x,y)
                elif math.hypot(x-reference[0],y-reference[1]) > 1e-9: raise ValueError('prepared grid topology is not conforming')
                if incident['faceId'] == owner['faceId']:
                    owner_vertices, owner_weights = (a,b,c), weights
                region_key = (face['tri'], face['cell'])
                if region_key not in seen_regions:
                    seen_regions.add(region_key)
                    baseline = incident['baseline']
                    region_point = exact if face['tri'] == owner_face['tri'] else {**exact,'baseX':baseline['x'],'baseY':baseline['y']}
                    jacobian(region_point,face['tri'],face['cell'])
            if owner_vertices is None: raise ValueError('source grid sample is not covered by prepared triangles')
            error = gpu_error(exact,owner_vertices,owner_weights)
            global_max = max(global_max,error)
            if error > tolerance_px: mark_face(owner_face)
        sampled_max=global_max
        if not marks:
            if global_max>.5: raise ValueError('refinement did not meet 0.5px sampled tolerance')
            break
        if iteration==MAX_DEPTH: raise ValueError('refinement did not meet 0.5px sampled tolerance')
        if len(vertices)+len(marks)>VERTEX_CAP: raise ValueError('mesh vertex capacity exceeded')
        mids={}
        for key in marks:
            a,b=key
            mids[key]=add(midpoint(vertices[a],vertices[b],edge_owners[key]))
        next_faces=[]
        for face in faces:
            a,b,c=face['v'];ab=mids.get(edge_key(a,b));bc=mids.get(edge_key(b,c));ca=mids.get(edge_key(c,a)); count=sum(x is not None for x in (ab,bc,ca))
            def push(tri): next_faces.append({**face,'v':tri,'depth':face['depth']+1})
            if not count: next_faces.append(face)
            elif count==3: push((a,ab,ca));push((ab,b,bc));push((ca,bc,c));push((ab,bc,ca))
            elif count==1:
                if ab is not None: push((a,ab,c));push((ab,b,c))
                elif bc is not None: push((b,bc,a));push((bc,c,a))
                else: push((c,ca,b));push((ca,a,b))
            elif ab is not None and bc is not None: push((b,bc,ab));push((a,ab,c));push((ab,bc,c))
            elif bc is not None and ca is not None: push((c,ca,bc));push((b,bc,a));push((bc,ca,a))
            else: push((a,ab,ca));push((c,ca,b));push((ca,ab,b))
        faces=next_faces
        for face in faces:
            if face['depth']>MAX_DEPTH: raise ValueError('refinement depth exceeded')
            _relative_positive(*(vertices[i] for i in face['v']))
        probe_state = _compile_source_probe_state(vertices, faces, xs, ys, sample)
    return {**mesh,'validationProfile':'relative-source-v1','sampledMaxErrorPx':sampled_max,
            'vertices':[{key:p[key] for key in ('s','t','x','y','u','v')} for p in vertices],
            'triangles':[idx for f in faces for idx in f['v']]}


def prepare_grid_warp_mesh(mesh, warp, *, side, tolerance_px=TOLERANCE_PX):
    """Return a defensively copied, bounded-cache render mesh for this exact input."""
    if side not in ('left', 'right'): raise ValueError('v7 warp evaluation requires explicit side')
    if not isinstance(mesh, dict): raise ValueError('configurable grid requires a trusted source mesh')
    source_fingerprint = fingerprint_baseline_mesh(mesh)
    metadata = {key: value for key, value in mesh.items() if key not in ('vertices', 'triangles')}
    mesh_fingerprint = _fingerprint({'source': source_fingerprint, 'metadata': metadata})
    key = _fingerprint({'mesh': mesh_fingerprint, 'warp': warp, 'side': side, 'tolerance': tolerance_px})
    cached = _FINAL_EVALUATION_CACHE.get(key)
    if cached is not None:
        _FINAL_EVALUATION_CACHE.move_to_end(key)
        return deepcopy(cached)
    result = _prepare_grid_warp_mesh_uncached(mesh, warp, side=side, tolerance_px=tolerance_px,
                                              _source_fingerprint=source_fingerprint, _mesh_fingerprint=mesh_fingerprint)
    _FINAL_EVALUATION_CACHE[key] = deepcopy(result)
    while len(_FINAL_EVALUATION_CACHE) > _FINAL_CACHE_LIMIT:
        _FINAL_EVALUATION_CACHE.popitem(last=False)
    return result


def evaluate_grid_warp_point(mesh, warp, s, t):
    sample=create_baseline_sampler(mesh, fingerprint=fingerprint_baseline_mesh(mesh))
    return _exact({'s':s,'t':t},sample(s,t)['triangleId'],sample,_homography(warp['keystone']['corners']),warp['grid'])
