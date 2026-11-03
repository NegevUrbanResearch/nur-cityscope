"""Pure editable-grid axis and residual resampling operations."""

import math

MIN_COUNT = 2
MAX_COUNT = 16


def _count(value, label='count'):
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise TypeError(f'{label} must be an integer from {MIN_COUNT} to {MAX_COUNT}')
    if isinstance(value, float) and not math.isfinite(value):
        raise ValueError(f'{label} must be finite')
    if value < MIN_COUNT or value > MAX_COUNT:
        raise ValueError(f'{label} must be an integer from {MIN_COUNT} to {MAX_COUNT}')
    if int(value) != value:
        raise ValueError(f'{label} must be an integer from {MIN_COUNT} to {MAX_COUNT}')
    return int(value)


def _finite(value, label):
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise TypeError(f'{label} must be a finite number')
    if isinstance(value, float) and not math.isfinite(value):
        raise ValueError(f'{label} must be finite')
    return value


def _axis(axis, expected_length=None, label='axis'):
    if not isinstance(axis, (list, tuple)) or not MIN_COUNT <= len(axis) <= MAX_COUNT:
        raise TypeError(f'{label} must contain 2–16 positions')
    if expected_length is not None and len(axis) != expected_length:
        raise TypeError(f'{label} length must match its count')
    previous = None
    for index, value in enumerate(axis):
        _finite(value, f'{label}[{index}]')
        if value < 0 or value > 1:
            raise ValueError(f'{label} positions must be within [0, 1]')
        if previous is not None and not value > previous:
            raise ValueError(f'{label} positions must increase strictly')
        previous = value
    if axis[0] != 0 or axis[-1] != 1:
        raise ValueError(f'{label} must start at 0 and end at 1')
    return axis


def uniform_axis(count):
    count = _count(count)
    return [index / (count - 1) for index in range(count)]


def grid_interval(axis, position):
    _axis(axis)
    _finite(position, 'position')
    p = min(1, max(0, position))
    if p == 1:
        return {'index': len(axis) - 2, 'fraction': 1}
    low, high = 0, len(axis) - 1
    while low + 1 < high:
        middle = (low + high) // 2
        if axis[middle] <= p:
            low = middle
        else:
            high = middle
    return {'index': low, 'fraction': (p - axis[low]) / (axis[low + 1] - axis[low])}


def _validated_grid(grid):
    if not isinstance(grid, dict):
        raise TypeError('grid must be an object')
    columns = _count(grid.get('columns'), 'columns')
    rows = _count(grid.get('rows'), 'rows')
    column_positions = grid.get('columnPositions')
    row_positions = grid.get('rowPositions')
    if 'columnPositions' not in grid:
        column_positions = uniform_axis(columns)
    else:
        _axis(column_positions, columns, 'columnPositions')
    if 'rowPositions' not in grid:
        row_positions = uniform_axis(rows)
    else:
        _axis(row_positions, rows, 'rowPositions')
    offsets = grid.get('offsets')
    if not isinstance(offsets, (list, tuple)) or len(offsets) != columns * rows:
        raise TypeError('grid offsets must match its row and column counts')
    for index, pair in enumerate(offsets):
        if not isinstance(pair, (list, tuple)) or len(pair) != 2:
            raise TypeError(f'grid offset {index} must contain two finite values')
        for value in pair:
            _finite(value, f'grid offset {index}')
            if value < -1 or value > 2:
                raise ValueError(f'grid offset {index} must be within [-1, 2]')
    return columns, rows, column_positions, row_positions


def sample_grid_offset(s, t, grid):
    _finite(s, 's')
    _finite(t, 't')
    columns, _, column_positions, row_positions = _validated_grid(grid)
    x = grid_interval(column_positions, s)
    y = grid_interval(row_positions, t)

    def at(column, row):
        return grid['offsets'][row * columns + column]

    p00 = at(x['index'], y['index'])
    p10 = at(x['index'] + 1, y['index'])
    p01 = at(x['index'], y['index'] + 1)
    p11 = at(x['index'] + 1, y['index'] + 1)
    result = []
    for component in range(2):
        top = p00[component] + (p10[component] - p00[component]) * x['fraction']
        bottom = p01[component] + (p11[component] - p01[component]) * x['fraction']
        result.append(top + (bottom - top) * y['fraction'])
    return result


def resample_grid(old_grid, new_column_positions, new_row_positions):
    _, _, old_columns, old_rows = _validated_grid(old_grid)
    _axis(new_column_positions, label='columnPositions')
    _axis(new_row_positions, label='rowPositions')
    offsets = [sample_grid_offset(s, t, old_grid) for t in new_row_positions for s in new_column_positions]
    result = dict(old_grid)
    result.update({
        'columns': len(new_column_positions),
        'rows': len(new_row_positions),
        'columnPositions': list(new_column_positions),
        'rowPositions': list(new_row_positions),
        'offsets': offsets,
    })
    return result


def _axis_key(axis):
    if axis == 'column':
        return 'columnPositions'
    if axis == 'row':
        return 'rowPositions'
    raise TypeError('axis must be "column" or "row"')


def insert_grid_line(grid, axis, position):
    key = _axis_key(axis)
    _finite(position, 'position')
    _, _, columns, rows = _validated_grid(grid)
    positions = list(columns if key == 'columnPositions' else rows)
    if not 0 < position < 1 or position in positions:
        raise ValueError('inserted grid line must be a distinct interior position')
    if len(positions) >= MAX_COUNT:
        raise ValueError('grid axis is already at its maximum count')
    positions.append(position)
    positions.sort()
    return resample_grid(grid, positions, rows) if key == 'columnPositions' else resample_grid(grid, columns, positions)


def remove_grid_line(grid, axis, index):
    key = _axis_key(axis)
    _, _, columns, rows = _validated_grid(grid)
    positions = list(columns if key == 'columnPositions' else rows)
    idx = _count_index(index)
    if idx <= 0 or idx >= len(positions) - 1:
        raise ValueError('only an interior grid line can be removed')
    if len(positions) <= MIN_COUNT:
        raise ValueError('grid axis is already at its minimum count')
    positions.pop(idx)
    return resample_grid(grid, positions, rows) if key == 'columnPositions' else resample_grid(grid, columns, positions)


def _count_index(value):
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise TypeError('index must be an integer')
    if isinstance(value, float) and not math.isfinite(value):
        raise ValueError('index must be finite')
    if value < 0 or value > MAX_COUNT or int(value) != value:
        raise ValueError('index must be a bounded integer')
    return int(value)


def move_grid_line(grid, axis, index, position):
    key = _axis_key(axis)
    _finite(position, 'position')
    _, _, columns, rows = _validated_grid(grid)
    positions = list(columns if key == 'columnPositions' else rows)
    idx = _count_index(index)
    if idx <= 0 or idx >= len(positions) - 1:
        raise ValueError('only an interior grid line can be moved')
    if not positions[idx - 1] < position < positions[idx + 1]:
        raise ValueError('grid line must remain strictly between its neighbors')
    positions[idx] = position
    return resample_grid(grid, positions, rows) if key == 'columnPositions' else resample_grid(grid, columns, positions)


def uniform_grid(grid, columns=None, rows=None):
    current_columns, current_rows, _, _ = _validated_grid(grid)
    column_positions = uniform_axis(current_columns if columns is None else columns)
    row_positions = uniform_axis(current_rows if rows is None else rows)
    return resample_grid(grid, column_positions, row_positions)
