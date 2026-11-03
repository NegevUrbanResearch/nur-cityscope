export function singlePointSelection(selection, grid = {}) {
  const mode = selection?.mode === 'grid' ? 'grid' : 'keystone';
  const columns = grid.columns || 7;
  const count = mode === 'grid' ? columns * (grid.rows || 7) : 4;
  const index = selection?.indices?.[0] ?? (selection?.kind === 'row' ? selection.index * columns : selection?.index || 0);
  return { mode, kind: mode === 'grid' ? 'point' : 'corner', index: Math.max(0, Math.min(count - 1, index)) };
}
