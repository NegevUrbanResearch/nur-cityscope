/**
 * @vitest-environment jsdom
 */
import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import { COPY, NARRATIVES } from "../../frontend/src/remote/nli-staff-script.js";

const page = readFileSync("frontend/nli-staff-remote.html", "utf8");
const remoteSource = readFileSync("frontend/src/remote/nli-staff-remote.js", "utf8");

function queryBlock(source, start, end) {
  const from = source.indexOf(start);
  const to = end ? source.indexOf(end, from + start.length) : source.length;
  return source.slice(from, to);
}

function titles(root, selector) {
  return [...root.querySelectorAll(selector)].map((node) => node.textContent);
}

describe("NLI staff home renderer", () => {
  test("renders four tracks, title-only cards, and the unchanged Free card in Hebrew and English", async () => {
    const { homeListHtml } = await import("../../frontend/src/remote/nli-staff-home.js");
    document.body.innerHTML = `<div id="narrativeList">${homeListHtml({ locale: "he", pending: false })}</div>`;
    const root = document.getElementById("narrativeList");
    expect([...root.children].map((node) => node.className)).toEqual([
      "home-lead",
      "nav-row",
      "home-names",
      "nav-card nav-card--quiet",
    ]);

    const lead = [...root.querySelector(".home-lead").children];
    expect(lead.map((button) => button.dataset.open)).toEqual(["show", "timeline"]);
    expect(titles(root.querySelector(".home-lead"), ".nav-card-title")).toEqual([
      "רצף ההקרנה המלא",
      "ציר הזמן",
    ]);
    expect(root.querySelector(".home-lead .nav-card-meta")).toBeNull();

    const narratives = [...root.querySelector(".nav-row").children];
    expect(narratives.map((button) => button.dataset.open)).toEqual(NARRATIVES.map((item) => item.id));
    expect(narratives).toHaveLength(5);
    expect(titles(root.querySelector(".nav-row"), ".nav-card-title")).toEqual([
      "משפחת שגב",
      "נובה ומור לוי",
      "שדרות",
      "מחנה שורה",
      "חיים פרי וחטופים",
    ]);
    expect(titles(root.querySelector(".nav-row"), ".nav-card-index")).toEqual(["01", "02", "03", "04", "05"]);
    expect(root.querySelector(".nav-row .nav-card-meta")).toBeNull();

    const names = [...root.querySelector(".home-names").children];
    expect(names.map((button) => button.dataset.showStep)).toEqual(["identity-database", "names-wall"]);
    expect(titles(root.querySelector(".home-names"), ".nav-card-title")).toEqual(["מאגר הזהויות", "קיר השמות"]);
    expect(root.querySelector(".home-names .nav-card-meta")).toBeNull();
    expect(root.querySelector("h2, h3")).toBeNull();

    const free = root.querySelector("[data-open-free]");
    expect(free.querySelector(".nav-card-title").textContent).toBe("שליטה חופשית");
    expect(free.querySelector(".nav-card-meta").textContent).toBe("סצנות מוכנות ושכבות");
    expect([...root.querySelectorAll("button")].some((button) => button.disabled)).toBe(false);

    document.body.innerHTML = `<div id="narrativeList">${homeListHtml({ locale: "en", pending: true })}</div>`;
    const english = document.getElementById("narrativeList");
    expect(titles(english.querySelector(".home-lead"), ".nav-card-title")).toEqual([
      "Full projection sequence",
      "The timeline",
    ]);
    expect(titles(english.querySelector(".nav-row"), ".nav-card-title")).toEqual([
      "Segev family",
      "Nova and Mor Levy",
      "Sderot",
      "Shura Camp",
      "Haim Peri and hostages",
    ]);
    expect(titles(english.querySelector(".home-names"), ".nav-card-title")).toEqual([
      "Identity database",
      "Names wall",
    ]);
    expect(english.querySelector("[data-open-free] .nav-card-title").textContent).toBe("Free control");
    expect(english.querySelector("[data-open-free] .nav-card-meta").textContent).toBe("Preset scenes and layers");
    expect([...english.querySelectorAll("button")].every((button) => button.disabled)).toBe(true);
    expect(english.querySelector("[data-open='show']").getAttribute("data-open")).toBe("show");
    expect(english.querySelector("[data-open='timeline']").getAttribute("data-open")).toBe("timeline");
    expect(english.querySelector("[data-open-free]").getAttribute("data-open-free")).toBe("1");
  });

  test("drops GIS, model, idle copy, names headings, and branch metadata", () => {
    expect(page).not.toContain('id="stepGis"');
    expect(page).not.toContain('id="stepModel"');
    expect(page).not.toContain('id="kitIdle"');
    expect(page).not.toContain('class="screens"');
    expect(remoteSource).not.toMatch(/stepGis|stepModel|kitIdle|namesHomeTitle|branch-btn-meta/);
    expect(COPY.he).not.toHaveProperty("kitIdle");
    expect(COPY.en).not.toHaveProperty("kitIdle");
    expect(COPY.he).not.toHaveProperty("gisLabel");
    expect(COPY.en).not.toHaveProperty("modelLabel");
    expect(COPY.he).not.toHaveProperty("namesHomeTitle");
    expect(COPY.en).not.toHaveProperty("namesHomeMeta");
    expect(COPY.he.freeTitle).toBe("שליטה חופשית");
    expect(COPY.en.freeMeta).toBe("Preset scenes and layers");
  });

  test("tablet presentation controls grow without changing the dock tap size, and notes stay clamped", () => {
    const portrait = queryBlock(page, "@media (min-width: 720px) and (min-height: 1000px)", "@media (min-width: 1000px)");
    const landscape = queryBlock(page, "@media (min-width: 1000px) and (max-height: 900px)", "@media (max-height: 700px)");
    const phone = queryBlock(page, "@media (max-width: 599px)", "@media (min-width: 600px)");
    for (const block of [portrait, landscape]) {
      expect(block).toContain("min-height: 72px");
      expect(block).toContain("min-height: 56px");
      expect(block).toContain("gap: 32px");
      expect(block).toContain("margin-top: 32px");
      expect(block).toContain("margin-bottom: 32px");
      expect(block).toContain("justify-content: flex-start");
      expect(block).toContain("width: 100%");
      expect(block).not.toContain("-webkit-line-clamp: unset");
      expect(block).not.toContain("overflow: visible");
    }
    expect(portrait).toContain("--tap: 60px");
    expect(landscape).toContain("--tap: 54px");
    expect(page).toContain("--tap: clamp(44px, 6.4vh, 56px)");
    expect(page).toContain('-webkit-line-clamp: 2');
    expect(page).toContain("-webkit-box-orient: vertical");
    expect(landscape).toContain('"top kit"');
    expect(landscape).toContain('". kit"');
    expect(landscape).not.toContain("screens");
    expect(page).not.toContain(".screens");
    expect(phone).toContain("grid-template-columns: minmax(0, 1fr)");
    expect(page).toContain("grid-template-columns: repeat(2, minmax(0, 1fr))");
    expect(page).not.toContain("minmax(0, 0.8fr) minmax(0, 1.2fr)");
  });
});
