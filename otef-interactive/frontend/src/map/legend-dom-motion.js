import { createLegendMotion } from "../shared/legend-motion.js";
import { resolveMotionMode } from "../shared/reduced-motion.js";
import { interpolateLegendPlacement } from "../shared/legend-placement-motion.js";

/** Reconcile rows by identity; retain departures without replacing unchanged labels. */
export function createLegendDomMotion({ element, content,
  now = () => performance.now(), requestFrame = globalThis.requestAnimationFrame?.bind(globalThis),
  cancelFrame = globalThis.cancelAnimationFrame?.bind(globalThis), motionMode = resolveMotionMode,
} = {}) {
  const supported = !!(content?.replaceChildren && content?.querySelectorAll && requestFrame);
  const motion = createLegendMotion({ now, motionMode, interpolateData: interpolateLegendPlacement });
  const nodes = new Map();
  let frame = null, disposed = false;
  const original = { width: element.style?.width || "", height: element.style?.height || "", transition: element.style?.transition || "" };
  let targetSize = null;
  let projectionMarkup;

  function paint(state) {
    const projection = element.classList.contains("map-legend-projection");
    element.style.opacity = String(state.opacity);
    // The projection compositor owns visibility of its DOM measurement source.
    if (!projection) element.style.visibility = state.opacity === 0 ? "hidden" : "";
    element.setAttribute("aria-hidden", String(state.opacity === 0));
    element.style.pointerEvents = state.opacity === 0 ? "none" : "";
    const retained = new Set(state.rows.map(row => row.id));
    for (const [id, node] of nodes) {
      if (!retained.has(id)) { node.remove(); nodes.delete(id); }
    }
    const displayScale = Number(element.ownerDocument.body?.dataset.gisDisplayScale) || 1;
    for (const node of nodes.values()) node.style.transform = "";
    const origin = element.getBoundingClientRect();
    for (const row of state.rows) {
      const node = nodes.get(row.id);
      if (!node) continue;
      if (projection && row.data.placement && projectionMarkup) {
        const holder = content.ownerDocument.createElement("div");
        holder.innerHTML = projectionMarkup(row.data.placement, row.data.font, row.data.layerId);
        const rendered = holder.firstElementChild;
        if (node.innerHTML !== rendered.innerHTML) node.innerHTML = rendered.innerHTML;
        for (const property of ["left", "top", "width", "height"]) node.style[property] = rendered.style[property];
      }
      const rect = node.getBoundingClientRect();
      const x = projection ? Number.parseFloat(node.style.left) || 0 : (rect.left - origin.left) / displayScale;
      const y = projection ? Number.parseFloat(node.style.top) || 0 : (rect.top - origin.top) / displayScale;
      node.style.opacity = String(row.opacity);
      node.style.transformOrigin = "top left";
      node.style.transform = `translate(${row.x - x}px, ${row.y - y}px) scale(${row.scale})`;
      node.setAttribute("aria-hidden", String(row.departing));
    }
    if (targetSize && !state.rows.some(row => row.departing)) {
      element.style.transition = motionMode() === "reduced" ? "none" : "width 300ms ease, height 300ms ease";
      element.style.width = `${targetSize.width}px`;
      element.style.height = `${targetSize.height}px`;
    }
    if (!state.moving) {
      for (const row of state.rows) {
        const node = nodes.get(row.id);
        node.style.opacity = "";
        if (!projection) node.style.transform = "";
      }
      if (!element.classList.contains("map-legend-projection")) {
        element.style.width = original.width;
        element.style.height = original.height;
        content.style.width = "";
        content.style.overflow = "";
        element.style.transition = original.transition;
        targetSize = null;
      }
    }
  }

  function tick() {
    frame = null;
    if (disposed) return;
    const state = motion.sample();
    paint(state);
    if (state.moving) frame = requestFrame(tick);
  }

  function render(html, { visible = !!html, immediate = false, placements, scale = 1, font, renderProjection } = {}) {
    if (disposed) return;
    if (!supported) { content.innerHTML = html; return; }
    const prior = motion.sample();
    paint(prior);
    const projection = element.classList.contains("map-legend-projection");
    projectionMarkup = renderProjection;
    const oldRect = element.getBoundingClientRect();
    const displayScale = Number(element.ownerDocument.body?.dataset.gisDisplayScale) || 1;
    if (!projection) { element.style.transition = "none"; element.style.width = original.width; element.style.height = original.height; content.style.width = ""; }
    const holder = content.ownerDocument.createElement("div");
    holder.innerHTML = html;
    const desiredNodes = [...holder.querySelectorAll(".map-legend-item")];
    const incoming = [];
    const counts = new Map();
    for (const candidate of desiredNodes) {
      const pack = candidate.closest("[data-legend-pack-id]")?.dataset.legendPackId || "";
      const base = `${pack}:${candidate.dataset.legendItemId || candidate.textContent}`;
      const index = counts.get(base) || 0;
      counts.set(base, index + 1);
      const id = `${base}:${index}`;
      const existing = nodes.get(id);
      const node = existing || candidate;
      if (existing) {
        if (node.innerHTML !== candidate.innerHTML) node.innerHTML = candidate.innerHTML;
        for (const attr of [...node.attributes]) node.removeAttribute(attr.name);
        for (const attr of candidate.attributes) node.setAttribute(attr.name, attr.value);
        candidate.replaceWith(node);
      }
      nodes.set(id, node);
      incoming.push({ id, node });
    }
    content.replaceChildren(...holder.childNodes);
    const bounds = content.getBoundingClientRect();
    const origin = element.getBoundingClientRect();
    const entries = incoming.map(({ id, node }, index) => {
      const rect = node.getBoundingClientRect();
      const x = projection ? Number.parseFloat(node.style.left) || 0 : (rect.left - origin.left) / displayScale;
      const y = projection ? Number.parseFloat(node.style.top) || 0 : (rect.top - origin.top) / displayScale;
      return { id, x: x * scale, y: y * scale, scale,
        data: { x, y, width: rect.width / displayScale, height: rect.height / displayScale,
          ...(placements ? { placement: placements[index], fitScale: scale, font, layerId: node.dataset.legendLayerId } : {}) } };
    });
    const desiredIds = new Set(entries.map(entry => entry.id));
    for (const row of prior.rows) {
      if (desiredIds.has(row.id)) continue;
      const node = nodes.get(row.id);
      if (!node) continue;
      Object.assign(node.style, { position: "absolute", left: `${row.data.x}px`, top: `${row.data.y}px`,
        width: `${row.data.width}px`, height: `${row.data.height}px`, margin: "0" });
      content.appendChild(node);
    }
    if (!projection) {
      const nextRect = element.getBoundingClientRect();
      targetSize = { width: (visible ? nextRect.width : oldRect.width) / displayScale,
        height: (visible ? nextRect.height : oldRect.height) / displayScale };
      content.style.width = `${bounds.width / displayScale}px`;
      content.style.overflow = "visible";
      element.style.width = `${oldRect.width / displayScale}px`;
      element.style.height = `${Math.max(oldRect.height, nextRect.height) / displayScale}px`;
    }
    paint(motion.update(entries, { visible, immediate }));
    if (frame == null) frame = requestFrame(tick);
  }

  return {
    render,
    isAnimating: () => frame != null,
    dispose() {
      disposed = true;
      if (frame != null) cancelFrame?.(frame);
      frame = null;
      motion.clear();
      nodes.clear();
    },
  };
}
