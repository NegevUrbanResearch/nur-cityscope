"""Shared relative-source and Float32 render triangle validation."""
import math
import struct

EPSILON = 2.220446049250313e-16


def _area(a, b, c, x_key, y_key):
    ab_x, ab_y = b[x_key] - a[x_key], b[y_key] - a[y_key]
    ac_x, ac_y = c[x_key] - a[x_key], c[y_key] - a[y_key]
    product_a, product_b = ab_x * ac_y, ab_y * ac_x
    return product_a - product_b, 32 * EPSILON * (abs(product_a) + abs(product_b))


def relative_triangle_error(a, b, c):
    source, source_roundoff = _area(a, b, c, 's', 't')
    destination, destination_roundoff = _area(a, b, c, 'x', 'y')
    if not source > source_roundoff:
        return 'source'
    if not destination > destination_roundoff or not destination / source > 1e-9:
        return 'destination'

    def render(point):
        x = struct.unpack('f', struct.pack('f', 2 * point['x'] - 1))[0]
        y = struct.unpack('f', struct.pack('f', 1 - 2 * point['y']))[0]
        return {'x': (x + 1) / 2, 'y': (1 - y) / 2}

    rendered_a, rendered_b, rendered_c = map(render, (a, b, c))
    rendered, rendered_roundoff = _area(rendered_a, rendered_b, rendered_c, 'x', 'y')
    if not rendered > rendered_roundoff or not rendered / source > 1e-9:
        return 'render'
    return None


def validate_relative_source_triangle(a, b, c, *, source_error='source grid is numerically degenerate', destination_error='grid warp folds or collapses a triangle'):
    error = relative_triangle_error(a, b, c)
    if error == 'source':
        raise ValueError(source_error)
    if error == 'destination':
        raise ValueError(destination_error)
    if error == 'render':
        raise ValueError('render precision collapses or inverts a grid triangle')
    return True
