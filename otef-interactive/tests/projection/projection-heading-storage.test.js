import { expect, test, vi } from 'vitest';
import { bindProjectionHeadingStorage } from '../../frontend/src/projection/projection-heading-storage.js';
import { NLI_LABEL_HEADING_STORAGE_KEY } from '../../frontend/src/shared/nli-label-heading.js';

function fakeWindow() {
  const listeners = new Map();
  return { addEventListener: (type, listener) => listeners.set(type, listener),
    removeEventListener: (type) => listeners.delete(type),
    dispatch: (key) => listeners.get('storage')?.({ key }), listeners };
}

test('output heading storage event hides stale names and schedules matching runtime preparation', () => {
  const win = fakeWindow(); const order = [];
  const dispose = bindProjectionHeadingStorage({ win, browserMode: true, previewMode: false,
    applyHeading: () => order.push('heading'), disposePreparation: () => order.push('cancel-old'),
    controller: { reload: () => order.push('hide-old') },
    reapplyRuntime: () => order.push('prepare-new') });
  win.dispatch('other'); expect(order).toEqual([]);
  win.dispatch(NLI_LABEL_HEADING_STORAGE_KEY);
  expect(order).toEqual(['heading', 'cancel-old', 'hide-old', 'prepare-new']);
  dispose(); expect(win.listeners.has('storage')).toBe(false);
});

test('preview heading storage event reuses paired preparation and aborts superseded event', async () => {
  const win = fakeWindow(); const calls = [];
  const repreparePreview = vi.fn((signal) => { calls.push(signal); return Promise.resolve(); });
  const dispose = bindProjectionHeadingStorage({ win, browserMode: true, previewMode: true,
    applyHeading: vi.fn(), disposePreparation: vi.fn(), controller: { reload: vi.fn() }, repreparePreview });
  win.dispatch(NLI_LABEL_HEADING_STORAGE_KEY);
  win.dispatch(NLI_LABEL_HEADING_STORAGE_KEY);
  expect(repreparePreview).toHaveBeenCalledTimes(2);
  expect(calls[0].aborted).toBe(true);
  expect(calls[1].aborted).toBe(false);
  dispose(); expect(calls[1].aborted).toBe(true);
});
