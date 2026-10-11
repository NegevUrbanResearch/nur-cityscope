import { createProjectionShelterAdapter } from "./projection-shelter-adapter.js";
import { createProjectionLayerTextures } from "./projection-layer-textures.js";
import { SHELTER_VECTOR_LAYER_ID } from "../shared/maplibre-nli-shelters.js";

const VERTEX = `attribute vec2 a_position;
varying vec2 v_uv;
void main() {
  v_uv = vec2((a_position.x + 1.0) * 0.5, (1.0 - a_position.y) * 0.5);
  gl_Position = vec4(a_position, 0.0, 1.0);
}`;
const FRAGMENT = `precision highp float;
uniform sampler2D u_image;
varying vec2 v_uv;
void main() { gl_FragColor = texture2D(u_image, v_uv); }`;

function compile(gl, type, source) {
  const shader = gl.createShader(type);
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const error = gl.getShaderInfoLog(shader);
    gl.deleteShader(shader);
    throw new Error(`Shelter projection shader: ${error}`);
  }
  return shader;
}

/** Keep shelters below people while drawing vectors at the map framebuffer resolution. */
export function createProjectionShelterLayer({ document = globalThis.document, getSnapshot } = {}) {
  let map, adapter, resources;
  return {
    id: SHELTER_VECTOR_LAYER_ID, type: "custom", renderingMode: "2d",
    onAdd(nextMap, gl) {
      map = nextMap;
      adapter = createProjectionShelterAdapter({ map, document, getSnapshot });
      const vertex = compile(gl, gl.VERTEX_SHADER, VERTEX);
      const fragment = compile(gl, gl.FRAGMENT_SHADER, FRAGMENT);
      const program = gl.createProgram();
      gl.attachShader(program, vertex);
      gl.attachShader(program, fragment);
      gl.linkProgram(program);
      gl.deleteShader(vertex);
      gl.deleteShader(fragment);
      if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
        const error = gl.getProgramInfoLog(program);
        gl.deleteProgram(program);
        throw new Error(`Shelter projection program: ${error}`);
      }
      const extension = gl.createVertexArray ? null : gl.getExtension("OES_vertex_array_object");
      const bindVertexArray = value => extension ? extension.bindVertexArrayOES(value) : gl.bindVertexArray(value);
      const vertexArray = extension ? extension.createVertexArrayOES() : gl.createVertexArray();
      const buffer = gl.createBuffer();
      const position = gl.getAttribLocation(program, "a_position");
      bindVertexArray(vertexArray);
      gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
      gl.enableVertexAttribArray(position);
      gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);
      bindVertexArray(null);
      resources = { program, buffer, vertexArray, bindVertexArray,
        deleteVertexArray: value => extension ? extension.deleteVertexArrayOES(value) : gl.deleteVertexArray(value),
        image: gl.getUniformLocation(program, "u_image"), textures: createProjectionLayerTextures(gl) };
    },
    render(gl) {
      if (!resources || gl.isContextLost()) return;
      const descriptor = adapter.descriptor({ source: map.getCanvas() });
      if (!descriptor) return;
      gl.activeTexture(gl.TEXTURE0);
      const premultiply = gl.getParameter(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL);
      const flipY = gl.getParameter(gl.UNPACK_FLIP_Y_WEBGL);
      let texture;
      try {
        gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
        gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
        texture = resources.textures.bind({ ...descriptor, id: "map" });
      } finally {
        gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, premultiply);
        gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, flipY);
      }
      if (!texture) return;
      gl.disable(gl.DEPTH_TEST);
      gl.disable(gl.STENCIL_TEST);
      gl.depthMask(false);
      gl.colorMask(true, true, true, true);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      resources.bindVertexArray(resources.vertexArray);
      gl.useProgram(resources.program);
      gl.uniform1i(resources.image, 0);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      resources.bindVertexArray(null);
    },
    onRemove(_map, gl) {
      adapter?.dispose();
      if (resources) {
        resources.textures.dispose();
        gl.deleteBuffer(resources.buffer);
        gl.deleteProgram(resources.program);
        resources.deleteVertexArray(resources.vertexArray);
      }
      adapter = resources = map = null;
    },
  };
}
