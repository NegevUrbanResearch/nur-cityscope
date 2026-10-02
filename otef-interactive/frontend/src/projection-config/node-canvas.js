import { recordProjectionTrace } from './projection-trace-input.js';

const COLUMNS = [
  ["content", "names-wall", "settlement-names"], ["clock-gis", "nova-explainers", "clock-projection"], ["pre"], ["left-crop", "right-crop"],
  ["left-fit", "right-fit"], ["left-keystone", "right-keystone"],
  ["left-grid", "right-grid"], ["left-output", "right-output"],
];
const EDGES = [
  ["content", "pre"], ["pre", "left-crop"], ["pre", "right-crop"],
  ["left-crop", "left-fit"], ["right-crop", "right-fit"],
  ["left-fit", "left-keystone"], ["right-fit", "right-keystone"],
  ["left-keystone", "left-grid"], ["right-keystone", "right-grid"],
  ["left-grid", "left-output"], ["right-grid", "right-output"],
];
const PAD = 28;
const COLUMN_GAP = 48;
const ROW_GAP = 64;
const INTERACTIVE_TOUCH_SELECTOR = "input, button, select, textarea, a, label, [contenteditable], [role='button']";
const leftOf = (card) => Number.isFinite(card.offsetLeft) ? card.offsetLeft : Number.parseFloat(card.style.left) || 0;
const topOf = (card) => Number.isFinite(card.offsetTop) ? card.offsetTop : Number.parseFloat(card.style.top) || 0;

export function layoutNodePositions(sizes) {
  const widthOf = (id) => sizes[id]?.width || 280;
  const heightOf = (id) => sizes[id]?.height || 300;
  const topHeight = Math.max(...["left-crop", "left-fit", "left-keystone", "left-grid", "left-output"].map(heightOf));
  const bottomHeight = Math.max(...["right-crop", "right-fit", "right-keystone", "right-grid", "right-output"].map(heightOf));
  const pathHeight = topHeight + ROW_GAP + bottomHeight;
  const contentColumnHeight = heightOf("content") + ROW_GAP + heightOf("names-wall") + ROW_GAP + heightOf("settlement-names");
  const clockColumnHeight = heightOf("clock-gis") + ROW_GAP + heightOf("nova-explainers") + ROW_GAP + heightOf("clock-projection");
  const overlayStack = new Set(["content", "names-wall", "settlement-names", "clock-gis", "nova-explainers", "clock-projection"]);
  const height = PAD * 2 + Math.max(pathHeight, contentColumnHeight, clockColumnHeight);
  const positions = {};
  let x = PAD;
  for (const column of COLUMNS) {
    const stackedHeight = column[0] === "clock-gis" ? clockColumnHeight : contentColumnHeight;
    let stackY = (height - stackedHeight) / 2;
    for (const id of column) {
      const y = id.startsWith("left-") ? PAD
        : id.startsWith("right-") ? PAD + topHeight + ROW_GAP
          : overlayStack.has(id) ? stackY
            : (height - heightOf(id)) / 2;
      positions[id] = { x, y };
      if (overlayStack.has(id)) stackY += heightOf(id) + ROW_GAP;
    }
    x += Math.max(...column.map(widthOf)) + COLUMN_GAP;
  }
  return { positions, bounds: { width: x - COLUMN_GAP + PAD, height } };
}

export function fitTransform(bounds, viewport) {
  if (!(bounds.width > 0 && bounds.height > 0 && viewport.width > 0 && viewport.height > 0)) {
    return { x: 0, y: 0, scale: 1 };
  }
  const scale = Math.min(1, (viewport.width - PAD * 2) / bounds.width, (viewport.height - PAD * 2) / bounds.height);
  return {
    x: (viewport.width - bounds.width * scale) / 2,
    y: (viewport.height - bounds.height * scale) / 2,
    scale,
  };
}

export function zoomAt(view, factor, anchor) {
  const scale = Math.min(2, Math.max(0.18, view.scale * factor));
  const ratio = scale / view.scale;
  return {
    x: anchor.x - (anchor.x - view.x) * ratio,
    y: anchor.y - (anchor.y - view.y) * ratio,
    scale,
  };
}

export function createNodeCanvas({ document, viewport, graph, svg, wire, nodeMap, controls, trace }) {
  let view = { x: 0, y: 0, scale: 1 };
  let drag = null;
  const touches = new Map();
  let pinch = null;
  let touchSequencePinched = false;
  let interactionListeners = false;
  let framing = "initial";
  let selectedNode = "pre";
  let focusedNodes = null;
  let mounted = false;
  let observer = null;
  const headers = [];
  const sizes = () => Object.fromEntries([...nodeMap].map(([id, card]) => [id, {
    width: card.offsetWidth || 280,
    height: card.offsetHeight || 300,
  }]));
  const paint = () => { graph.style.transform = `translate(${view.x}px, ${view.y}px) scale(${view.scale})`; recordProjectionTrace(trace, 'viewport', { surface: 'graph', phase: 'paint', viewX: view.x, viewY: view.y, scale: view.scale }); };

  function updateWires() {
    let width = 0;
    let height = 0;
    for (const card of nodeMap.values()) {
      width = Math.max(width, leftOf(card) + (card.offsetWidth || 280) + PAD);
      height = Math.max(height, topOf(card) + (card.offsetHeight || 300) + PAD);
    }
    graph.style.width = `${width}px`;
    graph.style.height = `${height}px`;
    svg.setAttribute("width", width);
    svg.setAttribute("height", height);
    svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
    const paths = EDGES.map(([from, to]) => {
      const a = nodeMap.get(from);
      const b = nodeMap.get(to);
      if (!a || !b) return "";
      const ax = leftOf(a) + (a.offsetWidth || 280);
      const ay = topOf(a) + (a.offsetHeight || 300) / 2;
      const bx = leftOf(b);
      const by = topOf(b) + (b.offsetHeight || 300) / 2;
      const bend = Math.max(24, (bx - ax) / 2);
      return `M${ax} ${ay} C${ax + bend} ${ay}, ${bx - bend} ${by}, ${bx} ${by}`;
    }).join(" ");
    wire.setAttribute("d", paths);
    return { width, height };
  }

  function layout() {
    const { positions } = layoutNodePositions(sizes());
    for (const [id, card] of nodeMap) {
      card.style.left = `${positions[id].x}px`;
      card.style.top = `${positions[id].y}px`;
    }
    updateWires();
  }

  function fit() {
    const width = viewport.clientWidth || 0;
    const height = viewport.clientHeight || 0;
    if (!(width > 0 && height > 0)) return;
    view = fitTransform(updateWires(), { width, height });
    framing = "fit";
    focusedNodes = null;
    paint();
  }

  function focusNode(id, scale = 1) {
    const card = nodeMap.get(id);
    if (!card || !viewport.clientWidth || !viewport.clientHeight) return;
    view = {
      x: viewport.clientWidth / 2 - (leftOf(card) + card.offsetWidth / 2) * scale,
      y: viewport.clientHeight / 2 - (topOf(card) + card.offsetHeight / 2) * scale,
      scale,
    };
    framing = "focus";
    focusedNodes = null;
    paint();
  }

  function focusNodes(ids) {
    const targets = [...new Set(Array.isArray(ids) ? ids : [])].filter((id) => nodeMap.has(id));
    if (!targets.length || !viewport.clientWidth || !viewport.clientHeight) return false;
    const cards = targets.map((id) => nodeMap.get(id));
    const left = Math.min(...cards.map(leftOf));
    const top = Math.min(...cards.map(topOf));
    const right = Math.max(...cards.map((card) => leftOf(card) + (card.offsetWidth || 280)));
    const bottom = Math.max(...cards.map((card) => topOf(card) + (card.offsetHeight || 300)));
    const bounds = { width: right - left, height: bottom - top };
    const scale = Math.min(1, (viewport.clientWidth - PAD * 2) / bounds.width, (viewport.clientHeight - PAD * 2) / bounds.height);
    view = {
      x: viewport.clientWidth / 2 - (left + right) / 2 * scale,
      y: viewport.clientHeight / 2 - (top + bottom) / 2 * scale,
      scale,
    };
    focusedNodes = targets;
    framing = "focus-group";
    paint();
    return true;
  }

  function frameOpening() {
    const content = nodeMap.get("content");
    const pre = nodeMap.get("pre");
    if (!content || !pre || !viewport.clientWidth || !viewport.clientHeight) return;
    const scale = 0.8;
    view = {
      x: 40 - leftOf(content) * scale,
      y: viewport.clientHeight / 2 - (topOf(pre) + pre.offsetHeight / 2) * scale,
      scale,
    };
    framing = "initial";
    paint();
  }

  const center = () => ({ x: viewport.clientWidth / 2, y: viewport.clientHeight / 2 });
  function zoom(factor, anchor = center()) {
    view = zoomAt(view, factor, anchor);
    framing = "custom";
    paint();
  }
  const zoomIn = () => zoom(1.2);
  const zoomOut = () => zoom(1 / 1.2);
  const zoomOne = () => focusNode(selectedNode);
  const onWheel = (event) => {
    event.preventDefault();
    const rect = viewport.getBoundingClientRect();
    zoom(event.deltaY < 0 ? 1.1 : 1 / 1.1, { x: event.clientX - rect.left, y: event.clientY - rect.top });
  };

  function syncInteractionListeners() {
    const active = Boolean(drag || touches.size);
    if (active === interactionListeners) return;
    interactionListeners = active;
    const method = active ? "addEventListener" : "removeEventListener";
    document?.[method]?.("pointermove", onDocumentMove);
    document?.[method]?.("pointerup", onDocumentEnd);
    document?.[method]?.("pointercancel", onDocumentEnd);
    document?.[method]?.("lostpointercapture", onDocumentEnd);
    document?.[method]?.("visibilitychange", onVisibilityChange);
    document?.[method]?.("blur", onWindowBlur);
    const windowTarget = document?.defaultView || globalThis.window;
    if (windowTarget && windowTarget !== document) windowTarget[method]?.("blur", onWindowBlur);
  }

  const localPoint = (event) => {
    const rect = viewport.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  };

  function startPinch() {
    const pair = [...touches.entries()].slice(0, 2);
    if (pair.length !== 2) return;
    const [aId, a] = pair[0]; const [bId, b] = pair[1];
    const dx = b.x - a.x; const dy = b.y - a.y;
    const distance = Math.hypot(dx, dy);
    if (!(distance > 0)) return;
    const centroid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    pinch = {
      ids: [aId, bId], distance, scale: view.scale,
      worldX: (centroid.x - view.x) / view.scale,
      worldY: (centroid.y - view.y) / view.scale,
    };
  }

  function updatePinch() {
    if (!pinch) return;
    const a = touches.get(pinch.ids[0]); const b = touches.get(pinch.ids[1]);
    if (!a || !b) return;
    const distance = Math.hypot(b.x - a.x, b.y - a.y);
    const scale = Math.min(2, Math.max(0.18, pinch.scale * distance / pinch.distance));
    const centroid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    view = { x: centroid.x - pinch.worldX * scale, y: centroid.y - pinch.worldY * scale, scale };
    framing = "custom";
    focusedNodes = null;
    paint();
  }

  function trackTouchDown(event) {
    if (event.pointerType !== "touch") return false;
    const target = event.target;
    if (target?.closest?.(INTERACTIVE_TOUCH_SELECTOR)) return true;
    if (!touches.has(event.pointerId)) touches.set(event.pointerId, localPoint(event));
    syncInteractionListeners();
    if (!touchSequencePinched && touches.size === 2) {
      endDrag(undefined, true);
      touchSequencePinched = true;
      startPinch();
      return true;
    }
    return touchSequencePinched;
  }

  function moveTouch(event) {
    if (event.pointerType !== "touch" || !touches.has(event.pointerId)) return;
    touches.set(event.pointerId, localPoint(event));
    updatePinch();
  }

  function endTouch(event) {
    if (event?.pointerId !== undefined && touches.has(event.pointerId)) {
      touches.delete(event.pointerId);
      if (pinch?.ids.includes(event.pointerId)) pinch = null;
    }
    if (!touches.size) {
      pinch = null;
      touchSequencePinched = false;
    }
    syncInteractionListeners();
  }

  function onDocumentMove(event) {
    moveTouch(event);
    moveDrag(event);
  }

  function onDocumentEnd(event) {
    if (event?.type === "pointerup") moveTouch(event);
    endDrag(event);
    endTouch(event);
  }

  function onWindowBlur() {
    endDrag(undefined, true);
    touches.clear();
    pinch = null;
    touchSequencePinched = false;
    syncInteractionListeners();
  }

  function onVisibilityChange() {
    if (document?.visibilityState === "hidden") onWindowBlur();
  }

  function endDrag(event, force = false) {
    if (!drag || (!force && event?.pointerId !== drag.pointerId)) return;
    drag = null;
    syncInteractionListeners();
  }
  function moveDrag(event) {
    if (!drag || event.pointerId !== drag.pointerId) return;
    if (drag.pointerType === "touch" && touchSequencePinched) return;
    const dx = event.clientX - drag.x;
    const dy = event.clientY - drag.y;
    if (drag.node) {
      drag.node.style.left = `${Math.max(PAD, drag.left + dx / view.scale)}px`;
      drag.node.style.top = `${Math.max(PAD, drag.top + dy / view.scale)}px`;
      updateWires();
    } else {
      view.x = drag.viewX + dx;
      view.y = drag.viewY + dy;
      paint();
    }
    framing = "custom";
  }
  function beginDrag(event, node = null) {
    if (event.button !== 0 || event.isPrimary === false || drag || touchSequencePinched) return;
    event.preventDefault?.();
    drag = { pointerId: event.pointerId, pointerType: event.pointerType, x: event.clientX, y: event.clientY, node, left: node ? leftOf(node) : 0, top: node ? topOf(node) : 0, viewX: view.x, viewY: view.y };
    syncInteractionListeners();
  }
  const onBackgroundDown = (event) => {
    const consumed = trackTouchDown(event);
    if (!consumed && (event.target === viewport || event.target === graph || event.target === svg)) beginDrag(event);
  };

  function mount() {
    if (mounted) return;
    mounted = true;
    layout();
    frameOpening();
    viewport.addEventListener("pointerdown", onBackgroundDown);
    viewport.addEventListener("wheel", onWheel, { passive: false });
    for (const [id, card] of nodeMap) {
      const header = card.querySelector?.("h3") || card.children?.find?.((child) => child.tagName === "H3");
      if (!header) continue;
      const onHeaderDown = (event) => {
        const interactive = event.target?.closest?.(INTERACTIVE_TOUCH_SELECTOR);
        const consumed = trackTouchDown(event);
        event.stopPropagation?.();
        if (!consumed && !interactive) beginDrag(event, card);
      };
      header.addEventListener("pointerdown", onHeaderDown);
      headers.push([header, onHeaderDown]);
    }
    controls.zoomIn.addEventListener("click", zoomIn);
    controls.zoomOut.addEventListener("click", zoomOut);
    controls.zoomReset.addEventListener("click", fit);
    controls.zoomOne.addEventListener("click", zoomOne);
    if (typeof ResizeObserver === "function") {
      observer = new ResizeObserver(() => {
        if (framing === "initial") { layout(); frameOpening(); }
        else if (framing === "fit") { layout(); fit(); }
        else if (framing === "focus") { updateWires(); focusNode(selectedNode, view.scale); }
        else if (framing === "focus-group") { updateWires(); focusNodes(focusedNodes || []); }
        else updateWires();
      });
      observer.observe(viewport);
      for (const card of nodeMap.values()) observer.observe(card);
    }
  }

  function dispose() {
    if (!mounted) return;
    mounted = false;
    endDrag(undefined, true);
    touches.clear();
    pinch = null;
    touchSequencePinched = false;
    syncInteractionListeners();
    observer?.disconnect();
    observer = null;
    viewport.removeEventListener("pointerdown", onBackgroundDown);
    viewport.removeEventListener("wheel", onWheel);
    for (const [header, handler] of headers) header.removeEventListener("pointerdown", handler);
    headers.length = 0;
    controls.zoomIn.removeEventListener("click", zoomIn);
    controls.zoomOut.removeEventListener("click", zoomOut);
    controls.zoomReset.removeEventListener("click", fit);
    controls.zoomOne.removeEventListener("click", zoomOne);
  }

  return { mount, fit, focusNodes, updateWires, setSelected: (id) => { if (nodeMap.has(id)) selectedNode = id; }, dispose };
}
