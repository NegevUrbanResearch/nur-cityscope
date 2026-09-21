import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import {
  LEGEND_LAYOUT_DEFAULT,
  clampLegendLayout,
  layoutPixelBounds,
  moveLegendLayout,
  resizeLegendLayout,
  rotateLegendLayout,
  chooseLegendInitialLayout,
  findLegendSnap,
  legendSpanKey,
  installLegendLayout,
} from "../../frontend/src/projection/legend-layout.js";

class FakeElement {
  constructor(tagName = "div") {
    this.tagName = tagName.toUpperCase();
    this.children = [];
    this.parentElement = null;
    this.style = {};
    this.dataset = {};
    this.listeners = new Map();
    this.classList = { toggle: vi.fn() };
    this.value = "";
    this.textContent = "";
  }
  appendChild(child) { child.parentElement = this; this.children.push(child); return child; }
  remove() { this.parentElement?.children.splice(this.parentElement.children.indexOf(this), 1); }
  addEventListener(type, handler) { if (!this.listeners.has(type)) this.listeners.set(type, new Set()); this.listeners.get(type).add(handler); }
  removeEventListener(type, handler) { this.listeners.get(type)?.delete(handler); }
  dispatchEvent(event) {
    if (!event.target) event.target = this;
    event.currentTarget = this;
    for (const handler of [...(this.listeners.get(event.type) || [])]) handler(event);
    if (event.bubbles !== false) this.parentElement?.dispatchEvent(event);
    return true;
  }
  setPointerCapture() {}
  setAttribute(name, value) { this[name] = value; }
  matches(selector) { return selector.split(",").some((part) => part.trim() === this.tagName.toLowerCase() || (part.includes("[data-legend-handle") && this.dataset.legendHandle)); }
  querySelector(selector) {
    if (selector.startsWith("[data-legend-handle=\"")) { const mode = selector.match(/\"([^\"]+)\"/)?.[1]; return this.children.find((child) => child.dataset.legendHandle === mode) || null; }
    if (selector === "[data-legend-font]") return this.children.find((child) => "legendFont" in child.dataset) || null;
    if (selector === "[data-legend-dwell]") return this.children.find((child) => "legendDwell" in child.dataset) || null;
    if (selector === "[data-legend-warning]") return this.children.find((child) => "legendWarning" in child.dataset) || null;
    return this.children.find((child) => child.className === selector.slice(1)) || null;
  }
  querySelectorAll(selector) { const found = this.querySelector(selector); return found ? [found] : []; }
  getBoundingClientRect() { return this.rect || { left: 0, top: 0, right: 1920, bottom: 1080, width: 1920, height: 1080 }; }
  set innerHTML(value) {
    this.children = [];
    if (value.includes("data-legend-font")) { const input = new FakeElement("input"); input.dataset.legendFont = ""; this.appendChild(input); }
    if (value.includes("data-legend-dwell")) { const input = new FakeElement("input"); input.dataset.legendDwell = ""; this.appendChild(input); }
    if (value.includes("data-legend-warning")) { const warning = new FakeElement("span"); warning.dataset.legendWarning = ""; this.appendChild(warning); }
  }
}

class FakeDocument {
  constructor() { this.documentElement = { clientWidth: 1920, clientHeight: 1080 }; this.body = new FakeElement("body"); }
  createElement(tagName) { return new FakeElement(tagName); }
}

function installFixture({
  settings = {},
  spanKey = "full",
  clockRect = { left: 700, top: 200, right: 1100, bottom: 600 },
  projectionConfig,
  setLegendSettings = vi.fn(),
} = {}) {
  const document = new FakeDocument();
  const window = new FakeElement("window");
  globalThis.document = document;
  globalThis.window = window;
  const parent = new FakeElement("main"); parent.rect = { left: 0, top: 0, right: 1920, bottom: 1080, width: 1920, height: 1080 }; document.body.appendChild(parent);
  const element = new FakeElement("section"); parent.appendChild(element);
  const clock = new FakeElement("aside"); clock.rect = { ...clockRect, width: clockRect.right - clockRect.left, height: clockRect.bottom - clockRect.top }; parent.appendChild(clock);
  const dataContext = { getLegendSettings: () => settings, setLegendSettings };
  const instance = installLegendLayout({
    element,
    clockElement: clock,
    dataContext,
    spanKey,
    getProjectionConfig: () => projectionConfig,
  });
  return { document, window, parent, element, clock, dataContext, instance, setLegendSettings };
}

function pointer(type, target, x, y) { target.dispatchEvent({ type, target, button: 0, clientX: x, clientY: y, pointerId: 1, preventDefault() {}, }); }
function editorFor(fixture) { return fixture.parent.children.find((child) => child.className === "legend-layout-editor"); }
async function flushPromises() {
  await Promise.resolve();
  await Promise.resolve();
}

beforeEach(() => { delete globalThis.document; delete globalThis.window; });
afterEach(() => { delete globalThis.document; delete globalThis.window; });

const viewport = { width: 1920, height: 1080 };
const base = { leftPct: 40, topPct: 30, widthPct: 20, heightPct: 20, fontPx: 22, rotateDeg: 0, dwellSeconds: 8 };

describe("legend layout projection geometry", () => {
  it("uses the compact first-run legend box", () => {
    expect(LEGEND_LAYOUT_DEFAULT).toMatchObject({
      leftPct: 68,
      topPct: 18,
      widthPct: 20,
      heightPct: 32,
      fontPx: 16,
    });
  });

  it("clamps geometry and dwell using the clock layout limits", () => {
    expect(clampLegendLayout({ ...base, leftPct: 99, topPct: -1, widthPct: 120, heightPct: 0, dwellSeconds: 99 })).toEqual({
      ...base, leftPct: 0, topPct: 0, widthPct: 100, heightPct: 2, dwellSeconds: 30,
    });
  });

  it("moves and resizes in percentage coordinates while preserving the panel minimum", () => {
    expect(moveLegendLayout(base, 5, -10)).toMatchObject({ leftPct: 45, topPct: 20 });
    expect(resizeLegendLayout(base, 99, 99)).toMatchObject({ widthPct: 100, heightPct: 100 });
    expect(resizeLegendLayout(base, -99, -99)).toMatchObject({ widthPct: 2, heightPct: 2 });
  });

  it("computes rotated pixel bounds with viewport aspect correction", () => {
    const bounds = layoutPixelBounds({ ...base, rotateDeg: 45 }, viewport);
    expect(bounds.width).toBeGreaterThan(384);
    expect(bounds.height).toBeGreaterThan(216);
    expect(bounds.left).toBeGreaterThanOrEqual(0);
    expect(bounds.top).toBeGreaterThanOrEqual(0);
    expect(bounds.right).toBeLessThanOrEqual(viewport.width);
    expect(bounds.bottom).toBeLessThanOrEqual(viewport.height);
  });

  it("rotates the layout around its center and keeps the result visible", () => {
    expect(rotateLegendLayout(base, 40)).toMatchObject({ rotateDeg: 40, leftPct: 40, topPct: 30 });
    expect(rotateLegendLayout({ ...base, rotateDeg: 170 }, 30).rotateDeg).toBe(180);
  });

  it("selects a snap candidate by closest compatible edge", () => {
    const legend = layoutPixelBounds({ ...base, leftPct: 40, topPct: 30, widthPct: 20, heightPct: 20 }, viewport);
    const clock = { left: legend.right + 8, top: legend.top, right: legend.right + 180, bottom: legend.bottom };
    const snap = findLegendSnap(legend, clock, viewport);
    expect(snap).toMatchObject({ axis: "x", displacement: -4 });
  });

  it("snaps from roughly 28 pixels while preserving the 12 pixel gap", () => {
    const legend = layoutPixelBounds(base, viewport);
    const clock = {
      left: legend.right + 35,
      top: legend.top,
      right: legend.right + 200,
      bottom: legend.bottom,
    };
    expect(findLegendSnap(legend, clock, viewport)).toMatchObject({
      axis: "x",
      displacement: 23,
    });
  });

  it("ignores a hidden clock and candidates outside the projector", () => {
    expect(findLegendSnap(layoutPixelBounds(base, viewport), null, viewport)).toBe(null);
    expect(findLegendSnap({ left: -200, top: 10, right: -20, bottom: 100, width: 180, height: 90 }, { left: 0, top: 10, right: 20, bottom: 100 }, viewport)).toBe(null);
  });

  it("chooses a fitting initial slot for each span and falls back beside the clock", () => {
    const config = { outputs: { left: { crop: { x0: 0, x1: 0.5, y0: 0, y1: 1 } }, right: { crop: { x0: 0.5, x1: 1, y0: 0, y1: 1 } } } };
    expect(legendSpanKey("right")).toBe("right");
    expect(chooseLegendInitialLayout({ spanKey: "left", viewport, clockBounds: { left: 100, top: 100, right: 500, bottom: 500 }, projectionConfig: config }).leftPct).toBeGreaterThanOrEqual(0);
    expect(chooseLegendInitialLayout({ spanKey: "right", viewport, clockBounds: null, projectionConfig: config }).leftPct).toBeGreaterThan(50);
  });
});

describe("legend layout installation", () => {
  it("saves once on pointerup and restores without saving on pointercancel", async () => {
    const fixture = installFixture({ setLegendSettings: vi.fn().mockResolvedValue({ ok: true }) });
    fixture.instance.setVisible(true);
    const before = fixture.instance.getLayout();
    pointer("pointerdown", fixture.element, 1400, 300);
    fixture.window.dispatchEvent({ type: "pointermove", clientX: 1450, clientY: 320 });
    fixture.window.dispatchEvent({ type: "pointerup", clientX: 1450, clientY: 320 });
    await flushPromises();
    expect(fixture.setLegendSettings).toHaveBeenCalledTimes(1);
    const secondStart = fixture.instance.getLayout();
    pointer("pointerdown", fixture.element, 1450, 320);
    fixture.window.dispatchEvent({ type: "pointermove", clientX: 1500, clientY: 340 });
    fixture.window.dispatchEvent({ type: "pointercancel", clientX: 1500, clientY: 340 });
    expect(fixture.setLegendSettings).toHaveBeenCalledTimes(1);
    expect(fixture.instance.getLayout()).toEqual(expect.objectContaining(secondStart));
    fixture.instance.dispose();
  });

  it("keeps a successful local save ahead of a deferred remote update and restores confirmed state on failure", async () => {
    let resolveSave;
    const save = vi.fn(() => new Promise((resolve) => { resolveSave = resolve; }));
    const fixture = installFixture({ setLegendSettings: save });
    fixture.instance.setVisible(true);
    const confirmed = fixture.instance.getLayout();
    pointer("pointerdown", fixture.element, 1400, 300);
    fixture.window.dispatchEvent({ type: "pointermove", clientX: 1450, clientY: 300 });
    fixture.window.dispatchEvent({ type: "pointerup", clientX: 1450, clientY: 300 });
    fixture.instance.applyServerSettings({ ...confirmed, leftPct: 2 });
    resolveSave({ ok: true });
    await flushPromises();
    expect(fixture.instance.getLayout().leftPct).not.toBe(2);
    save.mockRejectedValueOnce(new Error("offline"));
    const beforeFailure = fixture.instance.getLayout();
    const controls = editorFor(fixture).children[1];
    const font = controls.querySelector("[data-legend-font]");
    font.value = 30;
    font.dispatchEvent({ type: "change", target: font });
    await flushPromises();
    expect(fixture.instance.getLayout()).toEqual(expect.objectContaining(beforeFailure));
    expect(controls.querySelector("[data-legend-warning]").textContent).toContain("Could not save");
    fixture.instance.dispose();
  });

  it("does not drag from controls and disposal removes active pointer listeners", () => {
    const fixture = installFixture({ setLegendSettings: vi.fn() });
    fixture.instance.setVisible(true);
    const initialLeft = fixture.instance.getLayout().leftPct;
    const controls = editorFor(fixture).children[1];
    const font = controls.querySelector("[data-legend-font]");
    pointer("pointerdown", font, 1400, 300);
    fixture.window.dispatchEvent({ type: "pointermove", clientX: 1500, clientY: 300 });
    expect(fixture.instance.getLayout().leftPct).toBe(initialLeft);
    pointer("pointerdown", fixture.element, 1400, 300);
    fixture.instance.dispose();
    fixture.window.dispatchEvent({ type: "pointerup", clientX: 1500, clientY: 300 });
    expect(fixture.setLegendSettings).not.toHaveBeenCalled();
  });

  it("shows a snap guide and magnetizes live during movement", async () => {
    const fixture = installFixture({
      settings: { projection: { full: { ...base, leftPct: 15.83, topPct: 25 } } },
      setLegendSettings: vi.fn().mockResolvedValue({ ok: true }),
    });
    fixture.instance.setVisible(true);
    const guide = editorFor(fixture).children[0];
    pointer("pointerdown", fixture.element, 400, 400);
    fixture.window.dispatchEvent({ type: "pointermove", clientX: 400, clientY: 400 });
    expect(guide.style.display).toBe("block");
    const magnetized = fixture.instance.getLayout().leftPct;
    expect(magnetized).not.toBeCloseTo(15.83, 4);
    fixture.window.dispatchEvent({ type: "pointerup", clientX: 400, clientY: 400 });
    await flushPromises();
    expect(guide.style.display).toBe("none");
    expect(fixture.instance.getLayout().leftPct).toBeCloseTo(magnetized, 5);
    expect(fixture.setLegendSettings).toHaveBeenCalledTimes(1);
    fixture.instance.dispose();
  });

  it("rejects a live snap candidate that would enter the overlap exclusion", async () => {
    const projectionConfig = {
      outputs: {
        left: { crop: { x0: 0, x1: 0.6, y0: 0, y1: 1 }, post: { scale: 1, tx: 0, ty: 0 } },
        right: { crop: { x0: 0.4, x1: 1, y0: 0, y1: 1 }, post: { scale: 1, tx: 0, ty: 0 } },
      },
    };
    const fixture = installFixture({
      spanKey: "left",
      clockRect: { left: 1500, top: 200, right: 1800, bottom: 600 },
      projectionConfig,
      settings: { projection: { left: { ...base, leftPct: 57.08, topPct: 25 } } },
      setLegendSettings: vi.fn().mockResolvedValue({ ok: true }),
    });
    fixture.instance.setVisible(true);
    const guide = editorFor(fixture).children[0];
    pointer("pointerdown", fixture.element, 1200, 400);
    fixture.window.dispatchEvent({ type: "pointermove", clientX: 1200, clientY: 400 });
    expect(guide.style.display).toBe("none");
    fixture.window.dispatchEvent({ type: "pointerup", clientX: 1200, clientY: 400 });
    await flushPromises();
    expect(fixture.setLegendSettings.mock.calls[0][0].layout.leftPct).toBeCloseTo(57.08, 2);
    fixture.instance.dispose();
  });

  it("inverse-rotates resize deltas in pixels and anchors the opposite corner", () => {
    const start = { ...base, rotateDeg: 45 };
    const fixture = installFixture({
      settings: { projection: { full: start } },
    });
    fixture.instance.setVisible(true);
    const resizeHandle = editorFor(fixture).children.find((child) => child.dataset.legendHandle === "resize");
    const before = layoutPixelBounds(fixture.instance.getLayout(), viewport);
    const [startX, startY] = [before.corners[2].x, before.corners[2].y];

    pointer("pointerdown", resizeHandle, startX, startY);
    fixture.window.dispatchEvent({ type: "pointermove", clientX: startX + 100, clientY: startY + 40 });

    const resized = fixture.instance.getLayout();
    const after = layoutPixelBounds(resized, viewport);
    expect(resized.widthPct).not.toBe(start.widthPct);
    expect(resized.heightPct).not.toBe(start.heightPct);
    expect(resized.widthPct).toBeCloseTo(start.widthPct + (100 * Math.SQRT1_2 + 40 * Math.SQRT1_2) / 1920 * 100, 5);
    expect(resized.heightPct).toBeCloseTo(start.heightPct + (-100 * Math.SQRT1_2 + 40 * Math.SQRT1_2) / 1080 * 100, 5);
    expect(after.corners[0].x).toBeCloseTo(before.corners[0].x, 5);
    expect(after.corners[0].y).toBeCloseTo(before.corners[0].y, 5);
    fixture.instance.dispose();
  });

  it("keeps a pointer-resized rotated legend inside a 1920x1080 parent", async () => {
    const fixture = installFixture({
      settings: { projection: { full: { ...base, leftPct: 70, topPct: 65, rotateDeg: 45 } } },
      setLegendSettings: vi.fn().mockResolvedValue({ ok: true }),
    });
    fixture.instance.setVisible(true);
    const resizeHandle = editorFor(fixture).children.find((child) => child.dataset.legendHandle === "resize");
    const before = fixture.instance.getLayout();
    const corner = layoutPixelBounds(before, viewport).corners[2];
    pointer("pointerdown", resizeHandle, corner.x, corner.y);
    fixture.window.dispatchEvent({ type: "pointermove", clientX: corner.x + 372, clientY: corner.y + 282 });
    const resized = fixture.instance.getLayout();
    const bounds = layoutPixelBounds(resized, viewport);
    expect(resized).not.toMatchObject({ widthPct: before.widthPct, heightPct: before.heightPct });
    expect(bounds.left).toBeGreaterThanOrEqual(-0.001);
    expect(bounds.top).toBeGreaterThanOrEqual(-0.001);
    expect(bounds.right).toBeLessThanOrEqual(1920.001);
    expect(bounds.bottom).toBeLessThanOrEqual(1080.001);
    fixture.window.dispatchEvent({ type: "pointerup", clientX: corner.x + 372, clientY: corner.y + 282 });
    await flushPromises();
    fixture.instance.dispose();
  });

  it("keeps a pointer-rotated legend visible near the parent edge", () => {
    const start = { ...base, leftPct: 76, topPct: 4, rotateDeg: 20 };
    const fixture = installFixture({
      settings: { projection: { full: start } },
    });
    fixture.instance.setVisible(true);
    const rotateHandle = editorFor(fixture).children.find((child) => child.dataset.legendHandle === "rotate");
    const before = layoutPixelBounds(fixture.instance.getLayout(), viewport);
    const center = {
      x: viewport.width * (start.leftPct + start.widthPct / 2) / 100,
      y: viewport.height * (start.topPct + start.heightPct / 2) / 100,
    };
    const handle = {
      x: (before.corners[0].x + before.corners[1].x) / 2,
      y: (before.corners[0].y + before.corners[1].y) / 2,
    };
    const radius = Math.hypot(handle.x - center.x, handle.y - center.y);
    const targetAngle = Math.atan2(handle.y - center.y, handle.x - center.x) + Math.PI / 3;

    pointer("pointerdown", rotateHandle, handle.x, handle.y);
    fixture.window.dispatchEvent({
      type: "pointermove",
      clientX: center.x + Math.cos(targetAngle) * radius,
      clientY: center.y + Math.sin(targetAngle) * radius,
    });

    const rotated = fixture.instance.getLayout();
    const bounds = layoutPixelBounds(rotated, viewport);
    expect(rotated.rotateDeg).not.toBe(start.rotateDeg);
    expect(bounds.left).toBeGreaterThanOrEqual(-0.001);
    expect(bounds.top).toBeGreaterThanOrEqual(-0.001);
    expect(bounds.right).toBeLessThanOrEqual(1920.001);
    expect(bounds.bottom).toBeLessThanOrEqual(1080.001);
    fixture.instance.dispose();
  });

  it("snaps legend rotation to the clock transform within eight degrees", () => {
    const fixture = installFixture({
      settings: { projection: { full: { ...base, rotateDeg: 0 } } },
    });
    fixture.clock.style.transform = "rotate(30deg)";
    fixture.instance.setVisible(true);
    const rotateHandle = editorFor(fixture).children.find((child) => child.dataset.legendHandle === "rotate");
    const bounds = layoutPixelBounds(fixture.instance.getLayout(), viewport);
    const center = {
      x: viewport.width * (base.leftPct + base.widthPct / 2) / 100,
      y: viewport.height * (base.topPct + base.heightPct / 2) / 100,
    };
    const handle = {
      x: (bounds.corners[0].x + bounds.corners[1].x) / 2,
      y: (bounds.corners[0].y + bounds.corners[1].y) / 2,
    };
    const radius = Math.hypot(handle.x - center.x, handle.y - center.y);
    const targetAngle = Math.atan2(handle.y - center.y, handle.x - center.x) + 24 * Math.PI / 180;

    pointer("pointerdown", rotateHandle, handle.x, handle.y);
    fixture.window.dispatchEvent({
      type: "pointermove",
      clientX: center.x + Math.cos(targetAngle) * radius,
      clientY: center.y + Math.sin(targetAngle) * radius,
    });

    expect(fixture.instance.getLayout().rotateDeg).toBeCloseTo(30, 5);
    fixture.instance.dispose();
  });

  it("hides the right-span duplicate and initializes a hidden clock in open parent space", () => {
    const right = installFixture({
      spanKey: "right",
      settings: { projection: { right: { ...base, leftPct: 10, topPct: 10 } } },
    });
    right.instance.setVisible(true);
    expect(right.element.style.display).toBe("none");
    expect(editorFor(right).style.display).toBe("none");
    right.instance.dispose();

    const hiddenClock = installFixture({ clockRect: { left: 0, top: 0, right: 0, bottom: 0 } });
    const initial = hiddenClock.instance.getLayout();
    expect(initial.widthPct).toBe(LEGEND_LAYOUT_DEFAULT.widthPct);
    expect(initial.heightPct).toBe(LEGEND_LAYOUT_DEFAULT.heightPct);
    expect(initial).not.toMatchObject({ leftPct: 68, topPct: 18 });
    hiddenClock.instance.dispose();
  });

  it("suppresses arithmetic snap candidates inside overlap exclusion", () => {
    const snap = findLegendSnap({ left: 100, top: 100, right: 300, bottom: 300 }, { left: 308, top: 100, right: 600, bottom: 300 }, viewport, { left: 80, top: 80, right: 400, bottom: 400 });
    expect(snap).toBe(null);
  });
});
