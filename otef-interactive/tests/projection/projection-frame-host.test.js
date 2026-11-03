// @vitest-environment jsdom
import { afterEach, expect, test, vi } from 'vitest';
import { mountProjectionFrameHost } from '../../frontend/src/projection/projection-frame-host.js';
let host;
afterEach(() => { host?.dispose(); host = null; vi.useRealTimers(); });
function mount() {
  host = mountProjectionFrameHost({ document, window,
    source: new URL('http://localhost/otef-interactive/projection.html?span=left&outputMode=browser'), rotate: true });
  return host.iframe;
}
function message(frame, type, key = 'cue-1', origin = 'http://localhost') {
  window.dispatchEvent(new MessageEvent('message', { source: frame.contentWindow, origin,
    data: { type: `otef-projection-${type}`, key } }));
}
test('one renderer replacement keeps the old picture and fullscreen owner until entry succeeds', () => {
  const old = mount(), fullscreenOwner = document.documentElement;
  const enter = vi.fn(); fullscreenOwner.requestFullscreen = enter;
  Object.defineProperty(document, 'fullscreenElement', { configurable: true, value: fullscreenOwner });
  message(old, 'scene'); message(old, 'refresh');
  const replacement = [...document.querySelectorAll('iframe')].find(frame => frame !== old);
  expect(old.isConnected).toBe(true); expect(replacement.style.visibility).toBe('hidden');
  expect(document.fullscreenElement).toBe(fullscreenOwner); expect(enter).not.toHaveBeenCalled();
  expect(new URL(replacement.src).searchParams.get('namesEntryRetry')).toBe('1');
  message(replacement, 'entered');
  expect(old.isConnected).toBe(false); expect(host.iframe).toBe(replacement);
  expect(replacement.style.visibility).toBe('visible');
  expect(document.fullscreenElement).toBe(fullscreenOwner);
  delete document.fullscreenElement; delete fullscreenOwner.requestFullscreen;
});
test('a failed replacement is removed and repeated failure never loops', () => {
  const old = mount(); message(old, 'scene'); message(old, 'refresh');
  const fresh = [...document.querySelectorAll('iframe')].find(frame => frame !== old);
  message(fresh, 'failed');
  expect(fresh.isConnected).toBe(false); expect(old.isConnected).toBe(true);
  message(old, 'refresh');
  expect(document.querySelectorAll('iframe')).toHaveLength(1);
});
test('a superseding tablet cue discards the pending replacement', () => {
  const old = mount(); message(old, 'scene'); message(old, 'refresh');
  const fresh = [...document.querySelectorAll('iframe')].find(frame => frame !== old);
  message(old, 'scene', null);
  expect(fresh.isConnected).toBe(false);
  message(fresh, 'entered'); expect(host.iframe).toBe(old);
});
test('a replacement that observes a newer tablet cue cannot promote the retired Names entry', () => {
  const old = mount(); message(old, 'scene'); message(old, 'refresh');
  const fresh = [...document.querySelectorAll('iframe')].find(frame => frame !== old);
  message(fresh, 'scene', 'cue-2'); message(fresh, 'entered', 'cue-1');
  expect(fresh.isConnected).toBe(false); expect(host.iframe).toBe(old);
});
test('foreign windows and cross-origin messages cannot refresh a projector', () => {
  const old = mount(); message(old, 'scene');
  message(old, 'refresh', 'cue-1', 'https://example.com');
  window.dispatchEvent(new MessageEvent('message', { source: window, origin: 'http://localhost',
    data: { type: 'otef-projection-refresh', key: 'cue-1' } }));
  expect(document.querySelectorAll('iframe')).toHaveLength(1);
});
test('a replacement that never boots is bounded and retains the old scene', () => {
  vi.useFakeTimers(); const old = mount(); message(old, 'scene'); message(old, 'refresh');
  vi.advanceTimersByTime(30000);
  expect(document.querySelectorAll('iframe')).toHaveLength(1); expect(host.iframe).toBe(old);
});
