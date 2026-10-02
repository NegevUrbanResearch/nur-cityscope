/**
 * @vitest-environment jsdom
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test, vi } from "vitest";
import {
  archiveControlsHtml,
  createArchivePageHold,
} from "../../frontend/src/remote/nli-staff-archive-controls.js";
import { messageForLocale } from "../../frontend/src/remote/remote-locale.js";

const staffHtml = readFileSync(
  path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../frontend/nli-staff-remote.html"),
  "utf8",
);

const labels = {
  openNliRecord: "Open NLI record",
  backToMap: "Back to map",
  nliArchiveScrollUp: "Scroll up",
  nliArchiveScrollDown: "Scroll down",
  nliArchiveRecord: "NLI record",
};

function mount(phase, extra = {}) {
  const host = document.createElement("div");
  host.innerHTML = archiveControlsHtml({
    phase,
    localeLabels: labels,
    personName: "חיים פרי",
    disabled: false,
    ...extra,
  });
  return host;
}

describe("staff archive control HTML", () => {
  test("closed state is one Open button and no scroll actions", () => {
    const host = mount("closed");
    const open = host.querySelector("[data-archive-action='open']");
    expect(open).not.toBeNull();
    expect(open.classList.contains("btn")).toBe(true);
    expect(open.textContent).toBe(labels.openNliRecord);
    expect(open.disabled).toBe(false);
    expect(host.querySelector("[data-archive-action='page_up']")).toBeNull();
    expect(host.querySelector("[data-archive-action='page_down']")).toBeNull();
    expect(host.querySelector("[data-archive-action='close']")).toBeNull();
    expect(host.querySelector(".presentation-controls")).not.toBeNull();
  });

  test("opening disables the Open button", () => {
    const open = mount("opening").querySelector("[data-archive-action='open']");
    expect(open).not.toBeNull();
    expect(open.disabled).toBe(true);
    expect(open.textContent).toBe(labels.openNliRecord);
  });

  test("open state pairs scroll up and down with Back and the person heading", () => {
    const host = mount("open");
    const up = host.querySelector("[data-archive-action='page_up']");
    const down = host.querySelector("[data-archive-action='page_down']");
    const close = host.querySelector("[data-archive-action='close']");
    const heading = host.querySelector(".presentation-controls-heading");
    expect(host.querySelector("[data-archive-action='open']")).toBeNull();
    expect(up.classList.contains("btn")).toBe(true);
    expect(up.classList.contains("btn--outline")).toBe(true);
    expect(up.textContent).toBe(labels.nliArchiveScrollUp);
    expect(down.classList.contains("btn")).toBe(true);
    expect(down.classList.contains("btn--outline")).toBe(false);
    expect(down.textContent).toBe(labels.nliArchiveScrollDown);
    expect(up.parentElement.classList.contains("presentation-slide-actions")).toBe(true);
    expect(up.compareDocumentPosition(down) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(close.classList.contains("btn--outline")).toBe(true);
    expect(close.classList.contains("presentation-close")).toBe(true);
    expect(close.textContent).toBe(labels.backToMap);
    expect(heading.querySelector("span").textContent).toBe("חיים פרי");
    expect(heading.querySelector("span:last-child").textContent).toBe(labels.nliArchiveRecord);
    expect(host.textContent).not.toContain("Hold to keep scrolling");
    expect(host.querySelector(".archive-hold-hint")).toBeNull();
    expect([up, down, close].every((button) => button.disabled)).toBe(false);
  });

  test("closing disables scroll and Back", () => {
    const host = mount("closing");
    const buttons = [...host.querySelectorAll("button")];
    expect(buttons.map((button) => button.dataset.archiveAction)).toEqual(["page_up", "page_down", "close"]);
    expect(buttons.every((button) => button.disabled)).toBe(true);
  });

  test("disabled flag disables Open and the open-phase controls", () => {
    expect(mount("closed", { disabled: true }).querySelector("button").disabled).toBe(true);
    const buttons = [...mount("open", { disabled: true }).querySelectorAll("button")];
    expect(buttons).toHaveLength(3);
    expect(buttons.every((button) => button.disabled)).toBe(true);
  });

  test("generated kit HTML does not emit the player step title", () => {
    const html = archiveControlsHtml({ phase: "open", localeLabels: labels, personName: "חיים פרי" });
    expect(html).not.toContain("stepTitle");
    expect(html).not.toContain("id=\"stepNote\"");
  });

  test("injecting open archive HTML leaves the player title, note, and dock", () => {
    document.body.innerHTML = `
      <section id="player">
        <h1 class="step-title" id="stepTitle">ניר עוז</h1>
        <p class="step-note" id="stepNote">הרשומה נשארת על הקיר</p>
        <div class="kit" id="playerKit">
          <div class="kit-block kit-action" id="kitArchive"></div>
        </div>
        <div class="dock">
          <button type="button" id="prevBtn">הקודם</button>
          <button type="button" id="nextBtn">הבא</button>
        </div>
      </section>
    `;
    document.getElementById("kitArchive").innerHTML = archiveControlsHtml({
      phase: "open",
      localeLabels: labels,
      personName: "חיים פרי",
    });
    expect(document.getElementById("stepTitle").textContent).toBe("ניר עוז");
    expect(document.getElementById("stepNote").textContent).toBe("הרשומה נשארת על הקיר");
    expect(document.querySelector(".dock")).not.toBeNull();
    expect(document.getElementById("kitArchive").innerHTML).not.toContain("stepTitle");
    expect(document.getElementById("kitArchive").querySelector("[data-archive-action='page_down']")).not.toBeNull();
  });
});

describe("staff archive page source", () => {
  test("mounts empty archive hosts and removes the standalone archive buttons", () => {
    const page = new DOMParser().parseFromString(staffHtml, "text/html");
    const searchKit = page.getElementById("searchKit");
    const mountPoint = page.getElementById("searchArchiveMount");
    const kitArchive = page.getElementById("kitArchive");
    expect(kitArchive).not.toBeNull();
    expect(kitArchive.querySelector("button")).toBeNull();
    expect(searchKit.contains(mountPoint)).toBe(true);
    expect(page.getElementById("searchStatus").compareDocumentPosition(mountPoint) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(page.getElementById("archiveBtn")).toBeNull();
    expect(page.getElementById("freeArchiveBtn")).toBeNull();
    expect(staffHtml).not.toContain("#freeArchiveBtn");
  });

  test("sizes archive Open like presentation and hides search while the record is open", () => {
    expect(staffHtml).toContain("#kitArchive:not([hidden])");
    expect(staffHtml).toContain("#searchKit.is-archive-open .archive-controls");
    expect(staffHtml).toContain("#searchKit.is-archive-open .search");
    expect(staffHtml).toContain("#searchKit.is-archive-open .results");
    expect(staffHtml).toMatch(/#kitArchive \.presentation-controls \.btn\[data-archive-action="open"\]/);
    expect(staffHtml).toMatch(/#searchKit \.presentation-controls \.btn\[data-archive-action="open"\]/);
    expect(staffHtml).toContain("clamp(180px, 32dvh, 260px)");
  });
});

describe("archive locale copy", () => {
  test("adds Hebrew and English scroll and record labels", () => {
    expect(messageForLocale("he", "nliArchiveScrollUp")).toBe("גלילה למעלה");
    expect(messageForLocale("en", "nliArchiveScrollUp")).toBe("Scroll up");
    expect(messageForLocale("he", "nliArchiveScrollDown")).toBe("גלילה למטה");
    expect(messageForLocale("en", "nliArchiveScrollDown")).toBe("Scroll down");
    expect(messageForLocale("he", "nliArchiveRecord")).toBe("רשומת NLI");
    expect(messageForLocale("en", "nliArchiveRecord")).toBe("NLI record");
    expect(messageForLocale("he", "openNliRecord")).toBe("פתיחת ארכיון הספרייה");
    expect(messageForLocale("en", "backToMap")).toBe("Back to map");
  });
});

describe("staff archive page hold", () => {
  test("pages immediately then every 500ms and does not fire after clear", () => {
    vi.useFakeTimers();
    const page = vi.fn();
    const host = mount("open");
    const down = host.querySelector("[data-archive-action='page_down']");
    down.setPointerCapture = vi.fn();
    const hold = createArchivePageHold({ page, isOpen: () => true });
    try {
      hold.start({ target: down, pointerId: 7 });
      expect(down.setPointerCapture).toHaveBeenCalledWith(7);
      expect(page).toHaveBeenCalledTimes(1);
      expect(page).toHaveBeenCalledWith("down");
      vi.advanceTimersByTime(499);
      expect(page).toHaveBeenCalledTimes(1);
      vi.advanceTimersByTime(1);
      expect(page).toHaveBeenCalledTimes(2);
      hold.clear();
      vi.advanceTimersByTime(2000);
      expect(page).toHaveBeenCalledTimes(2);
    } finally {
      hold.destroy();
      vi.useRealTimers();
    }
  });
});
