/** Scalar history never owns or restores a whole calibration snapshot. */
export function createParameterHistory({ limit = 50 } = {}) {
  let undo = []; let redo = [];
  const copy = entry => entry ? { ...entry } : null;
  return {
    record({ path, before, after }) {
      if (Object.is(before, after)) return;
      undo.push({ path, before, after });
      undo = undo.slice(-Math.max(1, limit)); redo = [];
    },
    peekUndo: () => copy(undo.at(-1)), peekRedo: () => copy(redo.at(-1)),
    commitUndo() { const entry = undo.pop(); if (entry) redo.push(entry); },
    commitRedo() { const entry = redo.pop(); if (entry) undo.push(entry); },
    invalidate(paths) {
      const changed = new Set(paths);
      undo = undo.filter(entry => !changed.has(entry.path));
      redo = redo.filter(entry => !changed.has(entry.path));
    },
    clear() { undo = []; redo = []; },
    state: () => ({ undo: undo.length, redo: redo.length }),
  };
}
