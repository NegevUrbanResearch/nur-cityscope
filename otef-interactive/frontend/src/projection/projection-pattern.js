import { DEFAULT_PROJECTION_CONFIG, validateProjectionConfig } from "../shared/projection-config-schema.js";
import { t3ToOutput } from "../shared/projection-config-geometry.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PATTERNS = new Set(["off", "grid", "output_id"]);

function node(tag) {
  if (typeof document !== "undefined" && typeof document.createElementNS === "function") return document.createElementNS("http://www.w3.org/2000/svg", tag);
  return {
    children: [], style: {}, dataset: {},
    setAttribute(name, value) { this[name] = String(value); },
    appendChild(child) { this.children.push(child); child.parentElement = this; return child; },
  };
}

function sourceToOutput(u, v, config, branch) {
  const pre = config.pre;
  const radians = (-Number(pre.rotateDeg) * Math.PI) / 180;
  // The camera's pre translation is expressed in canonical 1920×1080
  // base-view axes. Rotate in pixels, then return to normalized T3 space.
  const aspect = 1920 / 1080;
  const x = (u - 0.5 + Number(pre.tx)) * aspect;
  const y = v - 0.5 + Number(pre.ty);
  const rotated = {
    u: 0.5 + (Number(pre.scale) * (x * Math.cos(radians) - y * Math.sin(radians))) / aspect,
    v: 0.5 + Number(pre.scale) * (x * Math.sin(radians) + y * Math.cos(radians)),
  };
  return t3ToOutput(rotated, branch);
}

function drawPath(svg, points, stroke = "white", width = 0.002) {
  const path = node("path");
  path.setAttribute("d", `M ${points.map((p) => `${p.u} ${p.v}`).join(" L ")}`);
  path.setAttribute("fill", "none"); path.setAttribute("stroke", stroke); path.setAttribute("stroke-width", width);
  svg.appendChild(path);
}

export function createProjectionPattern({ host, spanId, clock = globalThis, table = "otef" } = {}) {
  let svg = null;
  let timer = null;
  let disposed = false;
  let config = DEFAULT_PROJECTION_CONFIG;
  let activeCommand = null;

  const clearTimer = () => { if (timer !== null && typeof clock.clearTimeout === "function") clock.clearTimeout(timer); timer = null; };
  const remove = ({ clearCommand = true } = {}) => { clearTimer(); if (svg?.parentElement?.removeChild) svg.parentElement.removeChild(svg); else if (svg && host?.removeChild) host.removeChild(svg); svg = null; if (clearCommand) activeCommand = null; };
  const armExpiry = () => { clearTimer(); if (typeof clock.setTimeout === "function") timer = clock.setTimeout(remove, 3000); };

  function render(command, renewExpiry) {
    if (svg?.parentElement?.removeChild) svg.parentElement.removeChild(svg);
    else if (svg && host?.removeChild) host.removeChild(svg);
    svg = node("svg");
    svg.setAttribute("viewBox", "0 0 1 1"); svg.setAttribute("preserveAspectRatio", "none");
    svg.dataset.pattern = command.pattern;
    svg.style.position = "absolute"; svg.style.inset = "0"; svg.style.width = "100%"; svg.style.height = "100%"; svg.style.pointerEvents = "none"; svg.style.zIndex = "20";
    const branch = config.outputs[spanId];
    const corners = [[0, 0], [1, 0], [1, 1], [0, 1]].map(([u, v]) => sourceToOutput(u, v, config, branch));
    drawPath(svg, [...corners, corners[0]], "#fff", 0.003);
    if (command.pattern === "grid") {
      for (let i = 1; i < 10; i += 1) {
        const n = i / 10;
        drawPath(svg, [sourceToOutput(n, 0, config, branch), sourceToOutput(n, 1, config, branch)], "#fff", 0.001);
        drawPath(svg, [sourceToOutput(0, n, config, branch), sourceToOutput(1, n, config, branch)], "#fff", 0.001);
      }
    } else {
      const point = sourceToOutput(0.5, 0.52, config, branch);
      const label = node("text"); label.setAttribute("x", point.u); label.setAttribute("y", point.v); label.setAttribute("text-anchor", "middle"); label.setAttribute("fill", "white"); label.setAttribute("font-size", "0.08"); label.textContent = spanId.toUpperCase(); svg.appendChild(label);
    }
    if (host?.appendChild) host.appendChild(svg);
    if (renewExpiry) armExpiry();
  }

  function setConfig(next) {
    if (Object.keys(validateProjectionConfig(next || {})).length !== 0) return false;
    config = next;
    if (activeCommand && !disposed) render(activeCommand, false);
    return true;
  }

  function receive(command = {}) {
    if (disposed || spanId !== "left" && spanId !== "right" || command.type !== "otef_projection_pattern" || command.table !== table || command.output !== spanId || !PATTERNS.has(command.pattern) || !UUID.test(String(command.sourceId || ""))) return false;
    if (command.pattern === "off") { remove(); return true; }
    activeCommand = { ...command };
    render(activeCommand, true);
    return true;
  }

  return { receive, setConfig, clear: remove, dispose() { disposed = true; remove(); } };
}
