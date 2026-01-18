// ABOUTME: WebGL-based particle fluid animation for parcel layer
// Extracts discrete points from parcels and animates them with fluid-like swirling motion

/**
 * ParcelAnimator - GPU-accelerated particle flow animation for parcel polygons
 * Extracts colored points from parcels and animates them with fluid dynamics
 */
class ParcelAnimator {
  constructor(container) {
    this.container = container;
    this.canvas = null;
    this.gl = null;
    this.program = null;
    this.buffers = {};
    this.uniforms = {};
    this.isAnimating = false;
    this.animationFrame = null;
    this.startTime = 0;
    this.particleCount = 0;
    this.modelBounds = null;
    this.displayBounds = null;

    // Particle settings
    this.particleSize = 3.0;  // Size of each dot
    this.particlesPerFeature = 50;  // Number of particles to sample per parcel

    this._createCanvas();
    this._initWebGL();
  }

  _createCanvas() {
    // Remove existing animation canvas if present
    const existing = this.container.querySelector('#animationCanvas');
    if (existing) existing.remove();

    // Create WebGL canvas
    this.canvas = document.createElement('canvas');
    this.canvas.id = 'animationCanvas';
    this.canvas.style.cssText = 'position: absolute; pointer-events: none; z-index: 6; display: none; image-rendering: crisp-edges; image-rendering: -webkit-optimize-contrast;';

    // Insert after layers canvas
    const layersCanvas = this.container.querySelector('#layersCanvas');
    if (layersCanvas && layersCanvas.nextSibling) {
      this.container.insertBefore(this.canvas, layersCanvas.nextSibling);
    } else {
      this.container.appendChild(this.canvas);
    }
  }

  _initWebGL() {
    this.gl = this.canvas.getContext('webgl', {
      alpha: true,
      antialias: true,
      premultipliedAlpha: false,
    });

    if (!this.gl) {
      console.error('WebGL not supported, falling back to static rendering');
      return;
    }

    this._compileShaders();
    this._setupBuffers();
  }

  _compileShaders() {
    const gl = this.gl;

    // Vertex shader - particles with fluid motion using simplex noise
    const vertexShaderSource = `
      precision highp float;

      attribute vec2 a_position;      // Original position
      attribute vec3 a_color;         // Particle color
      attribute float a_phase;        // Random phase offset for variety

      uniform vec2 u_resolution;
      uniform float u_time;
      uniform float u_pointSize;

      varying vec3 v_color;

      // Simplex noise functions for fluid motion
      vec3 mod289(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
      vec2 mod289v2(vec2 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
      vec3 permute(vec3 x) { return mod289(((x*34.0)+1.0)*x); }

      float snoise(vec2 v) {
        const vec4 C = vec4(0.211324865405187, 0.366025403784439,
                           -0.577350269189626, 0.024390243902439);
        vec2 i  = floor(v + dot(v, C.yy));
        vec2 x0 = v - i + dot(i, C.xx);
        vec2 i1 = (x0.x > x0.y) ? vec2(1.0, 0.0) : vec2(0.0, 1.0);
        vec4 x12 = x0.xyxy + C.xxzz;
        x12.xy -= i1;
        i = mod289v2(i);
        vec3 p = permute(permute(i.y + vec3(0.0, i1.y, 1.0)) + i.x + vec3(0.0, i1.x, 1.0));
        vec3 m = max(0.5 - vec3(dot(x0,x0), dot(x12.xy,x12.xy), dot(x12.zw,x12.zw)), 0.0);
        m = m*m;
        m = m*m;
        vec3 x = 2.0 * fract(p * C.www) - 1.0;
        vec3 h = abs(x) - 0.5;
        vec3 ox = floor(x + 0.5);
        vec3 a0 = x - ox;
        m *= 1.79284291400159 - 0.85373472095314 * (a0*a0 + h*h);
        vec3 g;
        g.x = a0.x * x0.x + h.x * x0.y;
        g.yz = a0.yz * x12.xz + h.yz * x12.yw;
        return 130.0 * dot(m, g);
      }

      void main() {
        v_color = a_color;

        // Time with per-particle phase offset
        float t = u_time * 0.5 + a_phase;

        // Multi-octave noise for organic fluid motion
        float noiseScale = 0.008;

        // Sample noise at particle position to get flow direction
        float noise1 = snoise(vec2(a_position.x * noiseScale + t * 0.3,
                                    a_position.y * noiseScale + t * 0.2));
        float noise2 = snoise(vec2(a_position.x * noiseScale * 2.0 - t * 0.25,
                                    a_position.y * noiseScale * 2.0 + t * 0.15));
        float noise3 = snoise(vec2(a_position.y * noiseScale * 0.5 + t * 0.4,
                                    a_position.x * noiseScale * 0.5 - t * 0.2));

        // Combined noise for swirling effect
        float swirl = noise1 * 0.5 + noise2 * 0.35 + noise3 * 0.15;

        // Create circular swirling motion
        float angle = swirl * 6.28318;  // Convert to radians
        float radius = 8.0 + sin(t * 0.7 + a_phase * 3.0) * 4.0;  // Pulsing radius

        // Apply fluid displacement
        vec2 offset = vec2(
          cos(angle) * radius,
          sin(angle) * radius
        );

        vec2 pos = a_position + offset;

        // Convert to clip space
        vec2 clipSpace = (pos / u_resolution) * 2.0 - 1.0;
        gl_Position = vec4(clipSpace * vec2(1, -1), 0, 1);
        gl_PointSize = u_pointSize;
      }
    `;

    // Fragment shader - render circular dots
    const fragmentShaderSource = `
      precision highp float;

      varying vec3 v_color;

      void main() {
        // Create circular dot
        vec2 center = gl_PointCoord - vec2(0.5);
        float dist = length(center);

        // Smooth circle edge
        float alpha = 1.0 - smoothstep(0.35, 0.5, dist);

        if (alpha < 0.01) discard;

        gl_FragColor = vec4(v_color, alpha);
      }
    `;

    // Compile vertex shader
    const vertexShader = gl.createShader(gl.VERTEX_SHADER);
    gl.shaderSource(vertexShader, vertexShaderSource);
    gl.compileShader(vertexShader);

    if (!gl.getShaderParameter(vertexShader, gl.COMPILE_STATUS)) {
      console.error('Vertex shader error:', gl.getShaderInfoLog(vertexShader));
      return;
    }

    // Compile fragment shader
    const fragmentShader = gl.createShader(gl.FRAGMENT_SHADER);
    gl.shaderSource(fragmentShader, fragmentShaderSource);
    gl.compileShader(fragmentShader);

    if (!gl.getShaderParameter(fragmentShader, gl.COMPILE_STATUS)) {
      console.error('Fragment shader error:', gl.getShaderInfoLog(fragmentShader));
      return;
    }

    // Link program
    this.program = gl.createProgram();
    gl.attachShader(this.program, vertexShader);
    gl.attachShader(this.program, fragmentShader);
    gl.linkProgram(this.program);

    if (!gl.getProgramParameter(this.program, gl.LINK_STATUS)) {
      console.error('Program link error:', gl.getProgramInfoLog(this.program));
      return;
    }

    // Get uniform locations
    this.uniforms.resolution = gl.getUniformLocation(this.program, 'u_resolution');
    this.uniforms.time = gl.getUniformLocation(this.program, 'u_time');
    this.uniforms.pointSize = gl.getUniformLocation(this.program, 'u_pointSize');

    // Get attribute locations
    this.attributes = {
      position: gl.getAttribLocation(this.program, 'a_position'),
      color: gl.getAttribLocation(this.program, 'a_color'),
      phase: gl.getAttribLocation(this.program, 'a_phase'),
    };
  }

  _setupBuffers() {
    const gl = this.gl;
    this.buffers.position = gl.createBuffer();
    this.buffers.color = gl.createBuffer();
    this.buffers.phase = gl.createBuffer();
  }

  /**
   * Extract particles from GeoJSON parcels
   * @param {Object} geojson - GeoJSON FeatureCollection
   * @param {Function} styleFunction - Function to get style for each feature
   * @param {Object} modelBounds - Model bounds { west, east, north, south }
   * @param {Object} displayBounds - Display bounds { width, height, offsetX, offsetY }
   */
  setPolygonData(geojson, styleFunction, modelBounds, displayBounds) {
    this.modelBounds = modelBounds;
    this.displayBounds = displayBounds;

    if (!geojson?.features || !this.gl) return;

    const positions = [];
    const colors = [];
    const phases = [];

    for (const feature of geojson.features) {
      if (!feature.geometry) continue;

      const style = styleFunction ? styleFunction(feature) : {};
      const fillColor = style.fillColor || style.fill || '#888888';
      const rgb = this._hexToRgb(fillColor);

      // Sample random points within the polygon
      const samplePoints = this._samplePolygon(feature.geometry, this.particlesPerFeature);

      for (const point of samplePoints) {
        const pixel = this._coordToPixel(point);
        positions.push(pixel.x, pixel.y);
        colors.push(rgb.r / 255, rgb.g / 255, rgb.b / 255);
        phases.push(Math.random() * Math.PI * 2);  // Random phase for variety
      }
    }

    // Upload to GPU
    const gl = this.gl;

    gl.bindBuffer(gl.ARRAY_BUFFER, this.buffers.position);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(positions), gl.STATIC_DRAW);

    gl.bindBuffer(gl.ARRAY_BUFFER, this.buffers.color);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(colors), gl.STATIC_DRAW);

    gl.bindBuffer(gl.ARRAY_BUFFER, this.buffers.phase);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(phases), gl.STATIC_DRAW);

    this.particleCount = positions.length / 2;
    console.log(`[ParcelAnimator] Loaded ${this.particleCount} particles from ${geojson.features.length} features`);
  }

  /**
   * Sample random points within a polygon using rejection sampling
   */
  _samplePolygon(geometry, numPoints) {
    const points = [];
    const bounds = this._getGeometryBounds(geometry);

    if (!bounds) return points;

    let attempts = 0;
    const maxAttempts = numPoints * 20;  // Limit to avoid infinite loops

    while (points.length < numPoints && attempts < maxAttempts) {
      attempts++;

      // Random point within bounding box
      const x = bounds.minX + Math.random() * (bounds.maxX - bounds.minX);
      const y = bounds.minY + Math.random() * (bounds.maxY - bounds.minY);

      // Check if point is inside polygon
      if (this._pointInGeometry([x, y], geometry)) {
        points.push([x, y]);
      }
    }

    // If we couldn't get enough points, use the bounds center
    if (points.length === 0) {
      points.push([(bounds.minX + bounds.maxX) / 2, (bounds.minY + bounds.maxY) / 2]);
    }

    return points;
  }

  /**
   * Get bounding box of a geometry
   */
  _getGeometryBounds(geometry) {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;

    const processCoords = (coords) => {
      for (const coord of coords) {
        if (Array.isArray(coord[0])) {
          processCoords(coord);
        } else {
          minX = Math.min(minX, coord[0]);
          minY = Math.min(minY, coord[1]);
          maxX = Math.max(maxX, coord[0]);
          maxY = Math.max(maxY, coord[1]);
        }
      }
    };

    processCoords(geometry.coordinates);

    if (minX === Infinity) return null;
    return { minX, minY, maxX, maxY };
  }

  /**
   * Check if point is inside geometry using ray casting
   */
  _pointInGeometry(point, geometry) {
    if (geometry.type === 'Polygon') {
      return this._pointInPolygon(point, geometry.coordinates[0]);
    } else if (geometry.type === 'MultiPolygon') {
      for (const polygon of geometry.coordinates) {
        if (this._pointInPolygon(point, polygon[0])) {
          return true;
        }
      }
    }
    return false;
  }

  /**
   * Ray casting algorithm for point-in-polygon test
   */
  _pointInPolygon(point, ring) {
    const [x, y] = point;
    let inside = false;

    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const xi = ring[i][0], yi = ring[i][1];
      const xj = ring[j][0], yj = ring[j][1];

      if (((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi)) {
        inside = !inside;
      }
    }

    return inside;
  }

  _coordToPixel(coord) {
    const [x, y] = coord;
    const bounds = this.modelBounds;
    const display = this.displayBounds;

    const pctX = (x - bounds.west) / (bounds.east - bounds.west);
    const pctY = (bounds.north - y) / (bounds.north - bounds.south);

    return {
      x: pctX * display.width,
      y: pctY * display.height
    };
  }

  _hexToRgb(hex) {
    const shorthandRegex = /^#?([a-f\d])([a-f\d])([a-f\d])$/i;
    hex = hex.replace(shorthandRegex, (m, r, g, b) => r + r + g + g + b + b);

    const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    return result ? {
      r: parseInt(result[1], 16),
      g: parseInt(result[2], 16),
      b: parseInt(result[3], 16)
    } : { r: 128, g: 128, b: 128 };
  }

  /**
   * Update canvas position to match display bounds
   * Supports high-DPI rendering via devicePixelRatio and optional URL override
   */
  updatePosition(displayBounds, modelBounds) {
    if (!displayBounds || !modelBounds) return;

    this.displayBounds = displayBounds;
    this.modelBounds = modelBounds;

    // Check for explicit resolution override via URL parameter (e.g., ?canvasRes=1920x1200)
    const urlParams = new URLSearchParams(window.location.search);
    const canvasRes = urlParams.get('canvasRes');

    let canvasWidth, canvasHeight, dpr;

    if (canvasRes && canvasRes.match(/^\d+x\d+$/)) {
      // Explicit resolution override - render at exact specified resolution
      const [w, h] = canvasRes.split('x').map(Number);
      canvasWidth = w;
      canvasHeight = h;
      dpr = canvasWidth / displayBounds.width;
      console.log(`[ParcelAnimator] Using explicit resolution: ${w}x${h}`);
    } else {
      // Use devicePixelRatio for high-DPI rendering
      dpr = window.devicePixelRatio || 1;
      canvasWidth = Math.round(displayBounds.width * dpr);
      canvasHeight = Math.round(displayBounds.height * dpr);
    }

    // Position canvas exactly over the layers canvas (CSS size)
    this.canvas.style.left = displayBounds.offsetX + 'px';
    this.canvas.style.top = displayBounds.offsetY + 'px';
    this.canvas.style.width = displayBounds.width + 'px';
    this.canvas.style.height = displayBounds.height + 'px';

    // Set canvas internal resolution (scaled for high-DPI)
    this.canvas.width = canvasWidth;
    this.canvas.height = canvasHeight;

    if (this.gl) {
      this.gl.viewport(0, 0, canvasWidth, canvasHeight);
    }
  }

  /**
   * Start the animation loop
   */
  start() {
    if (this.isAnimating) return;
    if (!this.gl || !this.particleCount) {
      console.warn('[ParcelAnimator] Cannot start: no WebGL or particle data');
      return;
    }

    this.isAnimating = true;
    this.startTime = performance.now();
    this.canvas.style.display = 'block';

    console.log('[ParcelAnimator] Animation started');
    this._animate();
  }

  /**
   * Stop the animation loop
   */
  stop() {
    this.isAnimating = false;
    if (this.animationFrame) {
      cancelAnimationFrame(this.animationFrame);
      this.animationFrame = null;
    }
    this.canvas.style.display = 'none';
    console.log('[ParcelAnimator] Animation stopped');
  }

  _animate() {
    if (!this.isAnimating) return;

    this._render();
    this.animationFrame = requestAnimationFrame(() => this._animate());
  }

  _render() {
    const gl = this.gl;
    if (!gl || !this.program) return;

    // Clear with transparent
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);

    // Enable blending for transparency
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

    gl.useProgram(this.program);

    // Set uniforms
    const time = (performance.now() - this.startTime) / 1000;
    gl.uniform2f(this.uniforms.resolution, this.canvas.width, this.canvas.height);
    gl.uniform1f(this.uniforms.time, time);
    gl.uniform1f(this.uniforms.pointSize, this.particleSize);

    // Bind position buffer
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buffers.position);
    gl.enableVertexAttribArray(this.attributes.position);
    gl.vertexAttribPointer(this.attributes.position, 2, gl.FLOAT, false, 0, 0);

    // Bind color buffer
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buffers.color);
    gl.enableVertexAttribArray(this.attributes.color);
    gl.vertexAttribPointer(this.attributes.color, 3, gl.FLOAT, false, 0, 0);

    // Bind phase buffer
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buffers.phase);
    gl.enableVertexAttribArray(this.attributes.phase);
    gl.vertexAttribPointer(this.attributes.phase, 1, gl.FLOAT, false, 0, 0);

    // Draw points
    gl.drawArrays(gl.POINTS, 0, this.particleCount);
  }

  /**
   * Destroy the animator and cleanup resources
   */
  destroy() {
    this.stop();

    if (this.gl) {
      this.gl.deleteProgram(this.program);
      this.gl.deleteBuffer(this.buffers.position);
      this.gl.deleteBuffer(this.buffers.color);
      this.gl.deleteBuffer(this.buffers.phase);
    }

    if (this.canvas && this.canvas.parentNode) {
      this.canvas.parentNode.removeChild(this.canvas);
    }
  }
}

// Expose globally
window.ParcelAnimator = ParcelAnimator;
