import { describe, expect, it, vi } from "vitest";
import { createMapLibreGroupOpacity } from "../../frontend/src/shared/maplibre-group-opacity.js";

function createGl() {
  const defaultVao = { attributes: new Map([[1, { enabled: true, buffer: null }]]) };
  let vao = defaultVao;
  let buffer = null;
  const attributes = (index) => {
    if (!vao.attributes.has(index)) vao.attributes.set(index, {});
    return vao.attributes.get(index);
  };
  const gl = {
    drawingBufferWidth: 800,
    drawingBufferHeight: 500,
    isContextLost: () => false,
    createShader: () => ({}),
    getShaderParameter: () => true,
    createProgram: () => ({}),
    isProgram: () => true,
    getProgramParameter: () => true,
    createBuffer: () => ({}),
    createTexture: () => ({}),
    createVertexArray: vi.fn(() => ({ attributes: new Map() })),
    deleteVertexArray: vi.fn(),
    bindVertexArray: (value) => { vao = value ?? defaultVao; },
    bindBuffer: (_target, value) => { buffer = value; },
    getAttribLocation: () => 0,
    getUniformLocation: () => ({}),
    enableVertexAttribArray: (index) => { attributes(index).enabled = true; },
    vertexAttribPointer: (index) => { attributes(index).buffer = buffer; },
    drawArrays: vi.fn(() => {
      for (const attribute of vao.attributes.values()) {
        if (attribute.enabled && !attribute.buffer) throw new Error("INVALID_OPERATION: enabled attribute has no buffer");
      }
    }),
  };
  for (const method of ["shaderSource", "compileShader", "deleteShader", "attachShader", "linkProgram", "bufferData", "activeTexture", "bindTexture", "texParameteri", "texImage2D", "copyTexSubImage2D", "disable", "colorMask", "depthMask", "useProgram", "uniform1i", "uniform1f", "deleteTexture", "deleteBuffer", "deleteProgram"]) gl[method] = vi.fn();
  return { gl, defaultVao };
}

describe("MapLibre marker group compositor", () => {
  it("draws the fade independently of enabled attributes left in the default vertex array", () => {
    const { gl, defaultVao } = createGl();
    const group = createMapLibreGroupOpacity("people", 0.08);
    group.begin.onAdd({}, gl);
    group.begin.render(gl);
    expect(() => group.end.render(gl)).not.toThrow();
    expect(gl.drawArrays).toHaveBeenCalledOnce();
    expect(defaultVao.attributes.get(1)).toEqual({ enabled: true, buffer: null });
  });

  it("releases the owned vertex array when the compositor is removed", () => {
    const { gl } = createGl();
    const group = createMapLibreGroupOpacity("people", 0.08);
    group.begin.onAdd({}, gl);
    group.end.onRemove({}, gl);
    expect(gl.createVertexArray).toHaveBeenCalledOnce();
    expect(gl.deleteVertexArray).toHaveBeenCalledWith(gl.createVertexArray.mock.results[0].value);
  });

  it("isolates the draw on MapLibre's WebGL 1 fallback through the vertex array extension", () => {
    const { gl } = createGl();
    const extension = {
      createVertexArrayOES: gl.createVertexArray,
      bindVertexArrayOES: gl.bindVertexArray,
      deleteVertexArrayOES: gl.deleteVertexArray,
    };
    delete gl.createVertexArray; delete gl.bindVertexArray; delete gl.deleteVertexArray;
    gl.getExtension = vi.fn(() => extension);
    const group = createMapLibreGroupOpacity("people", 0.08);
    group.begin.onAdd({}, gl);
    group.begin.render(gl);
    expect(() => group.end.render(gl)).not.toThrow();
    group.end.onRemove({}, gl);
    expect(extension.deleteVertexArrayOES).toHaveBeenCalledOnce();
  });
});
