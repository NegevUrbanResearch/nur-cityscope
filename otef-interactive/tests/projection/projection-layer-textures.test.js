import { describe, expect, test, vi } from 'vitest';
import { createProjectionLayerTextures } from '../../frontend/src/projection/projection-layer-textures.js';

function fakeGl() {
  let id = 0;
  return {
    createTexture: vi.fn(() => ({ id: ++id })), deleteTexture: vi.fn(),
    bindTexture: vi.fn(), texParameteri: vi.fn(), texImage2D: vi.fn(),
    TEXTURE_2D: 1, TEXTURE_MIN_FILTER: 2, TEXTURE_MAG_FILTER: 3,
    TEXTURE_WRAP_S: 4, TEXTURE_WRAP_T: 5, LINEAR: 6, CLAMP_TO_EDGE: 7,
    RGBA: 8, UNSIGNED_BYTE: 9,
  };
}

const uploads = (gl, source) => gl.texImage2D.mock.calls.filter((args) => args.at(-1) === source).length;

describe('projection layer textures', () => {
  test.each(['image', 'map', 'settlements', 'caption', 'pattern', 'legend'])('retains a versioned %s texture', (id) => {
    const gl = fakeGl(); const cache = createProjectionLayerTextures(gl);
    const source = { width: 64, height: 32 };
    const layer = { id, source, contentVersion: 0 };
    const texture = cache.bind(layer);
    expect(cache.bind({ ...layer, matrix: [1], clip: [0, 0, 1, 1], opacity: 0.5 })).toBe(texture);
    expect(uploads(gl, source)).toBe(1);
    expect(gl.createTexture).toHaveBeenCalledTimes(1);
    expect(gl.texParameteri).toHaveBeenCalledTimes(4);
  });

  test('uploads volatile, invalid, and missing versions on every bind', () => {
    const gl = fakeGl(); const cache = createProjectionLayerTextures(gl);
    const source = { width: 16, height: 16 };
    for (const contentVersion of [undefined, -1, 0.5, Number.MAX_SAFE_INTEGER + 1]) {
      cache.bind({ id: 'map', source, contentVersion });
      cache.bind({ id: 'map', source, contentVersion });
    }
    expect(uploads(gl, source)).toBe(8);
    expect(gl.createTexture).toHaveBeenCalledTimes(1);
  });

  test('invalidates on version, source, and intrinsic dimension changes', () => {
    const gl = fakeGl(); const cache = createProjectionLayerTextures(gl);
    const source = { naturalWidth: 16, naturalHeight: 16, width: 99, height: 99 };
    cache.bind({ id: 'image', source, contentVersion: 0 });
    cache.bind({ id: 'image', source, contentVersion: 1 });
    source.naturalWidth = 32;
    cache.bind({ id: 'image', source, contentVersion: 1 });
    const replacement = { width: 32, height: 16 };
    cache.bind({ id: 'image', source: replacement, contentVersion: 1 });
    expect(uploads(gl, source)).toBe(3);
    expect(uploads(gl, replacement)).toBe(1);
    expect(gl.createTexture).toHaveBeenCalledTimes(1);
  });

  test('skips incomplete sources and uploads when they become ready', () => {
    const gl = fakeGl(); const cache = createProjectionLayerTextures(gl);
    const source = { naturalWidth: 0, naturalHeight: 0, width: 100, height: 100, complete: false };
    expect(cache.bind({ id: 'image', source, contentVersion: 0 })).toBe(null);
    expect(uploads(gl, source)).toBe(0);
    source.naturalWidth = 100; source.naturalHeight = 100; source.complete = true;
    expect(cache.bind({ id: 'image', source, contentVersion: 0 })).not.toBe(null);
    expect(uploads(gl, source)).toBe(1);
  });

  test('reuploads a source that became unready between draws', () => {
    const gl = fakeGl(); const cache = createProjectionLayerTextures(gl);
    const source = { naturalWidth: 100, naturalHeight: 100, complete: true };
    const layer = { id: 'image', source, contentVersion: 0 };
    cache.bind(layer);
    source.complete = false;
    expect(cache.bind(layer)).toBe(null);
    source.complete = true;
    cache.bind(layer);
    expect(uploads(gl, source)).toBe(2);
  });

  test('retries failed upload without treating it as valid', () => {
    const gl = fakeGl(); const cache = createProjectionLayerTextures(gl);
    const source = { width: 16, height: 16 };
    gl.texImage2D.mockImplementationOnce(() => { throw new Error('upload failed'); });
    expect(() => cache.bind({ id: 'caption', source, contentVersion: 0 })).toThrow('upload failed');
    cache.bind({ id: 'caption', source, contentVersion: 0 });
    expect(uploads(gl, source)).toBe(2);
  });

  test('prunes absent IDs and disposes each retained texture once', () => {
    const gl = fakeGl(); const cache = createProjectionLayerTextures(gl);
    const caption = cache.bind({ id: 'caption', source: { width: 2, height: 2 }, contentVersion: 0 });
    const hidden = cache.bind({ id: 'legend', source: { width: 2, height: 2 }, contentVersion: 0 });
    cache.prune(new Set(['legend']));
    expect(gl.deleteTexture).toHaveBeenCalledExactlyOnceWith(caption);
    cache.prune(new Set(['legend']));
    cache.dispose();
    cache.dispose();
    expect(gl.deleteTexture.mock.calls).toEqual([[caption], [hidden]]);
  });
});
