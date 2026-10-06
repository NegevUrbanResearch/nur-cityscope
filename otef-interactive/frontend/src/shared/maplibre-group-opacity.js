/** Fade a completed run of native layers once, preserving the framebuffer beneath it. */
export function createMapLibreGroupOpacity(id, opacity) {
  let resources = null;
  let captured = false;
  const vertexSource = `
    attribute vec2 a_position;
    varying vec2 v_uv;
    void main() {
      v_uv = (a_position + 1.0) * 0.5;
      gl_Position = vec4(a_position, 0.0, 1.0);
    }`;
  const fragmentSource = `
    precision mediump float;
    uniform sampler2D u_background;
    uniform sampler2D u_group;
    uniform float u_opacity;
    varying vec2 v_uv;
    void main() {
      gl_FragColor = mix(texture2D(u_background, v_uv), texture2D(u_group, v_uv), u_opacity);
    }`;

  function shader(gl, type, source) {
    const handle = gl.createShader(type);
    gl.shaderSource(handle, source);
    gl.compileShader(handle);
    if (!gl.getShaderParameter(handle, gl.COMPILE_STATUS)) {
      const error = gl.getShaderInfoLog(handle);
      gl.deleteShader(handle);
      throw new Error(`Marker group shader: ${error}`);
    }
    return handle;
  }

  function initialize(gl) {
    if (resources && gl.isProgram(resources.program)) return;
    const vertex = shader(gl, gl.VERTEX_SHADER, vertexSource);
    const fragment = shader(gl, gl.FRAGMENT_SHADER, fragmentSource);
    const program = gl.createProgram();
    gl.attachShader(program, vertex);
    gl.attachShader(program, fragment);
    gl.linkProgram(program);
    gl.deleteShader(vertex);
    gl.deleteShader(fragment);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      const error = gl.getProgramInfoLog(program);
      gl.deleteProgram(program);
      throw new Error(`Marker group program: ${error}`);
    }
    const vertexArrayExtension = gl.createVertexArray ? null : gl.getExtension("OES_vertex_array_object");
    const bindVertexArray = (array) => vertexArrayExtension
      ? vertexArrayExtension.bindVertexArrayOES(array) : gl.bindVertexArray(array);
    const buffer = gl.createBuffer();
    bindVertexArray(null);
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    resources = {
      program, buffer, width: 0, height: 0,
      vertexArray: vertexArrayExtension ? vertexArrayExtension.createVertexArrayOES() : gl.createVertexArray(),
      bindVertexArray,
      deleteVertexArray: (array) => vertexArrayExtension
        ? vertexArrayExtension.deleteVertexArrayOES(array) : gl.deleteVertexArray(array),
      textures: [gl.createTexture(), gl.createTexture()],
      position: gl.getAttribLocation(program, "a_position"),
      background: gl.getUniformLocation(program, "u_background"),
      group: gl.getUniformLocation(program, "u_group"),
      opacity: gl.getUniformLocation(program, "u_opacity"),
    };
  }

  function capture(gl, index) {
    gl.activeTexture(gl.TEXTURE0 + index);
    gl.bindTexture(gl.TEXTURE_2D, resources.textures[index]);
    gl.copyTexSubImage2D(gl.TEXTURE_2D, 0, 0, 0, 0, 0, resources.width, resources.height);
  }

  const begin = {
    id: `${id}-begin`, type: "custom", renderingMode: "2d",
    onAdd(_map, gl) { initialize(gl); },
    render(gl) {
      captured = false;
      if (gl.isContextLost()) return;
      initialize(gl);
      const width = gl.drawingBufferWidth;
      const height = gl.drawingBufferHeight;
      if (!width || !height) return;
      if (resources.width !== width || resources.height !== height) {
        resources.width = width;
        resources.height = height;
        for (let index = 0; index < 2; index += 1) {
          gl.activeTexture(gl.TEXTURE0 + index);
          gl.bindTexture(gl.TEXTURE_2D, resources.textures[index]);
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
          gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
        }
      }
      capture(gl, 0);
      captured = true;
    },
  };
  const end = {
    id: `${id}-end`, type: "custom", renderingMode: "2d",
    render(gl) {
      if (!captured || !resources || gl.isContextLost()) return;
      captured = false;
      capture(gl, 1);
      gl.disable(gl.BLEND);
      gl.disable(gl.DEPTH_TEST);
      gl.disable(gl.STENCIL_TEST);
      gl.colorMask(true, true, true, true);
      gl.depthMask(false);
      // The default VAO can retain enabled attributes whose buffers MapLibre deleted.
      resources.bindVertexArray(resources.vertexArray);
      gl.useProgram(resources.program);
      gl.bindBuffer(gl.ARRAY_BUFFER, resources.buffer);
      gl.enableVertexAttribArray(resources.position);
      gl.vertexAttribPointer(resources.position, 2, gl.FLOAT, false, 0, 0);
      for (let index = 0; index < 2; index += 1) {
        gl.activeTexture(gl.TEXTURE0 + index);
        gl.bindTexture(gl.TEXTURE_2D, resources.textures[index]);
      }
      gl.uniform1i(resources.background, 0);
      gl.uniform1i(resources.group, 1);
      gl.uniform1f(resources.opacity, typeof opacity === "function" ? opacity() : opacity);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      resources.bindVertexArray(null);
    },
    onRemove(_map, gl) {
      if (!resources) return;
      for (const texture of resources.textures) gl.deleteTexture(texture);
      resources.deleteVertexArray(resources.vertexArray);
      gl.deleteBuffer(resources.buffer);
      gl.deleteProgram(resources.program);
      resources = null;
      captured = false;
    },
  };
  return { begin, end };
}
