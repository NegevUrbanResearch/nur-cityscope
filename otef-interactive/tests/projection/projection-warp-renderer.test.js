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
  test('reuses static pixels while still drawing a changed transform', () => {
    const gl = fakeGl();
    const renderer = createProjectionWarpRenderer({ canvas: canvasFor(gl), mesh });
    const source = { width: 64, height: 64 };
    const layer = { id: 'caption', source, contentVersion: 0 };
    renderer.draw({ layers: [layer] });
    renderer.draw({ layers: [{ ...layer, opacity: 0.5 }] });
    expect(gl.texImage2D.mock.calls.filter((args) => args.at(-1) === source)).toHaveLength(1);
    expect(gl.drawArrays).toHaveBeenCalledTimes(2);
  });

  test('does not upload or draw transparent non-name layers', () => {
    const gl = fakeGl();
    const renderer = createProjectionWarpRenderer({ canvas: canvasFor(gl), mesh });
    const source = { width: 64, height: 64 };
    renderer.draw({ layers: [{ id: 'image', source, contentVersion: 0, opacity: 0 }] });
    expect(gl.texImage2D.mock.calls.filter((args) => args.at(-1) === source)).toHaveLength(0);
    expect(gl.drawArrays).not.toHaveBeenCalled();
    expect(gl.drawElements).toHaveBeenCalledTimes(1);
  });

  test('retains hidden layers until scene removal, then deletes their texture once', () => {
    const gl = fakeGl();
    const renderer = createProjectionWarpRenderer({ canvas: canvasFor(gl), mesh });
    const source = { width: 64, height: 64 };
    const layer = { id: 'legend', source, contentVersion: 0 };
    renderer.draw({ layers: [layer] });
    const texture = gl.bindTexture.mock.calls.at(-2)[1];
    renderer.draw({ layers: [{ ...layer, contentVersion: 1, opacity: 0 }] });
    expect(gl.texImage2D.mock.calls.filter((args) => args.at(-1) === source)).toHaveLength(1);
    expect(gl.deleteTexture).not.toHaveBeenCalledWith(texture);
    renderer.draw({ layers: [{ ...layer, contentVersion: 1 }] });
    expect(gl.texImage2D.mock.calls.filter((args) => args.at(-1) === source)).toHaveLength(2);
    renderer.draw({ layers: [] });
    expect(gl.deleteTexture).toHaveBeenCalledExactlyOnceWith(texture);
    expect(gl.drawElements).toHaveBeenCalledTimes(4);
    renderer.dispose();
    expect(gl.deleteTexture.mock.calls.filter(([deleted]) => deleted === texture)).toHaveLength(1);
  });

  test('creates a fresh layer texture after context recovery', () => {
    const gl = fakeGl(), canvas = canvasFor(gl);
    const renderer = createProjectionWarpRenderer({ canvas, mesh });
    const source = { width: 64, height: 64 };
    renderer.draw({ layers: [{ id: 'caption', source, contentVersion: 0 }] });
    canvas.listeners.webglcontextlost({ preventDefault: vi.fn() });
    canvas.listeners.webglcontextrestored();
    expect(gl.texImage2D.mock.calls.filter((args) => args.at(-1) === source)).toHaveLength(2);
  });

  test('disposes retained textures on manual context replacement', () => {
    const gl = fakeGl(), canvas = canvasFor(gl);
    const renderer = createProjectionWarpRenderer({ canvas, mesh });
    const source = { width: 64, height: 64 };
    renderer.draw({ layers: [{ id: 'caption', source, contentVersion: 0 }] });
    const texture = gl.bindTexture.mock.calls.at(-2)[1];
    const replacement = fakeGl();
    renderer.recoverContext(replacement);
    expect(gl.deleteTexture.mock.calls.filter(([deleted]) => deleted === texture)).toHaveLength(1);
    expect(replacement.texImage2D.mock.calls.filter((args) => args.at(-1) === source)).toHaveLength(1);
  });
  test('restores the names texture once and then reuses it', () => {
    const gl = fakeGl(), canvas = canvasFor(gl);
    const renderer = createProjectionWarpRenderer({ canvas, mesh });
    const name = { id:'names', source:{}, contentVersion:1, opacity:1 };
    const nameUploads = () => gl.texImage2D.mock.calls.filter((args) => args.at(-1) === name.source).length;
    renderer.draw({ layers:[name] });
    expect(nameUploads()).toBe(1);
    renderer.draw({ layers:[{ ...name, opacity:0.5 }] });
    expect(nameUploads()).toBe(1);
    canvas.listeners.webglcontextlost({ preventDefault:vi.fn() });
    canvas.listeners.webglcontextrestored();
    expect(nameUploads()).toBe(2);
    renderer.draw({ layers:[{ ...name, opacity:0.3 }] });
    expect(nameUploads()).toBe(2);
    renderer.dispose();
    expect(gl.deleteTexture).toHaveBeenCalled();
  });
  test('draws static name quads once per frame with clock uniforms and no visibility uploads', () => {
    const gl = fakeGl(), canvas = canvasFor(gl);
    const renderer = createProjectionWarpRenderer({ canvas, mesh });
    const vertices = new Float32Array([
      0,0,0,0, 1,0,0,0, 0,1,0,0,
      0,1,0,0, 1,0,0,0, 1,1,0,0,
    ]);
    const source = {};
    const layer = { id: 'names', source, contentVersion: 1, opacity: 1,
      revealVertices: vertices, revealSeconds: 0.8, selectedIndex: -1 };
    renderer.draw({ layers: [layer] });
    const uploads = gl.bufferData.mock.calls.length;
    const textureUploads = gl.texImage2D.mock.calls.filter((args) => args.at(-1) === source).length;
    for (const seconds of [1.2, 4.4, 8.8, 20, 3.1]) renderer.draw({ layers: [{ ...layer, revealSeconds: seconds, opacity: 0.4 }] });
    for (const invalid of [20.001, -0.001, Number.NaN, Number.POSITIVE_INFINITY])
      expect(() => renderer.draw({ layers: [{ ...layer, revealSeconds: invalid }] })).toThrow(/reveal clock/);
    expect(gl.bufferData).toHaveBeenCalledTimes(uploads);
    expect(gl.texImage2D.mock.calls.filter((args) => args.at(-1) === source)).toHaveLength(textureUploads);
    expect(gl.drawArrays).toHaveBeenLastCalledWith(gl.TRIANGLES, 0, 6);
    expect(gl.uniform1f).toHaveBeenCalledWith('uRevealSeconds', 4.4);
    expect(gl.shaderSource.mock.calls.some(([, sourceCode]) => sourceCode.includes('uRevealSeconds') && sourceCode.includes('aDelay'))).toBe(true);
    expect(gl.shaderSource.mock.calls.some(([, sourceCode]) => sourceCode.includes('aNameIndex-uSelectedIndex'))).toBe(true);
    expect(gl.shaderSource.mock.calls.some(([, sourceCode]) => sourceCode.includes('/1.600'))).toBe(true);
    renderer.draw({ layers: [{ ...layer, contentVersion: 2, selectedIndex: 0 }] });
    expect(gl.bufferData).toHaveBeenCalledTimes(uploads);
    expect(gl.texImage2D.mock.calls.filter((args) => args.at(-1) === source)).toHaveLength(textureUploads + 1);
    const replacement = new Float32Array(vertices);
    renderer.draw({ layers: [{ ...layer, revealVertices: replacement }] });
    expect(gl.bufferData).toHaveBeenCalledTimes(uploads + 1);
    canvas.listeners.webglcontextlost({ preventDefault: vi.fn() });
    canvas.listeners.webglcontextrestored();
    expect(gl.bufferData).toHaveBeenCalledTimes(uploads + 6);
    renderer.dispose();
    expect(gl.deleteBuffer).toHaveBeenCalled();
  });
  test('defaults the names reveal clock to twenty seconds', () => {
    const gl = fakeGl(), renderer = createProjectionWarpRenderer({ canvas: canvasFor(gl), mesh });
    renderer.draw({ layers: [{ id: 'names', source: {}, contentVersion: 1, revealVertices: new Float32Array(24) }] });
    expect(gl.uniform1f).toHaveBeenCalledWith('uRevealSeconds', 20);
    renderer.dispose();
  });
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

  test('relative-source profile accepts small well-conditioned faces and rejects Float32 collapse', () => {
    const small={width:1920,height:1080,validationProfile:'relative-source-v1',vertices:[
      {s:.1,t:.1,x:.1,y:.1,u:0,v:0},{s:.101,t:.1,x:.101,y:.1,u:1,v:0},{s:.1,t:.101,x:.1,y:.101,u:0,v:1}],triangles:[0,1,2]};
    expect(validateProjectionMesh(small)).toBe(small);
    const collapsed={...small,vertices:[
      {s:.3,t:.3,x:.3,y:.3,u:0,v:0},{s:.300000001,t:.3,x:.300000001,y:.3,u:1,v:0},{s:.3,t:.300000001,x:.3,y:.300000001,u:0,v:1}]};
    expect(()=>validateProjectionMesh(collapsed)).toThrow('render precision collapses or inverts a grid triangle');
    const insufficientRatio={...small,vertices:[
      {s:0,t:0,x:.6113237719982862,y:.9376534202601761,u:0,v:0},
      {s:1,t:0,x:.7954265424050391,y:.6015647205058485,u:1,v:0},
      {s:0,t:1,x:.7312631888714295,y:.7186981057826362,u:0,v:1}]};
    expect(()=>validateProjectionMesh(insufficientRatio)).toThrow('render precision collapses or inverts a grid triangle');
    expect(()=>validateProjectionMesh({...small,validationProfile:'unknown'})).toThrow('projection mesh validation profile is unknown');
  });
});
