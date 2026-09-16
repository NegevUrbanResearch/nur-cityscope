import { describe, expect, it, vi } from "vitest";
import {
  installNliExplainerDebug,
  isNliExplainerDebugRequestedInUrl,
  moveLayoutByDelta,
  resizeLayoutFromHandle,
  rotateLayoutByDelta,
} from "../../frontend/src/projection/nli-explainer-debug.js";
import {
  applyNliExplainerLayout,
  NLI_EXPLAINER_LAYOUT_STORAGE_KEY,
  NLI_GIS_CLOCK_LAYOUT_STORAGE_KEY,
} from "../../frontend/src/projection/nli-explainer-overlay.js";
import { createNarrativePresentation } from "../../frontend/src/map/nli-narrative-presentation.js";
import { NLI_NARRATIVES } from "../../frontend/src/shared/nli-narratives.js";
import {
  disposeInvestigationTimelineForMap,
  syncInvestigationTimelineToMap,
} from "../../frontend/src/shared/maplibre-investigation-timeline.js";
import { idleNliClock } from "../../frontend/src/shared/nli-investigation-clock.js";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const GIS_CLOCK_DEFAULT_LAYOUT = {
  leftPct: 30,
  topPct: 88,
  widthPct: 40,
  heightPct: 8,
  fontPx: 22,
  rotateDeg: 0,
};

function collect(node) {
  const out = [];
  for (const c of node.children || []) {
    out.push(c, ...collect(c));
  }
  return out;
}

function matchesSel(node, sel) {
  const attr = /^\[data-([^\]]+)\]$/.exec(sel);
  if (!attr) return false;
  const camel = attr[1].replace(/-([a-z])/g, (_, ch) => ch.toUpperCase());
  return Object.prototype.hasOwnProperty.call(node.dataset || {}, camel);
}

function fakeEl(init = {}) {
  const el = {
    id: "",
    className: "",
    style: {},
    dataset: {},
    children: [],
    parentElement: null,
    parentNode: null,
    value: "",
    _html: "",
    _listeners: {},
    clientWidth: 800,
    clientHeight: 600,
    addEventListener(type, fn) {
      (this._listeners[type] ||= []).push(fn);
    },
    removeEventListener(type, fn) {
      this._listeners[type] = (this._listeners[type] || []).filter((f) => f !== fn);
    },
    dispatchEvent(ev) {
      for (const fn of this._listeners[ev.type] || []) fn(ev);
      return true;
    },
    appendChild(child) {
      this.children.push(child);
      child.parentElement = this;
      child.parentNode = this;
      return child;
    },
    contains(node) {
      if (node === this) return true;
      return this.children.some((c) => c === node || c.contains?.(node));
    },
    querySelector(sel) {
      return collect(this).find((n) => matchesSel(n, sel)) || null;
    },
    querySelectorAll(sel) {
      return collect(this).filter((n) => matchesSel(n, sel));
    },
    getAttribute(name) {
      if (name === "data-ned-field") return this.dataset.nedField ?? null;
      return null;
    },
    setAttribute() {},
    remove() {
      const p = this.parentElement;
      if (!p?.children) return;
      p.children = p.children.filter((c) => c !== this);
      this.parentElement = null;
      this.parentNode = null;
    },
    getBoundingClientRect() {
      return { left: 0, top: 0, width: 200, height: 100 };
    },
    ...init,
  };
  Object.defineProperty(el, "innerHTML", {
    get() {
      return this._html;
    },
    set(html) {
      this._html = String(html);
      const kids = [];
      for (const m of String(html).matchAll(/data-ned-field="([^"]+)"/g)) {
        kids.push(fakeEl({ dataset: { nedField: m[1] }, value: "" }));
      }
      for (const key of ["chip", "warn", "overflow", "reset", "download", "copy"]) {
        if (String(html).includes(`data-ned-${key}`)) {
          const camel = `ned${key[0].toUpperCase()}${key.slice(1)}`;
          kids.push(fakeEl({ dataset: { [camel]: "" } }));
        }
      }
      this.children = kids;
      for (const c of kids) {
        c.parentElement = this;
        c.parentNode = this;
      }
    },
    configurable: true,
  });
  return el;
}

function mountGisRemoteDebug({ remoteMap, persistRemoteLayoutMap }) {
  const storage = {
    data: {},
    getItem(key) { return this.data[key] ?? null; },
    setItem(key, value) { this.data[key] = String(value); },
    removeItem(key) { delete this.data[key]; },
  };
  const body = fakeEl();
  const display = fakeEl({ id: "map", clientWidth: 800, clientHeight: 600 });
  const host = fakeEl({ id: "nliGisClockHost" });
  const caption = fakeEl({ className: "nli-investigation-timeline-caption" });
  display.appendChild(host);
  host.appendChild(caption);
  const windowListeners = {};
  const win = {
    location: { search: "" },
    localStorage: storage,
    addEventListener(type, fn) { (windowListeners[type] ||= []).push(fn); },
    removeEventListener(type, fn) {
      windowListeners[type] = (windowListeners[type] || []).filter((item) => item !== fn);
    },
    dispatchEvent(ev) {
      for (const fn of windowListeners[ev.type] || []) fn(ev);
      return true;
    },
    requestAnimationFrame(cb) { cb(); return 1; },
  };
  vi.stubGlobal("window", win);
  vi.stubGlobal("document", {
    body,
    createElement() { return fakeEl(); },
    getElementById(id) { return id === "map" ? display : null; },
  });
  vi.stubGlobal("localStorage", storage);
  const api = installNliExplainerDebug({
    host,
    captionEl: caption,
    registerDisposer() {},
    storage,
    storageKey: NLI_GIS_CLOCK_LAYOUT_STORAGE_KEY,
    defaultLayout: GIS_CLOCK_DEFAULT_LAYOUT,
    enableSpanGuards: false,
    enableLayoutMapExport: false,
    mergeProjectionLayout: false,
    enableRotation: true,
    initialVisible: true,
    getRemoteLayoutMap: () => remoteMap,
    persistRemoteLayoutMap,
  });
  return { api, host, win, storage };
}

function moveGisHost({ host, win, clientX = 40, clientY = 24 }) {
  const pointer = (type, extra = {}) => ({
    type,
    button: 0,
    clientX: 20,
    clientY: 20,
    target: host,
    preventDefault() {},
    ...extra,
  });
  host.dispatchEvent(pointer("pointerdown"));
  win.dispatchEvent(pointer("pointermove", { clientX, clientY }));
  win.dispatchEvent(pointer("pointerup"));
}

async function flushRemoteSave() {
  for (let i = 0; i < 8; i += 1) await Promise.resolve();
}

const overlayGuards = vi.hoisted(() => ({
  nliExplainerSpanKey: vi.fn(),
  nliExplainerBoxHitsOverlap: vi.fn(),
  mergeNliExplainerLayout: vi.fn(),
}));

vi.mock("../../frontend/src/projection/nli-explainer-overlay.js", async (importOriginal) => {
  const actual = await importOriginal();
  overlayGuards.nliExplainerSpanKey.mockImplementation((...args) => actual.nliExplainerSpanKey(...args));
  overlayGuards.nliExplainerBoxHitsOverlap.mockImplementation((...args) =>
    actual.nliExplainerBoxHitsOverlap(...args),
  );
  overlayGuards.mergeNliExplainerLayout.mockImplementation((...args) =>
    actual.mergeNliExplainerLayout(...args),
  );
  return {
    ...actual,
    nliExplainerSpanKey: overlayGuards.nliExplainerSpanKey,
    nliExplainerBoxHitsOverlap: overlayGuards.nliExplainerBoxHitsOverlap,
    mergeNliExplainerLayout: overlayGuards.mergeNliExplainerLayout,
  };
});

describe("nli explainer debug editor", () => {
  it("url flags", () => {
    expect(isNliExplainerDebugRequestedInUrl("?ned=1")).toBe(true);
    expect(isNliExplainerDebugRequestedInUrl("?nliExplainerDebug=1")).toBe(true);
    expect(isNliExplainerDebugRequestedInUrl("")).toBe(false);
  });

  it("projection-main binds E and help documents it; GIS matches NliExplainerDebug", () => {
    const here = path.dirname(fileURLToPath(import.meta.url));
    const main = fs.readFileSync(path.resolve(here, "../../frontend/src/entries/projection-main.js"), "utf8");
    const gis = fs.readFileSync(path.resolve(here, "../../frontend/src/entries/map-main.js"), "utf8");
    const html = fs.readFileSync(path.resolve(here, "../../frontend/projection.html"), "utf8");
    const debugSrc = fs.readFileSync(path.resolve(here, "../../frontend/src/projection/nli-explainer-debug.js"), "utf8");
    const css = fs.readFileSync(path.resolve(here, "../../frontend/css/styles.css"), "utf8");
    expect(main).toMatch(/readProjectionDisplayHotkey/);
    expect(main).toMatch(/dispatchProjectionDisplayHotkey/);
    expect(main).toMatch(/NliExplainerDebug/);
    expect(html).toMatch(/nli explainer/i);
    expect(html).toMatch(/ned=1/);
    expect(html).toMatch(/nliExplainerLayout=committed/);
    expect(html).toMatch(/<strong>A<\/strong>/);
    expect(html).toMatch(/<strong>H<\/strong>/);
    expect(gis).toMatch(/NliExplainerDebug/);
    expect(gis).toMatch(/key === "e"/);
    expect(gis).toMatch(/nliGisClockHost/);
    expect(gis).toMatch(/raiseGisClockHost/);
    expect(gis).toMatch(/style\.load.*raiseGisClockHost|raiseGisClockHost/);
    expect(gis).toMatch(/nliCaptionMode:\s*"clock-only"/);
    expect(gis).toMatch(/isNliExplainerDebugRequestedInUrl/);
    expect(gis).toMatch(/ned=1/);
    expect(gis).toMatch(/nliExplainerDebug=1/);
    expect(gis).toMatch(/otef\.nliGisClockLayout\.v2|NLI_GIS_CLOCK_LAYOUT_STORAGE_KEY/);
    expect(css).not.toMatch(/--nli-gis-clock-size:\s*clamp\(1\.25rem,\s*2\.2vw,\s*2rem\)/);
    expect(css).toMatch(/#nliGisClockHost \.nli-tl-clock--clock-only/);
    expect(css).not.toMatch(/#nliGisClockHost[^}]*--nli-projection-clock-size/);
    const gisClockRule = css.slice(
      css.indexOf("#nliGisClockHost .nli-tl-clock--clock-only"),
      css.indexOf("#nliGisClockHost .nli-investigation-timeline-caption"),
    );
    expect(gisClockRule).toMatch(/font-size:\s*inherit/);
    expect(gisClockRule).not.toMatch(/font-size:\s*var\(--nli-gis-clock-size\)/);
    expect(gis).toMatch(/enableRotation:\s*true/);
    expect(main).toMatch(/explainerDebugVisible/);
    expect(main).toMatch(/isVisible/);
    expect(main).toMatch(/preventDefault/);
    expect(gis).toMatch(/preventDefault/);
    expect(debugSrc).toMatch(/NLI_EXPLAINER_SAMPLE_MODEL/);
    expect(debugSrc).toMatch(/nliExplainerContentOverflows/);
    expect(debugSrc).toMatch(/nliExplainerBoxHitsOverlap/);
    expect(debugSrc).toMatch(/a\.download/);
    expect(debugSrc).toMatch(/nli-explainer-layout\.json/);
    expect(debugSrc).toMatch(/rotateDeg/);
    expect(debugSrc).not.toMatch(/scrollHeight\s*>\s*captionEl\.clientHeight/);
  });

  it("move resize and rotate adjust then clamp", () => {
    const base = { leftPct: 10, topPct: 10, widthPct: 20, heightPct: 20, fontPx: 22, rotateDeg: 0 };
    expect(moveLayoutByDelta(base, 10, 0).leftPct).toBe(20);
    expect(resizeLayoutFromHandle(base, "e", 5, 0).widthPct).toBe(25);
    expect(rotateLayoutByDelta(base, 15).rotateDeg).toBe(15);
  });

  it("projection-main statically imports nli-explainer-debug (no inline import())", () => {
    const here = path.dirname(fileURLToPath(import.meta.url));
    const main = fs.readFileSync(
      path.resolve(here, "../../frontend/src/entries/projection-main.js"),
      "utf8",
    );
    expect(main).toMatch(/from\s+["'][^"']*nli-explainer-debug\.js["']/);
    expect(main).not.toMatch(/import\s*\(\s*[\s\S]*?nli-explainer-debug\.js/);
    const fromIdx = main.search(/from\s+["'][^"']*nli-explainer-debug\.js["']/);
    const loadIdx = main.indexOf('map.on("load"');
    expect(fromIdx).toBeGreaterThan(-1);
    expect(fromIdx).toBeLessThan(loadIdx);
  });

  it("GIS debug host HTML stays clock-only without chip rows", async () => {
    const injected = {
      className: "",
      hidden: true,
      innerHTML: "",
      textContent: "",
      dir: "",
      setAttribute() {},
    };
    const map = {
      getStyle: () => ({ layers: [] }),
      getLayer: () => null,
      getSource: () => null,
      addSource() {},
      addLayer() {},
      removeLayer() {},
      removeSource() {},
      setFeatureState() {},
      getPaintProperty() {},
      moveLayer() {},
      setPaintProperty() {},
      setLayoutProperty() {},
      getContainer: () => ({
        querySelector: () => null,
        appendChild() {
          throw new Error("must not append");
        },
        removeChild() {},
      }),
    };
    await syncInvestigationTimelineToMap(map, idleNliClock(), [{ id: "nli", layers: [] }], {
      captionEl: injected,
      allowMapCaption: false,
      nliCaptionMode: "clock-only",
      explainerDebugVisible: true,
      featuresById: {},
      now: () => 0,
    });
    expect(injected.innerHTML).toMatch(/nli-tl-clock/);
    expect(injected.innerHTML).not.toContain("nli-tl-row");
    expect(injected.innerHTML).not.toContain("שטחים");
    disposeInvestigationTimelineForMap(map);
  });

  it("GIS host fontPx is applied so debug size can win the clock", () => {
    const host = { style: {} };
    applyNliExplainerLayout(host, { ...GIS_CLOCK_DEFAULT_LAYOUT, fontPx: 40 });
    expect(host.style.fontSize).toBe("40px");
  });

  it("clock-only captions are transparent and inherit layout fontPx", () => {
    const here = path.dirname(fileURLToPath(import.meta.url));
    const css = fs.readFileSync(path.resolve(here, "../../frontend/css/styles.css"), "utf8");
    const main = fs.readFileSync(path.resolve(here, "../../frontend/src/entries/projection-main.js"), "utf8");
    void main;
    expect(css).toMatch(/#nliExplainerHost\s*\{[^}]*z-index:\s*12/);
    expect(css).toMatch(/#nliGisClockHost\s*\{[^}]*z-index:\s*20/);
    expect(css).toMatch(/#nliExplainerHost \.nli-investigation-timeline-caption\s*\{[^}]*pointer-events:\s*auto/);
    expect(css).toMatch(/#nliGisClockHost \.nli-investigation-timeline-caption\s*\{[^}]*pointer-events:\s*auto/);
    expect(css).toMatch(/#nliExplainerHost \.nli-tl-clock--clock-only/);
    expect(css).toMatch(/#nliGisClockHost \.nli-tl-clock--clock-only/);
    const explainerClock = css.slice(
      css.indexOf("#nliExplainerHost .nli-tl-clock--clock-only"),
      css.indexOf("#nliExplainerHost .nli-investigation-timeline-caption"),
    );
    expect(explainerClock).toMatch(/font-size:\s*inherit/);
    expect(explainerClock).not.toMatch(/--nli-projection-clock-size/);
    const explainerCaption = css.slice(
      css.indexOf("#nliExplainerHost .nli-investigation-timeline-caption"),
      css.indexOf("#nliGisClockHost"),
    );
    expect(explainerCaption).toMatch(/background:\s*transparent/);
    expect(explainerCaption).not.toMatch(/rgba\(12,\s*16,\s*22,\s*0\.62\)/);
    const gisCaption = css.slice(
      css.indexOf("#nliGisClockHost .nli-investigation-timeline-caption"),
    );
    expect(gisCaption).toMatch(/background:\s*transparent/);
  });

  it("map-main statically imports nli-explainer-debug (no inline import())", () => {
    const here = path.dirname(fileURLToPath(import.meta.url));
    const gis = fs.readFileSync(
      path.resolve(here, "../../frontend/src/entries/map-main.js"),
      "utf8",
    );
    expect(gis).toMatch(/from\s+["'][^"']*nli-explainer-debug\.js["']/);
    expect(gis).not.toMatch(/import\s*\(\s*[\s\S]*?nli-explainer-debug\.js/);
    const fromIdx = gis.search(/from\s+["'][^"']*nli-explainer-debug\.js["']/);
    const loadIdx = gis.indexOf('map.on("load"');
    expect(fromIdx).toBeGreaterThan(-1);
    expect(fromIdx).toBeLessThan(loadIdx);
  });

  it("URL-init visible sync cannot run before isVisible is true", () => {
    const here = path.dirname(fileURLToPath(import.meta.url));
    const main = fs.readFileSync(
      path.resolve(here, "../../frontend/src/entries/projection-main.js"),
      "utf8",
    );
    const debugSrc = fs.readFileSync(
      path.resolve(here, "../../frontend/src/projection/nli-explainer-debug.js"),
      "utf8",
    );
    expect(debugSrc).toMatch(/onVisibleChange\(visible\)/);
    expect(main).toMatch(/onVisibleChange:\s*\(\s*visible\s*\)\s*=>/);
    expect(main).toMatch(
      /onVisibleChange:\s*\(\s*visible\s*\)\s*=>\s*\{[^}]*explainerDebugVisible\s*=\s*visible(?:\s*===\s*true)?[^}]*syncContextInvestigation\(\)/,
    );
    const assignIdx = main.indexOf("window.NliExplainerDebug =");
    const installIdx = main.indexOf("installNliExplainerDebug(");
    const usesCallbackVisible =
      /onVisibleChange:\s*\(\s*visible\s*\)\s*=>\s*\{[^}]*explainerDebugVisible\s*=\s*visible/.test(
        main,
      );
    expect(usesCallbackVisible || (assignIdx > -1 && assignIdx < installIdx)).toBe(true);
    const syncMatch = main.match(
      /const syncContextInvestigation = \(\) => \{[\s\S]*?explainerDebugVisible:\s*([^,\n]+)/,
    );
    expect(syncMatch).not.toBeNull();
    expect(syncMatch[1]).not.toMatch(/window\.NliExplainerDebug/);
  });

  it("persist and reset wrap localStorage.setItem in try/catch", () => {
    const here = path.dirname(fileURLToPath(import.meta.url));
    const debugSrc = fs.readFileSync(
      path.resolve(here, "../../frontend/src/projection/nli-explainer-debug.js"),
      "utf8",
    );
    const persistBlock = debugSrc.slice(
      debugSrc.indexOf("function persist()"),
      debugSrc.indexOf("function currentFullMap()"),
    );
    expect(persistBlock).toMatch(/try\s*\{[\s\S]*localStorage\.setItem[\s\S]*\}\s*catch/);
    const resetBlock = debugSrc.slice(
      debugSrc.indexOf("[data-ned-reset]"),
      debugSrc.indexOf("[data-ned-download]"),
    );
    expect(resetBlock).toMatch(/try\s*\{[\s\S]*localStorage\.setItem[\s\S]*\}\s*catch/);
  });

  it("setVisible puts handles on the host and pointerup persists the span key", () => {
    const mem = {};
    const storage = {
      getItem(key) {
        return Object.prototype.hasOwnProperty.call(mem, key) ? mem[key] : null;
      },
      setItem(key, value) {
        mem[key] = String(value);
      },
      removeItem(key) {
        delete mem[key];
      },
    };

    function fakeEl(init = {}) {
      const el = {
        id: "",
        className: "",
        style: {},
        dataset: {},
        children: [],
        parentElement: null,
        parentNode: null,
        value: "",
        _html: "",
        _listeners: {},
        clientWidth: 800,
        clientHeight: 600,
        addEventListener(type, fn) {
          (this._listeners[type] ||= []).push(fn);
        },
        removeEventListener(type, fn) {
          this._listeners[type] = (this._listeners[type] || []).filter((f) => f !== fn);
        },
        dispatchEvent(ev) {
          for (const fn of this._listeners[ev.type] || []) fn(ev);
          return true;
        },
        appendChild(child) {
          this.children.push(child);
          child.parentElement = this;
          child.parentNode = this;
          return child;
        },
        contains(node) {
          if (node === this) return true;
          return this.children.some((c) => c === node || c.contains?.(node));
        },
        querySelector(sel) {
          return collect(this).find((n) => matchesSel(n, sel)) || null;
        },
        querySelectorAll(sel) {
          return collect(this).filter((n) => matchesSel(n, sel));
        },
        getAttribute(name) {
          if (name === "data-ned-field") return this.dataset.nedField ?? null;
          return null;
        },
        setAttribute() {},
        remove() {
          const p = this.parentElement;
          if (!p?.children) return;
          p.children = p.children.filter((c) => c !== this);
          this.parentElement = null;
          this.parentNode = null;
        },
        getBoundingClientRect() {
          return { left: 0, top: 0, width: 200, height: 100 };
        },
        ...init,
      };
      Object.defineProperty(el, "innerHTML", {
        get() {
          return this._html;
        },
        set(html) {
          this._html = String(html);
          const kids = [];
          for (const m of String(html).matchAll(/data-ned-field="([^"]+)"/g)) {
            kids.push(fakeEl({ dataset: { nedField: m[1] }, value: "" }));
          }
          for (const key of ["chip", "warn", "overflow", "reset", "download", "copy"]) {
            if (String(html).includes(`data-ned-${key}`)) {
              const camel = `ned${key[0].toUpperCase()}${key.slice(1)}`;
              kids.push(fakeEl({ dataset: { [camel]: "" } }));
            }
          }
          this.children = kids;
          for (const c of kids) {
            c.parentElement = this;
            c.parentNode = this;
          }
        },
        configurable: true,
      });
      return el;
    }

    function collect(node) {
      const out = [];
      for (const c of node.children || []) {
        out.push(c, ...collect(c));
      }
      return out;
    }

    function matchesSel(node, sel) {
      const attr = /^\[data-([^\]]+)\]$/.exec(sel);
      if (!attr) return false;
      const camel = attr[1].replace(/-([a-z])/g, (_, ch) => ch.toUpperCase());
      return Object.prototype.hasOwnProperty.call(node.dataset || {}, camel);
    }

    const body = fakeEl();
    const display = fakeEl({ id: "displayContainer", clientWidth: 800, clientHeight: 600 });
    const host = fakeEl({ id: "nliExplainerHost" });
    const caption = fakeEl({ className: "nli-investigation-timeline-caption" });
    display.appendChild(host);
    host.appendChild(caption);

    const windowListeners = {};
    const win = {
      location: { search: "" },
      localStorage: storage,
      addEventListener(type, fn) {
        (windowListeners[type] ||= []).push(fn);
      },
      removeEventListener(type, fn) {
        windowListeners[type] = (windowListeners[type] || []).filter((f) => f !== fn);
      },
      dispatchEvent(ev) {
        for (const fn of windowListeners[ev.type] || []) fn(ev);
        return true;
      },
      requestAnimationFrame(cb) {
        cb();
        return 1;
      },
    };
    const doc = {
      body,
      createElement() {
        return fakeEl();
      },
      getElementById(id) {
        return id === "displayContainer" ? display : null;
      },
    };

    vi.stubGlobal("window", win);
    vi.stubGlobal("document", doc);
    vi.stubGlobal("localStorage", storage);

    const api = installNliExplainerDebug({
      host,
      captionEl: caption,
      registerDisposer() {},
    });
    expect(api).not.toBeNull();
    api.setVisible(true);

    const hostHandles = host.children.filter((c) => c.dataset?.nedHandle);
    const captionHandles = caption.children.filter((c) => c.dataset?.nedHandle);
    expect(hostHandles.filter((c) => c.dataset.nedHandle !== "rotate")).toHaveLength(8);
    expect(hostHandles.some((c) => c.dataset.nedHandle === "rotate")).toBe(true);
    expect(captionHandles).toHaveLength(0);

    function pointerEv(type, target, extra = {}) {
      return {
        type,
        button: 0,
        clientX: 20,
        clientY: 20,
        target,
        preventDefault() {},
        ...extra,
      };
    }
    host.dispatchEvent(pointerEv("pointerdown", host));
    win.dispatchEvent(pointerEv("pointermove", host, { clientX: 40, clientY: 24 }));
    win.dispatchEvent(pointerEv("pointerup", host));

    const raw = storage.getItem(NLI_EXPLAINER_LAYOUT_STORAGE_KEY);
    expect(raw).toBeTruthy();
    const parsed = JSON.parse(raw);
    expect(parsed).toHaveProperty("full");
    expect(parsed.full).toEqual(expect.objectContaining({ leftPct: expect.any(Number) }));

    api.dispose();
    vi.unstubAllGlobals();
  });

  it("GIS debug does not use span selection, overlap guards, or projection layout merge", () => {
    const mem = {};
    const storage = {
      getItem(key) {
        return Object.prototype.hasOwnProperty.call(mem, key) ? mem[key] : null;
      },
      setItem(key, value) {
        mem[key] = String(value);
      },
      removeItem(key) {
        delete mem[key];
      },
    };

    function fakeEl(init = {}) {
      const el = {
        id: "",
        className: "",
        style: {},
        dataset: {},
        children: [],
        parentElement: null,
        parentNode: null,
        value: "",
        _html: "",
        _listeners: {},
        clientWidth: 800,
        clientHeight: 600,
        addEventListener(type, fn) {
          (this._listeners[type] ||= []).push(fn);
        },
        removeEventListener(type, fn) {
          this._listeners[type] = (this._listeners[type] || []).filter((f) => f !== fn);
        },
        dispatchEvent(ev) {
          for (const fn of this._listeners[ev.type] || []) fn(ev);
          return true;
        },
        appendChild(child) {
          this.children.push(child);
          child.parentElement = this;
          child.parentNode = this;
          return child;
        },
        contains(node) {
          if (node === this) return true;
          return this.children.some((c) => c === node || c.contains?.(node));
        },
        querySelector(sel) {
          return collect(this).find((n) => matchesSel(n, sel)) || null;
        },
        querySelectorAll(sel) {
          return collect(this).filter((n) => matchesSel(n, sel));
        },
        getAttribute(name) {
          if (name === "data-ned-field") return this.dataset.nedField ?? null;
          return null;
        },
        setAttribute() {},
        remove() {
          const p = this.parentElement;
          if (!p?.children) return;
          p.children = p.children.filter((c) => c !== this);
          this.parentElement = null;
          this.parentNode = null;
        },
        getBoundingClientRect() {
          return { left: 0, top: 0, width: 200, height: 100 };
        },
        ...init,
      };
      Object.defineProperty(el, "innerHTML", {
        get() {
          return this._html;
        },
        set(html) {
          this._html = String(html);
          const kids = [];
          for (const m of String(html).matchAll(/data-ned-field="([^"]+)"/g)) {
            kids.push(fakeEl({ dataset: { nedField: m[1] }, value: "" }));
          }
          for (const key of ["chip", "warn", "overflow", "reset", "download", "copy"]) {
            if (String(html).includes(`data-ned-${key}`)) {
              const camel = `ned${key[0].toUpperCase()}${key.slice(1)}`;
              kids.push(fakeEl({ dataset: { [camel]: "" } }));
            }
          }
          this.children = kids;
          for (const c of kids) {
            c.parentElement = this;
            c.parentNode = this;
          }
        },
        configurable: true,
      });
      return el;
    }

    function collect(node) {
      const out = [];
      for (const c of node.children || []) {
        out.push(c, ...collect(c));
      }
      return out;
    }

    function matchesSel(node, sel) {
      const attr = /^\[data-([^\]]+)\]$/.exec(sel);
      if (!attr) return false;
      const camel = attr[1].replace(/-([a-z])/g, (_, ch) => ch.toUpperCase());
      return Object.prototype.hasOwnProperty.call(node.dataset || {}, camel);
    }

    const body = fakeEl();
    const display = fakeEl({ id: "map", clientWidth: 800, clientHeight: 600 });
    const host = fakeEl({ id: "nliGisClockHost" });
    const caption = fakeEl({ className: "nli-investigation-timeline-caption" });
    display.appendChild(host);
    host.appendChild(caption);

    const windowListeners = {};
    const win = {
      location: { search: "?span=left" },
      localStorage: storage,
      addEventListener(type, fn) {
        (windowListeners[type] ||= []).push(fn);
      },
      removeEventListener(type, fn) {
        windowListeners[type] = (windowListeners[type] || []).filter((f) => f !== fn);
      },
      dispatchEvent(ev) {
        for (const fn of windowListeners[ev.type] || []) fn(ev);
        return true;
      },
      requestAnimationFrame(cb) {
        cb();
        return 1;
      },
    };
    const doc = {
      body,
      createElement() {
        return fakeEl();
      },
      getElementById(id) {
        return id === "map" ? display : null;
      },
    };

    vi.stubGlobal("window", win);
    vi.stubGlobal("document", doc);
    vi.stubGlobal("localStorage", storage);

    overlayGuards.nliExplainerSpanKey.mockClear();
    overlayGuards.nliExplainerBoxHitsOverlap.mockClear();
    overlayGuards.mergeNliExplainerLayout.mockClear();

    function mountGisClockDebug({ storage: store, host: gisHost }) {
      return installNliExplainerDebug({
        host: gisHost,
        captionEl: caption,
        registerDisposer() {},
        storage: store,
        storageKey: NLI_GIS_CLOCK_LAYOUT_STORAGE_KEY,
        defaultLayout: GIS_CLOCK_DEFAULT_LAYOUT,
        enableSpanGuards: false,
        enableLayoutMapExport: false,
        mergeProjectionLayout: false,
        enableRotation: true,
        initialVisible: true,
      });
    }

    const api = mountGisClockDebug({ storage, host });
    expect(api).not.toBeNull();
    const panel = body.children.find((child) => child.querySelector?.("[data-ned-reset]")) || body;
    expect(panel.querySelector("[data-ned-download]")).toBeNull();
    expect(panel.querySelector("[data-ned-copy]")).toBeNull();
    expect(panel.querySelector("[data-ned-warn]")).toBeNull();
    expect(String(panel.innerHTML || panel._html || "")).toMatch(/data-ned-field="rotateDeg"/);
    expect(host.children.filter((c) => c.dataset?.nedHandle === "rotate")).toHaveLength(1);
    expect(host.children.filter((c) => c.dataset?.nedHandle && c.dataset.nedHandle !== "rotate")).toHaveLength(8);
    expect(localStorage.getItem("otef.nliExplainerLayout.v2")).toBeNull();
    expect(localStorage.getItem("otef.nliExplainerLayout.v1")).toBeNull();

    function pointerEv(type, target, extra = {}) {
      return {
        type,
        button: 0,
        clientX: 20,
        clientY: 20,
        target,
        preventDefault() {},
        ...extra,
      };
    }
    host.dispatchEvent(pointerEv("pointerdown", host));
    win.dispatchEvent(pointerEv("pointermove", host, { clientX: 40, clientY: 24 }));
    win.dispatchEvent(pointerEv("pointerup", host));

    expect(localStorage.getItem("otef.nliExplainerLayout.v2")).toBeNull();
    expect(localStorage.getItem("otef.nliExplainerLayout.v1")).toBeNull();
    const gisRaw = localStorage.getItem(NLI_GIS_CLOCK_LAYOUT_STORAGE_KEY);
    expect(gisRaw).toBeTruthy();
    const gisParsed = JSON.parse(gisRaw);
    expect(gisParsed.start).toEqual(expect.objectContaining({ leftPct: expect.any(Number) }));
    expect(gisParsed).not.toHaveProperty("leftPct");
    expect(gisParsed).not.toHaveProperty("left");
    expect(gisParsed).not.toHaveProperty("right");
    expect(gisParsed).not.toHaveProperty("full");
    expect(overlayGuards.nliExplainerSpanKey).not.toHaveBeenCalled();
    expect(overlayGuards.nliExplainerBoxHitsOverlap).not.toHaveBeenCalled();
    expect(overlayGuards.mergeNliExplainerLayout).not.toHaveBeenCalled();

    api.dispose();
    vi.unstubAllGlobals();
  });

  it("setGisClockLayoutSlot persists the previous slot and rebinds an open editor", () => {
    const storage = {
      data: {},
      getItem(key) { return this.data[key] ?? null; },
      setItem(key, value) { this.data[key] = String(value); },
      removeItem(key) { delete this.data[key]; },
    };
    const body = fakeEl();
    const display = fakeEl({ id: "map", clientWidth: 800, clientHeight: 600 });
    const host = fakeEl({ id: "nliGisClockHost" });
    const caption = fakeEl({ className: "nli-investigation-timeline-caption" });
    display.appendChild(host);
    host.appendChild(caption);
    const win = {
      location: { search: "" },
      localStorage: storage,
      addEventListener() {},
      removeEventListener() {},
      requestAnimationFrame(cb) { cb(); return 1; },
    };
    vi.stubGlobal("window", win);
    vi.stubGlobal("document", {
      body,
      createElement() { return fakeEl(); },
      getElementById(id) { return id === "map" ? display : null; },
    });
    vi.stubGlobal("localStorage", storage);
    const api = installNliExplainerDebug({
      host,
      captionEl: caption,
      registerDisposer() {},
      storage,
      storageKey: NLI_GIS_CLOCK_LAYOUT_STORAGE_KEY,
      defaultLayout: GIS_CLOCK_DEFAULT_LAYOUT,
      enableSpanGuards: false,
      enableLayoutMapExport: false,
      mergeProjectionLayout: false,
      enableRotation: true,
      initialVisible: true,
    });
    expect(typeof api.setGisClockLayoutSlot).toBe("function");
    api.setGisClockLayoutSlot("nova");
    const stored = JSON.parse(storage.getItem(NLI_GIS_CLOCK_LAYOUT_STORAGE_KEY));
    expect(stored.start).toEqual(expect.objectContaining({ leftPct: expect.any(Number) }));
    expect(stored).not.toHaveProperty("nova");
    expect(host.style.left).toBe(`${GIS_CLOCK_DEFAULT_LAYOUT.leftPct}%`);
    expect(host.style.top).toBe(`${GIS_CLOCK_DEFAULT_LAYOUT.topPct}%`);
    api.setGisClockLayoutSlot("segev");
    const after = JSON.parse(storage.getItem(NLI_GIS_CLOCK_LAYOUT_STORAGE_KEY));
    expect(after.start).toEqual(stored.start);
    expect(after.nova).toEqual(GIS_CLOCK_DEFAULT_LAYOUT);
    expect(after).not.toHaveProperty("segev");
    expect(host.style.left).toBe(`${GIS_CLOCK_DEFAULT_LAYOUT.leftPct}%`);
    expect(api.isVisible()).toBe(true);
    api.dispose();
    vi.unstubAllGlobals();
  });

  it("GIS remote slot binding reads custom start coordinates without a same-slot save", () => {
    const remoteMap = {
      start: { ...GIS_CLOCK_DEFAULT_LAYOUT, leftPct: 11, topPct: 22 },
    };
    const persist = vi.fn(() => Promise.resolve());
    const { api, host } = mountGisRemoteDebug({ remoteMap, persistRemoteLayoutMap: persist });

    api.setGisClockLayoutSlot("start");

    expect(host.style.left).toBe("11%");
    expect(host.style.top).toBe("22%");
    expect(persist).not.toHaveBeenCalled();
    api.dispose();
    vi.unstubAllGlobals();
  });

  it("GIS remote edits survive an acknowledged save and remount", async () => {
    const remoteMap = {
      start: { ...GIS_CLOCK_DEFAULT_LAYOUT, leftPct: 11, topPct: 22 },
    };
    const persist = vi.fn(async (payload) => {
      Object.assign(remoteMap, payload);
    });
    const first = mountGisRemoteDebug({ remoteMap, persistRemoteLayoutMap: persist });
    moveGisHost(first);
    await flushRemoteSave();
    const editedLeft = first.host.style.left;
    expect(editedLeft).not.toBe("11%");
    first.api.dispose();
    vi.unstubAllGlobals();

    const second = mountGisRemoteDebug({ remoteMap, persistRemoteLayoutMap: persist });
    second.api.setGisClockLayoutSlot("start");
    expect(second.host.style.left).toBe(editedLeft);
    second.api.dispose();
    vi.unstubAllGlobals();
  });

  it("GIS remote rebinding during a deferred save keeps the working edit", async () => {
    const remoteMap = {
      start: { ...GIS_CLOCK_DEFAULT_LAYOUT, leftPct: 11, topPct: 22 },
    };
    let resolveSave;
    const pending = new Promise((resolve) => { resolveSave = resolve; });
    const persist = vi.fn(() => pending);
    const { api, host, win } = mountGisRemoteDebug({ remoteMap, persistRemoteLayoutMap: persist });
    moveGisHost({ host, win });
    await flushRemoteSave();
    const editedLeft = host.style.left;

    api.setGisClockLayoutSlot("start");

    expect(host.style.left).toBe(editedLeft);
    expect(persist).toHaveBeenCalledTimes(1);
    resolveSave();
    api.dispose();
    vi.unstubAllGlobals();
  });

  it("GIS remote saves serialize slot changes and preserve both edited slots", async () => {
    const remoteMap = {
      start: { ...GIS_CLOCK_DEFAULT_LAYOUT, leftPct: 11 },
      nova: { ...GIS_CLOCK_DEFAULT_LAYOUT, leftPct: 33 },
    };
    const resolvers = [];
    const payloads = [];
    const persist = vi.fn((payload) => {
      payloads.push(payload);
      return new Promise((resolve) => resolvers.push(resolve));
    });
    const first = mountGisRemoteDebug({ remoteMap, persistRemoteLayoutMap: persist });
    moveGisHost(first);
    first.api.setGisClockLayoutSlot("nova");
    moveGisHost({ host: first.host, win: first.win, clientX: 60, clientY: 24 });
    await flushRemoteSave();
    expect(persist).toHaveBeenCalledTimes(1);
    expect(resolvers).toHaveLength(1);

    resolvers.shift()();
    await flushRemoteSave();
    expect(persist).toHaveBeenCalledTimes(2);
    expect(resolvers).toHaveLength(1);
    resolvers.shift()();
    await flushRemoteSave();
    expect(persist).toHaveBeenCalledTimes(3);
    expect(resolvers).toHaveLength(1);
    expect(payloads[2]).toHaveProperty("start");
    expect(payloads[2]).toHaveProperty("nova");
    Object.assign(remoteMap, payloads[2]);
    resolvers.shift()();
    await flushRemoteSave();

    first.api.dispose();
    vi.unstubAllGlobals();
    const second = mountGisRemoteDebug({ remoteMap, persistRemoteLayoutMap: persist });
    second.api.setGisClockLayoutSlot("start");
    const startLeft = second.host.style.left;
    second.api.setGisClockLayoutSlot("nova");
    expect(second.host.style.left).toBe(`${remoteMap.nova.leftPct}%`);
    expect(startLeft).toBe(`${remoteMap.start.leftPct}%`);
    second.api.dispose();
    vi.unstubAllGlobals();
  });

  it("GIS remote save rejection is absorbed so a later edit still saves", async () => {
    const remoteMap = { start: { ...GIS_CLOCK_DEFAULT_LAYOUT, leftPct: 11 } };
    let rejectFirst;
    let resolveSecond;
    const persist = vi.fn()
      .mockImplementationOnce(() => new Promise((_, reject) => { rejectFirst = reject; }))
      .mockImplementationOnce(() => new Promise((resolve) => { resolveSecond = resolve; }));
    const { api, host, win } = mountGisRemoteDebug({ remoteMap, persistRemoteLayoutMap: persist });
    moveGisHost({ host, win });
    await flushRemoteSave();
    rejectFirst(new Error("save failed"));
    await flushRemoteSave();
    moveGisHost({ host, win, clientX: 60, clientY: 24 });
    await flushRemoteSave();
    expect(persist).toHaveBeenCalledTimes(2);
    resolveSecond();
    await flushRemoteSave();
    api.dispose();
    vi.unstubAllGlobals();
  });

  it("map-main calls setGisClockLayoutSlot on narrative enter replace and exit", () => {
    const gis = fs.readFileSync(
      path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../frontend/src/entries/map-main.js"),
      "utf8",
    );
    expect(gis).toMatch(/setGisClockLayoutSlot/);
    expect(gis).toMatch(/nliCaptionMode:\s*"clock-only"/);
  });

  it("GIS clock E stays closed while Segev presentation is open", () => {
    const host = fakeEl();
    const caption = fakeEl();
    const storage = {
      getItem: () => null,
      setItem: vi.fn(),
    };
    const body = fakeEl();
    vi.stubGlobal("window", {
      location: { search: "" },
      localStorage: storage,
      addEventListener() {},
      removeEventListener() {},
      requestAnimationFrame(cb) { cb(); return 1; },
    });
    vi.stubGlobal("document", {
      body,
      createElement() { return fakeEl(); },
      getElementById() { return null; },
    });
    vi.stubGlobal("localStorage", storage);
    const api = installNliExplainerDebug({
      host,
      captionEl: caption,
      registerDisposer() {},
      storage,
      storageKey: NLI_GIS_CLOCK_LAYOUT_STORAGE_KEY,
      defaultLayout: GIS_CLOCK_DEFAULT_LAYOUT,
      enableSpanGuards: false,
      enableLayoutMapExport: false,
      mergeProjectionLayout: false,
      enableRotation: true,
      initialVisible: false,
    });
    api.setVisible(true);
    expect(api.isVisible()).toBe(true);
    api.setGisClockHotkeyAllowed(false);
    api.setVisible(true);
    expect(api.isVisible()).toBe(false);
    const event = { key: "e", defaultPrevented: false, repeat: false, target: { tagName: "BODY" } };
    expect(api.handleGisClockHotkey(event)).toBe(false);
    expect(api.isVisible()).toBe(false);
    api.setGisClockHotkeyAllowed(true);
    expect(api.handleGisClockHotkey(event)).toBe(true);
    expect(api.isVisible()).toBe(true);
    api.dispose();
    vi.unstubAllGlobals();
  });

  it("narrative transition close without emitResult re-enables GIS clock E", async () => {
    const host = fakeEl();
    const caption = fakeEl();
    const storage = { getItem: () => null, setItem: vi.fn() };
    const body = fakeEl();
    const listeners = new Map();
    const container = {
      children: [],
      appendChild(child) { this.children.push(child); child.parentNode = this; return child; },
      removeChild(child) { this.children = this.children.filter((item) => item !== child); child.parentNode = null; },
      querySelector(selector) {
        for (const child of this.children) {
          const match = child.querySelector?.(selector);
          if (match) return match;
        }
        return null;
      },
    };
    vi.stubGlobal("window", {
      location: { search: "" },
      localStorage: storage,
      addEventListener() {},
      removeEventListener() {},
      requestAnimationFrame(cb) { cb(); return 1; },
    });
    vi.stubGlobal("document", {
      body,
      createElement(tagName) { return fakeEl({ tagName }); },
      getElementById() { return null; },
      addEventListener: vi.fn((type, handler) => listeners.set(type, handler)),
      removeEventListener: vi.fn((type, handler) => {
        if (listeners.get(type) === handler) listeners.delete(type);
      }),
    });
    vi.stubGlobal("localStorage", storage);
    try {
      const api = installNliExplainerDebug({
        host,
        captionEl: caption,
        registerDisposer() {},
        storage,
        storageKey: NLI_GIS_CLOCK_LAYOUT_STORAGE_KEY,
        defaultLayout: GIS_CLOCK_DEFAULT_LAYOUT,
        enableSpanGuards: false,
        enableLayoutMapExport: false,
        mergeProjectionLayout: false,
        enableRotation: true,
        initialVisible: false,
      });
      const presentation = createNarrativePresentation(container, {
        onOpenChange: (open) => {
          api.setGisClockHotkeyAllowed(!open);
          if (open) api.setVisible(false);
        },
      });
      presentation.open(NLI_NARRATIVES.segev, { narrativeId: "segev", requestId: "open-1" });
      const event = { key: "e", defaultPrevented: false, repeat: false, target: { tagName: "BODY" } };
      expect(api.handleGisClockHotkey(event)).toBe(false);
      expect(api.isVisible()).toBe(false);
      presentation.close();
      expect(api.handleGisClockHotkey(event)).toBe(true);
      expect(api.isVisible()).toBe(true);
      presentation.dispose();
      api.dispose();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("click on host or caption toggles editor chrome; E preventDefault when handled", () => {
    const storage = {
      data: {},
      getItem(key) { return this.data[key] ?? null; },
      setItem(key, value) { this.data[key] = String(value); },
      removeItem(key) { delete this.data[key]; },
    };
    const body = fakeEl();
    const display = fakeEl({ id: "map", clientWidth: 800, clientHeight: 600 });
    const host = fakeEl({ id: "nliGisClockHost" });
    const caption = fakeEl({ className: "nli-investigation-timeline-caption" });
    display.appendChild(host);
    host.appendChild(caption);
    vi.stubGlobal("window", {
      location: { search: "" },
      localStorage: storage,
      addEventListener() {},
      removeEventListener() {},
      requestAnimationFrame(cb) { cb(); return 1; },
    });
    vi.stubGlobal("document", {
      body,
      createElement() { return fakeEl(); },
      getElementById(id) { return id === "map" ? display : null; },
    });
    vi.stubGlobal("localStorage", storage);
    const api = installNliExplainerDebug({
      host,
      captionEl: caption,
      registerDisposer() {},
      storage,
      storageKey: NLI_GIS_CLOCK_LAYOUT_STORAGE_KEY,
      defaultLayout: GIS_CLOCK_DEFAULT_LAYOUT,
      enableSpanGuards: false,
      enableLayoutMapExport: false,
      mergeProjectionLayout: false,
      enableRotation: true,
      initialVisible: false,
    });
    expect(api.isVisible()).toBe(false);
    expect(typeof api.toggle).toBe("function");

    caption.dispatchEvent({ type: "click", button: 0, target: caption, preventDefault() {} });
    expect(api.isVisible()).toBe(true);
    const handles = host.children.filter((c) => c.dataset?.nedHandle);
    expect(handles.length).toBeGreaterThan(0);
    expect(handles.every((c) => c.style.display === "block")).toBe(true);
    const panel = body.children.find((child) => child.querySelector?.("[data-ned-reset]"));
    expect(panel?.style.display).toBe("block");

    host.dispatchEvent({ type: "click", button: 0, target: host, preventDefault() {} });
    expect(api.isVisible()).toBe(false);
    expect(handles.every((c) => c.style.display === "none")).toBe(true);

    const event = {
      key: "e",
      defaultPrevented: false,
      repeat: false,
      target: { tagName: "BODY" },
      preventDefault() { this.defaultPrevented = true; },
    };
    expect(api.handleGisClockHotkey(event)).toBe(true);
    expect(event.defaultPrevented).toBe(true);
    expect(api.isVisible()).toBe(true);
    api.dispose();
    vi.unstubAllGlobals();
  });

  it("committed search still persists to localStorage and applyLive updates left/top", () => {
    const mem = {};
    const storage = {
      getItem(key) {
        return Object.prototype.hasOwnProperty.call(mem, key) ? mem[key] : null;
      },
      setItem(key, value) {
        mem[key] = String(value);
      },
      removeItem(key) {
        delete mem[key];
      },
    };
    const storedLeft = {
      leftPct: 12,
      topPct: 14,
      widthPct: 20,
      heightPct: 20,
      fontPx: 22,
      rotateDeg: 0,
    };
    storage.setItem(NLI_EXPLAINER_LAYOUT_STORAGE_KEY, JSON.stringify({ left: storedLeft }));

    const body = fakeEl();
    const display = fakeEl({ id: "displayContainer", clientWidth: 800, clientHeight: 600 });
    const host = fakeEl({ id: "nliExplainerHost" });
    const caption = fakeEl({ className: "nli-investigation-timeline-caption" });
    display.appendChild(host);
    host.appendChild(caption);
    const windowListeners = {};
    const win = {
      location: { search: "?span=left&nliExplainerLayout=committed" },
      localStorage: storage,
      addEventListener(type, fn) {
        (windowListeners[type] ||= []).push(fn);
      },
      removeEventListener(type, fn) {
        windowListeners[type] = (windowListeners[type] || []).filter((f) => f !== fn);
      },
      dispatchEvent(ev) {
        for (const fn of windowListeners[ev.type] || []) fn(ev);
        return true;
      },
      requestAnimationFrame(cb) {
        cb();
        return 1;
      },
    };
    vi.stubGlobal("window", win);
    vi.stubGlobal("document", {
      body,
      createElement() { return fakeEl(); },
      getElementById(id) { return id === "displayContainer" ? display : null; },
    });
    vi.stubGlobal("localStorage", storage);

    const api = installNliExplainerDebug({
      host,
      captionEl: caption,
      registerDisposer() {},
    });
    api.setVisible(true);
    expect(host.style.left).toBe("12%");
    expect(host.style.top).toBe("14%");

    function pointerEv(type, target, extra = {}) {
      return {
        type,
        button: 0,
        clientX: 20,
        clientY: 20,
        target,
        preventDefault() {},
        ...extra,
      };
    }
    host.dispatchEvent(pointerEv("pointerdown", host));
    win.dispatchEvent(pointerEv("pointermove", host, { clientX: 40, clientY: 36 }));
    expect(host.style.left).not.toBe("12%");
    expect(host.style.top).not.toBe("14%");
    const liveLeft = host.style.left;
    const liveTop = host.style.top;
    win.dispatchEvent(pointerEv("pointerup", host));

    const parsed = JSON.parse(storage.getItem(NLI_EXPLAINER_LAYOUT_STORAGE_KEY));
    expect(parsed.left).toEqual(expect.objectContaining({
      leftPct: expect.any(Number),
      topPct: expect.any(Number),
    }));
    expect(parsed.left.leftPct).not.toBe(12);
    expect(parsed.left.topPct).not.toBe(14);
    expect(host.style.left).toBe(liveLeft);
    expect(host.style.top).toBe(liveTop);
    api.dispose();
    vi.unstubAllGlobals();
  });
});
