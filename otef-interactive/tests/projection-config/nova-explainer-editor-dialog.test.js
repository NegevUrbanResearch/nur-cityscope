import { afterEach, expect, test, vi } from "vitest";
import { createClockLayoutClient } from "../../frontend/src/projection-config/clock-layout-client.js";
import { layoutFor, resourceFor } from "../../frontend/src/projection-config/clock-layout-controls.js";
import { openNovaExplainerEditor } from "../../frontend/src/projection-config/nova-explainer-editor-dialog.js";

const clockBox = { leftPct: 30, topPct: 88, widthPct: 40, heightPct: 8, fontPx: 22, rotateDeg: 0 };
const savedMaps = {
  close: { "100": { leftPct: 11, topPct: 21 } },
  wide: { "100": { leftPct: 61, topPct: 71 }, "104": { leftPct: 62, topPct: 72 } },
};
const cards = [
  { objectId: 100, name: "Alpha Name", box: { leftPct: 10, topPct: 12, widthPct: 8, heightPct: 4 } },
  { objectId: 104, name: "Beta Name", box: { leftPct: 12, topPct: 14, widthPct: 8, heightPct: 4 } },
  { objectId: 106, name: "Offscreen Name", box: null },
];
const disposers = [];

function documentHarness() {
  const winListeners = new Map();
  const docListeners = new Map();
  const doc = {
    activeElement: null,
    addEventListener(type, handler) { (docListeners.get(type) || docListeners.set(type, []).get(type)).push(handler); },
    removeEventListener(type, handler) {
      const list = docListeners.get(type) || [];
      docListeners.set(type, list.filter((item) => item !== handler));
    },
    dispatch(type, event) { for (const handler of docListeners.get(type) || []) handler(event); },
    defaultView: {
      location: { href: "http://localhost/otef-interactive/projection-config.html", origin: "http://localhost" },
      addEventListener(type, handler) { winListeners.set(type, handler); },
      removeEventListener(type, handler) { if (winListeners.get(type) === handler) winListeners.delete(type); },
      dispatch(type, event) { winListeners.get(type)?.(event); },
      requestAnimationFrame(callback) { callback(); return 1; },
      cancelAnimationFrame() {},
    },
    createElement(tag) {
      const node = {
        tagName: tag.toUpperCase(), children: [], dataset: {}, style: {}, attributes: {}, hidden: false, disabled: false, value: "",
        classList: { add() {}, remove() {}, toggle() {} },
        appendChild(child) { this.children.push(child); child.parentElement = this; child.ownerDocument ||= doc; return child; },
        append(...children) { children.forEach((child) => this.appendChild(child)); },
        replaceChildren(...children) { this.children = []; children.forEach((child) => this.appendChild(child)); },
        setAttribute(key, value) { this.attributes[key] = String(value); if (key.startsWith("data-")) this.dataset[key.slice(5)] = String(value); },
        removeAttribute(key) { delete this.attributes[key]; },
        addEventListener(type, handler) { (this.listeners ||= {})[type] = [...(this.listeners?.[type] || []), handler]; },
        removeEventListener(type, handler) { this.listeners[type] = (this.listeners?.[type] || []).filter((item) => item !== handler); },
        dispatch(type, extra = {}) { for (const handler of this.listeners?.[type] || []) handler({ currentTarget: this, target: this, preventDefault() {}, stopPropagation() {}, button: 0, ...extra }); },
        remove() { this.removed = true; this.parentElement && (this.parentElement.children = this.parentElement.children.filter((child) => child !== this)); },
        focus() { doc.activeElement = this; },
        setPointerCapture(id) { this.captured = id; },
        releasePointerCapture(id) { this.released = id; this.captured = null; },
        getBoundingClientRect() { return { left: 0, top: 0, width: 960, height: 540, right: 960, bottom: 540 }; },
        querySelectorAll(selector) {
          const tags = selector.split(",").map((item) => item.trim().toUpperCase());
          const found = [];
          const walk = (entry) => {
            if (tags.includes(entry.tagName)) found.push(entry);
            for (const child of entry.children || []) walk(child);
          };
          for (const child of this.children || []) walk(child);
          return found;
        },
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

afterEach(() => { disposers.splice(0).forEach((dispose) => dispose()); vi.useRealTimers(); });

test("nova explainers resource is the overlay slot and is not a clock rectangle", () => {
  const selection = resourceFor("nova-explainers", "segev", "legend");
  expect(selection).toMatchObject({ resource: "gisNovaExplainers", slot: "novaExplainers", fallback: { close: {}, wide: {} } });
  expect(selection.fallback.fontPx).toBeUndefined();
  expect(selection.fallback.widthPct).toBeUndefined();
  expect(selection.fallback.rotateDeg).toBeUndefined();
  const shown = layoutFor({
    getSlot: () => ({ acknowledged: { close: { "100": { leftPct: 3, topPct: 4 } }, wide: { "104": { leftPct: 8, topPct: 9 } } }, draft: null }),
  }, selection);
  expect(shown.layout).toEqual({ close: { "100": { leftPct: 3, topPct: 4 } }, wide: { "104": { leftPct: 8, topPct: 9 } } });
  expect(shown.layout.fontPx).toBeUndefined();
});

test("Close and Wide edits stay isolated and reset deletes only the selected camera entry", async () => {
  vi.useFakeTimers();
  const rig = await editorFixture();
  rig.rendered();
  rig.select("100");
  rig.setAxis("leftPct", "15");
  rig.setAxis("topPct", "25");
  await vi.advanceTimersByTimeAsync(150);
  expect(rig.latestLayout().close["100"]).toEqual({ leftPct: 15, topPct: 25 });
  expect(rig.latestLayout().wide["100"]).toEqual({ leftPct: 61, topPct: 71 });
  rig.camera("wide");
  rig.rendered(cards, "wide");
  rig.select("100");
  rig.setAxis("leftPct", "63");
  rig.setAxis("topPct", "73");
  await vi.advanceTimersByTimeAsync(150);
  expect(rig.latestLayout().close["100"]).toEqual({ leftPct: 15, topPct: 25 });
  expect(rig.latestLayout().wide["100"]).toEqual({ leftPct: 63, topPct: 73 });
  expect(rig.latestLayout().wide["104"]).toEqual({ leftPct: 62, topPct: 72 });
  const writesBeforeReset = rig.writeClockSlot.mock.calls.length;
  rig.reset();
  await vi.waitFor(() => expect(rig.writeClockSlot.mock.calls.length).toBe(writesBeforeReset + 1));
  expect(rig.latestLayout().wide["100"]).toBeUndefined();
  expect(rig.latestLayout().wide["104"]).toEqual({ leftPct: 62, topPct: 72 });
  expect(rig.latestLayout().close["100"]).toEqual({ leftPct: 15, topPct: 25 });
});

test("blank and non-finite numeric input is ignored", async () => {
  vi.useFakeTimers();
  const rig = await editorFixture();
  rig.rendered();
  rig.select("100");
  rig.setAxis("leftPct", "");
  rig.setAxis("leftPct", "nope");
  rig.setAxis("topPct", "Infinity");
  await vi.advanceTimersByTimeAsync(200);
  expect(rig.writeClockSlot).not.toHaveBeenCalled();
  expect(rig.client.getSlot("gisNovaExplainers", "novaExplainers").draft).toBeNull();
});

test("numeric X and Y edits debounce for 150ms", async () => {
  vi.useFakeTimers();
  const rig = await editorFixture();
  rig.rendered();
  rig.select("100");
  rig.setAxis("leftPct", "44");
  await vi.advanceTimersByTimeAsync(149);
  expect(rig.writeClockSlot).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(1);
  expect(rig.writeClockSlot).toHaveBeenCalledOnce();
  expect(rig.latestLayout().close["100"]).toEqual({ leftPct: 44, topPct: 21 });
  expect(rig.latestLayout().wide["100"]).toEqual(savedMaps.wide["100"]);
});

test("a numeric X/Y burst publishes one preview after the debounced write", async () => {
  vi.useFakeTimers();
  const rig = await editorFixture();
  rig.rendered();
  rig.select("100");
  const sent = rig.frame().contentWindow.sent.length;
  rig.setAxis("leftPct", "18");
  rig.setAxis("topPct", "28");
  await vi.advanceTimersByTimeAsync(150);
  await vi.waitFor(() => expect(rig.writeClockSlot).toHaveBeenCalledOnce());
  expect(rig.latestLayout().close["100"]).toEqual({ leftPct: 18, topPct: 28 });
  expect(rig.frame().contentWindow.sent.length).toBe(sent + 1);
});

test("a numeric edit superseded by pointer-up publishes one preview", async () => {
  vi.useFakeTimers();
  const rig = await editorFixture();
  rig.rendered();
  rig.select("100");
  const sent = rig.frame().contentWindow.sent.length;
  rig.setAxis("leftPct", "30");
  const handle = rig.card("100");
  handle.dispatch("pointerdown", { pointerId: 4, clientX: 120, clientY: 90 });
  rig.docDispatch("pointermove", { pointerId: 4, clientX: 216, clientY: 90 });
  rig.docDispatch("pointerup", { pointerId: 4, clientX: 216, clientY: 90 });
  await vi.advanceTimersByTimeAsync(150);
  await vi.waitFor(() => expect(rig.writeClockSlot).toHaveBeenCalledOnce());
  expect(rig.latestLayout().close["100"].leftPct).toBeCloseTo(40);
  expect(rig.frame().contentWindow.sent.length).toBe(sent + 1);
});

test("pointer move keeps the local handle without saving and pointer-up commits the document once", async () => {
  const rig = await editorFixture();
  rig.rendered();
  const sent = rig.frame().contentWindow.sent.length;
  const handle = rig.card("100");
  const startX = Number(handle.attributes.x);
  handle.dispatch("pointerdown", { pointerId: 7, clientX: 100, clientY: 80 });
  rig.docDispatch("pointermove", { pointerId: 7, clientX: 196, clientY: 80 });
  rig.docDispatch("pointermove", { pointerId: 7, clientX: 292, clientY: 134 });
  expect(rig.writeClockSlot).not.toHaveBeenCalled();
  expect(rig.frame().contentWindow.sent).toHaveLength(sent);
  expect(Number(rig.card("100").attributes.x)).toBeGreaterThan(startX);
  rig.docDispatch("pointerup", { pointerId: 7, clientX: 292, clientY: 134 });
  await vi.waitFor(() => expect(rig.writeClockSlot).toHaveBeenCalledOnce());
  expect(rig.writeClockSlot.mock.calls[0][0]).toMatchObject({ surface: "gisOverlays", slot: "novaExplainers" });
  expect(rig.latestLayout().close["100"].leftPct).toBeCloseTo(30);
  expect(rig.latestLayout().close["100"].topPct).toBeCloseTo(22);
  expect(rig.latestLayout().wide).toEqual(savedMaps.wide);
  expect(rig.frame().contentWindow.sent.length).toBe(sent + 1);
  expect(rig.frame().contentWindow.sent.at(-1).message).toMatchObject({
    element: "novaExplainers", sceneId: "nova", surface: "gis", output: null, novaExplainerCamera: "close",
  });
});

test("a gesture applies the pointer delta to the latest local draft", async () => {
  vi.useFakeTimers();
  const rig = await editorFixture();
  rig.rendered();
  rig.select("100");
  rig.setAxis("leftPct", "30");
  const handle = rig.card("100");
  handle.dispatch("pointerdown", { pointerId: 4, clientX: 120, clientY: 90 });
  rig.docDispatch("pointermove", { pointerId: 4, clientX: 216, clientY: 90 });
  rig.docDispatch("pointerup", { pointerId: 4, clientX: 216, clientY: 90 });
  await vi.advanceTimersByTimeAsync(150);
  await vi.waitFor(() => expect(rig.writeClockSlot).toHaveBeenCalled());
  expect(rig.latestLayout().close["100"].leftPct).toBeCloseTo(40);
  expect(rig.latestLayout().close["100"].topPct).toBeCloseTo(21);
  expect(rig.latestLayout().wide["104"]).toEqual(savedMaps.wide["104"]);
});

test("name selection and numeric position recover an overlapping card", async () => {
  vi.useFakeTimers();
  const rig = await editorFixture();
  rig.rendered();
  const names = rig.find((node) => node.className === "nova-explainer-names");
  expect(names.querySelectorAll("option").map((option) => option.textContent)).toEqual(["100 Alpha Name", "104 Beta Name", "106 Offscreen Name"]);
  expect(names.getAttribute?.("dir") || names.attributes?.dir).toBe("auto");
  names.value = "104";
  names.dispatch("change");
  rig.setAxis("leftPct", "60");
  rig.setAxis("topPct", "40");
  await vi.advanceTimersByTimeAsync(150);
  expect(rig.latestLayout().close["104"]).toEqual({ leftPct: 60, topPct: 40 });
  expect(rig.latestLayout().close["100"]).toEqual(savedMaps.close["100"]);
});

test("a saved card shows saved X/Y while handles use the rendered box", async () => {
  const rig = await editorFixture({
    close: { "100": { leftPct: 80, topPct: 80 } },
    wide: { "100": { leftPct: 61, topPct: 71 } },
  });
  rig.rendered();
  const handle = rig.card("100");
  expect(Number(handle.attributes.x)).toBeCloseTo(10 * 19.2);
  expect(Number(handle.attributes.y)).toBeCloseTo(12 * 10.8);
  expect(Number(handle.attributes.width)).toBeCloseTo(8 * 19.2);
  expect(Number(handle.attributes.height)).toBeCloseTo(4 * 10.8);
  expect(rig.card("106")).toBeUndefined();
  rig.select("100");
  expect(rig.input("leftPct").value).toBe("80");
  expect(rig.input("topPct").value).toBe("80");
});

test("a clamped saved card shows saved X/Y and drag tracks the displayed handle", async () => {
  const rig = await editorFixture({
    close: { "100": { leftPct: 100, topPct: 100 } },
    wide: { "100": { leftPct: 61, topPct: 71 } },
  });
  rig.rendered([
    { objectId: 100, name: "Alpha Name", box: { leftPct: 90, topPct: 90, widthPct: 8, heightPct: 4 } },
  ]);
  rig.select("100");
  expect(rig.input("leftPct").value).toBe("100");
  expect(rig.input("topPct").value).toBe("100");
  const handle = rig.card("100");
  expect(Number(handle.attributes.x)).toBeCloseTo(90 * 19.2);
  expect(Number(handle.attributes.y)).toBeCloseTo(90 * 10.8);
  handle.dispatch("pointerdown", { pointerId: 3, clientX: 100, clientY: 80 });
  rig.docDispatch("pointermove", { pointerId: 3, clientX: 109.6, clientY: 80 });
  expect(Number(rig.card("100").attributes.x)).toBeCloseTo(91 * 19.2);
  expect(Number(rig.card("100").attributes.y)).toBeCloseTo(90 * 10.8);
  rig.docDispatch("pointerup", { pointerId: 3, clientX: 109.6, clientY: 80 });
  await vi.waitFor(() => expect(rig.writeClockSlot).toHaveBeenCalledOnce());
  expect(rig.latestLayout().close["100"].leftPct).toBeCloseTo(91);
  expect(rig.latestLayout().close["100"].topPct).toBeCloseTo(90);
});

test("an on-screen unsaved card shows the rendered box", async () => {
  const rig = await editorFixture();
  rig.rendered();
  rig.select("104");
  expect(rig.input("leftPct").value).toBe("12");
  expect(rig.input("topPct").value).toBe("14");
  expect(rig.writeClockSlot).not.toHaveBeenCalled();
});

test("the initially displayed card accepts numeric edits and reset without a change event", async () => {
  vi.useFakeTimers();
  const rig = await editorFixture();
  rig.rendered();
  const names = rig.find((node) => node.className === "nova-explainer-names");
  expect(names.value).toBe("100");
  expect(rig.input("leftPct").value).toBe("11");
  expect(rig.input("topPct").value).toBe("21");
  rig.setAxis("leftPct", "33");
  rig.setAxis("topPct", "43");
  await vi.advanceTimersByTimeAsync(150);
  expect(rig.writeClockSlot).toHaveBeenCalledOnce();
  expect(rig.latestLayout().close["100"]).toEqual({ leftPct: 33, topPct: 43 });
  rig.reset();
  await vi.waitFor(() => expect(rig.latestLayout().close["100"]).toBeUndefined());
  expect(rig.latestLayout().wide["100"]).toEqual(savedMaps.wide["100"]);
  expect(rig.writeClockSlot).toHaveBeenCalledTimes(2);
});

test("an initial card with no box shows 50/50 and stays unsaved until edited", async () => {
  vi.useFakeTimers();
  const rig = await editorFixture();
  rig.rendered([
    { objectId: 106, name: "Offscreen Name", box: null },
    { objectId: 100, name: "Alpha Name", box: { leftPct: 10, topPct: 12, widthPct: 8, heightPct: 4 } },
  ]);
  const names = rig.find((node) => node.className === "nova-explainer-names");
  expect(names.value).toBe("106");
  expect(rig.input("leftPct").value).toBe("50");
  expect(rig.input("topPct").value).toBe("50");
  await vi.advanceTimersByTimeAsync(200);
  expect(rig.writeClockSlot).not.toHaveBeenCalled();
  rig.setAxis("leftPct", "40");
  await vi.advanceTimersByTimeAsync(150);
  expect(rig.writeClockSlot).toHaveBeenCalledOnce();
  expect(rig.latestLayout().close["106"]).toEqual({ leftPct: 40, topPct: 50 });
  rig.reset();
  await vi.waitFor(() => expect(rig.latestLayout().close["106"]).toBeUndefined());
});

test("an offscreen unsaved card stays selectable at 50/50 until it is edited", async () => {
  vi.useFakeTimers();
  const rig = await editorFixture();
  rig.rendered();
  rig.select("106");
  expect(rig.input("leftPct").value).toBe("50");
  expect(rig.input("topPct").value).toBe("50");
  await vi.advanceTimersByTimeAsync(200);
  expect(rig.writeClockSlot).not.toHaveBeenCalled();
  rig.setAxis("leftPct", "40");
  await vi.advanceTimersByTimeAsync(150);
  expect(rig.latestLayout().close["106"]).toEqual({ leftPct: 40, topPct: 50 });
  expect(rig.latestLayout().close["100"]).toEqual(savedMaps.close["100"]);
});

test("a stale preview cannot reposition handles", async () => {
  const rig = await editorFixture();
  rig.rendered();
  const firstId = rig.frame().contentWindow.sent[0].message.requestId;
  rig.camera("wide");
  expect(rig.card("100")).toBeUndefined();
  rig.message({
    type: "otef_clock_preview_rendered", requestId: firstId, surface: "gis", sceneId: "nova", output: null,
    mesh: null, meshIdentity: null, pageIndex: 0, pageCount: 1, novaExplainerCamera: "close",
    novaExplainerCards: [{ objectId: 100, name: "Alpha Name", box: { leftPct: 90, topPct: 90, widthPct: 8, heightPct: 4 } }],
  });
  expect(rig.card("100")).toBeUndefined();
  const latest = rig.frame().contentWindow.sent.at(-1).message;
  rig.message({
    type: "otef_clock_preview_rendered", requestId: latest.requestId, surface: "gis", sceneId: "nova", output: null,
    mesh: null, meshIdentity: null, pageIndex: 0, pageCount: 1, novaExplainerCamera: "wide",
    novaExplainerCards: [{ objectId: 100, name: "Alpha Name", box: { leftPct: 40, topPct: 18, widthPct: 8, heightPct: 4 } }],
  });
  expect(Number(rig.card("100").attributes.x)).toBeCloseTo(40 * 19.2);
});

test("switching cameras reseeds X/Y from the new acknowledged box without reselecting the name", async () => {
  const rig = await editorFixture();
  expect(savedMaps.close["100"]).not.toEqual(savedMaps.wide["100"]);
  rig.rendered();
  rig.select("100");
  expect(rig.input("leftPct").value).toBe("11");
  expect(rig.input("topPct").value).toBe("21");
  const names = rig.find((node) => node.className === "nova-explainer-names");
  expect(names.value).toBe("100");
  rig.camera("wide");
  expect(names.value).toBe("100");
  rig.rendered(
    [{ objectId: 100, name: "Alpha Name", box: { leftPct: 61, topPct: 71, widthPct: 8, heightPct: 4 } }],
    "wide",
  );
  expect(names.value).toBe("100");
  expect(rig.input("leftPct").value).toBe(String(savedMaps.wide["100"].leftPct));
  expect(rig.input("topPct").value).toBe(String(savedMaps.wide["100"].topPct));
});

test("loading and failed previews disable drag", async () => {
  const loading = await editorFixture();
  expect(loading.card("100")).toBeUndefined();
  loading.rendered();
  const handle = loading.card("100");
  const state = loading.frame().contentWindow.sent.at(-1).message;
  loading.message({ type: "otef_clock_preview_error", requestId: state.requestId, message: "preview down" });
  expect(loading.find((node) => node.className === "clock-layout-preview-status").textContent).toMatch(/unavailable/i);
  expect(loading.card("100")).toBeUndefined();
  handle.dispatch("pointerdown", { pointerId: 3, clientX: 100, clientY: 80 });
  loading.docDispatch("pointerup", { pointerId: 3, clientX: 200, clientY: 80 });
  expect(handle.captured).toBeUndefined();
  expect(loading.writeClockSlot).not.toHaveBeenCalled();
});

test("a camera switch disables drag until the matching preview renders", async () => {
  const rig = await editorFixture();
  rig.rendered();
  const closeHandle = rig.card("100");
  expect(closeHandle).toBeDefined();
  expect(rig.input("leftPct").disabled).toBe(false);
  rig.camera("wide");
  expect(rig.card("100")).toBeUndefined();
  expect(rig.input("leftPct").disabled).toBe(true);
  expect(rig.input("topPct").disabled).toBe(true);
  closeHandle.dispatch("pointerdown", { pointerId: 11, clientX: 100, clientY: 80 });
  rig.docDispatch("pointermove", { pointerId: 11, clientX: 220, clientY: 80 });
  rig.docDispatch("pointerup", { pointerId: 11, clientX: 220, clientY: 80 });
  expect(closeHandle.captured).toBeUndefined();
  rig.setAxis("leftPct", "70");
  expect(rig.writeClockSlot).not.toHaveBeenCalled();
  rig.rendered(
    [{ objectId: 100, name: "Alpha Name", box: { leftPct: 40, topPct: 18, widthPct: 8, heightPct: 4 } }],
    "wide",
  );
  expect(rig.input("leftPct").disabled).toBe(false);
  const wideHandle = rig.card("100");
  wideHandle.dispatch("pointerdown", { pointerId: 12, clientX: 100, clientY: 80 });
  rig.docDispatch("pointermove", { pointerId: 12, clientX: 196, clientY: 80 });
  rig.docDispatch("pointerup", { pointerId: 12, clientX: 196, clientY: 80 });
  await vi.waitFor(() => expect(rig.writeClockSlot).toHaveBeenCalledOnce());
  expect(rig.latestLayout().wide["100"].leftPct).toBeCloseTo(50);
  expect(rig.latestLayout().close["100"]).toEqual(savedMaps.close["100"]);
});

test("switching cameras or closing mid-drag cancels the gesture and releases capture", async () => {
  const rig = await editorFixture();
  rig.rendered();
  const handle = rig.card("100");
  handle.dispatch("pointerdown", { pointerId: 9, clientX: 100, clientY: 80 });
  rig.docDispatch("pointermove", { pointerId: 9, clientX: 220, clientY: 80 });
  expect(handle.captured).toBe(9);
  rig.camera("wide");
  expect(handle.released).toBe(9);
  expect(rig.writeClockSlot).not.toHaveBeenCalled();
  expect(rig.client.getSlot("gisNovaExplainers", "novaExplainers").draft).toBeNull();
  rig.camera("close");
  rig.rendered();
  const again = rig.card("100");
  again.dispatch("pointerdown", { pointerId: 10, clientX: 100, clientY: 80 });
  rig.docDispatch("pointermove", { pointerId: 10, clientX: 220, clientY: 80 });
  rig.find((node) => node.className === "clock-layout-close").dispatch("click");
  expect(again.released).toBe(10);
  expect(rig.writeClockSlot).not.toHaveBeenCalled();
});

test("conflict keeps the draft, Retry resubmits it, and Load saved replaces both cameras", async () => {
  vi.useFakeTimers();
  const serverNext = {
    close: { "100": { leftPct: 1, topPct: 20 } },
    wide: { "104": { leftPct: 3, topPct: 18 } },
  };
  const rig = await editorFixture(savedMaps, {
    writeClockSlot: vi.fn(async ({ layout, baseRevision }) => {
      if (rigWrites === 0) {
        rigWrites += 1;
        const conflictDoc = structuredClone(baseSnapshot());
        conflictDoc.gisOverlays = { novaExplainers: structuredClone(serverNext) };
        return { status: 409, error: "conflict", nliClockLayout: conflictDoc, nliClockLayoutRevision: 4 };
      }
      rigWrites += 1;
      const doc = structuredClone(baseSnapshot());
      doc.gisOverlays = { novaExplainers: layout };
      return { status: "ok", nliClockLayout: doc, nliClockLayoutRevision: baseRevision + 1 };
    }),
  });
  rig.rendered();
  rig.select("100");
  rig.setAxis("leftPct", "44");
  await vi.advanceTimersByTimeAsync(150);
  await vi.waitFor(() => expect(rig.find((node) => node.className === "clock-layout-status").textContent).toBe("Changed on another screen"));
  expect(rig.client.getSlot("gisNovaExplainers", "novaExplainers").draft.close["100"].leftPct).toBe(44);
  expect(rig.client.getSlot("gisNovaExplainers", "novaExplainers").acknowledged).toEqual(serverNext);
  expect(rig.input("leftPct").value).toBe("44");
  rig.find((node) => node.className === "clock-layout-retry").dispatch("click");
  await vi.waitFor(() => expect(rig.client.getSlot("gisNovaExplainers", "novaExplainers").status).toBe("Saved"));
  expect(rig.writeClockSlot.mock.calls[1][0]).toMatchObject({ surface: "gisOverlays", slot: "novaExplainers", baseRevision: 4 });
  expect(rig.writeClockSlot.mock.calls[1][0].layout.close["100"].leftPct).toBe(44);
  expect(rig.writeClockSlot.mock.calls[1][0].layout.wide["104"]).toEqual(savedMaps.wide["104"]);
  rig.setAxis("leftPct", "48");
  rig.find((node) => node.className === "clock-layout-load").dispatch("click");
  expect(rig.client.getSlot("gisNovaExplainers", "novaExplainers")).toMatchObject({ draft: null, status: "Saved", acknowledged: rig.writeClockSlot.mock.calls[1][0].layout });
  expect(rig.input("leftPct").value).toBe("44");
});

test("an accepted remote overlay reseeds fields, handles, and the preview without Load saved", async () => {
  const handlers = new Map();
  const socket = {
    on: (name, handler) => handlers.set(name, handler),
    off: (name) => handlers.delete(name),
  };
  const rig = await editorFixture(savedMaps, { socket });
  rig.rendered();
  rig.select("100");
  expect(rig.find((node) => node.className === "clock-layout-status").textContent).toBe("Saved");
  const sent = rig.frame().contentWindow.sent.length;
  const remoteMaps = {
    close: { "100": { leftPct: 33, topPct: 44 } },
    wide: { "100": { leftPct: 55, topPct: 66 }, "104": { leftPct: 77, topPct: 18 } },
  };
  handlers.get("otef_nli_clock_layout_changed")({
    nliClockLayout: baseSnapshot(remoteMaps),
    nliClockLayoutRevision: 1,
  });
  expect(rig.client.getSlot("gisNovaExplainers", "novaExplainers")).toMatchObject({ draft: null, status: "Saved" });
  expect(rig.input("leftPct").value).toBe("33");
  expect(rig.input("topPct").value).toBe("44");
  expect(Number(rig.card("100").attributes.x)).toBeCloseTo(33 * 19.2);
  expect(Number(rig.card("100").attributes.y)).toBeCloseTo(44 * 10.8);
  expect(rig.frame().contentWindow.sent.length).toBe(sent + 1);
  expect(rig.frame().contentWindow.sent.at(-1).message).toMatchObject({
    novaExplainerCamera: "close",
    novaExplainerLayout: remoteMaps,
  });
  expect(rig.writeClockSlot).not.toHaveBeenCalled();
  rig.camera("wide");
  expect(rig.input("leftPct").value).toBe("55");
  expect(rig.input("topPct").value).toBe("66");
});

test("a remote overlay during a retained draft does not replace the draft", async () => {
  vi.useFakeTimers();
  const handlers = new Map();
  const socket = {
    on: (name, handler) => handlers.set(name, handler),
    off: (name) => handlers.delete(name),
  };
  const rig = await editorFixture(savedMaps, {
    socket,
    writeClockSlot: () => new Promise(() => {}),
  });
  rig.rendered();
  rig.select("100");
  rig.setAxis("leftPct", "44");
  expect(rig.client.getSlot("gisNovaExplainers", "novaExplainers").status).toBe("Saving");
  const sent = rig.frame().contentWindow.sent.length;
  handlers.get("otef_nli_clock_layout_changed")({
    nliClockLayout: baseSnapshot({
      close: { "100": { leftPct: 1, topPct: 2 } },
      wide: { "100": { leftPct: 3, topPct: 4 } },
    }),
    nliClockLayoutRevision: 1,
  });
  expect(rig.client.getSlot("gisNovaExplainers", "novaExplainers").status).toBe("Conflict");
  expect(rig.client.getSlot("gisNovaExplainers", "novaExplainers").draft.close["100"].leftPct).toBe(44);
  expect(rig.input("leftPct").value).toBe("44");
  expect(rig.frame().contentWindow.sent.length).toBe(sent);
  expect(rig.frame().contentWindow.sent.at(-1).message.novaExplainerLayout.close["100"]).toEqual(savedMaps.close["100"]);
});

test("the dialog traps focus, closes on Escape, and restores the opener", async () => {
  const doc = documentHarness();
  const opener = doc.createElement("button");
  doc.body.appendChild(opener);
  opener.focus();
  const client = {
    getSlot: () => ({ acknowledged: savedMaps, draft: null, status: "Saved" }),
    getHydrationState: () => ({ status: "Saved" }),
    subscribe: () => () => {},
    commit: vi.fn(),
  };
  const editor = openNovaExplainerEditor({ layoutClient: client, document: doc });
  disposers.push(() => editor.dispose());
  const dialog = descendants(doc.body).find((node) => String(node.className).includes("nova-explainer-dialog"));
  const close = descendants(dialog).find((node) => node.className === "clock-layout-close");
  expect(doc.activeElement).toBe(close);
  expect(opener.inert).toBe(true);
  expect(descendants(dialog).some((node) => node.textContent === "Show on exhibit")).toBe(false);
  dialog.dispatch("keydown", { key: "Tab", shiftKey: true });
  expect(doc.activeElement).not.toBe(close);
  dialog.dispatch("keydown", { key: "Tab" });
  expect(doc.activeElement).toBe(close);
  dialog.dispatch("keydown", { key: "Escape" });
  expect(doc.activeElement).toBe(opener);
  expect(opener.inert).not.toBe(true);
  expect(dialog.removed).toBe(true);
});

test("pending edits warn before unload and dispose removes the dialog", async () => {
  vi.useFakeTimers();
  const onPendingState = vi.fn();
  const rig = await editorFixture(savedMaps, {}, { onPendingState });
  rig.rendered();
  rig.select("100");
  rig.setAxis("leftPct", "18");
  expect(onPendingState).toHaveBeenCalledWith(true);
  const event = { preventDefault: vi.fn(), returnValue: "keep" };
  rig.doc.defaultView.dispatch("beforeunload", event);
  expect(event.preventDefault).toHaveBeenCalled();
  rig.editor.dispose();
  expect(rig.find((node) => String(node.className).includes("nova-explainer-dialog"))).toBeUndefined();
  expect(rig.frame()).toBeUndefined();
  event.preventDefault.mockClear();
  rig.doc.defaultView.dispatch("beforeunload", event);
  expect(event.preventDefault).not.toHaveBeenCalled();
  expect(() => rig.editor.dispose()).not.toThrow();
  await vi.advanceTimersByTimeAsync(150);
  expect(rig.writeClockSlot).toHaveBeenCalled();
});

let rigWrites = 0;

function baseSnapshot(maps = savedMaps) {
  return {
    gis: { nova: clockBox, start: clockBox },
    projection: { left: clockBox },
    gisOverlays: { novaExplainers: structuredClone(maps) },
  };
}

async function editorFixture(maps = savedMaps, clientOverrides = {}, editorOverrides = {}) {
  rigWrites = 0;
  const initial = {
    nli_clock_layout: baseSnapshot(maps),
    nli_clock_layout_revision: 0,
    legend_settings: { projection: { left: { ...clockBox, dwellSeconds: 8 } } },
    legend_layout_revision: 0,
  };
  const writeClockSlot = clientOverrides.writeClockSlot || vi.fn(async ({ layout, baseRevision }) => {
    const doc = structuredClone(initial.nli_clock_layout);
    doc.gisOverlays = { novaExplainers: layout };
    return { status: "ok", nliClockLayout: doc, nliClockLayoutRevision: baseRevision + 1 };
  });
  const getSnapshot = clientOverrides.getSnapshot || vi.fn(async () => initial);
  if (clientOverrides.getSnapshot) {
    clientOverrides.getSnapshot.mockResolvedValueOnce?.(initial);
    if (!clientOverrides.getSnapshot.getMockImplementation()) clientOverrides.getSnapshot.mockResolvedValue(initial);
  }
  const client = createClockLayoutClient({
    getSnapshot: async (options) => getSnapshot(options),
    writeClockSlot,
    writeLegendSlot: async () => ({}),
    socket: clientOverrides.socket,
  });
  await client.hydrate().catch(() => {});
  const doc = documentHarness();
  const editor = openNovaExplainerEditor({ layoutClient: client, document: doc, ...editorOverrides });
  disposers.push(() => { editor.dispose(); client.destroy(); });
  const find = (predicate) => descendants(doc.body).find(predicate);
  const frame = () => find((node) => node.tagName === "IFRAME");
  const message = (data) => doc.defaultView.dispatch("message", {
    origin: doc.defaultView.location.origin,
    source: frame().contentWindow,
    data: { sessionId: new URL(frame().src).searchParams.get("previewSession"), ...data },
  });
  const rig = {
    doc, editor, client, writeClockSlot, find, frame, message,
    docDispatch(type, extra) { doc.dispatch(type, { preventDefault() {}, ...extra }); },
    input(field) { return find((node) => node.dataset?.field === field); },
    card(id) { return find((node) => node.attributes?.["data-object-id"] === String(id) && !node.removed); },
    select(id) { const names = find((node) => node.className === "nova-explainer-names"); names.value = String(id); names.dispatch("change"); },
    setAxis(field, value) { const input = find((node) => node.dataset?.field === field); input.value = String(value); input.dispatch("change"); },
    camera(name) { find((node) => node.dataset?.camera === name).dispatch("click"); },
    reset() { find((node) => node.dataset?.action === "nova-explainer-reset").dispatch("click"); },
    latestLayout() { return writeClockSlot.mock.calls.at(-1)[0].layout; },
    rendered(nextCards = cards, camera = "close") {
      message({ type: "otef_clock_preview_ready", surface: "gis", output: null });
      const state = frame().contentWindow.sent.at(-1).message;
      message({
        type: "otef_clock_preview_rendered", requestId: state.requestId, surface: "gis", sceneId: "nova", output: null,
        mesh: null, meshIdentity: null, pageIndex: 0, pageCount: 1, novaExplainerCamera: camera, novaExplainerCards: nextCards,
      });
    },
  };
  return rig;
}
