const MIN_COUNT = 2;
const MAX_COUNT = 16;

function requireFinite(value, label) {
  if (!Number.isFinite(value)) throw new TypeError(`${label} must be a finite number`);
  return value;
}

function requireCount(value, label = 'count') {
  if (!Number.isInteger(value) || value < MIN_COUNT || value > MAX_COUNT) {
    throw new RangeError(`${label} must be an integer from ${MIN_COUNT} to ${MAX_COUNT}`);
  }
  return value;
}

function validateAxis(axis, expectedLength, label = 'axis') {
  if (!Array.isArray(axis) || axis.length < MIN_COUNT || axis.length > MAX_COUNT ||
      (expectedLength !== undefined && axis.length !== expectedLength)) {
    throw new TypeError(`${label} must contain ${expectedLength ?? '2–16'} positions`);
  }
  axis.forEach((position, index) => {
    requireFinite(position, `${label}[${index}]`);
    if (position < 0 || position > 1) throw new RangeError(`${label} positions must be within [0, 1]`);
    if (index > 0 && !(position > axis[index - 1])) throw new RangeError(`${label} positions must increase strictly`);
  });
  if (axis[0] !== 0 || axis[axis.length - 1] !== 1) throw new RangeError(`${label} must start at 0 and end at 1`);
  return axis;
}

export function uniformAxis(count) {
  requireCount(count);
  return Array.from({ length: count }, (_, index) => index / (count - 1));
}

export function resizeGridAxis(grid, axis, count) {
  if (axis !== 'row' && axis !== 'column') throw new Error('Choose row or column.');
  const shape = validateGrid(grid);
  const columns = axis === 'column' ? uniformAxis(count) : shape.columnPositions;
  const rows = axis === 'row' ? uniformAxis(count) : shape.rowPositions;
  return resampleGrid(grid, columns, rows);
}

export function gridInterval(axis, position) {
  validateAxis(axis);
  requireFinite(position, 'position');
  const p = Math.min(1, Math.max(0, position));
  if (p === 1) return { index: axis.length - 2, fraction: 1 };
  let low = 0;
  let high = axis.length - 1;
  while (low + 1 < high) {
    const middle = (low + high) >>> 1;
    if (axis[middle] <= p) low = middle;
    else high = middle;
  }
  return { index: low, fraction: (p - axis[low]) / (axis[low + 1] - axis[low]) };
}

function validateGrid(grid) {
  if (!grid || typeof grid !== 'object' || Array.isArray(grid)) throw new TypeError('grid must be an object');
  const columns = requireCount(grid.columns, 'columns');
  const rows = requireCount(grid.rows, 'rows');
  const columnPositions = grid.columnPositions === undefined ? uniformAxis(columns) : validateAxis(grid.columnPositions, columns, 'columnPositions');
  const rowPositions = grid.rowPositions === undefined ? uniformAxis(rows) : validateAxis(grid.rowPositions, rows, 'rowPositions');
  if (!Array.isArray(grid.offsets) || grid.offsets.length !== columns * rows) throw new TypeError('grid offsets must match its row and column counts');
  for (const [index, pair] of grid.offsets.entries()) {
    if (!Array.isArray(pair) || pair.length !== 2 || !pair.every(Number.isFinite) || pair.some((value) => value < -1 || value > 2)) {
      throw new TypeError(`grid offset ${index} must contain two finite values within [-1, 2]`);
    }
  }
  return { columns, rows, columnPositions, rowPositions };
}

export function sampleGridOffset(s, t, grid) {
  requireFinite(s, 's');
  requireFinite(t, 't');
  const { columns, columnPositions, rowPositions } = validateGrid(grid);
  const x = gridInterval(columnPositions, s);
  const y = gridInterval(rowPositions, t);
  const at = (column, row) => grid.offsets[row * columns + column];
  const p00 = at(x.index, y.index);
  const p10 = at(x.index + 1, y.index);
  const p01 = at(x.index, y.index + 1);
  const p11 = at(x.index + 1, y.index + 1);
  const result = [];
  for (let component = 0; component < 2; component += 1) {
    const top = p00[component] + (p10[component] - p00[component]) * x.fraction;
    const bottom = p01[component] + (p11[component] - p01[component]) * x.fraction;
    result.push(top + (bottom - top) * y.fraction);
  }
  return result;
}

export function resampleGrid(oldGrid, newColumnPositions, newRowPositions) {
  const old = validateGrid(oldGrid);
  validateAxis(newColumnPositions, undefined, 'columnPositions');
  validateAxis(newRowPositions, undefined, 'rowPositions');
  const offsets = [];
  for (const t of newRowPositions) {
    for (const s of newColumnPositions) offsets.push(sampleGridOffset(s, t, oldGrid));
  }
  return {
    ...oldGrid,
    columns: newColumnPositions.length,
    rows: newRowPositions.length,
    columnPositions: [...newColumnPositions],
    rowPositions: [...newRowPositions],
    offsets,
  };
}

function axisKey(axis) {
  if (axis === 'column') return 'columnPositions';
  if (axis === 'row') return 'rowPositions';
  throw new TypeError('axis must be "column" or "row"');
}

export function insertGridLine(grid, axis, position) {
  const key = axisKey(axis);
  requireFinite(position, 'position');
  const shape = validateGrid(grid);
  const oldPositions = [...shape[key]];
  if (!(position > 0 && position < 1) || oldPositions.includes(position)) throw new RangeError('inserted grid line must be a distinct interior position');
  if (oldPositions.length >= MAX_COUNT) throw new RangeError('grid axis is already at its maximum count');
  const positions = [...oldPositions, position].sort((a, b) => a - b);
  return key === 'columnPositions'
    ? resampleGrid(grid, positions, shape.rowPositions)
    : resampleGrid(grid, shape.columnPositions, positions);
}

export function removeGridLine(grid, axis, index) {
  const key = axisKey(axis);
  const shape = validateGrid(grid);
  const positions = [...shape[key]];
  if (!Number.isInteger(index) || index <= 0 || index >= positions.length - 1) throw new RangeError('only an interior grid line can be removed');
  if (positions.length <= MIN_COUNT) throw new RangeError('grid axis is already at its minimum count');
  positions.splice(index, 1);
  return key === 'columnPositions'
    ? resampleGrid(grid, positions, shape.rowPositions)
    : resampleGrid(grid, shape.columnPositions, positions);
}

export function moveGridLine(grid, axis, index, position) {
  const key = axisKey(axis);
  const shape = validateGrid(grid);
  requireFinite(position, 'position');
  const positions = [...shape[key]];
  if (!Number.isInteger(index) || index <= 0 || index >= positions.length - 1) throw new RangeError('only an interior grid line can be moved');
  if (!(position > positions[index - 1] && position < positions[index + 1])) throw new RangeError('grid line must remain strictly between its neighbors');
  positions[index] = position;
  return key === 'columnPositions'
    ? resampleGrid(grid, positions, shape.rowPositions)
    : resampleGrid(grid, shape.columnPositions, positions);
}

export function uniformGrid(grid, columns = grid?.columns, rows = grid?.rows) {
  validateGrid(grid);
  const columnPositions = uniformAxis(columns);
  const rowPositions = uniformAxis(rows);
  return resampleGrid(grid, columnPositions, rowPositions);
}
