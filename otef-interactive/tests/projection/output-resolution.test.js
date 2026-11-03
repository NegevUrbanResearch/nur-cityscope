import { expect, test, vi } from 'vitest';
import { resolveProjectionResolution, projectionMapPixelRatio, bindProjectionMapResolution } from '../../frontend/src/projection/output-resolution.js';

test('resolution is explicit and defaults safely to the lab output', () => {
  expect(resolveProjectionResolution('')).toEqual({ width: 1920, height: 1080, scale: 1 });
  expect(resolveProjectionResolution('?outputResolution=8k')).toEqual({ width: 1920, height: 1080, scale: 1 });
  for (const key of ['constructor', 'toString', '__proto__']) expect(resolveProjectionResolution(`?outputResolution=${key}`)).toEqual({ width: 1920, height: 1080, scale: 1 });
  expect(resolveProjectionResolution('?outputResolution=4k')).toEqual({ width: 3840, height: 2160, scale: 2 });
});

test('map raster density follows fullscreen layout rather than multiplying 4K a second time', () => {
  const resolution = resolveProjectionResolution('?outputResolution=4k');
  expect(projectionMapPixelRatio(resolution, { clientWidth: 1920, clientHeight: 1080 })).toBe(2);
  expect(projectionMapPixelRatio(resolution, { clientWidth: 3840, clientHeight: 2160 })).toBe(1);
  expect(projectionMapPixelRatio(resolution, { clientWidth: 2560, clientHeight: 1440 })).toBe(1.5);
  const container = { clientWidth: 1920, clientHeight: 1080 };
  let pixelRatio = 1;
  const map = { getPixelRatio: () => pixelRatio, setPixelRatio: vi.fn(value => { pixelRatio = value; }) };
  const listeners = new Map();
  const window = { addEventListener: (key, fn) => listeners.set(key, fn), removeEventListener: (key) => listeners.delete(key) };
  const dispose = bindProjectionMapResolution({ map, container, resolution, window });
  expect(map.setPixelRatio).toHaveBeenCalledWith(2);
  container.clientWidth = 3840; container.clientHeight = 2160;
  listeners.get('resize')();
  expect(map.setPixelRatio).toHaveBeenLastCalledWith(1);
  dispose(); expect(listeners.size).toBe(0);
});
