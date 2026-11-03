import { expect, it } from 'vitest';
import { createParameterHistory } from '../../frontend/src/projection-config/parameter-history.js';
it('records only its parameter, suppresses no-ops and invalidates redo', () => {
  const h = createParameterHistory({ limit: 2 });
  h.record({ path: 'pre.scale', before: 1, after: 1 }); expect(h.peekUndo()).toBeNull();
  const entry = { path: 'pre.scale', before: 1, after: 1.001 };
  h.record(entry); expect(h.peekUndo()).toEqual(entry);
  h.commitUndo(); expect(h.peekRedo()).toEqual(entry);
  h.record({ path: 'pre.tx', before: 0, after: .001 }); expect(h.peekRedo()).toBeNull();
  h.invalidate(['pre.tx']); expect(h.peekUndo()).toBeNull();
});
it('bounds history and retains unrelated paths on invalidation', () => {
  const h = createParameterHistory({ limit: 2 });
  for (const path of ['pre.scale', 'pre.tx', 'pre.ty']) h.record({ path, before: 0, after: 1 });
  h.invalidate(['pre.ty']); expect(h.peekUndo().path).toBe('pre.tx');
  h.commitUndo(); h.commitRedo(); expect(h.peekUndo().path).toBe('pre.tx');
  h.clear(); expect(h.state()).toEqual({ undo: 0, redo: 0 });
});
