import { afterEach, expect, test, vi } from "vitest";
import { createClockLayoutClient } from "../../frontend/src/projection-config/clock-layout-client.js";
import { layoutFieldEdit } from "../../frontend/src/projection-config/clock-layout-controls.js";
import { openClockLayoutEditor } from "../../frontend/src/projection-config/clock-layout-editor-dialog.js";

function documentHarness() {
  const winListeners = new Map();
  const docListeners = new Map();
  const doc = {
    activeElement: null,
    addEventListener(type, handler) { docListeners.set(type, handler); },
    removeEventListener(type, handler) { if (docListeners.get(type) === handler) docListeners.delete(type); },
    dispatch(type, event) { docListeners.get(type)?.(event); },
    defaultView: {
      location: { href: "http://localhost/otef-interactive/projection-config.html", origin: "http://localhost" },
      addEventListener(type, handler) { winListeners.set(type, handler); },
      removeEventListener(type, handler) { if (winListeners.get(type) === handler) winListeners.delete(type); },
      dispatch(type, event) { winListeners.get(type)?.(event); },
      requestAnimationFrame(callback) { callback(); return 1; },
      cancelAnimationFrame() {},
      matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
    },
    createElement(tag) {
      const node = {
        tagName: tag.toUpperCase(), children: [], dataset: {}, style: {}, attributes: {}, hidden: false,
        classList: { add() {}, remove() {}, toggle() {} },
        appendChild(child) { this.children.push(child); child.parentElement = this; child.ownerDocument ||= doc; return child; },
        insertBefore(child, reference) {
          if (reference == null) return this.appendChild(child);
          if (!this.children.includes(reference)) throw Object.assign(new Error("Reference node is not a child"), { name: "NotFoundError" });
          if (child === reference) return child;
          const previousParent = child.parentElement;
          if (previousParent) {
            const previousIndex = previousParent.children.indexOf(child);
            if (previousIndex >= 0) previousParent.children.splice(previousIndex, 1);
          }
          const referenceIndex = this.children.indexOf(reference);
          this.children.splice(referenceIndex, 0, child);
          child.parentElement = this; child.ownerDocument ||= doc;
          return child;
        },
        append(...children) { children.forEach((child) => this.appendChild(child)); },
        replaceChildren(...children) { this.children = []; children.forEach((child) => this.appendChild(child)); },
        setAttribute(key, value) { this.attributes[key] = value; if (key.startsWith("data-")) this.dataset[key.slice(5)] = value; },
        removeAttribute(key) { delete this.attributes[key]; },
        addEventListener(type, handler) { (this.listeners ||= {})[type] = [...(this.listeners?.[type] || []), handler]; },
        removeEventListener(type, handler) { this.listeners[type] = (this.listeners?.[type] || []).filter((item) => item !== handler); },
        dispatch(type, extra = {}) { for (const handler of this.listeners?.[type] || []) handler({ currentTarget: this, target: this, preventDefault() {}, stopPropagation() {}, ...extra }); },
        remove() { this.removed = true; },
        focus() { doc.activeElement = this; },
        getBoundingClientRect() { return { left: 0, top: 0, width: 960, height: 540, right: 960, bottom: 540 }; },
      };
      if (tag === "iframe") node.contentWindow = { sent: [], postMessage(message, origin) { this.sent.push({ message, origin }); } };
      node.ownerDocument = doc;
      return node;
    },
  };
  doc.body = doc.createElement("body");
  doc.body.ownerDocument = doc;
  return doc;
}

function descendants(node) { return [node, ...(node.children || []).flatMap(descendants)]; }

const initialLayout = { leftPct: 8, topPct: 8, widthPct: 35, heightPct: 28, fontPx: 22, rotateDeg: 0 };
const projectionMesh = { width: 1920, height: 1080, vertices: [
  { u: 0, v: 0, x: 100 / 1920, y: 0 }, { u: 1, v: 0, x: 1820 / 1920, y: 0 },
  { u: 1, v: 1, x: 1820 / 1920, y: 1 }, { u: 0, v: 1, x: 100 / 1920, y: 1 },
], triangles: [0, 1, 2, 0, 2, 3] };
const disposers = [];

test("column edits convert numeric select values and reject malformed values", () => {
  expect(layoutFieldEdit({ ...initialLayout, columns: 2 }, "columns", "1").columns).toBe(1);
  for (const value of ["", "4", "-1", "1.5", "auto", null, [2], { toString: () => "2" }]) {
    expect(layoutFieldEdit({ ...initialLayout, columns: 2 }, "columns", value)).toBeNull();
  }
});

test.each([
  ["clock-gis", "clock", "gisClock", "start"],
  ["clock-projection", "clock", "projectionClock", "left"],
  ["clock-projection", "legend", "projectionLegend", "left"],
])("numeric %s/%s edits normalize the complete box before preview and backend acknowledgement", async (nodeId, element, resource, slot) => {
  vi.useFakeTimers();
  let latest;
  const normalize = (layout) => ({ ...layout, leftPct: Math.min(layout.leftPct, 100 - layout.widthPct), topPct: Math.min(layout.topPct, 100 - layout.heightPct) });
  const rig = await editorFixture(nodeId, element, { client: {
    writeClockSlot: async ({ surface, layout, baseRevision }) => { latest = normalize(layout); return { status: "ok", nliClockLayout: { gis: { start: initialLayout }, projection: { left: initialLayout }, [surface]: { [slot]: latest } }, nliClockLayoutRevision: baseRevision + 1 }; },
    writeLegendSlot: async ({ layout, baseRevision }) => { latest = normalize(layout); return { changeKind: "layout", legendProjection: { left: latest }, legendLayoutRevision: baseRevision + 1 }; },
  } }); rig.rendered();
  const set = (key, value) => { const input = rig.find((node) => node.dataset?.field === key); input.value = String(value); input.dispatch("change"); };
  set("leftPct", 95); set("topPct", 97);
  expect(rig.client.getSlot(resource, slot).draft).toMatchObject({ leftPct: 65, topPct: 72 });
  set("widthPct", 80); set("heightPct", 90);
  const draft = rig.client.getSlot(resource, slot).draft;
  expect(draft).toMatchObject({ leftPct: 20, topPct: 10, widthPct: 80, heightPct: 90 });
  const preview = rig.frame().contentWindow.sent.at(-1).message;
  expect(element === "legend" ? preview.legendLayout : preview.clockLayout).toEqual(draft);
  await vi.advanceTimersByTimeAsync(150);
  expect(rig.client.getSlot(resource, slot)).toMatchObject({ acknowledged: latest, draft: null, status: "Saved" });
});

test.each([0, 1, 2, 3])("legend column select previews, saves, and reloads %i", async (columns) => {
  vi.useFakeTimers();
  const rig = await editorFixture("clock-projection", "legend"); rig.rendered();
  const select = rig.find((node) => node.dataset?.field === "columns");
  expect(select).toBeDefined();
  expect(select.children.map((option) => [option.value, option.textContent])).toEqual([["0", "Auto"], ["1", "1"], ["2", "2"], ["3", "3"]]);
  expect(select.hidden).toBe(false);
  select.value = String(columns); select.dispatch("change");
  const draft = rig.client.getSlot("projectionLegend", "left").draft;
  expect(draft.columns).toBe(columns);
  expect(rig.frame().contentWindow.sent.at(-1).message.legendLayout.columns).toBe(columns);
  await vi.advanceTimersByTimeAsync(150);
  expect(rig.writeLegendSlot).toHaveBeenCalledWith(expect.objectContaining({ layout: expect.objectContaining({ columns }) }));
  expect(rig.client.getSlot("projectionLegend", "left").acknowledged.columns).toBe(columns);
  rig.editor.dispose();
  const reloaded = openClockLayoutEditor({ nodeId: "clock-projection", element: "legend", layoutClient: rig.client, document: rig.doc });
  expect(descendants(rig.doc.body).find((node) => node.dataset?.field === "columns").value).toBe(String(columns));
  reloaded.dispose(); rig.client.destroy();
});

test("legacy legend opens as Auto without changing its acknowledged record and hides dwell", async () => {
  const rig = await editorFixture("clock-projection", "legend"); rig.rendered();
  const select = rig.find((node) => node.dataset?.field === "columns");
  expect(select.value).toBe("0");
  expect(select.hidden).toBe(false);
  expect(rig.find((node) => node.dataset?.field === "dwellSeconds").hidden).toBe(true);
  const fontLabel = rig.find((node) => node.dataset?.field === "fontPx").parentElement;
  expect(fontLabel.children[0].textContent).toBe("Font size (maximum)");
  expect(rig.client.getSlot("projectionLegend", "left").acknowledged).not.toHaveProperty("columns");
  expect(rig.client.getSlot("projectionLegend", "left").draft).toBeNull();
  expect(rig.writeLegendSlot).not.toHaveBeenCalled();
});

test.each([["clock-projection", "clock"], ["clock-gis", "clock"]])("column select is hidden for %s/%s", async (nodeId, element) => {
  const rig = await editorFixture(nodeId, element); rig.rendered();
  expect(rig.find((node) => node.dataset?.field === "columns").hidden).toBe(true);
  expect(rig.find((node) => node.dataset?.field === "fontPx").parentElement.children[0].textContent).toBe("Font size");
});

test("clock editor identifies its output or selected GIS scene and explains autosave", async () => {
  const projection = await editorFixture("clock-projection");
  expect(projection.find((node) => node.className === "clock-layout-header")?.children[0].textContent).toMatch(/Left/);
  expect(projection.find((node) => node.className === "clock-layout-autosave-note")?.textContent).toMatch(/save automatically/i);
  projection.editor.dispose(); projection.client.destroy();

  const gis = await editorFixture("clock-gis");
  expect(gis.find((node) => node.className === "clock-layout-header")?.children[0].textContent).toMatch(/Home/);
  const scene = gis.find((node) => node.className?.includes("clock-layout-scene")).children[0];
  scene.value = "segev"; scene.dispatch("change");
  expect(gis.find((node) => node.className === "clock-layout-header")?.children[0].textContent).toMatch(/Segev/i);
});

test.each(["move", "release"])("projection gesture cancels on unavailable inverse at %s and keeps numeric editing usable", async (phase) => {
  const rig = await editorFixture(); rig.rendered();
  const hit = rig.find((node) => node.attributes?.class === "clock-layout-body-hit");
  hit.dispatch("pointerdown", { button: 0, pointerId: 17, clientX: 240, clientY: 160 });
  rig.doc.dispatch("pointermove", { pointerId: 17, clientX: 260, clientY: 170 });
  rig.doc.dispatch(phase === "move" ? "pointermove" : "pointerup", { pointerId: 17, clientX: 2, clientY: 170 });
  rig.doc.dispatch("pointerup", { pointerId: 17, clientX: 260, clientY: 170 });
  await Promise.resolve();
  expect(rig.writeClockSlot).not.toHaveBeenCalled();
  expect(rig.frame().contentWindow.sent.at(-1).message.clockLayout).toEqual(initialLayout);
  expect(rig.find((node) => node.className === "clock-layout-mapping-status")?.textContent).toContain("Mapping unavailable");
  expect(rig.find((node) => node.dataset?.field === "leftPct").disabled).toBe(false);
});

test("rejected initial projection inverse shows visible mapping feedback without a write", async () => {
  const rig = await editorFixture(); rig.rendered();
  rig.find((node) => node.attributes?.class === "clock-layout-body-hit").dispatch("pointerdown", { button: 0, pointerId: 17, clientX: 2, clientY: 170 });
  expect(rig.find((node) => node.className === "clock-layout-mapping-status")?.textContent).toContain("Mapping unavailable");
  expect(rig.writeClockSlot).not.toHaveBeenCalled();
});

test("validated clipping and partial-mesh warnings remain visible without changing layout or calibration", async () => {
  const rig = await editorFixture(); rig.rendered();
  const state = rig.frame().contentWindow.sent.at(-1).message;
  rig.message({ type: "otef_clock_preview_rendered", requestId: state.requestId, surface: "projection", sceneId: "home", output: "left",
    mesh: projectionMesh, meshIdentity: "mesh-a", pageIndex: 0, pageCount: 1,
    warnings: { clipped: true, outOfView: true, mapping: "partial" } });
  const warning = rig.find((node) => node.className === "clock-layout-warning");
  expect(warning?.textContent).toContain("Content clipped"); expect(warning?.textContent).toContain("partly outside"); expect(warning?.textContent).toContain("partial");
  expect(rig.client.getSlot("projectionClock", "left")).toMatchObject({ acknowledged: initialLayout, draft: null, status: "Saved" });
  expect(rig.writeClockSlot).not.toHaveBeenCalled();
});
afterEach(() => { disposers.splice(0).forEach((dispose) => dispose()); vi.useRealTimers(); });

async function editorFixture(nodeId = "clock-projection", element = "clock", overrides = {}) {
  const snapshot = { nli_clock_layout: { gis: { start: initialLayout }, projection: { left: initialLayout } }, nli_clock_layout_revision: 0,
    legend_settings: { projection: { left: { ...initialLayout, dwellSeconds: 8 } } }, legend_layout_revision: 0 };
  const writeClockSlot = vi.fn(async ({ surface, slot, layout }) => ({ status: "ok", nliClockLayout: { ...snapshot.nli_clock_layout, [surface]: { [slot]: layout } }, nliClockLayoutRevision: 1 }));
  const writeLegendSlot = vi.fn(async ({ layout }) => ({ changeKind: "layout", legendProjection: { left: layout }, legendLayoutRevision: 1 }));
  const client = createClockLayoutClient({ getSnapshot: async () => snapshot, writeClockSlot, writeLegendSlot, ...overrides.client });
  await client.hydrate().catch(() => {});
  const doc = documentHarness();
  const editor = openClockLayoutEditor({ nodeId, element, layoutClient: client, document: doc, ...overrides.editor });
  disposers.push(() => { editor.dispose(); client.destroy(); });
  const find = (predicate) => descendants(doc.body).find(predicate);
  const frame = () => find((node) => node.tagName === "IFRAME");
  const message = (data, target = frame()) => doc.defaultView.dispatch("message", { origin: doc.defaultView.location.origin,
    source: target.contentWindow, data: { sessionId: new URL(target.src).searchParams.get("previewSession"), ...data } });
  function rendered(activeMesh = projectionMesh) {
    const surface = nodeId === "clock-gis" ? "gis" : "projection";
    message({ type: "otef_clock_preview_ready", surface, output: surface === "gis" ? null : "left" });
    const state = frame().contentWindow.sent.at(-1).message;
    message({ type: "otef_clock_preview_rendered", requestId: state.requestId, surface, sceneId: "home", output: state.output,
      mesh: surface === "gis" ? null : activeMesh, meshIdentity: surface === "gis" ? null : "mesh-a", pageIndex: 0, pageCount: 1 });
  }
  return { doc, editor, client, snapshot, writeClockSlot, writeLegendSlot, find, frame, message, rendered };
}

test.each(["move", "release"])("projection gesture cancels a valid-to-ambiguous inverse at %s with zero writes", async (phase) => {
  const rig = await editorFixture();
  rig.rendered({ ...projectionMesh, vertices: [...projectionMesh.vertices,
    { u: 0, v: 0, x: 0.55, y: 0.1 }, { u: 0.4, v: 0, x: 0.9, y: 0.1 }, { u: 0, v: 0.7, x: 0.55, y: 0.8 }], triangles: [...projectionMesh.triangles, 4, 5, 6] });
  rig.find((node) => node.attributes?.class === "clock-layout-body-hit").dispatch("pointerdown", { button: 0, pointerId: 17, clientX: 240, clientY: 160 });
  rig.doc.dispatch("pointermove", { pointerId: 17, clientX: 260, clientY: 170 });
  rig.doc.dispatch(phase === "move" ? "pointermove" : "pointerup", { pointerId: 17, clientX: 560, clientY: 170 });
  rig.doc.dispatch("pointerup", { pointerId: 17, clientX: 260, clientY: 170 });
  await vi.waitFor(() => expect(rig.frame().contentWindow.sent.at(-1).message.clockLayout).toEqual(initialLayout));
  expect(rig.writeClockSlot).not.toHaveBeenCalled();
  expect(rig.find((node) => node.className === "clock-layout-mapping-status").hidden).toBe(false);
});

test.each(["clock", "legend"])("projection %s draws normalized mesh endpoints and corners in pixel SVG on a square stage", async (element) => {
  const rig = await editorFixture("clock-projection", element);
  rig.find((node) => node.className === "clock-layout-stage").getBoundingClientRect = () => ({ left: 0, top: 0, width: 400, height: 400 });
  rig.rendered();
  const overlay = rig.find((node) => node.attributes?.viewBox === "0 0 1920 1080");
  const circles = overlay.children.filter((node) => node.tagName === "CIRCLE");
  const expected = [[237.6, 86.4], [839.6, 86.4], [839.6, 388.8], [237.6, 388.8]];
  expect(circles).toHaveLength(4);
  circles.forEach((circle, index) => {
    expect(Number(circle.attributes.cx)).toBeCloseTo(expected[index][0]);
    expect(Number(circle.attributes.cy)).toBeCloseTo(expected[index][1]);
  });
  const paths = overlay.children.filter((node) => node.attributes?.class === "clock-layout-outline");
  const points = paths.map((node) => node.attributes.d.match(/[-+]?\d*\.?\d+(?:e[-+]?\d+)?/gi).map(Number));
  expect(points[0]).toEqual([expect.closeTo(237.6), expect.closeTo(86.4), expect.closeTo(839.6), expect.closeTo(86.4)]);
  expect(points.every(([x1, y1, x2, y2]) => Math.min(x1, x2) >= 237.59 && Math.max(x1, x2) <= 839.61
    && Math.min(y1, y2) >= 86.39 && Math.max(y1, y2) <= 388.81)).toBe(true);
  expect(rig.find((node) => node.className === "clock-layout-reference-plane").style.transform).toBe("translate(0px, 87.5px) scale(0.20833333333333334)");
  expect(Number(circles[0].attributes.cx) * 400 / 1920).toBeCloseTo(49.5);
  expect(87.5 + Number(circles[0].attributes.cy) * 400 / 1920).toBeCloseTo(105.5);
  expect(rig.writeClockSlot).not.toHaveBeenCalled(); expect(rig.writeLegendSlot).not.toHaveBeenCalled();
});

test("GIS SVG corners retain their unwarped reference pixel coordinates", async () => {
  const rig = await editorFixture("clock-gis"); rig.rendered();
  const corner = rig.find((node) => node.dataset?.corner === "top-left");
  expect(Number(corner.attributes.cx)).toBeCloseTo(153.6);
  expect(Number(corner.attributes.cy)).toBeCloseTo(86.4);
});

test.each([
  ["clock-gis", "clock", "gisClock", "start"],
  ["clock-projection", "clock", "projectionClock", "left"],
  ["clock-projection", "legend", "projectionLegend", "left"],
])("first %s/%s completed gesture saves an absent authoritative slot after canceling a move", async (nodeId, element, resource, slot) => {
  const empty = { nli_clock_layout: { gis: {}, projection: {} }, nli_clock_layout_revision: 0,
    legend_settings: { projection: {} }, legend_layout_revision: 0 };
  const rig = await editorFixture(nodeId, element, { client: { getSnapshot: async () => empty } }); rig.rendered();
  expect(rig.client.getSlot(resource, slot)).toMatchObject({ acknowledged: null, draft: null, status: "Saved" });
  const first = rig.frame().contentWindow.sent.at(-1).message;
  const fallback = element === "legend" ? first.legendLayout : first.clockLayout;
  const clientPoint = (u, v) => ({ clientX: (nodeId === "clock-gis" ? u * 1920 : 100 + 1720 * u) / 2, clientY: v * 540 });
  const center = clientPoint((fallback.leftPct + fallback.widthPct / 2) / 100, (fallback.topPct + fallback.heightPct / 2) / 100);
  rig.find((node) => node.attributes?.class === "clock-layout-body-hit").dispatch("pointerdown", { button: 0, pointerId: 3, ...center });
  rig.doc.dispatch("pointermove", { pointerId: 3, clientX: center.clientX + 10, clientY: center.clientY + 10 });
  const moved = rig.frame().contentWindow.sent.at(-1).message;
  expect((element === "legend" ? moved.legendLayout : moved.clockLayout).leftPct).not.toBe(fallback.leftPct);
  expect(rig.writeClockSlot).not.toHaveBeenCalled(); expect(rig.writeLegendSlot).not.toHaveBeenCalled();
  rig.doc.dispatch("pointercancel", { pointerId: 3 });
  expect(rig.client.getSlot(resource, slot)).toMatchObject({ acknowledged: null, draft: null, status: "Saved" });
  const restored = rig.frame().contentWindow.sent.at(-1).message;
  expect(element === "legend" ? restored.legendLayout : restored.clockLayout).toEqual(fallback);
  const handle = rig.find((node) => node.dataset?.corner === "bottom-right");
  const corner = { clientX: Number(handle.attributes.cx) / 2, clientY: Number(handle.attributes.cy) / 2 };
  handle.dispatch("pointerdown", { button: 0, pointerId: 4, ...corner });
  rig.doc.dispatch("pointermove", { pointerId: 4, clientX: corner.clientX + 10, clientY: corner.clientY + 10 });
  expect(rig.writeClockSlot).not.toHaveBeenCalled(); expect(rig.writeLegendSlot).not.toHaveBeenCalled();
  rig.doc.dispatch("pointerup", { pointerId: 4, clientX: corner.clientX + 10, clientY: corner.clientY + 10 });
  await vi.waitFor(() => expect(rig.client.getSlot(resource, slot).status).toBe("Saved"));
  const writer = element === "legend" ? rig.writeLegendSlot : rig.writeClockSlot;
  expect(writer).toHaveBeenCalledOnce();
  expect(writer.mock.calls[0][0]).toMatchObject(element === "legend" ? { span: "left", baseRevision: 0 }
    : { surface: nodeId === "clock-gis" ? "gis" : "projection", slot, baseRevision: 0 });
  expect(rig.client.getSlot(resource, slot).acknowledged).toEqual(writer.mock.calls[0][0].layout);
});

test("an absent-slot gesture still conflicts when a concurrent server update creates its slot", async () => {
  const handlers = new Map();
  const empty = { nli_clock_layout: { gis: {}, projection: {} }, nli_clock_layout_revision: 0,
    legend_settings: { projection: {} }, legend_layout_revision: 0 };
  const rig = await editorFixture("clock-gis", "clock", { client: { getSnapshot: async () => empty,
    socket: { on: (name, handler) => handlers.set(name, handler), off: (name) => handlers.delete(name) } } }); rig.rendered();
  const fallback = rig.frame().contentWindow.sent.at(-1).message.clockLayout;
  const x = (fallback.leftPct + fallback.widthPct / 2) * 9.6; const y = (fallback.topPct + fallback.heightPct / 2) * 5.4;
  rig.find((node) => node.attributes?.class === "clock-layout-body-hit").dispatch("pointerdown", { button: 0, pointerId: 7, clientX: x, clientY: y });
  rig.doc.dispatch("pointermove", { pointerId: 7, clientX: x + 10, clientY: y + 10 });
  handlers.get("otef_nli_clock_layout_changed")({ nliClockLayout: { gis: { start: initialLayout }, projection: {} }, nliClockLayoutRevision: 1 });
  rig.doc.dispatch("pointerup", { pointerId: 7, clientX: x + 10, clientY: y + 10 });
  expect(rig.client.getSlot("gisClock", "start")).toMatchObject({ status: "Conflict", acknowledged: initialLayout, draft: expect.any(Object) });
  expect(rig.writeClockSlot).not.toHaveBeenCalled();
});

test("projection body movement publishes the inverse-mapped draft before release using a frozen square fit", async () => {
  const rig = await editorFixture();
  const stage = rig.find((node) => node.className === "clock-layout-stage");
  stage.getBoundingClientRect = () => ({ left: 0, top: 0, width: 400, height: 400 });
  rig.rendered();
  const plane = rig.find((node) => node.className === "clock-layout-reference-plane");
  expect(plane.style.transform).toBe("translate(0px, 87.5px) scale(0.20833333333333334)");
  const hit = rig.find((node) => node.attributes?.class === "clock-layout-body-hit");
  expect(hit).toBeDefined();
  hit.dispatch("pointerdown", { button: 0, pointerId: 12, clientX: 100, clientY: 130 });
  stage.getBoundingClientRect = () => ({ left: 50, top: 70, width: 900, height: 600 });
  rig.doc.dispatch("pointermove", { pointerId: 12, clientX: 120, clientY: 150 });
  const draft = rig.frame().contentWindow.sent.at(-1).message;
  expect(draft.clockLayout.leftPct).toBeCloseTo(8 + 96 / 1720 * 100);
  expect(draft.clockLayout.topPct).toBeCloseTo(8 + 96 / 1080 * 100);
  expect(draft.legendLayout).toMatchObject({ leftPct: 8, dwellSeconds: 8 });
  expect(plane.style.transform).toBe("translate(0px, 87.5px) scale(0.20833333333333334)");
  expect(rig.writeClockSlot).not.toHaveBeenCalled();
  rig.doc.dispatch("pointercancel", { pointerId: 12 });
  expect(rig.frame().contentWindow.sent.at(-1).message.clockLayout).toEqual(initialLayout);
  expect(rig.writeClockSlot).not.toHaveBeenCalled();
});

test("completed legend dwell edit survives closing before debounce and saves only left placement", async () => {
  vi.useFakeTimers();
  const rig = await editorFixture("clock-projection", "legend");
  const dwell = rig.find((node) => node.dataset?.field === "dwellSeconds");
  dwell.value = "19"; dwell.dispatch("change"); rig.editor.close();
  await vi.advanceTimersByTimeAsync(150);
  expect(rig.writeLegendSlot).toHaveBeenCalledTimes(1);
  expect(rig.writeLegendSlot.mock.calls[0][0]).toMatchObject({ span: "left", layout: { dwellSeconds: 19 } });
  expect(rig.writeClockSlot).not.toHaveBeenCalled();
});

test("frame failure cancels moved projection gestures and Retry recreates the frame retaining completed drafts", async () => {
  vi.useFakeTimers();
  const rig = await editorFixture(); rig.rendered();
  const input = rig.find((node) => node.dataset?.field === "leftPct"); input.value = "17"; input.dispatch("change");
  const oldFrame = rig.frame();
  rig.find((node) => node.attributes?.["data-gesture"] === "move").dispatch("pointerdown", { button: 0, pointerId: 4, clientX: 240, clientY: 160 });
  rig.doc.dispatch("pointermove", { pointerId: 4, clientX: 300, clientY: 190 });
  rig.message({ type: "otef_clock_preview_error", requestId: oldFrame.contentWindow.sent.at(-1).message.requestId, message: "Draw failed" });
  const retry = rig.find((node) => node.className === "clock-layout-preview-retry");
  expect(retry.hidden).toBe(false);
  expect(rig.find((node) => node.attributes?.["data-gesture"])).toBeUndefined();
  expect(rig.client.getSlot("projectionClock", "left").draft.leftPct).toBe(17);
  retry.dispatch("click");
  expect(rig.frame()).not.toBe(oldFrame);
  rig.message({ type: "otef_clock_preview_rendered", requestId: 1, surface: "projection", sceneId: "home", output: "left", mesh: projectionMesh, meshIdentity: "old", pageIndex: 0, pageCount: 1 }, oldFrame);
  expect(rig.find((node) => node.attributes?.["data-gesture"])).toBeUndefined();
  rig.rendered();
  expect(rig.frame().contentWindow.sent.at(-1).message.clockLayout.leftPct).toBe(17);
  expect(rig.writeClockSlot).not.toHaveBeenCalled();
});

test("accepted projection calibration cancels an actually moved mesh gesture during rendering and bootstrap", async () => {
  const rig = await editorFixture(); rig.rendered();
  rig.find((node) => node.attributes?.["data-gesture"] === "move").dispatch("pointerdown", { button: 0, pointerId: 9, clientX: 240, clientY: 160 });
  rig.doc.dispatch("pointermove", { pointerId: 9, clientX: 300, clientY: 190 });
  expect(rig.frame().contentWindow.sent.at(-1).message.clockLayout.leftPct).not.toBe(8);
  rig.editor.calibrationChanged();
  const loadingFrame = rig.frame(); rig.editor.calibrationChanged();
  expect(rig.frame()).not.toBe(loadingFrame);
  rig.doc.dispatch("pointerup", { pointerId: 9, clientX: 300, clientY: 190 });
  rig.rendered();
  expect(rig.frame().contentWindow.sent.at(-1).message.clockLayout).toEqual(initialLayout);
  expect(rig.writeClockSlot).not.toHaveBeenCalled();
});

test("projection resize publishes at most once per RAF and commits the completed mesh-mapped clock draft once", async () => {
  const rig = await editorFixture(); rig.rendered();
  const callbacks = []; rig.doc.defaultView.requestAnimationFrame = (callback) => { callbacks.push(callback); return callbacks.length; };
  const handle = rig.find((node) => node.dataset?.corner === "bottom-right");
  handle.dispatch("pointerdown", { button: 0, pointerId: 5, clientX: 419.8, clientY: 194.4 });
  const sentCount = rig.frame().contentWindow.sent.length;
  rig.doc.dispatch("pointermove", { pointerId: 5, clientX: 450, clientY: 210 });
  rig.doc.dispatch("pointermove", { pointerId: 5, clientX: 470, clientY: 220 });
  expect(callbacks).toHaveLength(1);
  expect(rig.frame().contentWindow.sent).toHaveLength(sentCount);
  expect(rig.writeClockSlot).not.toHaveBeenCalled();
  callbacks[0]();
  const moved = rig.frame().contentWindow.sent.at(-1).message.clockLayout;
  expect(moved.widthPct).toBeGreaterThan(35);
  expect(moved.widthPct / 35).toBeCloseTo(moved.heightPct / 28);
  expect(moved.fontPx / 22).toBeCloseTo(moved.widthPct / 35);
  rig.doc.dispatch("pointerup", { pointerId: 5, clientX: 470, clientY: 220 });
  await vi.waitFor(() => expect(rig.writeClockSlot).toHaveBeenCalledOnce());
  expect(rig.writeClockSlot.mock.calls[0][0]).toMatchObject({ surface: "projection", slot: "left", layout: moved });
});

test("modal focuses a control, traps Tab, blocks the background and restores its opener on Escape", async () => {
  const doc = documentHarness();
  const opener = doc.createElement("button"); doc.body.appendChild(opener); opener.focus();
  const client = { getSlot: () => ({ acknowledged: initialLayout, status: "Saved" }), subscribe: () => () => {} };
  const editor = openClockLayoutEditor({ nodeId: "clock-gis", layoutClient: client, document: doc });
  disposers.push(editor.dispose);
  const dialog = descendants(doc.body).find((node) => node.className === "clock-layout-dialog");
  const close = descendants(dialog).find((node) => node.className === "clock-layout-close");
  expect(doc.activeElement === close).toBe(true);
  expect(opener.inert).toBe(true);
  dialog.dispatch("keydown", { key: "Tab", shiftKey: true });
  expect(doc.activeElement === close).toBe(false);
  expect(doc.activeElement.tagName).toBe("SUMMARY");
  dialog.dispatch("keydown", { key: "Tab" });
  expect(doc.activeElement === close).toBe(true);
  dialog.dispatch("keydown", { key: "Escape" });
  expect(doc.activeElement === opener).toBe(true);
  expect(opener.inert).not.toBe(true);
});

test.each(["Failed", "Conflict"])("exhibit acknowledgement does not override Saving or %s layout labels", async (finalStatus) => {
  const rig = await editorFixture("clock-gis", "clock", { editor: { onShowOnExhibit: async () => ({ status: "ready" }) },
    client: { writeClockSlot: vi.fn(async () => { throw Object.assign(new Error("Save failed"), finalStatus === "Conflict" ? { status: 409 } : {}); }) } });
  rig.find((node) => node.className === "clock-layout-show-exhibit").dispatch("click");
  await Promise.resolve();
  const input = rig.find((node) => node.dataset?.field === "leftPct"); input.value = "16"; input.dispatch("change");
  const status = rig.find((node) => node.className === "clock-layout-status");
  expect(status.textContent).toBe("Saving");
  await vi.waitFor(() => expect(status.textContent).toBe(finalStatus === "Failed" ? "Save failed" : "Changed on another screen"));
});

test("failed initial settings hydration blocks edits and Retry obtains an authoritative snapshot", async () => {
  const getSnapshot = vi.fn().mockRejectedValueOnce(new Error("Offline")).mockResolvedValue({ nli_clock_layout: { gis: {}, projection: {} }, nli_clock_layout_revision: 3,
    legend_settings: { projection: {} }, legend_layout_revision: 4 });
  const rig = await editorFixture("clock-gis", "clock", { client: { getSnapshot } });
  const input = rig.find((node) => node.dataset?.field === "leftPct");
  expect(rig.find((node) => node.className === "clock-layout-status").textContent).toBe("Settings unavailable");
  expect(input.disabled).toBe(true);
  input.value = "16"; input.dispatch("change");
  expect(rig.writeClockSlot).not.toHaveBeenCalled();
  rig.find((node) => node.className === "clock-layout-retry").dispatch("click");
  await vi.waitFor(() => expect(input.disabled).toBe(false));
  expect(getSnapshot.mock.calls.at(-1)[0]).toEqual({ forceFresh: true });
  expect(rig.find((node) => node.className === "clock-layout-status").textContent).toBe("Saved");
});

test("closing after a completed numeric edit keeps its slot-bound debounced write", async () => {
  vi.useFakeTimers();
  const initial = { leftPct: 8, topPct: 8, widthPct: 35, heightPct: 28, fontPx: 22, rotateDeg: 0 };
  const snapshot = { nli_clock_layout: { gis: { start: initial }, projection: { left: initial } }, nli_clock_layout_revision: 0,
    legend_settings: { projection: { left: { ...initial, dwellSeconds: 8 } } }, legend_layout_revision: 0 };
  const writeClockSlot = vi.fn(async ({ surface, slot, layout }) => ({ status: "ok", nliClockLayout: { gis: { [slot]: layout }, projection: { left: initial } }, nliClockLayoutRevision: 1 }));
  const client = createClockLayoutClient({ getSnapshot: async () => snapshot, writeClockSlot, writeLegendSlot: async () => ({}) });
  await client.hydrate();
  const doc = documentHarness();
  const editor = openClockLayoutEditor({ nodeId: "clock-gis", sceneId: "home", element: "clock", layoutClient: client, document: doc });
  const input = descendants(doc.body).find((node) => node.dataset?.field === "leftPct");
  expect(input).toBeDefined();
  input.value = "17";
  input.dispatch("change");
  editor.close();
  await vi.advanceTimersByTimeAsync(150);
  await vi.waitFor(() => expect(writeClockSlot).toHaveBeenCalledTimes(1));
  expect(writeClockSlot.mock.calls[0][0]).toMatchObject({ surface: "gis", slot: "start", layout: { leftPct: 17 } });
  expect(client.getSlot("gisClock", "start").status).toBe("Saved");
  client.destroy();
  vi.useRealTimers();
});

test("closing during a pointer drag restores the original preview without writing", async () => {
  const initial = { leftPct: 8, topPct: 8, widthPct: 35, heightPct: 28, fontPx: 22, rotateDeg: 0 };
  const snapshot = { nli_clock_layout: { gis: { start: initial }, projection: { left: initial } }, nli_clock_layout_revision: 0,
    legend_settings: { projection: { left: { ...initial, dwellSeconds: 8 } } }, legend_layout_revision: 0 };
  const writeClockSlot = vi.fn(async () => ({}));
  const client = createClockLayoutClient({ getSnapshot: async () => snapshot, writeClockSlot, writeLegendSlot: async () => ({}) });
  await client.hydrate();
  const doc = documentHarness();
  const editor = openClockLayoutEditor({ nodeId: "clock-gis", sceneId: "home", element: "clock", layoutClient: client, document: doc });
  const frame = descendants(doc.body).find((node) => node.tagName === "IFRAME");
  const sessionId = new URL(frame.src).searchParams.get("previewSession");
  doc.defaultView.dispatch("message", { origin: doc.defaultView.location.origin, source: frame.contentWindow,
    data: { type: "otef_clock_preview_ready", sessionId, surface: "gis", output: null } });
  const state = frame.contentWindow.sent[0].message;
  doc.defaultView.dispatch("message", { origin: doc.defaultView.location.origin, source: frame.contentWindow,
    data: { type: "otef_clock_preview_rendered", sessionId, requestId: state.requestId, surface: "gis", sceneId: "home", output: null,
      mesh: null, meshIdentity: null, pageIndex: 0, pageCount: 1 } });
  const moveHandle = descendants(doc.body).find((node) => node.attributes?.["data-gesture"] === "move");
  moveHandle.dispatch("pointerdown", { button: 0, pointerId: 7, clientX: 240, clientY: 160 });
  editor.close();
  expect(writeClockSlot).not.toHaveBeenCalled();
  expect(client.getSlot("gisClock", "start")).toMatchObject({ acknowledged: initial, draft: null, status: "Saved" });
  client.destroy();
});

test("accepted calibration change during a drag cancels the gesture and reloads the preview", async () => {
  const initial = { leftPct: 8, topPct: 8, widthPct: 35, heightPct: 28, fontPx: 22, rotateDeg: 0 };
  const snapshot = { nli_clock_layout: { gis: { start: initial }, projection: { left: initial } }, nli_clock_layout_revision: 0,
    legend_settings: { projection: { left: { ...initial, dwellSeconds: 8 } } }, legend_layout_revision: 0 };
  const writeClockSlot = vi.fn(async () => ({}));
  const client = createClockLayoutClient({ getSnapshot: async () => snapshot, writeClockSlot, writeLegendSlot: async () => ({}) });
  await client.hydrate();
  const doc = documentHarness();
  const editor = openClockLayoutEditor({ nodeId: "clock-gis", sceneId: "home", element: "clock", layoutClient: client, document: doc });
  const frame = descendants(doc.body).find((node) => node.tagName === "IFRAME");
  const firstSession = new URL(frame.src).searchParams.get("previewSession");
  doc.defaultView.dispatch("message", { origin: doc.defaultView.location.origin, source: frame.contentWindow,
    data: { type: "otef_clock_preview_ready", sessionId: firstSession, surface: "gis", output: null } });
  const state = frame.contentWindow.sent[0].message;
  doc.defaultView.dispatch("message", { origin: doc.defaultView.location.origin, source: frame.contentWindow,
    data: { type: "otef_clock_preview_rendered", sessionId: firstSession, requestId: state.requestId, surface: "gis", sceneId: "home", output: null,
      mesh: null, meshIdentity: null, pageIndex: 0, pageCount: 1 } });
  descendants(doc.body).find((node) => node.attributes?.["data-gesture"] === "move")
    .dispatch("pointerdown", { button: 0, pointerId: 9, clientX: 240, clientY: 160 });
  editor.calibrationChanged();
  const reloadedFrame = descendants(doc.body).find((node) => node.tagName === "IFRAME");
  expect(new URL(reloadedFrame.src).searchParams.get("previewSession")).not.toBe(firstSession);
  expect(writeClockSlot).not.toHaveBeenCalled();
  expect(client.getSlot("gisClock", "start")).toMatchObject({ acknowledged: initial, draft: null, status: "Saved" });
  editor.dispose();
  client.destroy();
});
