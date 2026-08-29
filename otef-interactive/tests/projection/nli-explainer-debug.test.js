import { describe, expect, it, vi } from "vitest";
import {
  installNliExplainerDebug,
  isNliExplainerDebugRequestedInUrl,
  moveLayoutByDelta,
  resizeLayoutFromHandle,
  rotateLayoutByDelta,
} from "../../frontend/src/projection/nli-explainer-debug.js";
import { NLI_EXPLAINER_LAYOUT_STORAGE_KEY } from "../../frontend/src/projection/nli-explainer-overlay.js";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

describe("nli explainer debug editor", () => {
  it("url flags", () => {
    expect(isNliExplainerDebugRequestedInUrl("?ned=1")).toBe(true);
    expect(isNliExplainerDebugRequestedInUrl("?nliExplainerDebug=1")).toBe(true);
    expect(isNliExplainerDebugRequestedInUrl("")).toBe(false);
  });

  it("projection-main binds E and help documents it; GIS does not", () => {
    const here = path.dirname(fileURLToPath(import.meta.url));
    const main = fs.readFileSync(path.resolve(here, "../../frontend/src/entries/projection-main.js"), "utf8");
    const gis = fs.readFileSync(path.resolve(here, "../../frontend/src/entries/map-main.js"), "utf8");
    const html = fs.readFileSync(path.resolve(here, "../../frontend/projection.html"), "utf8");
    const debugSrc = fs.readFileSync(path.resolve(here, "../../frontend/src/projection/nli-explainer-debug.js"), "utf8");
    expect(main).toMatch(/key === "e"/);
    expect(main).toMatch(/NliExplainerDebug/);
    expect(html).toMatch(/nli explainer/i);
    expect(html).toMatch(/ned=1/);
    expect(html).toMatch(/nliExplainerLayout=committed/);
    expect(gis).not.toMatch(/NliExplainerDebug/);
    expect(gis).not.toMatch(/key === "e"/);
    expect(main).toMatch(/explainerDebugVisible/);
    expect(main).toMatch(/isVisible/);
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
});
