const WIDTH = 1920;
const HEIGHT = 1080;
const EPSILON = 1e-5;

function finite(value) { return typeof value === "number" && Number.isFinite(value); }

export function validateProjectionMesh(mesh) {
  if (!mesh || !finite(mesh.width) || !finite(mesh.height) || mesh.width !== WIDTH || mesh.height !== HEIGHT) throw new Error("projection mesh must be 1920x1080");
  if (!Array.isArray(mesh.vertices) || mesh.vertices.length < 3 || !Array.isArray(mesh.triangles) || mesh.triangles.length < 3 || mesh.triangles.length % 3) throw new Error("projection mesh geometry is incomplete");
  if (mesh.vertices.length > 65536) throw new Error("projection mesh exceeds unsigned-short vertex capacity");
  for (const point of mesh.vertices) {
    if (!point || ![point.s, point.t, point.x, point.y, point.u, point.v].every(finite)) throw new Error("projection mesh contains non-finite vertex");
    for (const key of ["s", "t", "u", "v"]) if (point[key] < -EPSILON || point[key] > 1 + EPSILON) throw new Error("projection mesh texture coordinates are out of range");
    for (const key of ["x", "y"]) if (point[key] < -1 - EPSILON || point[key] > 2 + EPSILON) throw new Error("projection mesh destination coordinates are out of range");
  }
  for (let i = 0; i < mesh.triangles.length; i += 3) {
    const indices = mesh.triangles.slice(i, i + 3);
    if (!indices.every((n) => finite(n) && Number.isInteger(n) && n >= 0 && n <= 65535 && n < mesh.vertices.length)) throw new Error("projection mesh triangle index is invalid or exceeds unsigned-short capacity");
    const [a, b, c] = indices.map((n) => mesh.vertices[n]);
    const area = (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
    if (!(area > EPSILON)) throw new Error("projection mesh triangle is inverted or degenerate");
  }
  return mesh;
}

const COMPOSE_VERTEX = `attribute vec2 aSource; uniform mat3 uMatrix; varying vec2 vUv; void main(){ vec3 p=uMatrix*vec3(aSource,1.0); gl_Position=vec4(2.0*p.x-p.z,p.z-2.0*p.y,0.0,p.z); vUv=aSource; }`;
const COMPOSE_FRAGMENT = `precision mediump float; varying vec2 vUv; uniform sampler2D uSource; uniform float uOpacity; uniform vec4 uClip; void main(){ vec2 outputUv=vec2((gl_FragCoord.x+0.5)/1920.0,1.0-(gl_FragCoord.y+0.5)/1080.0); if(outputUv.x<uClip.x||outputUv.y<uClip.y||outputUv.x>uClip.z||outputUv.y>uClip.w) discard; vec4 color=texture2D(uSource,vUv); gl_FragColor=vec4(color.rgb,color.a*uOpacity); }`;
const FINAL_VERTEX = `attribute vec2 aPosition; attribute vec2 aUv; varying vec2 vUv; void main(){vUv=vec2(aUv.x,1.0-aUv.y);gl_Position=vec4(aPosition,0.0,1.0);}`;
const FINAL_FRAGMENT = `precision mediump float; varying vec2 vUv; uniform sampler2D uTexture; void main(){gl_FragColor=texture2D(uTexture,vUv);}`;

const OUTPUT_CONTEXT_ATTRIBUTES = Object.freeze({ alpha: true, premultipliedAlpha: true });

function compileShader(gl, type, source) {
  const result = gl.createShader(type);
  gl.shaderSource(result, source);
  gl.compileShader(result);
  if (gl.getShaderParameter && !gl.getShaderParameter(result, gl.COMPILE_STATUS)) throw new Error(`projection shader compile failed: ${gl.getShaderInfoLog?.(result) || "unknown error"}`);
  return result;
}

function createProgram(gl, vertexSource, fragmentSource, attributes) {
  let vertex;
  let fragment;
  let result;
  try {
    vertex = compileShader(gl, gl.VERTEX_SHADER, vertexSource);
    fragment = compileShader(gl, gl.FRAGMENT_SHADER, fragmentSource);
    result = gl.createProgram();
    gl.attachShader(result, vertex);
    gl.attachShader(result, fragment);
    for (const [name, location] of Object.entries(attributes)) gl.bindAttribLocation?.(result, location, name);
    gl.linkProgram(result);
    if (gl.getProgramParameter && !gl.getProgramParameter(result, gl.LINK_STATUS)) throw new Error(`projection shader link failed: ${gl.getProgramInfoLog?.(result) || "unknown error"}`);
    return result;
  } catch (error) {
    gl.deleteProgram?.(result);
    throw error;
  } finally {
    gl.deleteShader?.(vertex);
    gl.deleteShader?.(fragment);
  }
}

function identity() { return [1, 0, 0, 0, 1, 0, 0, 0, 1]; }

function matrix9(value) {
  if (value == null) return identity();
  if ((Array.isArray(value) || ArrayBuffer.isView(value)) && value.length === 9 && Array.from(value).every(finite)) return Array.from(value);
  throw new Error("source projective matrix must contain 9 finite values");
}

function descriptor(item) {
  const source = item?.source;
  if (!source) throw new Error("projection layer requires an explicit texture source");
  const clip = item.clip || [0, 0, 1, 1];
  if (!Array.isArray(clip) || clip.length !== 4 || !clip.every(finite) || clip[0] < 0 || clip[1] < 0 || clip[2] > 1 || clip[3] > 1 || clip[2] <= clip[0] || clip[3] <= clip[1]) throw new Error("projection layer clip is invalid");
  const opacity = item.opacity == null ? 1 : item.opacity;
  if (!finite(opacity) || opacity < 0 || opacity > 1) throw new Error("projection layer opacity is invalid");
  return { source, matrix: matrix9(item.matrix), clip: [...clip], opacity };
}

function meshArrays(mesh) {
  return {
    positions: new Float32Array(mesh.vertices.flatMap((p) => [p.x * 2 - 1, 1 - p.y * 2])),
    uvs: new Float32Array(mesh.vertices.flatMap((p) => [p.u, p.v])),
    indices: new Uint16Array(mesh.triangles),
  };
}

function setAttribute(gl, program, name, buffer, size) {
  const location = gl.getAttribLocation?.(program, name);
  if (location == null || location < 0) throw new Error(`projection shader attribute missing: ${name}`);
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.enableVertexAttribArray(location);
  gl.vertexAttribPointer(location, size, gl.FLOAT, false, 0, 0);
  return location;
}

function configureTexture(gl, texture) {
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
}

function createMeshBuffers(gl, mesh) {
  const arrays = meshArrays(mesh);
  const created = {};
  try {
    created.position = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, created.position);
    gl.bufferData(gl.ARRAY_BUFFER, arrays.positions, gl.STATIC_DRAW);
    created.uv = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, created.uv);
    gl.bufferData(gl.ARRAY_BUFFER, arrays.uvs, gl.STATIC_DRAW);
    created.index = gl.createBuffer();
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, created.index);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, arrays.indices, gl.STATIC_DRAW);
    created.count = arrays.indices.length;
    return created;
  } catch (error) {
    for (const key of ["position", "uv", "index"]) if (created[key]) gl.deleteBuffer?.(created[key]);
    throw error;
  }
}

export function createProjectionWarpRenderer({ canvas, mesh, gl: suppliedGl } = {}) {
  let currentMesh = validateProjectionMesh(mesh);
  let gl = suppliedGl || canvas?.getContext?.("webgl", OUTPUT_CONTEXT_ATTRIBUTES);
  if (!gl) throw new Error("browser projection requires WebGL");
  let resources = null;
  let lost = false;
  let latest = [];

  const release = () => {
    if (!resources) return;
    for (const key of ["quad", "position", "uv", "index"]) if (resources[key]) gl.deleteBuffer?.(resources[key]);
    for (const key of ["composed", "sourceTexture"]) if (resources[key]) gl.deleteTexture?.(resources[key]);
    if (resources.framebuffer) gl.deleteFramebuffer?.(resources.framebuffer);
    for (const key of ["compose", "final"]) if (resources[key]) gl.deleteProgram?.(resources[key]);
    resources = null;
  };

  const dropResources = () => { resources = null; };

  const createResources = () => {
    if (resources) return resources;
    const created = {};
    try {
      created.compose = createProgram(gl, COMPOSE_VERTEX, COMPOSE_FRAGMENT, { aSource: 0 });
      created.final = createProgram(gl, FINAL_VERTEX, FINAL_FRAGMENT, { aPosition: 0, aUv: 1 });
      created.quad = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, created.quad);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]), gl.STATIC_DRAW);
      Object.assign(created, createMeshBuffers(gl, currentMesh));
      created.composed = gl.createTexture();
      configureTexture(gl, created.composed);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, WIDTH, HEIGHT, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      created.framebuffer = gl.createFramebuffer();
      gl.bindFramebuffer(gl.FRAMEBUFFER, created.framebuffer);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, created.composed, 0);
      if (gl.checkFramebufferStatus && gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) throw new Error("projection composition framebuffer is incomplete");
      created.sourceTexture = gl.createTexture();
      configureTexture(gl, created.sourceTexture);
      created.finalUv = gl.getAttribLocation?.(created.final, "aUv");
      resources = created;
      return resources;
    } catch (error) {
      resources = created;
      release();
      throw error;
    }
  };

  const onLost = (event) => { event?.preventDefault?.(); lost = true; dropResources(); };
  const onRestored = () => { lost = false; if (latest.length) draw({ layers: latest }); };
  canvas?.addEventListener?.("webglcontextlost", onLost);
  canvas?.addEventListener?.("webglcontextrestored", onRestored);

  function draw({ layers = [], image, map, overlays = [], patterns = [], media = [] } = {}) {
    if (lost) return false;
    const input = layers.length ? layers : [image, map, ...overlays, ...patterns, ...media].filter(Boolean).map((source) => ({ source }));
    const valid = input.map(descriptor);
    latest = valid;
    const r = createResources();
    gl.enable?.(gl.BLEND);
    gl.blendFuncSeparate?.(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.pixelStorei?.(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.bindFramebuffer(gl.FRAMEBUFFER, r.framebuffer);
    gl.viewport(0, 0, WIDTH, HEIGHT);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.useProgram(r.compose);
    setAttribute(gl, r.compose, "aSource", r.quad, 2);
    gl.disableVertexAttribArray?.(r.finalUv);
    gl.uniform1i?.(gl.getUniformLocation?.(r.compose, "uSource"), 0);
    for (const layer of valid) {
      gl.activeTexture?.(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, r.sourceTexture);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, layer.source);
      gl.uniformMatrix3fv?.(gl.getUniformLocation?.(r.compose, "uMatrix"), false, new Float32Array(layer.matrix));
      gl.uniform4fv?.(gl.getUniformLocation?.(r.compose, "uClip"), new Float32Array(layer.clip));
      gl.uniform1f?.(gl.getUniformLocation?.(r.compose, "uOpacity"), layer.opacity);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, canvas?.width || WIDTH, canvas?.height || HEIGHT);
    gl.disable?.(gl.BLEND);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.useProgram(r.final);
    setAttribute(gl, r.final, "aPosition", r.position, 2);
    setAttribute(gl, r.final, "aUv", r.uv, 2);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, r.index);
    gl.activeTexture?.(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, r.composed);
    gl.uniform1i?.(gl.getUniformLocation?.(r.final, "uTexture"), 0);
    gl.drawElements(gl.TRIANGLES, r.count, gl.UNSIGNED_SHORT, 0);
    return true;
  }

  return {
    draw,
    setMesh(next) {
      const checked = validateProjectionMesh(next);
      if (resources) {
        const replacement = createMeshBuffers(gl, checked);
        for (const key of ["position", "uv", "index"]) gl.deleteBuffer?.(resources[key]);
        Object.assign(resources, replacement);
      }
      currentMesh = checked;
    },
    getMesh: () => currentMesh,
    isContextLost: () => lost,
    recoverContext(nextGl) { release(); gl = nextGl || canvas?.getContext?.("webgl", OUTPUT_CONTEXT_ATTRIBUTES); if (!gl) throw new Error("browser projection requires WebGL"); lost = false; if (latest.length) draw({ layers: latest }); },
    dispose() { release(); canvas?.removeEventListener?.("webglcontextlost", onLost); canvas?.removeEventListener?.("webglcontextrestored", onRestored); lost = true; },
  };
}

export { WIDTH as PROJECTION_WIDTH, HEIGHT as PROJECTION_HEIGHT };
