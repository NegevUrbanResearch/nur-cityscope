import { afterEach, beforeEach, expect, test, vi } from 'vitest';

vi.mock('../../frontend/src/projection-config/config-controller.js', () => ({
  mountProjectionConfig: () => ({ dispose() {}, setSettlementCatalog() {} }),
}));
vi.mock('../../frontend/src/shared/projection-config-client.js', () => ({
  createProjectionConfigClient: () => ({ stop() {} }),
}));
vi.mock('../../frontend/src/projection-config/output-window-controller.js', () => ({
  createOutputWindowController: () => ({ getState: () => ({ supported: false }), dispose() {} }),
}));

import { bootProjectionConfig } from '../../frontend/src/entries/projection-config-main.js';

let doc, win, socket, dispose;
beforeEach(async () => {
  vi.useFakeTimers();
  win = new EventTarget();
  doc = new EventTarget();
  doc.defaultView = win;
  doc.visibilityState = 'visible';
  doc.getElementById = () => ({});
  socket = { on() {}, off() {}, send: () => true, getConnected: () => true, restart: vi.fn() };
  dispose = await bootProjectionConfig({ document: doc, socket,
    location: { href: 'http://localhost/otef-interactive/projection-config.html' },
    fetchImpl: vi.fn(async () => ({ ok: true, json: async () => ({}) })),
  });
});
afterEach(() => { dispose?.(); vi.useRealTimers(); });
function visibility(state) {
  doc.visibilityState = state;
  doc.dispatchEvent(new Event('visibilitychange'));
}

test('tablet foreground replaces a socket still reporting connected and coalesces wake events', () => {
  doc.dispatchEvent(new Event('visibilitychange'));
  win.dispatchEvent(new Event('pageshow'));
  vi.advanceTimersByTime(100);
  expect(socket.restart).not.toHaveBeenCalled();
  visibility('hidden');
  visibility('visible');
  const restored = new Event('pageshow'); restored.persisted = true;
  win.dispatchEvent(restored);
  win.dispatchEvent(new Event('online'));
  vi.advanceTimersByTime(100);
  expect(socket.getConnected()).toBe(true);
  expect(socket.restart).toHaveBeenCalledOnce();
  doc.dispatchEvent(new Event('visibilitychange'));
  vi.advanceTimersByTime(100);
  expect(socket.restart).toHaveBeenCalledOnce();
});

test('network return and restored pages recover only while visible', () => {
  win.dispatchEvent(new Event('online'));
  vi.advanceTimersByTime(100);
  expect(socket.restart).toHaveBeenCalledOnce();
  visibility('hidden');
  win.dispatchEvent(new Event('online'));
  vi.advanceTimersByTime(100);
  expect(socket.restart).toHaveBeenCalledOnce();
  visibility('visible');
  vi.advanceTimersByTime(100);
  expect(socket.restart).toHaveBeenCalledTimes(2);
  const restored = new Event('pageshow'); restored.persisted = true;
  win.dispatchEvent(restored);
  vi.advanceTimersByTime(100);
  expect(socket.restart).toHaveBeenCalledTimes(3);
});

test('hiding or disposing cancels recovery and removes lifecycle listeners', () => {
  visibility('hidden'); visibility('visible'); visibility('hidden');
  vi.advanceTimersByTime(100);
  expect(socket.restart).not.toHaveBeenCalled();
  visibility('visible');
  dispose();
  vi.advanceTimersByTime(100);
  visibility('hidden'); visibility('visible');
  win.dispatchEvent(new Event('online'));
  const restored = new Event('pageshow'); restored.persisted = true;
  win.dispatchEvent(restored);
  vi.advanceTimersByTime(100);
  expect(socket.restart).not.toHaveBeenCalled();
});
