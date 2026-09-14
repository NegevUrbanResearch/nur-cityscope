const COLUMNS = [
  ["content"], ["pre"], ["left-crop", "right-crop"],
  ["left-fit", "right-fit"], ["left-output", "right-output"],
];
const EDGES = [
  ["content", "pre"], ["pre", "left-crop"], ["pre", "right-crop"],
  ["left-crop", "left-fit"], ["right-crop", "right-fit"],
  ["left-fit", "left-output"], ["right-fit", "right-output"],
];
const PAD = 28;
const COLUMN_GAP = 48;
const ROW_GAP = 64;
const leftOf = (card) => Number.isFinite(card.offsetLeft) ? card.offsetLeft : Number.parseFloat(card.style.left) || 0;
const topOf = (card) => Number.isFinite(card.offsetTop) ? card.offsetTop : Number.parseFloat(card.style.top) || 0;

export function layoutNodePositions(sizes) {
  const widthOf = (id) => sizes[id]?.width || 280;
  const heightOf = (id) => sizes[id]?.height || 300;
  const topHeight = Math.max(...["left-crop", "left-fit", "left-output"].map(heightOf));
  const bottomHeight = Math.max(...["right-crop", "right-fit", "right-output"].map(heightOf));
  const height = PAD * 2 + topHeight + ROW_GAP + bottomHeight;
  const positions = {};
  let x = PAD;
  for (const column of COLUMNS) {
    for (const id of column) {
      const y = id.startsWith("left-") ? PAD
        : id.startsWith("right-") ? PAD + topHeight + ROW_GAP
          : (height - heightOf(id)) / 2;
      positions[id] = { x, y };
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

export function createNodeCanvas({ document, viewport, graph, svg, wire, nodeMap, controls }) {
  let view = { x: 0, y: 0, scale: 1 };
  let drag = null;
  let framing = "initial";
  let selectedNode = "pre";
  let mounted = false;
  let observer = null;
  const headers = [];
  const sizes = () => Object.fromEntries([...nodeMap].map(([id, card]) => [id, {
    width: card.offsetWidth || 280,
    height: card.offsetHeight || 300,
  }]));
  const paint = () => { graph.style.transform = `translate(${view.x}px, ${view.y}px) scale(${view.scale})`; };

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
    paint();
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

  function endDrag() {
    drag = null;
    document?.removeEventListener?.("pointermove", moveDrag);
    document?.removeEventListener?.("pointerup", endDrag);
    document?.removeEventListener?.("pointercancel", endDrag);
  }
  function moveDrag(event) {
    if (!drag) return;
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
    if (event.button !== 0) return;
    endDrag();
    event.preventDefault?.();
    drag = { x: event.clientX, y: event.clientY, node, left: node ? leftOf(node) : 0, top: node ? topOf(node) : 0, viewX: view.x, viewY: view.y };
    document?.addEventListener?.("pointermove", moveDrag);
    document?.addEventListener?.("pointerup", endDrag);
    document?.addEventListener?.("pointercancel", endDrag);
  }
  const onBackgroundDown = (event) => {
    if (event.target === viewport || event.target === graph || event.target === svg) beginDrag(event);
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
      const onHeaderDown = (event) => { event.stopPropagation?.(); beginDrag(event, card); };
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
        else updateWires();
      });
      observer.observe(viewport);
      for (const card of nodeMap.values()) observer.observe(card);
    }
  }

  function dispose() {
    if (!mounted) return;
    mounted = false;
    endDrag();
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

  return { mount, fit, updateWires, setSelected: (id) => { if (nodeMap.has(id)) selectedNode = id; }, dispose };
}
