// @vitest-environment jsdom
import { expect, test, vi } from 'vitest';
import { mountGisDisplayResolution, gisLogicalViewport } from '../../frontend/src/map/gis-display-resolution.js';

function display(width, height, dpr = 1) {
  const listeners = new Map();
  const window = { innerWidth: width, innerHeight: height, devicePixelRatio: dpr, document,
    addEventListener: (key, fn) => listeners.set(key, fn), removeEventListener: key => listeners.delete(key) };
  return { window, listeners };
}

test('1080p and 4K GIS share scene layout while the map raster gains pixels', () => {
  const lab = display(1920, 1080);
  const a = mountGisDisplayResolution({ window: lab.window, document });
  expect(a.pixelRatio()).toBe(1);
  expect(gisLogicalViewport(lab.window)).toEqual({ width: 1920, height: 1080, scale: 1 });
  a.dispose();
  const exhibit = display(3840, 2160);
  const b = mountGisDisplayResolution({ window: exhibit.window, document });
  expect(b.pixelRatio()).toBe(2);
  expect(document.body.style.zoom).toBe('2');
  expect(document.body.style.width).toBe('1920px');
  expect(document.body.style.height).toBe('1080px');
  expect(gisLogicalViewport(exhibit.window)).toEqual({ width: 1920, height: 1080, scale: 2 });
  b.dispose();
});

test('Windows 150% scaling still produces a native 4K map with the same scene framing', () => {
  const scaled = display(2560, 1440, 1.5);
  const controller = mountGisDisplayResolution({ window: scaled.window, document });
  expect(controller.pixelRatio()).toBe(2);
  expect(gisLogicalViewport(scaled.window).width).toBe(1920);
  expect(gisLogicalViewport(scaled.window).height).toBe(1080);
  controller.dispose();
});

test('resizing updates GIS density without changing scene zoom and dispose restores layout', () => {
  const prior = document.body.style.cssText;
  const exhibit = display(3840, 2160);
  const controller = mountGisDisplayResolution({ window: exhibit.window, document });
  const map = { setPixelRatio: vi.fn(), resize: vi.fn(), jumpTo: vi.fn() };
  controller.bindMap(map);
  exhibit.window.innerWidth = 1920; exhibit.window.innerHeight = 1080;
  exhibit.listeners.get('resize')();
  expect(map.setPixelRatio).toHaveBeenLastCalledWith(1);
  expect(map.jumpTo).not.toHaveBeenCalled();
  expect(document.body.style.zoom).toBe('1');
  controller.dispose();
  expect(document.body.style.cssText).toBe(prior);
  expect(exhibit.listeners.size).toBe(0);
});

test('smaller GIS windows retain their current responsive layout', () => {
  const small = display(1200, 800);
  const controller = mountGisDisplayResolution({ window: small.window, document });
  expect(gisLogicalViewport(small.window)).toEqual({ width: 1200, height: 800, scale: 1 });
  expect(controller.pixelRatio()).toBe(1);
  controller.dispose();
});
