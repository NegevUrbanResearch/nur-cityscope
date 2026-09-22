import { describe, expect, test, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { createProjectionWarpRenderer, validateProjectionMesh } from "../../frontend/src/projection/projection-warp-renderer.js";

const mesh = { width: 1920, height: 1080, vertices: [
  { s: 0, t: 0, x: 0, y: 0, u: 0, v: 0 }, { s: 1, t: 0, x: 1, y: 0, u: 1, v: 0 },
  { s: 0, t: 1, x: 0, y: 1, u: 0, v: 1 }, { s: 1, t: 1, x: 1, y: 1, u: 1, v: 1 },
], triangles: [0, 1, 2, 2, 1, 3] };

function fakeGl() {
  let id = 0;
  const fn = () => vi.fn();
  return {
    createBuffer: vi.fn(() => ({ id: ++id })), bindBuffer: vi.fn(), bufferData: vi.fn(),
    createTexture: vi.fn(() => ({ id: ++id })), bindTexture: vi.fn(), texParameteri: vi.fn(), texImage2D: vi.fn(),
    createFramebuffer: vi.fn(() => ({ id: ++id })), bindFramebuffer: vi.fn(), framebufferTexture2D: vi.fn(), checkFramebufferStatus: vi.fn(() => 99),
    createShader: vi.fn(() => ({ id: ++id })), shaderSource: vi.fn(), compileShader: vi.fn(), getShaderParameter: vi.fn(() => true),
    createProgram: vi.fn(() => ({ id: ++id })), attachShader: vi.fn(), bindAttribLocation: vi.fn(), linkProgram: vi.fn(), getProgramParameter: vi.fn(() => true),
    useProgram: vi.fn(), getAttribLocation: vi.fn((_, name) => name === "aUv" ? 1 : 0), getUniformLocation: vi.fn((_, name) => name),
    enableVertexAttribArray: vi.fn(), disableVertexAttribArray: vi.fn(), vertexAttribPointer: vi.fn(), uniform1i: vi.fn(), uniform1f: vi.fn(), uniform4fv: vi.fn(), uniformMatrix3fv: vi.fn(),
    viewport: vi.fn(), clearColor: vi.fn(), clear: vi.fn(), drawArrays: vi.fn(), drawElements: vi.fn(),
    activeTexture: vi.fn(), pixelStorei: vi.fn(), enable: vi.fn(), blendFunc: vi.fn(),
    blendFuncSeparate: vi.fn(),
    deleteShader: vi.fn(), deleteBuffer: vi.fn(), deleteTexture: vi.fn(), deleteFramebuffer: vi.fn(), deleteProgram: vi.fn(),
    ARRAY_BUFFER: 1, ELEMENT_ARRAY_BUFFER: 2, STATIC_DRAW: 3, TRIANGLES: 4, TRIANGLE_STRIP: 5,
    UNSIGNED_SHORT: 6, TEXTURE0: 7, TEXTURE_2D: 8, RGBA: 9, UNSIGNED_BYTE: 10, COLOR_BUFFER_BIT: 11, FLOAT: 12,
    BLEND: 13, SRC_ALPHA: 14, ONE_MINUS_SRC_ALPHA: 15, VERTEX_SHADER: 16, FRAGMENT_SHADER: 17, COMPILE_STATUS: 18,
    LINK_STATUS: 19, FRAMEBUFFER: 20, COLOR_ATTACHMENT0: 21, FRAMEBUFFER_COMPLETE: 99, TEXTURE_MIN_FILTER: 22,
    TEXTURE_MAG_FILTER: 23, TEXTURE_WRAP_S: 24, TEXTURE_WRAP_T: 25, LINEAR: 26, CLAMP_TO_EDGE: 27, UNPACK_FLIP_Y_WEBGL: 28,
    ONE: 29,
  };
}

function canvasFor(gl) { const listeners = {}; return { width: 1920, height: 1080, getContext: () => gl, addEventListener: (name, cb) => { listeners[name] = cb; }, removeEventListener: vi.fn(), listeners }; }

describe("projection warp renderer", () => {
  test("rejects invalid destination winding and out-of-range destination coordinates", () => {
    expect(() => validateProjectionMesh({ ...mesh, triangles: [0, 2, 1] })).toThrow(/triangle/i);
    expect(() => validateProjectionMesh({ ...mesh, vertices: mesh.vertices.map((v, i) => i === 3 ? { ...v, x: 2.1 } : v) })).toThrow(/destination/i);
    expect(() => validateProjectionMesh({ ...mesh, vertices: mesh.vertices.map((v, i) => i === 3 ? { ...v, x: "1" } : v) })).toThrow(/non-finite/i);
  });

  test("rejects string dimensions and triangle indices", () => {
    expect(() => validateProjectionMesh({ ...mesh, width: "1920" })).toThrow(/1920x1080/i);
    expect(() => validateProjectionMesh({ ...mesh, triangles: ["0", 1, 2] })).toThrow(/index/i);
  });

  test("rejects meshes that cannot be represented by unsigned-short indices", () => {
    const oversized = Array.from({ length: 65537 }, (_, index) => ({
      s: 0, t: 0, x: index === 1 ? 1 : 0, y: index === 2 ? 1 : 0, u: 0, v: 0,
    }));
    expect(() => validateProjectionMesh({ ...mesh, vertices: oversized })).toThrow(/unsigned-short/i);
    expect(() => validateProjectionMesh({ ...mesh, vertices: [...mesh.vertices, ...oversized.slice(4)], triangles: [0, 1, 65536] })).toThrow(/unsigned-short/i);
  });

  test("accepts the tracked TD baseline destination extent", () => {
    const baseline = JSON.parse(fs.readFileSync(path.resolve(process.cwd(), "public/projection-calibration/td-baselines/right.json"), "utf8"));
    expect(validateProjectionMesh(baseline)).toBe(baseline);
  });

  test("composes descriptors with GL state and performs one final mesh draw", () => {
    const gl = fakeGl(); const canvas = canvasFor(gl); const renderer = createProjectionWarpRenderer({ canvas, mesh });
    const first = {}; const second = {};
    renderer.draw({ layers: [
      { source: first, opacity: 0.5, clip: [0.1, 0.2, 0.8, 0.9], matrix: [1, 0, 0, 0, 1, 0, 0.1, 0.05, 1] },
      { source: second },
    ] });
    expect(gl.drawArrays).toHaveBeenCalledTimes(2);
    expect(gl.drawElements).toHaveBeenCalledTimes(1);
    expect(gl.uniform1f).toHaveBeenCalledWith("uOpacity", 0.5);
    expect(gl.uniform4fv).toHaveBeenCalledWith("uClip", expect.any(Float32Array));
    expect(gl.uniformMatrix3fv).toHaveBeenCalledWith("uMatrix", false, expect.any(Float32Array));
    expect(gl.vertexAttribPointer).toHaveBeenCalled();
    expect(gl.texParameteri).toHaveBeenCalledWith(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  });

  test("rejects string opacity instead of coercing it", () => {
    const gl = fakeGl(); const canvas = canvasFor(gl); const renderer = createProjectionWarpRenderer({ canvas, mesh });
    expect(() => renderer.draw({ layers: [{ source: {}, opacity: "0.5" }] })).toThrow(/opacity/i);
  });

  test("uses premultiplied output without unpremultiplying composition pixels", () => {
    const gl = fakeGl(); const canvas = canvasFor(gl); const renderer = createProjectionWarpRenderer({ canvas, mesh });
    expect(renderer.draw({ layers: [{ source: {} }] })).toBe(true);
    expect(gl.shaderSource.mock.calls.some(([, source]) => source.includes("color.rgb/alpha"))).toBe(false);
    expect(gl.blendFuncSeparate).toHaveBeenCalledWith(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
  });

  test("requests premultiplied output on initial and recovery contexts", () => {
    const gl = fakeGl();
    const getContext = vi.fn(() => gl);
    const canvas = canvasFor(gl);
    canvas.getContext = getContext;
    const renderer = createProjectionWarpRenderer({ canvas, mesh });
    expect(getContext).toHaveBeenCalledWith("webgl", { alpha: true, premultipliedAlpha: true });
    renderer.draw({ layers: [{ source: {} }] });
    canvas.listeners.webglcontextlost({ preventDefault: vi.fn() });
    const restored = fakeGl();
    canvas.getContext = vi.fn(() => restored);
    renderer.recoverContext();
    expect(canvas.getContext).toHaveBeenCalledWith("webgl", { alpha: true, premultipliedAlpha: true });
    renderer.dispose();
  });

  test("uses one projective divide in composition clip coordinates", () => {
    const gl = fakeGl(); const canvas = canvasFor(gl); const renderer = createProjectionWarpRenderer({ canvas, mesh });
    renderer.draw({ layers: [{ source: {}, matrix: [1, 0, 0.3, 0, 1, 0.2, 0, 0, 1] }] });
    expect(gl.shaderSource.mock.calls.some(([, source]) => source.includes("2.0*p.x-p.z") && source.includes("p.z-2.0*p.y") && source.includes("0.0,p.z"))).toBe(true);
  });

  test("disables the final-pass UV attribute before composing after mesh replacement", () => {
    const gl = fakeGl(); const canvas = canvasFor(gl); const renderer = createProjectionWarpRenderer({ canvas, mesh });
    renderer.draw({ layers: [{ source: {} }] });
    const programs = gl.createProgram.mock.calls.length; const framebuffers = gl.createFramebuffer.mock.calls.length;
    renderer.setMesh(mesh);
    expect(gl.createProgram).toHaveBeenCalledTimes(programs);
    expect(gl.createFramebuffer).toHaveBeenCalledTimes(framebuffers);
    renderer.draw({ layers: [{ source: {} }] });
    expect(gl.disableVertexAttribArray).toHaveBeenCalledWith(1);
  });

  test("keeps the last valid mesh and restores resources after context events", () => {
    const gl = fakeGl(); const canvas = canvasFor(gl); const renderer = createProjectionWarpRenderer({ canvas, mesh });
    renderer.draw({ layers: [{ source: {} }] });
    expect(() => renderer.setMesh({ ...mesh, triangles: [0, 2, 1] })).toThrow();
    expect(renderer.getMesh()).toBe(mesh);
    const drawsBeforeLoss = gl.drawElements.mock.calls.length;
    canvas.listeners.webglcontextlost({ preventDefault: vi.fn() });
    expect(renderer.draw({ layers: [{ source: {} }] })).toBe(false);
    expect(gl.drawElements).toHaveBeenCalledTimes(drawsBeforeLoss);
    canvas.listeners.webglcontextrestored();
    expect(gl.deleteBuffer).not.toHaveBeenCalled();
    expect(gl.drawElements).toHaveBeenCalledTimes(drawsBeforeLoss + 1);
    renderer.dispose();
    expect(gl.deleteBuffer).toHaveBeenCalled(); expect(gl.deleteTexture).toHaveBeenCalled(); expect(gl.deleteFramebuffer).toHaveBeenCalled();
  });
});
