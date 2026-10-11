import { afterEach, expect, test, vi } from "vitest";
import { createProjectionShelterLayer } from "../../frontend/src/projection/projection-shelter-layer.js";
import { SHELTER_LAYER_ID } from "../../frontend/src/shared/maplibre-nli-shelters.js";

afterEach(() => vi.unstubAllGlobals());

test("uploads vector canvas only when changed and releases GPU resources on removal", () => {
  vi.stubGlobal("Path2D", class { constructor(data) { this.data = data; } });
  const ctx = { save() {}, restore() {}, clearRect() {}, scale() {}, translate() {}, rotate() {}, fill() {}, stroke() {}, setTransform() {}, drawImage() {} };
  const canvas = { width: 0, height: 0, getContext: () => ctx };
  const snapshot = { frame: { visible: true, shelters: [{ id: "a", geometry: { coordinates: [200, 300] } }], impactedIds: new Set() },
    layout: new Map([["a", { size: 0.25, offset: [0, 0], rotationDeg: 85 }]]) };
  const map = { getCanvas: () => ({ width: 3840, height: 2160, clientWidth: 1920, clientHeight: 1080 }),
    project: ([x, y]) => ({ x, y }), getZoom: () => 12,
    getLayer: id => id === SHELTER_LAYER_ID ? { layout: { visibility: "visible" } } : null,
    getPaintProperty: () => 0.5 };
  const gl = {};
  for (const name of ["VERTEX_SHADER", "FRAGMENT_SHADER", "COMPILE_STATUS", "LINK_STATUS", "ARRAY_BUFFER", "STATIC_DRAW", "FLOAT",
    "TEXTURE_2D", "TEXTURE_MIN_FILTER", "TEXTURE_MAG_FILTER", "TEXTURE_WRAP_S", "TEXTURE_WRAP_T", "LINEAR", "CLAMP_TO_EDGE",
    "RGBA", "UNSIGNED_BYTE", "TEXTURE0", "BLEND", "DEPTH_TEST", "STENCIL_TEST", "ONE", "ONE_MINUS_SRC_ALPHA", "TRIANGLE_STRIP",
    "UNPACK_PREMULTIPLY_ALPHA_WEBGL", "UNPACK_FLIP_Y_WEBGL"]) gl[name] = name;
  for (const name of ["createShader", "createProgram", "createBuffer", "createTexture", "createVertexArray"]) gl[name] = vi.fn(() => ({}));
  for (const name of ["shaderSource", "compileShader", "attachShader", "linkProgram", "deleteShader", "deleteProgram", "deleteBuffer",
    "deleteTexture", "deleteVertexArray", "bindBuffer", "bufferData", "bindTexture", "texParameteri", "texImage2D", "pixelStorei",
    "bindVertexArray", "useProgram", "enable", "disable", "blendFunc", "depthMask", "colorMask", "enableVertexAttribArray",
    "vertexAttribPointer", "activeTexture", "uniform1i", "drawArrays"]) gl[name] = vi.fn();
  gl.getShaderParameter = gl.getProgramParameter = () => true;
  gl.getAttribLocation = () => 0;
  gl.getUniformLocation = () => ({});
  gl.getParameter = () => false;
  gl.isContextLost = () => false;
  const layer = createProjectionShelterLayer({ document: { createElement: () => canvas }, getSnapshot: () => snapshot });
  layer.onAdd(map, gl);
  layer.render(gl);
  layer.render(gl);
  expect(gl.texImage2D).toHaveBeenCalledTimes(1);
  expect(gl.texImage2D.mock.calls[0].at(-1)).toBe(canvas);
  expect(gl.drawArrays).toHaveBeenCalledTimes(2);
  expect(gl.blendFunc).toHaveBeenCalledWith(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
  snapshot.frame.visible = false;
  layer.render(gl);
  expect(gl.drawArrays).toHaveBeenCalledTimes(2);
  layer.onRemove(map, gl);
  expect(gl.deleteTexture).toHaveBeenCalledTimes(1);
  expect(gl.deleteProgram).toHaveBeenCalledTimes(1);
  expect(gl.deleteVertexArray).toHaveBeenCalledTimes(1);
});
