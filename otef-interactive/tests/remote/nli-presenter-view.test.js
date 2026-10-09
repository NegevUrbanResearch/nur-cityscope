// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createPresenterView } from "../../frontend/src/remote/nli-presenter-view.js";
import presenterContent from "../../frontend/src/remote/nli-presenter-content.json" with { type: "json" };

function makeSnapshot(overrides = {}) {
  const beats = Array.from({ length: 6 }, (_, index) => ({ key: `beat-${index}`, minute: 360 + index * 3, copyKey: `copy-${index}`, copy: { timeLabel: `06:${String(index * 3).padStart(2, "0")}`, title: `Title ${index}`, summary: `Summary ${index}`, details: `Details ${index}` } }));
  return { ready: true, status: "ready", canMutate: true, phase: "playing", appliedKey: beats[0].key, previewMinute: null, error: null, boundaryKey: "scene-a", sceneBoundaryKey: "scene-a", beats, ...overrides };
}
function makeViewFixture({ profileCorpus, getSnapshot } = {}) {
  const root = document.createElement("div"); document.body.append(root);
  const commands = { select: vi.fn(async () => ({ ok: true })), step: vi.fn(async () => ({ ok: true })), toggle: vi.fn(async () => ({ ok: true })) };
  const onRetry = vi.fn(async () => ({ ok: true }));
  const view = createPresenterView({ root, commands, onError: vi.fn(), onRetry, profileCorpus, getSnapshot });
  return { root, commands, view, onRetry, snapshot: makeSnapshot() };
}
beforeEach(() => { document.body.replaceChildren(); });
describe("persistent NLI presenter view", () => {
  it("shows elapsed time on the left and total on the right at the top of the explanation card in both locales", () => {
    const f = makeViewFixture();
    f.view.update(makeSnapshot({ timing: { remainingMs: 31501, durationMs: 40000 } }));
    const timer = f.root.querySelector("[data-presenter-timing]");
    expect([...timer.querySelectorAll("bdi")].map(node => node.textContent)).toEqual(["0:08", "0:40"]);
    expect(timer.textContent).toContain("זמן שעבר");
    expect(timer.textContent).toContain("זמן כולל");
    const progress = timer.querySelector('[role="progressbar"]');
    expect(Number(progress.getAttribute("aria-valuenow"))).toBeCloseTo(8.499);
    expect(progress.getAttribute("aria-valuemax")).toBe("40");
    const current = f.root.querySelector("[data-presenter-current]");
    expect(timer.parentElement).toBe(current);
    expect(current.firstElementChild).toBe(timer);
    expect(timer.nextElementSibling).toBe(f.root.querySelector("[data-presenter-time]"));
    expect(timer.querySelector("bdi").dir).toBe("ltr");
    expect(timer.dir).toBe("ltr");
    f.view.update(makeSnapshot({ locale: "en", phase: "paused", timing: { remainingMs: 31501, durationMs: 40000 } }));
    expect(timer.textContent).toContain("Elapsed time");
    expect(timer.textContent).toContain("Total time");
    expect([...timer.querySelectorAll("bdi")].map(node => node.textContent)).toEqual(["0:08", "0:40"]);
    f.view.update(makeSnapshot({ ready: false }));
    expect(timer.hidden).toBe(true);
    f.view.dispose();
  });

  it("refreshes elapsed seconds without resetting the card or list, and stops when hidden or disposed", () => {
    vi.useFakeTimers();
    const base = Date.now();
    let phase = "playing";
    const getSnapshot = vi.fn(() => makeSnapshot({ phase,
      timing: { durationMs: 40000, remainingMs: 40000 - (Date.now() - base) } }));
    const f = makeViewFixture({ getSnapshot });
    try {
      f.view.update(getSnapshot());
      const timer = f.root.querySelector("[data-presenter-timing]");
      const card = f.root.querySelector("[data-presenter-text]");
      const row = f.root.querySelector("[data-presenter-event]");
      card.scrollTop = 35;
      vi.advanceTimersByTime(1000);
      expect(timer.querySelector("bdi").textContent).toBe("0:01");
      expect(timer.querySelector('[role="progressbar"]').getAttribute("aria-valuenow")).toBe("1");
      expect(card.scrollTop).toBe(35);
      expect(f.root.querySelector("[data-presenter-event]")).toBe(row);
      phase = "paused";
      f.view.update(getSnapshot());
      const pausedText = timer.textContent;
      vi.advanceTimersByTime(2000);
      expect(timer.textContent).toBe(pausedText);
      phase = "playing";
      f.view.update(getSnapshot());
      f.view.setVisible(false);
      getSnapshot.mockClear();
      vi.advanceTimersByTime(2000);
      expect(getSnapshot).not.toHaveBeenCalled();
      f.view.setVisible(true);
      f.view.dispose();
      getSnapshot.mockClear();
      vi.advanceTimersByTime(2000);
      expect(getSnapshot).not.toHaveBeenCalled();
    } finally { f.view.dispose(); vi.useRealTimers(); }
  });

  it("resets progress on replay, follows event jumps, and fills the bar when playback ends", () => {
    const f = makeViewFixture();
    const paint = (remainingMs, phase) => f.view.update(makeSnapshot({ phase,
      timing: { durationMs: 40000, remainingMs } }));
    paint(24000, "paused");
    const timer = f.root.querySelector("[data-presenter-timing]");
    const progress = timer.querySelector('[role="progressbar"]');
    expect(timer.querySelector("bdi").textContent).toBe("0:16");
    expect(progress.firstElementChild.style.width).toBe("40%");
    paint(0, "ended");
    expect([...timer.querySelectorAll("bdi")].map(node => node.textContent)).toEqual(["0:40", "0:40"]);
    expect(progress.firstElementChild.style.width).toBe("100%");
    paint(40000, "playing");
    expect(timer.querySelector("bdi").textContent).toBe("0:00");
    expect(progress.firstElementChild.style.width).toBe("0%");
    f.view.dispose();
  });

  it("centers rows against the scrolling viewport when the list has a nonzero page offset", () => {
    const f = makeViewFixture(); f.view.update(f.snapshot);
    const list = f.root.querySelector("[data-presenter-list]");
    Object.defineProperty(list, "clientHeight", { configurable: true, value: 100 });
    list.getBoundingClientRect = () => ({ top: 600, bottom: 700, height: 100 });
    const rows = [...list.children];
    rows.forEach((row, index) => {
      Object.defineProperty(row, "offsetTop", { configurable: true, value: 1000 + index * 50 });
      Object.defineProperty(row, "offsetHeight", { configurable: true, value: 50 });
      row.getBoundingClientRect = () => ({ top: 600 + index * 50 - list.scrollTop, height: 50 });
    });
    list.scrollTo = vi.fn(({ top }) => { list.scrollTop = top; });
    const rail = f.root.querySelector("[data-presenter-rail]");
    Object.defineProperty(rail, "clientHeight", { configurable: true, value: 240 });
    rail.getBoundingClientRect = () => ({ top: 0, height: 240, bottom: 240 });
    rail.dispatchEvent(new PointerEvent("pointerdown", { pointerId: 40, clientY: 240, bubbles: true }));
    expect(list.scrollTop).toBe(225);
    f.view.dispose();
  });

  it("does not recenter a pointer-focused row before its deliberate click, and keyboard focus only browses", async () => {
    const f = makeViewFixture(); f.view.update(f.snapshot);
    const list = f.root.querySelector("[data-presenter-list]");
    Object.defineProperty(list, "clientHeight", { configurable: true, value: 100 });
    list.getBoundingClientRect = () => ({ top: 600, bottom: 700, height: 100 });
    const target = f.root.querySelector('[data-presenter-event="beat-2"]');
    const row = target.closest("li");
    row.getBoundingClientRect = () => ({ top: 620, bottom: 670, height: 50 });
    list.scrollTo = vi.fn(({ top }) => { list.scrollTop = top; });
    target.dispatchEvent(new PointerEvent("pointerdown", { pointerId: 41, clientY: 640, bubbles: true }));
    target.focus();
    expect(list.scrollTo).not.toHaveBeenCalled();
    expect(row.classList.contains("is-browse")).toBe(true);
    target.dispatchEvent(new PointerEvent("pointerup", { pointerId: 41, clientY: 640, bubbles: true }));
    target.dispatchEvent(new MouseEvent("click", { bubbles: true, detail: 1 }));
    await Promise.resolve(); await Promise.resolve();
    expect(f.commands.select).toHaveBeenCalledTimes(1);
    expect(f.commands.select).toHaveBeenCalledWith("beat-2");

    f.commands.select.mockClear();
    const keyboardTarget = f.root.querySelector('[data-presenter-event="beat-3"]');
    keyboardTarget.focus();
    expect(f.commands.select).not.toHaveBeenCalled();
    expect(f.root.querySelector("[data-presenter-rail]").getAttribute("aria-valuenow")).toBe("3");
    f.view.dispose();
  });

  it("centers the list during rail tapping and dragging, then restores its scroll on cancel without commands", () => {
    const f = makeViewFixture(); f.view.update(f.snapshot);
    const rail = f.root.querySelector("[data-presenter-rail]"); const list = f.root.querySelector("[data-presenter-list]");
    rail.getBoundingClientRect = () => ({ top: 0, height: 240 });
    Object.defineProperty(list, "clientHeight", { value: 80 });
    for (const [index, row] of [...list.children].entries()) {
      Object.defineProperty(row, "offsetTop", { value: index * 50 });
      Object.defineProperty(row, "offsetHeight", { value: 50 });
    }
    list.scrollTop = 23;
    list.scrollTo = vi.fn(({ top }) => { list.scrollTop = top; });
    rail.setPointerCapture = vi.fn();
    rail.dispatchEvent(new PointerEvent("pointerdown", { pointerId: 4, clientY: 220, bubbles: true }));
    expect(rail.getAttribute("aria-valuenow")).toBe("5");
    expect(list.scrollTop).toBe(235);
    rail.dispatchEvent(new PointerEvent("pointermove", { pointerId: 4, clientY: 10, bubbles: true }));
    expect(list.scrollTop).not.toBe(235);
    rail.dispatchEvent(new PointerEvent("pointercancel", { pointerId: 4, bubbles: true }));
    expect(rail.getAttribute("aria-valuenow")).toBe("0");
    expect(list.scrollTop).toBe(23);
    rail.dispatchEvent(new PointerEvent("pointerdown", { pointerId: 5, clientY: 220, bubbles: true }));
    rail.dispatchEvent(new PointerEvent("pointerup", { pointerId: 5, clientY: 220, bubbles: true }));
    expect(rail.getAttribute("aria-valuenow")).toBe("5"); expect(list.scrollTop).toBe(235);
    expect(f.commands.select).not.toHaveBeenCalled(); expect(f.commands.step).not.toHaveBeenCalled(); expect(f.commands.toggle).not.toHaveBeenCalled();
    f.view.dispose();
  });

  it("renders every authored Nova detail inline across the six membership keys and both locales", () => {
    const f = makeViewFixture();
    const targets = Object.entries(presenterContent.records).filter(([key, record]) => {
      const [narrativeId, _membership, minute] = JSON.parse(key);
      return narrativeId === "nova" && [492, 540, 720].includes(minute) && record.he?.details && record.en?.details;
    });
    expect(targets).toHaveLength(6);
    for (const [key, record] of targets) {
      const minute = JSON.parse(key)[2];
      for (const locale of ["he", "en"]) {
        const beat = { key, minute, copy: record[locale] };
        f.view.update(makeSnapshot({ narrativeId: "nova", sceneId: "nova", beats: [beat], appliedKey: key, locale }));
        expect(f.root.querySelector("[data-presenter-title]").textContent).toBe(record[locale].title);
        expect(f.root.querySelector("[data-presenter-summary]").textContent).toBe(record[locale].summary || "");
        expect(f.root.querySelector("[data-presenter-inline-details]").textContent).toBe(record[locale].details);
        expect(f.root.querySelector("[data-presenter-details-trigger]")).toBeNull();
        expect(f.root.querySelector("[role=dialog]")).toBeNull();
        expect(f.root.querySelector("[data-presenter-controls]")).not.toBeNull();
      }
    }
    expect(f.root.querySelector("[data-presenter-rail]").hidden).toBe(true);
    f.view.dispose();
  });

  it("hides the rail on the opening-minutes scene and restores it on the next timeline scene", () => {
    const f = makeViewFixture(); f.view.update(makeSnapshot({ sceneId: "opening-minutes", sceneKey: "timeline:0:7" }));
    const rail = f.root.querySelector("[data-presenter-rail]");
    expect(rail.hidden).toBe(true); expect(f.root.querySelector("[data-presenter-list]").children.length).toBe(6);
    f.view.update(makeSnapshot({ sceneId: "rest-of-day", sceneKey: "timeline:1:7" })); expect(rail.hidden).toBe(false);
    f.view.dispose();
  });

  it.each([
    { sceneId: "opening-minutes", narrativeId: null },
    { sceneId: "nova", narrativeId: "nova" },
  ])("hides Back to now on $sceneId and restores it on the longer timeline", (scene) => {
    const f = makeViewFixture();
    f.view.update(makeSnapshot(scene));
    const now = f.root.querySelector("[data-presenter-now]");
    const footer = now.closest(".nli-presenter-footer");
    const browser = footer.closest(".nli-presenter-browser");
    expect(now.hidden).toBe(true);
    expect(footer.hidden).toBe(true);
    expect(browser.classList.contains("is-no-footer")).toBe(true);
    expect(f.root.querySelector("[data-presenter-play]").disabled).toBe(false);

    f.view.update(makeSnapshot({ sceneId: "rest-of-day", narrativeId: null }));
    expect(now.hidden).toBe(false);
    expect(footer.hidden).toBe(false);
    expect(browser.classList.contains("is-no-footer")).toBe(false);
    f.view.dispose();
  });

  it("marks Back to now while detached and clears the style on return without clock commands", () => {
    const f = makeViewFixture(); f.view.update(f.snapshot);
    const now = f.root.querySelector("[data-presenter-now]");
    f.root.querySelector('[data-presenter-event="beat-2"]').focus();
    expect(now.classList.contains("is-browsing")).toBe(true);
    now.click();
    expect(now.classList.contains("is-browsing")).toBe(false);
    expect(f.commands.select).not.toHaveBeenCalled(); expect(f.commands.step).not.toHaveBeenCalled(); expect(f.commands.toggle).not.toHaveBeenCalled();
    f.view.dispose();
  });

  it("keeps the full inline copy scroll region and controls stable as applied events advance", () => {
    const f = makeViewFixture(); f.view.update(f.snapshot);
    const title = f.root.querySelector("[data-presenter-title]"); const summary = f.root.querySelector("[data-presenter-summary]");
    const controls = f.root.querySelector("[data-presenter-controls]");
    expect(f.root.querySelector("[data-presenter-inline-details]").textContent).toBe("Details 0");
    expect(f.root.querySelector("[data-presenter-inline-details]").parentElement).toBe(f.root.querySelector("[data-presenter-text]"));
    f.view.update({ ...f.snapshot, appliedKey: "beat-1" });
    expect(title.textContent).toBe("Title 1"); expect(summary.textContent).toBe("Summary 1");
    expect(f.root.querySelector("[data-presenter-inline-details]").textContent).toBe("Details 1");
    expect(f.root.querySelector("[data-presenter-controls]")).toBe(controls);
    expect(f.root.querySelector("[role=dialog]")).toBeNull();
    f.view.dispose();
  });

  it("hides Nova rail from layout and accessibility", () => {
    const f = makeViewFixture(); f.view.update(f.snapshot);
    f.view.update({ ...f.snapshot, narrativeId: "nova" });
    const rail = f.root.querySelector("[data-presenter-rail]");
    expect(rail.hidden).toBe(true);
    expect(rail.getAttribute("aria-hidden")).toBe("true");
    expect(f.root.querySelector(".nli-presenter-browse-area").classList.contains("is-no-rail")).toBe(true);
    f.view.dispose();
  });

  it("renders a decorative transport icon beside each localized action label", () => {
    const f = makeViewFixture(); f.view.update({ ...f.snapshot, phase: "paused" });
    const play = f.root.querySelector("[data-presenter-play]");
    expect(play.querySelector("span").textContent).toBe("ניגון");
    expect(play.querySelector("svg").namespaceURI).toBe("http://www.w3.org/2000/svg");
    expect(play.querySelector("svg").getAttribute("viewBox")).toBe("0 0 24 24");
    expect(f.root.querySelector("[data-presenter-now] svg").namespaceURI).toBe("http://www.w3.org/2000/svg");
    expect(play.querySelector("svg").getAttribute("aria-hidden")).toBe("true");
    f.view.update({ ...f.snapshot, phase: "playing" }); expect(play.querySelector("span").textContent).toBe("השהיה");
    f.view.update({ ...f.snapshot, phase: "ended" }); expect(play.querySelector("span").textContent).toBe("ניגון מחדש");
    f.view.dispose();
  });

  it("renders applied and browsed rail markers in separate lanes and combines them in follow mode", () => {
    const f = makeViewFixture(); f.view.update(f.snapshot);
    let applied = f.root.querySelector('[data-marker-key="beat-0"]');
    expect(applied.classList.contains("is-combined")).toBe(true);
    f.root.querySelector('[data-presenter-event="beat-2"]').focus();
    applied = f.root.querySelector('[data-marker-key="beat-0"]');
    const browsed = f.root.querySelector('[data-marker-key="beat-2"]');
    expect(applied.classList.contains("is-combined")).toBe(false);
    expect(applied.style.left).toBe("16px"); expect(browsed.style.left).toBe("30px");
    expect(applied.classList.contains("is-current")).toBe(true); expect(browsed.classList.contains("is-browse")).toBe(true);
    f.view.dispose();
  });

  it("keeps omitted-hour copy off the footer while preserving rail break and endpoint labels", () => {
    const f = makeViewFixture();
    const beats = [389, 400].map((minute, index) => ({ key: `open-${index}`, minute, copy: { timeLabel: `06:${String(minute % 60).padStart(2, "0")}`, title: `Open ${index}`, summary: null, details: null } }));
    const rail = f.root.querySelector("[data-presenter-rail]");
    Object.defineProperty(rail, "clientHeight", { configurable: true, value: 360 });
    f.view.update(makeSnapshot({ beats: [...beats, ...f.snapshot.beats.slice(0, 1).map((beat) => ({ ...beat, key: "later", minute: 19 * 60 + 3 }))], appliedKey: "open-0" }));
    expect(f.root.querySelector("[data-presenter-gap-copy]")).toBeNull();
    expect(rail.querySelectorAll('[data-rail-mark="break"]')).toHaveLength(1);
    expect(rail.getAttribute("aria-label")).toContain("07–18: אין אירועים בציר");
    const single = [389, 400].map((minute, index) => ({ key: `minute-${index}`, minute, copy: { timeLabel: `06:${String(minute % 60).padStart(2, "0")}`, title: `Minute ${index}`, summary: null, details: null } }));
    f.view.update(makeSnapshot({ beats: single, appliedKey: single[0].key }));
    Object.defineProperty(rail, "clientHeight", { configurable: true, value: 180 });
    f.view.update(makeSnapshot({ beats: single, appliedKey: single[0].key }));
    const labels = [...rail.querySelectorAll(".nli-presenter-rail-label")].map((node) => node.textContent);
    expect(rail.querySelector(".nli-presenter-browse-label").textContent).toBe("06:29");
    expect(labels).toContain("06:40"); expect(labels).not.toContain("06");
    f.view.dispose();
  });

  it("retains browse focus across playback advances and returns focus to Play on scene change", () => {
    const f = makeViewFixture(); f.view.update(f.snapshot);
    const play = f.root.querySelector("[data-presenter-play]");
    const rail = f.root.querySelector("[data-presenter-rail]"); rail.focus();
    f.view.update({ ...f.snapshot, appliedKey: "beat-2" }); expect(document.activeElement).toBe(rail);
    const row = f.root.querySelector('[data-presenter-event="beat-3"]'); row.focus();
    f.view.update({ ...f.snapshot, appliedKey: "beat-4" }); expect(document.activeElement).toBe(row);
    f.root.querySelector("[data-presenter-text]").focus();
    f.view.update({ ...f.snapshot, boundaryKey: "scene-b" }); expect(document.activeElement).toBe(play);
    f.view.dispose();
  });

  it("renders occupied-hour and quarter ticks, gap marks, and model label lanes", () => {
    const f = makeViewFixture();
    const beats = [361, 395, 421, 481, 782, 1197].map((minute, index) => ({ key: `event-${index}`, minute, copy: { timeLabel: `${String(Math.floor(minute / 60)).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`, title: `Event ${index}`, summary: null, details: null } }));
    f.view.update(makeSnapshot({ beats, appliedKey: beats[0].key }));
    const rail = f.root.querySelector("[data-presenter-rail]");
    Object.defineProperty(rail, "clientHeight", { value: 360 });
    f.view.update(makeSnapshot({ beats, appliedKey: beats[0].key }));
    expect(rail.querySelectorAll('[data-rail-mark="hour"]')).toHaveLength(5);
    expect(rail.querySelectorAll('[data-rail-mark="quarter"]').length).toBeGreaterThan(0);
    expect(rail.querySelectorAll('[data-rail-mark="break"]')).toHaveLength(2);
    expect([...rail.querySelectorAll(".nli-presenter-rail-label")].map((node) => node.textContent)).toContain("07");
    expect(rail.querySelector('[data-rail-lane="browse"]')).not.toBeNull();
    f.view.dispose();
  });
  it("hiding cancels rail capture and suppresses an in-progress list tap", async () => {
    const f = makeViewFixture(); f.view.update(f.snapshot);
    const rail = f.root.querySelector("[data-presenter-rail]");
    rail.getBoundingClientRect = () => ({ top: 0, height: 240, bottom: 240, left: 0, right: 48, width: 48 });
    rail.setPointerCapture = vi.fn(); rail.releasePointerCapture = vi.fn();
    rail.dispatchEvent(new PointerEvent("pointerdown", { pointerId: 8, clientY: 220, bubbles: true }));
    const row = f.root.querySelector('[data-presenter-event="beat-2"]');
    row.dispatchEvent(new PointerEvent("pointerdown", { pointerId: 9, clientY: 8, bubbles: true }));
    f.view.setVisible(false);
    expect(rail.releasePointerCapture).toHaveBeenCalledWith(8);
    f.view.setVisible(true);
    row.dispatchEvent(new MouseEvent("click", { bubbles: true, detail: 1 }));
    await Promise.resolve();
    expect(f.commands.select).not.toHaveBeenCalled();
    f.view.dispose();
  });

  it("a new boundary releases rail capture and discards its prior browse gesture", () => {
    const f = makeViewFixture(); f.view.update(f.snapshot);
    const rail = f.root.querySelector("[data-presenter-rail]");
    rail.getBoundingClientRect = () => ({ top: 0, height: 240, bottom: 240, left: 0, right: 48, width: 48 });
    rail.setPointerCapture = vi.fn(); rail.releasePointerCapture = vi.fn();
    rail.dispatchEvent(new PointerEvent("pointerdown", { pointerId: 12, clientY: 220, bubbles: true }));
    f.view.update(makeSnapshot({ boundaryKey: "scene-b", appliedKey: "beat-0" }));
    expect(rail.releasePointerCapture).toHaveBeenCalledWith(12);
    expect(rail.getAttribute("aria-valuenow")).toBe("0");
    f.view.dispose();
  });
  it("keeps event nodes and browse scroll while playback advances", () => {
    const f = makeViewFixture(); f.view.update(f.snapshot);
    const list = f.root.querySelector("[data-presenter-list]"); const row = list.querySelector("button");
    list.dispatchEvent(new WheelEvent("wheel", { deltaY: 100, bubbles: true })); list.scrollTop = 120; list.dispatchEvent(new Event("scroll"));
    f.view.update({ ...f.snapshot, appliedKey: f.snapshot.beats[2].key });
    expect(list.querySelector("button")).toBe(row); expect(list.scrollTop).toBe(120);
    expect(f.commands.select).not.toHaveBeenCalled(); expect(f.commands.toggle).not.toHaveBeenCalled(); f.view.dispose();
  });
  it("localizes accessible names and renders GIS text literally", () => {
    const f = makeViewFixture(); const malicious = '<img src=x onerror="alert(1)">';
    f.view.update(makeSnapshot({ locale: "en", beats: [{ ...f.snapshot.beats[0], copy: { ...f.snapshot.beats[0].copy, title: malicious } }] }));
    expect(f.root.querySelector(".nli-presenter").getAttribute("aria-label")).toBe("Presenter timeline");
    expect(f.root.querySelector("[data-presenter-rail]").getAttribute("aria-label")).toBe("Browse events by hour");
    expect(f.root.querySelector("[data-presenter-title]").textContent).toBe(malicious); expect(f.root.querySelector("img")).toBeNull(); f.view.dispose();
  });
  it("browses from rail without commands and restores browse state on cancellation", () => {
    const f = makeViewFixture(); f.view.update(f.snapshot); const rail = f.root.querySelector("[data-presenter-rail]");
    rail.getBoundingClientRect = () => ({ top: 0, height: 240, bottom: 240, left: 0, right: 48, width: 48 }); rail.setPointerCapture = vi.fn();
    rail.dispatchEvent(new PointerEvent("pointerdown", { pointerId: 4, clientY: 220, bubbles: true }));
    const browsed = rail.getAttribute("aria-valuetext"); rail.dispatchEvent(new PointerEvent("pointercancel", { pointerId: 4, bubbles: true }));
    expect(rail.getAttribute("aria-valuetext")).not.toBe(browsed); expect(f.commands.select).not.toHaveBeenCalled(); f.view.dispose();
  });
});
  it("allows browsing while disconnected but applies only an explicit activation", async () => {
    const f = makeViewFixture(); f.view.update(makeSnapshot({ canMutate: false }));
    const row = f.root.querySelector('[data-presenter-event="beat-2"]');
    row.focus();
    expect(f.commands.select).not.toHaveBeenCalled();
    row.dispatchEvent(new MouseEvent("click", { bubbles: true, detail: 0 }));
    await Promise.resolve(); await Promise.resolve();
    expect(f.commands.select).not.toHaveBeenCalled();
    f.view.update(f.snapshot);
    row.dispatchEvent(new MouseEvent("click", { bubbles: true, detail: 0 }));
    await Promise.resolve(); await Promise.resolve();
    expect(f.commands.select).toHaveBeenCalledWith("beat-2");
    f.view.dispose();
  });

  it("cancels a drag before the following click and permits a later deliberate tap", async () => {
    const f = makeViewFixture(); f.view.update(f.snapshot);
    const button = f.root.querySelector('[data-presenter-event="beat-2"]');
    button.dispatchEvent(new PointerEvent("pointerdown", { pointerId: 2, clientY: 8, bubbles: true }));
    button.dispatchEvent(new PointerEvent("pointermove", { pointerId: 2, clientY: 30, bubbles: true }));
    f.root.querySelector("[data-presenter-text]").dispatchEvent(new PointerEvent("pointerup", { pointerId: 2, clientY: 30, bubbles: true }));
    button.dispatchEvent(new MouseEvent("click", { bubbles: true, detail: 1 }));
    expect(f.commands.select).not.toHaveBeenCalled();
    button.dispatchEvent(new MouseEvent("click", { bubbles: true, detail: 1 }));
    await Promise.resolve(); await Promise.resolve();
    expect(f.commands.select).toHaveBeenCalledTimes(1); f.view.dispose();
  });

  it("keeps the applied event on a rejected selection and exposes a retry without toggling playback", async () => {
    const f = makeViewFixture(); f.commands.select.mockResolvedValue({ ok: false, error: "rejected" });
    f.view.update(f.snapshot);
    f.root.querySelector('[data-presenter-event="beat-1"]').dispatchEvent(new MouseEvent("click", { bubbles: true, detail: 0 }));
    await Promise.resolve(); await Promise.resolve();
    expect(f.root.querySelector("[data-presenter-time]").textContent).toBe("06:00");
    expect(f.root.querySelector("[data-presenter-retry]").hidden).toBe(false);
    expect(f.commands.toggle).not.toHaveBeenCalled(); f.view.dispose();
  });


  it("keeps the focused browse row and its scroll position as playback advances", () => {
    const f = makeViewFixture(); f.view.update(f.snapshot);
    const list = f.root.querySelector("[data-presenter-list]"); const row = f.root.querySelector('[data-presenter-event="beat-3"]');
    row.focus(); list.scrollTop = 111;
    f.view.update({ ...f.snapshot, appliedKey: "beat-2" });
    expect(document.activeElement).toBe(row); expect(list.scrollTop).toBe(111); f.view.dispose();
  });

  it("updates Hebrew accessible labels and keeps rail physically left-to-right", () => {
    const f = makeViewFixture(); f.view.update(makeSnapshot({ locale: "he" }));
    expect(f.root.querySelector(".nli-presenter").getAttribute("aria-label")).toBe("ציר זמן למנחה");
    expect(f.root.querySelector("[data-presenter-rail]").getAttribute("aria-label")).toBe("עיון באירועים לפי שעה");
    expect(f.root.querySelector("[data-presenter-list]").dir).toBe("rtl"); f.view.dispose();
  });

  it("lets retry clear a local error without issuing clock commands", async () => {
    const f = makeViewFixture(); f.view.update(f.snapshot); f.view.setError("temporary failure");
    f.root.querySelector("[data-presenter-retry]").click(); await Promise.resolve(); await Promise.resolve();
    expect(f.root.querySelector("[data-presenter-retry]").hidden).toBe(true);
    expect(f.commands.select).not.toHaveBeenCalled(); expect(f.commands.step).not.toHaveBeenCalled(); expect(f.commands.toggle).not.toHaveBeenCalled();
    expect(f.onRetry).toHaveBeenCalledTimes(1); f.view.dispose();
  });

  it("uses a uniform enlarged text profile", () => {
    const f = makeViewFixture(); f.view.update(makeSnapshot({ textScale: 1.5 }));
    expect(f.root.querySelector(".nli-presenter").style.getPropertyValue("--presenter-text-scale")).toBe("1.5");
    expect(Number.parseFloat(f.root.querySelector(".nli-presenter").style.getPropertyValue("--presenter-row-height"))).toBeGreaterThan(48);
    f.view.dispose();
  });

  it("does not turn programmatic follow centering into browse mode", () => {
    const f = makeViewFixture(); f.view.update(f.snapshot);
    const list = f.root.querySelector("[data-presenter-list]"); list.scrollTop = 72; list.dispatchEvent(new Event("scroll"));
    f.view.update({ ...f.snapshot, appliedKey: "beat-1" });
    expect(f.root.querySelector("[data-presenter-rail]").getAttribute("aria-valuenow")).toBe("1");
    expect(f.commands.select).not.toHaveBeenCalled(); f.view.dispose();
  });

  it("browses with rail keyboard keys without applying an event", () => {
    const f = makeViewFixture(); f.view.update(f.snapshot); const rail = f.root.querySelector("[data-presenter-rail]");
    rail.dispatchEvent(new KeyboardEvent("keydown", { key: "End", bubbles: true, cancelable: true }));
    expect(rail.getAttribute("aria-valuenow")).toBe("5");
    expect(f.commands.select).not.toHaveBeenCalled(); expect(f.commands.toggle).not.toHaveBeenCalled(); f.view.dispose();
  });

  it("hides the inline paragraph when no optional details copy exists", () => {
    const f = makeViewFixture(); const beat = { ...f.snapshot.beats[0], copy: { ...f.snapshot.beats[0].copy, details: null } };
    f.view.update(makeSnapshot({ beats: [beat], appliedKey: beat.key }));
    expect(f.root.querySelector("[data-presenter-inline-details]").hidden).toBe(true); f.view.dispose();
  });

  it("does not carry captions or detail controls across an unverified boundary", () => {
    const f = makeViewFixture(); f.view.update(f.snapshot);
    f.view.update(makeSnapshot({ boundaryKey: "scene-b", locale: "en", beats: [], appliedKey: null, ready: false, canMutate: false, error: "Not ready" }));
    expect(f.root.querySelector("[data-presenter-title]").textContent).toBe("Timeline unavailable");
    expect(f.root.querySelector("[data-presenter-inline-details]").hidden).toBe(true);
    const rail = f.root.querySelector("[data-presenter-rail]");
    expect(rail.getAttribute("aria-disabled")).toBe("true"); expect(rail.hasAttribute("aria-valuenow")).toBe(false); f.view.dispose();
  });

it("clears the previous event time when a new boundary is unverified", () => {
  const f = makeViewFixture(); f.view.update(f.snapshot);
  f.view.update(makeSnapshot({ boundaryKey: "scene-b", locale: "en", beats: [], appliedKey: null, ready: false, canMutate: false, error: "Not ready" }));
  expect(f.root.querySelector("[data-presenter-time]").textContent).toBe("");
  expect(f.root.querySelector("[data-presenter-title]").textContent).toBe("Timeline unavailable"); f.view.dispose();
});

it("cancels pointer activation when list scrolling starts after the last pointermove", () => {
  const f = makeViewFixture(); f.view.update(f.snapshot); const list = f.root.querySelector("[data-presenter-list]");
  const button = f.root.querySelector('[data-presenter-event="beat-2"]');
  button.dispatchEvent(new PointerEvent("pointerdown", { pointerId: 10, clientY: 5, bubbles: true }));
  list.scrollTop = 50; list.dispatchEvent(new Event("scroll"));
  button.dispatchEvent(new PointerEvent("pointerup", { pointerId: 10, clientY: 5, bubbles: true }));
  button.dispatchEvent(new MouseEvent("click", { bubbles: true, detail: 1 }));
  expect(f.commands.select).not.toHaveBeenCalled(); f.view.dispose();
});

it("cancels a tap used to stop list inertia", () => {
  const f = makeViewFixture(); f.view.update(f.snapshot); const list = f.root.querySelector("[data-presenter-list]");
  list.dispatchEvent(new WheelEvent("wheel", { deltaY: 20, bubbles: true }));
  const button = f.root.querySelector('[data-presenter-event="beat-2"]');
  button.dispatchEvent(new PointerEvent("pointerdown", { pointerId: 11, clientY: 5, bubbles: true }));
  button.dispatchEvent(new PointerEvent("pointerup", { pointerId: 11, clientY: 5, bubbles: true }));
  button.dispatchEvent(new MouseEvent("click", { bubbles: true, detail: 1 }));
  expect(f.commands.select).not.toHaveBeenCalled(); f.view.dispose();
});

it.each([
  [{ ready: false, error: "still loading" }, "still loading"],
  [{ ok: false, error: "retry rejected" }, "retry rejected"],
])("keeps retryable error when retry result is not ready: %o", async (result, message) => {
  const f = makeViewFixture(); f.onRetry.mockResolvedValue(result); f.view.update(f.snapshot); f.view.setError("old failure");
  f.root.querySelector("[data-presenter-retry]").click(); await Promise.resolve(); await Promise.resolve();
  expect(f.root.querySelector("[data-presenter-retry]").hidden).toBe(false);
  expect(f.root.querySelector("[data-presenter-summary]").textContent).toBe(message); f.view.dispose();
});

it("lets the snapshot Hebrew locale override an English document locale", () => {
  document.documentElement.lang = "en";
  const f = makeViewFixture(); f.view.update(makeSnapshot({ locale: "he" }));
  expect(f.root.querySelector(".nli-presenter").getAttribute("aria-label")).toBe("ציר זמן למנחה"); f.view.dispose();
});

it("keeps row height uniform across event title lengths in one profile", () => {
  const f = makeViewFixture(); Object.defineProperty(f.root, "clientWidth", { configurable: true, value: 360 });
  const long = "A complete event title that uses several wrapped lines at enlarged text sizes";
  f.view.update(makeSnapshot({ textScale: 1.5, beats: f.snapshot.beats.map((beat, index) => ({ ...beat, copy: { ...beat.copy, title: index ? "Short" : long } })) }));
  const presenter = f.root.querySelector(".nli-presenter");
  expect(presenter.style.getPropertyValue("--presenter-title-lines")).toBeTruthy();
  const profileHeight = presenter.style.getPropertyValue("--presenter-row-height");
  f.view.update(makeSnapshot({ textScale: 1.5, beats: f.snapshot.beats.map((beat) => ({ ...beat, copy: { ...beat.copy, title: "A different title" } })) }));
  expect(presenter.style.getPropertyValue("--presenter-row-height")).toBe(profileHeight);
  const css = readFileSync("frontend/css/nli-presenter.css", "utf8");
  expect(css).toContain(".nli-presenter-list li { box-sizing:border-box;min-height:var(--presenter-row-height);height:var(--presenter-row-height);padding-block:4px; }");
  expect(css).toContain("overflow-wrap:anywhere");
  f.view.dispose();
});

it("reprofiles when the effective root rem changes without double scaling", () => {
  let remPx = 16; const observers = [];
  class ResizeObserverMock { constructor(callback) { this.callback = callback; this.targets = []; observers.push(this); } observe(target) { this.targets.push(target); } disconnect() {} }
  vi.stubGlobal("ResizeObserver", ResizeObserverMock);
  vi.stubGlobal("getComputedStyle", (target) => ({ fontSize: `${remPx}px`, getPropertyValue: (name) => target.style?.getPropertyValue(name) || "" }));
  try {
    const f = makeViewFixture(); f.view.update(makeSnapshot({ textScale: 1.5 }));
    const presenter = f.root.querySelector(".nli-presenter"); const probe = presenter.querySelector(".nli-presenter-rem-probe");
    expect(observers[0].targets).toContain(probe);
    const oldRowHeight = Number.parseFloat(presenter.style.getPropertyValue("--presenter-row-height"));
    remPx = 24; observers[0].callback([{ target: probe, contentRect: { width: 1, height: 24 } }]);
    expect(presenter.style.getPropertyValue("--presenter-text-scale")).toBe("1");
    expect(Number.parseFloat(presenter.style.getPropertyValue("--presenter-row-height"))).toBeGreaterThan(oldRowHeight);
    f.view.dispose();
  } finally { vi.unstubAllGlobals(); }
});

it("cancels a drag that returns to its start coordinate before pointerup", () => {
  const f = makeViewFixture(); f.view.update(f.snapshot); const list = f.root.querySelector("[data-presenter-list]");
  const button = f.root.querySelector('[data-presenter-event="beat-2"]');
  button.dispatchEvent(new PointerEvent("pointerdown", { pointerId: 20, clientY: 10, bubbles: true }));
  document.dispatchEvent(new PointerEvent("pointermove", { pointerId: 20, clientY: 30, bubbles: true }));
  document.dispatchEvent(new PointerEvent("pointerup", { pointerId: 20, clientY: 10, bubbles: true }));
  button.dispatchEvent(new MouseEvent("click", { bubbles: true, detail: 1 }));
  expect(f.commands.select).not.toHaveBeenCalled(); f.view.dispose();
});

it("cancels activation after stationary list pointer capture loss", () => {
  const f = makeViewFixture(); f.view.update(f.snapshot);
  const button = f.root.querySelector('[data-presenter-event="beat-2"]');
  button.dispatchEvent(new PointerEvent("pointerdown", { pointerId: 21, clientY: 10, bubbles: true }));
  button.dispatchEvent(new Event("lostpointercapture", { bubbles: true }));
  button.dispatchEvent(new MouseEvent("click", { bubbles: true, detail: 1 }));
  expect(f.commands.select).not.toHaveBeenCalled(); f.view.dispose();
});

it("profiles the complete bilingual corpus before short-to-long and locale updates", () => {
  const longHe = "כותרת אירוע בעברית ארוכה שמכילה מילים רבות כדי לבדוק עטיפה מלאה בלי קיצור או גלישה מהשורה";
  const longEn = "A complete English event title with enough words to wrap across many lines at a narrow enlarged text profile";
  const profileCorpus = { records: { synthetic: { he: { title: longHe }, en: { title: longEn } } } };
  const f = makeViewFixture({ profileCorpus }); Object.defineProperty(f.root, "clientWidth", { configurable: true, value: 280 });
  const shortBeats = f.snapshot.beats.map((beat) => ({ ...beat, copy: { ...beat.copy, title: "קצר" } }));
  f.view.update(makeSnapshot({ locale: "he", textScale: 2, beats: shortBeats }));
  const profile = f.root.querySelector(".nli-presenter"); const shortHeight = Number.parseFloat(profile.style.getPropertyValue("--presenter-row-height"));
  const shortLines = Number(profile.style.getPropertyValue("--presenter-title-lines"));
  const fallbackTitleWidth = 280 - 48 - (32 * 4) - 14;
  const expectedLongestLines = Math.ceil(Math.max(Array.from(longHe).length, Array.from(longEn).length) / (fallbackTitleWidth / (32 * 0.55)));
  expect(shortLines).toBeGreaterThanOrEqual(expectedLongestLines);
  f.view.update(makeSnapshot({ locale: "he", textScale: 2, beats: f.snapshot.beats.map((beat) => ({ ...beat, copy: { ...beat.copy, title: longHe } })) }));
  const longHeight = Number.parseFloat(profile.style.getPropertyValue("--presenter-row-height"));
  f.view.update(makeSnapshot({ locale: "en", textScale: 2, beats: f.snapshot.beats.map((beat) => ({ ...beat, copy: { ...beat.copy, title: longEn } })) }));
  expect(longHeight).toBe(shortHeight);
  expect(Number.parseFloat(profile.style.getPropertyValue("--presenter-row-height"))).toBe(shortHeight);
  const css = readFileSync("frontend/css/nli-presenter.css", "utf8");
  expect(css).toContain("height:calc(var(--presenter-row-height) - 8px)");
  expect(css).toContain("flex:0 0 3.5em;width:3.5em");
  expect(css).toContain("overflow-wrap:anywhere");
  expect(css).not.toMatch(/text-overflow\s*:\s*ellipsis|line-clamp\s*:/i);
  f.view.dispose();
});

it("uses the full compact title width and reserves three lines before locale changes", () => {
  const oldWidth = window.innerWidth; const oldHeight = window.innerHeight;
  Object.defineProperty(window, "innerWidth", { configurable: true, value: 320 });
  Object.defineProperty(window, "innerHeight", { configurable: true, value: 480 });
  const longHe = "כותרת מלאה בעברית המייצגת כותרת אירוע ארוכה במיוחד במסגרת קומפקטית";
  const longEn = "A complete English title with enough words to occupy several wrapped lines in a narrow compact event row";
  const f = makeViewFixture({ profileCorpus: { records: { synthetic: { he: { title: longHe }, en: { title: longEn } } } } });
  Object.defineProperty(f.root, "clientWidth", { configurable: true, value: 320 });
  Object.defineProperty(f.root, "clientHeight", { configurable: true, value: 480 });
  const row = (title) => f.snapshot.beats.map((beat) => ({ ...beat, copy: { ...beat.copy, title } }));
  try {
    f.view.update(makeSnapshot({ locale: "he", textScale: 2, beats: row("קצר") }));
    const presenter = f.root.querySelector(".nli-presenter");
    const lines = Number(presenter.style.getPropertyValue("--presenter-title-lines"));
    const rowHeight = presenter.style.getPropertyValue("--presenter-row-height");
    const fullWidth = 320 - 48 - 14;
    const expectedLines = Math.max(3, Math.ceil(Math.max(Array.from(longHe).length, Array.from(longEn).length) / (fullWidth / (32 * 0.55))));
    expect(lines).toBe(expectedLines);
    f.view.update(makeSnapshot({ locale: "he", textScale: 2, beats: row(longHe) }));
    f.view.update(makeSnapshot({ locale: "en", textScale: 2, beats: row(longEn) }));
    expect(presenter.style.getPropertyValue("--presenter-row-height")).toBe(rowHeight);
    expect(presenter.style.getPropertyValue("--presenter-title-lines")).toBe(String(lines));
  } finally {
    f.view.dispose();
    Object.defineProperty(window, "innerWidth", { configurable: true, value: oldWidth });
    Object.defineProperty(window, "innerHeight", { configurable: true, value: oldHeight });
  }
});

it("measures the bilingual title inventory once for a stable profile", () => {
  const f = makeViewFixture({ profileCorpus: { records: { a: { he: { title: "עברית" }, en: { title: "English" } }, b: { he: { title: "עברית" }, en: { title: "Other" } } } } });
  const probe = f.root.querySelector(".nli-presenter-title-probe");
  probe.getBoundingClientRect = vi.fn(() => ({ height: 0 }));
  f.view.update(f.snapshot);
  expect(probe.getBoundingClientRect).toHaveBeenCalledTimes(3);
  f.view.update({ ...f.snapshot, appliedKey: "beat-1" });
  expect(probe.getBoundingClientRect).toHaveBeenCalledTimes(3);
  f.view.dispose();
});

it("remeasures titles after font readiness and late loads even when font status stays loaded", async () => {
  let resolveReady; let titleHeight = 20;
  const listeners = new Map();
  const fontSet = {
    status: "loaded",
    ready: new Promise((resolve) => { resolveReady = resolve; }),
    addEventListener: vi.fn((type, callback) => listeners.set(type, callback)),
    removeEventListener: vi.fn((type, callback) => { if (listeners.get(type) === callback) listeners.delete(type); }),
  };
  Object.defineProperty(document, "fonts", { configurable: true, value: fontSet });
  const f = makeViewFixture({ profileCorpus: { records: { a: { he: { title: "כותרת" }, en: { title: "Title" } } } } });
  const probe = f.root.querySelector(".nli-presenter-title-probe");
  probe.getBoundingClientRect = vi.fn(() => ({ height: titleHeight }));
  try {
    f.view.update(f.snapshot);
    const profile = f.root.querySelector(".nli-presenter");
    const initialLines = Number(profile.style.getPropertyValue("--presenter-title-lines"));
    expect(probe.getBoundingClientRect).toHaveBeenCalledTimes(2);

    titleHeight = 80;
    resolveReady();
    await Promise.resolve(); await Promise.resolve();
    const readyLines = Number(profile.style.getPropertyValue("--presenter-title-lines"));
    expect(probe.getBoundingClientRect).toHaveBeenCalledTimes(4);
    expect(readyLines).toBeGreaterThan(initialLines);

    titleHeight = 120;
    listeners.get("loadingdone")?.();
    const lateLoadLines = Number(profile.style.getPropertyValue("--presenter-title-lines"));
    expect(probe.getBoundingClientRect).toHaveBeenCalledTimes(6);
    expect(lateLoadLines).toBeGreaterThan(readyLines);
    expect(fontSet.addEventListener).toHaveBeenCalledWith("loadingdone", expect.any(Function));
  } finally {
    f.view.dispose();
    delete document.fonts;
  }
  expect(fontSet.removeEventListener).toHaveBeenCalledWith("loadingdone", expect.any(Function));
});
