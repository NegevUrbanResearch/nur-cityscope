// @vitest-environment jsdom
import { expect, test, vi } from 'vitest';
import { mountReversedProjection } from '../../frontend/src/projection/projection-reversed-output.js';

test.each([['left', 'right'], ['right', 'left']])('physical %s displays the rotated completed %s output', (physical, logical) => {
  const host = document.createElement('main');
  document.body.replaceChildren(host);
  const mounted = mountReversedProjection({ document, window, location: { href: `http://localhost/otef-interactive/projection-reversed.html?span=${physical}&outputMode=browser` } });
  const frame = mounted.iframe;
  expect(new URL(frame.src).pathname).toBe('/otef-interactive/projection.html');
  expect(new URL(frame.src).searchParams.get('span')).toBe(logical);
  expect(new URL(frame.src).searchParams.get('outputMode')).toBe('browser');
  expect(new URL(frame.src).searchParams.has('preview')).toBe(false);
  expect(frame.style.transform).toBe('rotate(180deg)');
  expect(frame.allow).toContain("fullscreen 'none'");
  expect(host.isConnected).toBe(false);
  mounted.dispose();
});

test.each(['', '?span=both', '?span=left&preview=1'])('invalid or preview routes do not start a live projection: %s', search => {
  document.body.innerHTML = '<main>Existing content</main>';
  expect(mountReversedProjection({ document, window, location: { href: `http://localhost/otef-interactive/projection-reversed.html${search}` } })).toBeNull();
  expect(document.querySelector('iframe')).toBeNull();
});

test('fullscreen acts on the wrapper, and F in the child preserves the rotation', () => {
  const fullscreen = vi.fn(async () => {});
  document.documentElement.requestFullscreen = fullscreen;
  const mounted = mountReversedProjection({ document, window, location: { href: 'http://localhost/otef-interactive/projection-reversed.html?span=left' } });
  document.querySelector('button').click();
  expect(fullscreen).toHaveBeenCalledTimes(1);
  mounted.iframe.dispatchEvent(new Event('load'));
  const child = mounted.iframe.contentDocument;
  child.dispatchEvent(new child.defaultView.KeyboardEvent('keydown', { key: 'f', bubbles: true, cancelable: true }));
  expect(fullscreen).toHaveBeenCalledTimes(2);
  mounted.dispose();
  child.dispatchEvent(new child.defaultView.KeyboardEvent('keydown', { key: 'f' }));
  expect(fullscreen).toHaveBeenCalledTimes(2);
  delete document.documentElement.requestFullscreen;
});
