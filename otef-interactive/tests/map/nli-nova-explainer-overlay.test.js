// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createNovaExplainerOverlay } from "../../frontend/src/map/nli-nova-explainer-overlay.js";
import { NOVA_EXPLAINER_OBJECT_IDS } from "../../frontend/src/shared/nli-nova-explainer-layout.js";

const here = dirname(fileURLToPath(import.meta.url));
const RING = {
  type: "Polygon",
  coordinates: [[[34.4, 31.4], [34.5, 31.4], [34.5, 31.5], [34.4, 31.4]]],
};

let measureReads = 0;
let resolveFonts = () => {};

function polygon(id, name, geometry = RING) {
  const properties = { OBJECTID: id };
  if (name !== undefined) properties.Name = name;
  return { type: "Feature", properties, geometry };
}

function visual(partial = {}) {
  return {
    narrativeId: "nova",
    phase: "playing",
    novaBeatIndex: 0,
    achievedPolygonObjectIds: [97],
    polygonFeatures: [polygon(97, "כביש 232 ומתחם הנובה")],
    ...partial,
  };
}

function setReducedMotion(matches) {
  window.matchMedia = (query) => ({
    matches: matches && String(query).includes("prefers-reduced-motion"),
    media: query,
    addEventListener() {},
    removeEventListener() {},
    addListener() {},
    removeListener() {},
    dispatchEvent() { return false; },
  });
}

function mount(options = {}) {
  const container = document.createElement("div");
  let width = options.width ?? 800;
  let height = options.height ?? 600;
  Object.defineProperty(container, "clientWidth", { configurable: true, get: () => width });
  Object.defineProperty(container, "clientHeight", { configurable: true, get: () => height });
  document.body.appendChild(container);
  const handlers = {};
  const map = {
    project: options.project || (() => ({ x: 400, y: 300 })),
    getZoom() { throw new Error("zoom"); },
    on(type, fn) { (handlers[type] ||= []).push(fn); },
    off(type, fn) {
      handlers[type] = (handlers[type] || []).filter((item) => item !== fn);
    },
  };
  let narrativeId = options.narrativeId ?? "nova";
  let escape = options.escape || { mor: options.mor === true };
  let layout = options.layout || { close: {}, wide: {} };
  const overlay = createNovaExplainerOverlay({
    map,
    container,
    getLayout: () => layout,
    getNarrativeId: () => narrativeId,
    getEscapeOverlay: () => escape,
    motionMode: options.motionMode || "full",
    cameraOverride: options.cameraOverride,
  });
  return {
    overlay,
    map,
    container,
    handlers,
    setNarrative(id) { narrativeId = id; },
    setEscape(value) { escape = value; },
    setLayout(next) { layout = next; },
    setSize(nextWidth, nextHeight) { width = nextWidth; height = nextHeight; },
    host: () => container.querySelector("#nliNovaExplainerHost"),
    card: (id) => container.querySelector(`.nli-nova-explainer-card[data-object-id="${id}"]`),
    leader: (id) => container.querySelector(`svg [data-object-id="${id}"]`),
  };
}

beforeEach(() => {
  measureReads = 0;
  setReducedMotion(false);
  document.fonts = { ready: new Promise((resolve) => { resolveFonts = resolve; }) };
  vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockImplementation(function () {
    if (this.classList?.contains("nli-nova-explainer-card")) measureReads += 1;
    return 100;
  });
  vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockImplementation(() => 40);
});

afterEach(() => {
  document.body.replaceChildren();
  vi.restoreAllMocks();
  delete document.fonts;
});

describe("createNovaExplainerOverlay", () => {
  it("shows only achieved story ids, with the literal name and dir=auto", () => {
    const ui = mount();
    ui.overlay.sync(visual({
      achievedPolygonObjectIds: [97, 107, 100],
      polygonFeatures: [
        polygon("97", "  כביש 232 ומתחם הנובה  "),
        polygon(107, "לא בשורה"),
        polygon(100, "<b>חניון</b>"),
        polygon(98, "עדיין לא"),
      ],
    }));
    expect(ui.card(97).getAttribute("dir")).toBe("auto");
    expect(ui.card(97).querySelector(".nli-nova-explainer-card__name").textContent)
      .toBe("  כביש 232 ומתחם הנובה  ");
    expect(ui.card(97).querySelector(".nli-nova-explainer-card__name").innerHTML).not.toContain("<b>");
    expect(ui.card(100).textContent).toBe("<b>חניון</b>");
    expect(ui.card(107)).toBeNull();
    expect(ui.card(98)).toBeNull();
    expect(ui.host().style.pointerEvents).toBe("none");
    expect(ui.host().style.overflow).toBe("hidden");
    expect(ui.host().firstElementChild.tagName.toLowerCase()).toBe("svg");
  });

  it("omits empty, blank, and non-string names without blocking other cards", () => {
    const ui = mount();
    ui.overlay.sync(visual({
      achievedPolygonObjectIds: [97, 100, 104, 98],
      polygonFeatures: [
        polygon(97, "כביש 232"),
        polygon(100, "   "),
        polygon(104, ""),
        polygon(98, 12),
      ],
    }));
    expect(ui.card(97).textContent).toBe("כביש 232");
    expect(ui.card(100)).toBeNull();
    expect(ui.card(104)).toBeNull();
    expect(ui.card(98)).toBeNull();
  });

  it("drops the estimated-time parenthetical from the Eitan Mor kidnapping name", () => {
    const ui = mount();
    ui.overlay.sync(visual({
      achievedPolygonObjectIds: [106],
      novaBeatIndex: 4,
      polygonFeatures: [polygon(106, "חטיפת איתן מור, רום ברסלבסקי ומורן סטלה ינאי (זמן משוער - ייתכן שנחטפו בזמנים שונים לאורך הצהריים)")],
    }));
    expect(ui.card(106).textContent).toBe("חטיפת איתן מור, רום ברסלבסקי ומורן סטלה ינאי");
  });

  it("removes the fighting-focus numbers from explainer names", () => {
    const ui = mount();
    ui.overlay.sync(visual({
      achievedPolygonObjectIds: [97, 98],
      novaBeatIndex: 1,
      polygonFeatures: [
        polygon(97, "מוקד לחימה 1 - כביש 232"),
        polygon(98, "מוקד לחימה 2 - נקודת הטנק הדרומית"),
      ],
    }));
    expect(ui.card(97).textContent).toBe("מוקד לחימה - כביש 232");
    expect(ui.card(98).textContent).toBe("מוקד לחימה - נקודת הטנק הדרומית");
  });

  it("fades cards from earlier beats and keeps the current beat readable", () => {
    const ui = mount();
    ui.overlay.sync(visual({
      novaBeatIndex: 1,
      achievedPolygonObjectIds: [97, 100, 104, 98, 99, 186],
      polygonFeatures: [
        polygon(97, "כביש 232"),
        polygon(100, "חניון"),
        polygon(104, "מתחם"),
        polygon(98, "טנק"),
        polygon(99, "יער"),
        polygon(186, "בריחה"),
      ],
    }));
    expect(ui.card(97).classList.contains("nli-nova-explainer-card--past")).toBe(true);
    expect(ui.card(100).classList.contains("nli-nova-explainer-card--past")).toBe(true);
    expect(ui.card(98).classList.contains("nli-nova-explainer-card--past")).toBe(false);
    expect(ui.card(99).classList.contains("nli-nova-explainer-card--past")).toBe(false);
    expect(ui.leader(97).classList.contains("nli-nova-explainer-leader--past")).toBe(true);
    expect(ui.leader(98).classList.contains("nli-nova-explainer-leader--past")).toBe(false);
  });

  it("removes cards immediately when a later id is seeked away and keeps them while paused", () => {
    const ui = mount();
    const features = [polygon(97, "כביש 232"), polygon(100, "חניון")];
    ui.overlay.sync(visual({
      achievedPolygonObjectIds: [97, 100],
      polygonFeatures: features,
    }));
    const kept = ui.card(97);
    expect(kept).not.toBeNull();
    expect(ui.card(100)).not.toBeNull();
    ui.overlay.sync(visual({
      phase: "paused",
      achievedPolygonObjectIds: [97],
      polygonFeatures: features,
    }));
    expect(ui.card(97)).toBe(kept);
    expect(ui.card(100)).toBeNull();
    ui.overlay.sync(visual({ phase: "idle", achievedPolygonObjectIds: [97], polygonFeatures: features }));
    expect(ui.card(97)).toBeNull();
  });

  it("removes every card on narrative refresh without another sync", () => {
    const ui = mount();
    ui.overlay.sync(visual());
    expect(ui.card(97)).not.toBeNull();
    ui.setNarrative("segev");
    ui.overlay.refresh();
    expect(ui.card(97)).toBeNull();
    ui.setNarrative("nova");
    ui.overlay.refresh();
    expect(ui.card(97).textContent).toBe("כביש 232 ומתחם הנובה");
  });

  it.each(["individual", "overlap", "mor", "settled"])("fades cards and leaders together for %s escape state and restores them on return", (flag) => {
    const ui = mount();
    ui.overlay.sync(visual({ phase: "ended", novaBeatIndex: -1 }));
    const card = ui.card(97);
    const leader = ui.leader(97);
    ui.setEscape({ [flag]: true });
    ui.overlay.refresh();
    expect(ui.host().classList.contains("nli-nova-explainers--hidden")).toBe(true);
    expect(ui.host().getAttribute("aria-hidden")).toBe("true");
    expect(ui.card(97)).toBe(card);
    expect(ui.leader(97)).toBe(leader);
    ui.overlay.sync(visual({ phase: "ended", novaBeatIndex: -1 }));
    ui.handlers.move[0]();
    expect(ui.host().classList.contains("nli-nova-explainers--hidden")).toBe(true);
    ui.setEscape({});
    ui.overlay.refresh();
    expect(ui.host().classList.contains("nli-nova-explainers--hidden")).toBe(true);
    ui.overlay.sync(visual());
    expect(ui.host().classList.contains("nli-nova-explainers--hidden")).toBe(false);
    expect(ui.host().getAttribute("aria-hidden")).toBe("false");
    expect(ui.card(97)).toBe(card);
  });

  it("starts hidden when the fleeing routes scene is already active", () => {
    const ui = mount({ escape: { individual: true } });
    ui.overlay.sync(visual({ phase: "ended" }));
    expect(ui.host().classList.contains("nli-nova-explainers--hidden")).toBe(true);
  });

  it("shows all 14 eligible ended names and uses the wide saved position", () => {
    const features = NOVA_EXPLAINER_OBJECT_IDS.map((id) => polygon(id, `שם ${id}`));
    const ui = mount({
      layout: {
        close: { 97: { leftPct: 5, topPct: 5 } },
        wide: { 97: { leftPct: 25, topPct: 30 } },
      },
    });
    ui.overlay.sync(visual({
      phase: "ended",
      novaBeatIndex: -1,
      achievedPolygonObjectIds: [...NOVA_EXPLAINER_OBJECT_IDS, 107],
      polygonFeatures: features,
    }));
    expect(NOVA_EXPLAINER_OBJECT_IDS).toHaveLength(14);
    for (const id of NOVA_EXPLAINER_OBJECT_IDS) {
      expect(ui.card(id).textContent).toBe(`שם ${id}`);
    }
    expect(ui.card(107)).toBeNull();
    expect(ui.card(97).style.left).toBe("200px");
    expect(ui.card(97).style.top).toBe("180px");
  });

  it("hides an unsaved card with a missing or offscreen anchor and keeps a saved card without a leader", () => {
    const saved = { leftPct: 10, topPct: 20 };
    const layout = { close: { 97: saved, 100: { leftPct: 0, topPct: 0 } }, wide: {} };
    const ui = mount({
      layout,
      project: () => ({ x: -30, y: 40 }),
    });
    ui.overlay.sync(visual({
      achievedPolygonObjectIds: [97, 100, 104],
      polygonFeatures: [
        polygon(97, "בלי גאומטריה", null),
        polygon(100, "מחוץ למסך"),
        polygon(104, "בלי שמירה", null),
      ],
    }));
    expect(ui.card(97)).not.toBeNull();
    expect(ui.leader(97)).toBeNull();
    expect(ui.card(97).style.left).toBe("80px");
    expect(saved).toEqual({ leftPct: 10, topPct: 20 });
    expect(ui.card(100)).not.toBeNull();
    expect(ui.card(100).style.left).toBe("4px");
    expect(ui.card(100).style.top).toBe("4px");
    expect(ui.leader(100).querySelector("polyline").getAttribute("points")).toContain("-30,40");
    expect(ui.host().style.overflow).toBe("hidden");
    expect(ui.card(104)).toBeNull();
  });

  it("places an unsaved card 14px above the anchor and draws an elbow to the card edge", () => {
    const ui = mount();
    ui.overlay.sync(visual());
    const card = ui.card(97);
    expect(card.style.left).toBe("350px");
    expect(card.style.top).toBe("246px");
    expect(card.style.maxWidth).toBe("280px");
    expect(card.style.fontSize).toBe("");
    const leader = ui.leader(97);
    expect(leader.querySelector("circle").getAttribute("cx")).toBe("400");
    expect(leader.querySelector("circle").getAttribute("cy")).toBe("300");
    expect(leader.querySelector("polyline").getAttribute("points")).toBe("400,300 400,286");
    expect(ui.host().querySelector("svg").style.pointerEvents).toBe("none");
  });

  it("hides an unsaved card whose anchor leaves the container", () => {
    const ui = mount({ project: () => ({ x: 900, y: 20 }) });
    ui.overlay.sync(visual());
    expect(ui.host()).not.toBeNull();
    expect(ui.card(97)).toBeNull();
  });

  it("reuses the same card and leader group nodes on an unchanged second sync", () => {
    const ui = mount();
    const frame = visual();
    ui.overlay.sync(frame);
    const card = ui.card(97);
    const leader = ui.leader(97);
    expect(card).not.toBeNull();
    expect(leader?.tagName.toLowerCase()).toBe("g");
    ui.overlay.sync(frame);
    expect(ui.card(97)).toBe(card);
    expect(ui.leader(97)).toBe(leader);
  });

  it("reuses the card node across unchanged syncs and layout refresh without restarting the fade", () => {
    const ui = mount({ layout: { close: { 97: { leftPct: 10, topPct: 12 } }, wide: {} } });
    ui.overlay.sync(visual());
    const card = ui.card(97);
    expect(measureReads).toBeGreaterThan(0);
    expect(card.classList.contains("nli-nova-explainer-card--in")).toBe(true);
    card.classList.remove("nli-nova-explainer-card--in");
    const afterFirst = measureReads;
    ui.overlay.sync(visual());
    expect(ui.card(97)).toBe(card);
    expect(card.classList.contains("nli-nova-explainer-card--in")).toBe(false);
    expect(measureReads).toBe(afterFirst);
    ui.setLayout({ close: { 97: { leftPct: 40, topPct: 12 } }, wide: {} });
    ui.overlay.refresh();
    expect(ui.card(97)).toBe(card);
    expect(card.style.left).toBe("320px");
    expect(card.classList.contains("nli-nova-explainer-card--in")).toBe(false);
  });

  it("does not fade cards when motion is reduced or the viewer prefers reduced motion", () => {
    const reduced = mount({ motionMode: "reduced" });
    reduced.overlay.sync(visual());
    expect(reduced.card(97).classList.contains("nli-nova-explainer-card--in")).toBe(false);
    expect(reduced.host().style.transition).toBe("none");

    setReducedMotion(true);
    const preferred = mount();
    preferred.overlay.sync(visual());
    expect(preferred.card(97).classList.contains("nli-nova-explainer-card--in")).toBe(false);
  });

  it("follows a preview camera override and ignores map zoom", () => {
    const ui = mount({
      layout: {
        close: { 97: { leftPct: 10, topPct: 10 } },
        wide: { 97: { leftPct: 50, topPct: 10 } },
      },
      cameraOverride: () => "wide",
    });
    ui.overlay.sync(visual({ phase: "playing", novaBeatIndex: 0 }));
    expect(ui.card(97).style.left).toBe("400px");
  });

  it("shrinks the maximum width to the canvas inset", () => {
    const ui = mount({ width: 100, height: 200, project: () => ({ x: 40, y: 80 }) });
    ui.overlay.sync(visual());
    expect(ui.card(97).style.maxWidth).toBe("92px");
  });

  it("updates the leader on move and the saved position on resize", () => {
    const ui = mount({
      layout: { close: { 97: { leftPct: 10, topPct: 20 } }, wide: {} },
      project: () => ({ x: 400, y: 300 }),
    });
    ui.overlay.sync(visual());
    const card = ui.card(97);
    card.classList.remove("nli-nova-explainer-card--in");
    const afterSync = measureReads;
    ui.map.project = () => ({ x: 420, y: 310 });
    ui.handlers.move[0]();
    expect(ui.card(97)).toBe(card);
    expect(ui.leader(97).querySelector("circle").getAttribute("cx")).toBe("420");
    expect(ui.leader(97).querySelector("circle").getAttribute("cy")).toBe("310");
    expect(card.classList.contains("nli-nova-explainer-card--in")).toBe(false);
    expect(measureReads).toBe(afterSync);
    ui.setSize(400, 600);
    ui.handlers.resize[0]();
    expect(card.style.left).toBe("40px");
    expect(card.style.top).toBe("120px");
  });

  it("removes the host and ignores a late font callback after dispose", async () => {
    const ui = mount();
    ui.overlay.sync(visual());
    expect(ui.handlers.move).toHaveLength(1);
    expect(ui.handlers.resize).toHaveLength(1);
    ui.overlay.dispose();
    resolveFonts();
    await document.fonts.ready;
    await Promise.resolve();
    expect(ui.host()).toBeNull();
    expect(ui.handlers.move).toEqual([]);
    expect(ui.handlers.resize).toEqual([]);
    ui.overlay.sync(visual());
    expect(ui.host()).toBeNull();
  });

  it("re-measures once when fonts become ready", async () => {
    const ui = mount();
    ui.overlay.sync(visual());
    const afterSync = measureReads;
    resolveFonts();
    await document.fonts.ready;
    await Promise.resolve();
    expect(measureReads).toBeGreaterThan(afterSync);
    expect(ui.card(97)).not.toBeNull();
  });
});

describe("GIS owners mount the overlay and projection does not", () => {
  it("map-main and clock-preview own the overlay", () => {
    const src = readFileSync(resolve(here, "../../frontend/src/entries/map-main.js"), "utf8");
    const preview = readFileSync(resolve(here, "../../frontend/src/map/clock-preview.js"), "utf8");
    expect(src).toContain('from "../map/nli-nova-explainer-overlay.js"');
    expect(src).toContain("createNovaExplainerOverlay");
    expect(preview).toContain('from "./nli-nova-explainer-overlay.js"');
    expect(preview).toContain("createNovaExplainerOverlay");
    expect(src).toContain("onVisualFrame: novaExplainerOverlay.sync");
    expect(src).toContain("onClockFrame:");
    expect(src).toMatch(/getNliClockLayout\?\.\(\)\?\.gisOverlays\?\.novaExplainers/);
    expect(src).toContain("getEscapeOverlay");
    expect(src).toMatch(/subscribe\("nliClockLayout", \(\) => \{[\s\S]*?refresh\(\)/);
    expect(src).toMatch(/subscribe\("narrativeState", \(\) => \{[\s\S]*?refresh\(\)/);
    expect(src).toMatch(/subscribe\("escapeOverlay", \(\) => \{[\s\S]*?refresh\(\)/);
    expect(src).toContain("novaExplainerOverlay.dispose()");
    expect(preview).toContain("novaExplainerOverlay.dispose");
    expect(src).toMatch(
      /const raiseGisClockHost = \(\) => \{[\s\S]*?appendChild\(nliGisClockHost\);[\s\S]*?getElementById\("nliNovaExplainerHost"\)[\s\S]*?document\.contains\([\s\S]*?appendChild\([\s\S]*?map\.on\?\.\("style\.load", raiseGisClockHost\)/,
    );
  });

  it("projection-main and projection clock-preview do not own the overlay", () => {
    const projectionMain = readFileSync(resolve(here, "../../frontend/src/entries/projection-main.js"), "utf8");
    const projectionPreview = readFileSync(resolve(here, "../../frontend/src/projection/projection-clock-preview.js"), "utf8");
    for (const src of [projectionMain, projectionPreview]) {
      expect(src).not.toContain("nli-nova-explainer-overlay");
      expect(src).not.toContain("createNovaExplainerOverlay");
      expect(src).not.toContain("nliNovaExplainerHost");
    }
  });

  it("styles the cards with the person-plaque tokens and a 280ms fade", () => {
    const css = readFileSync(resolve(here, "../../frontend/css/styles.css"), "utf8");
    const start = css.indexOf("#nliNovaExplainerHost");
    expect(start).toBeGreaterThanOrEqual(0);
    const section = css.slice(start);
    expect(section).toContain("Hadassah Friedlaender");
    expect(section).toContain("24px");
    expect(section).toContain("280px");
    expect(section).toContain("#fffbf8");
    expect(section).toContain("#e6ddd2");
    expect(section).toContain("#c9bfb2");
    expect(section).toContain("#000");
    expect(section).toContain("280ms");
    expect(section).toContain("prefers-reduced-motion");
    expect(section).not.toMatch(/line-clamp|text-overflow:\s*ellipsis|transform:/);
  });
});
