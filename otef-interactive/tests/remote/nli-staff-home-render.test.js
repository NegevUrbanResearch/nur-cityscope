/**
 * @vitest-environment jsdom
 */
import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import { COPY, NARRATIVES } from "../../frontend/src/remote/nli-staff-script.js";

const page = readFileSync("frontend/nli-staff-remote.html", "utf8");
const remoteSource = readFileSync("frontend/src/remote/nli-staff-remote.js", "utf8");

function titles(root, selector) {
  return [...root.querySelectorAll(selector)].map((node) => node.textContent);
}

describe("NLI staff home renderer", () => {
  test("renders the lead pair, complete narrative cards, and the quiet shortcut pair", async () => {
    const { homeListHtml } = await import("../../frontend/src/remote/nli-staff-home.js");
    document.body.innerHTML = `<div id="narrativeList">${homeListHtml({ locale: "he", pending: false })}</div>`;
    const root = document.getElementById("narrativeList");
    expect([...root.children].map((node) => node.className)).toEqual([
      "home-lead",
      "nav-cards",
    ]);

    const lead = [...root.querySelector(".home-lead").children];
    expect(lead.map((button) => button.dataset.open)).toEqual(["show", "timeline"]);
    expect(titles(root.querySelector(".home-lead"), ".nav-card-title")).toEqual([
      "רצף ההקרנה המלא",
      "ציר הזמן",
    ]);
    expect(titles(root.querySelector(".home-lead"), ".nav-card-index")).toEqual(["", "00"]);
    expect(root.querySelector(".home-lead .nav-card-meta")).toBeNull();

    const narratives = [...root.querySelectorAll(".nav-cards > [data-open]")];
    expect(narratives.map((button) => button.dataset.open)).toEqual(NARRATIVES.map((item) => item.id));
    expect(narratives).toHaveLength(5);
    expect(titles(root.querySelector(".nav-cards"), ".nav-card--narrative .nav-card-title")).toEqual([
      "משפחת שגב",
      "נובה ומור לוי",
      "שדרות",
      "מחנה שורה",
      "חיים פרי וחטופים",
    ]);
    expect(titles(root.querySelector(".nav-cards"), ".nav-card--narrative .nav-card-index")).toEqual(["01", "02", "03", "04", "05"]);
    expect(narratives.every((button) => button.classList.contains("nav-card--narrative"))).toBe(true);

    const names = [...root.querySelector(".home-names").children];
    expect(names.map((button) => button.dataset.showStep)).toEqual(["identity-database", "names-wall"]);
    expect(titles(root.querySelector(".home-names"), ".nav-card-title")).toEqual(["מאגר הזהויות", "קיר השמות"]);
    expect(titles(root.querySelector(".home-names"), ".nav-card-index")).toEqual(["07", "08"]);
    expect(names.every((button) => button.classList.contains("nav-card--quiet"))).toBe(true);
    expect(root.querySelector("h2, h3")).toBeNull();
    expect([...root.querySelectorAll("button")].some((button) => button.disabled)).toBe(false);

    document.body.innerHTML = `<div id="narrativeList">${homeListHtml({ locale: "en", pending: true })}</div>`;
    const english = document.getElementById("narrativeList");
    expect(titles(english.querySelector(".home-lead"), ".nav-card-title")).toEqual([
      "Full projection sequence",
      "The timeline",
    ]);
    expect(titles(english.querySelector(".nav-cards"), ".nav-card--narrative .nav-card-title")).toEqual([
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
    expect(english.querySelectorAll(".nav-card")).toHaveLength(9);
    expect([...english.querySelectorAll("button")].every((button) => button.disabled)).toBe(true);
    expect(english.querySelector("[data-open='show']").getAttribute("data-open")).toBe("show");
    expect(english.querySelector("[data-open='timeline']").getAttribute("data-open")).toBe("timeline");
    expect(english.querySelector("[data-open-free]")).toBeNull();
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
    expect(COPY.he).not.toHaveProperty("freeTitle");
    expect(COPY.en).not.toHaveProperty("freeMeta");
  });

  test("staff page exposes Home layers and a fullscreen control", () => {
    expect(page).toContain('id="homeLayersBtn"');
    expect(page).toContain('id="fullscreenBtn"');
    expect(page).toContain('id="fullscreenStatus"');
    expect(page).not.toContain('data-screen="free"');
  });
});
