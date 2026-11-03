// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createNliStaffFontController } from "../../frontend/src/remote/nli-staff-fonts.js";

const choices = { he: "hadassah", en: "belleza" };

function face(familyName) { return { family: familyName, status: "loaded" }; }

describe("NLI staff font controller", () => {
  let locale;
  let document;
  let load;
  let onError;
  beforeEach(() => {
    document = window.document;
    document.documentElement.innerHTML = '<head></head><body><main class="app"><button id="localeHe" lang="he">עב</button><button id="localeEn" lang="en">EN</button><section id="fixture" lang="he">שם</section></main></body>';
    locale = "he";
    load = vi.fn(async (query) => [face(query.includes("Hadassah") ? "NLI Content Hadassah Friedlaender" : "NLI Content Belleza")]);
    Object.defineProperty(document, "fonts", { configurable: true, value: { load, ready: Promise.resolve() } });
    onError = vi.fn();
  });

  it("default_restores_heebo_after_override", async () => {
    const controller = createNliStaffFontController({ document, getLocale: () => locale, onError });
    expect(await controller.applyChoices(choices)).toBe(true);
    expect(document.body.style.fontFamily).toContain("Hadassah");
    expect(await controller.applyChoices({ he: "default", en: "belleza" })).toBe(true);
    expect(document.body.style.fontFamily).toBe("");
    expect(document.documentElement.style.getPropertyValue("--nli-staff-font-he")).toBe("");
    expect(document.getElementById("fixture").getAttribute("lang")).toBe("he");
  });

  it("each_locale_button_uses_its_own_language", async () => {
    const controller = createNliStaffFontController({ document, getLocale: () => locale, onError });
    const hebrewButton = document.getElementById("localeHe");
    const englishButton = document.getElementById("localeEn");
    expect(hebrewButton.getAttribute("lang")).toBe("he");
    expect(englishButton.getAttribute("lang")).toBe("en");
    expect(await controller.applyChoices(choices)).toBe(true);
    expect(englishButton.style.fontFamily).toContain("Belleza");
    expect(hebrewButton.style.fontFamily).toContain("Hadassah");
    expect(document.body.style.fontFamily).toContain("Hadassah");
    locale = "en";
    expect(await controller.applyChoices(choices)).toBe(true);
    expect(document.body.style.fontFamily).toContain("Belleza");
    expect(hebrewButton.getAttribute("lang")).toBe("he");
    expect(englishButton.getAttribute("lang")).toBe("en");
    expect(englishButton.style.fontFamily).toContain("Belleza");
    expect(hebrewButton.style.fontFamily).toContain("Hadassah");
  });

  it("keeps English Hadassah and Hebrew Default stable through Hebrew-English-Hebrew locale changes", async () => {
    locale = "en";
    const saved = { he: "default", en: "hadassah" };
    const controller = createNliStaffFontController({ document, getLocale: () => locale, onError });
    expect(await controller.applyChoices(saved)).toBe(true);
    expect(document.body.style.fontFamily).toContain("Hadassah");
    expect(document.getElementById("localeEn").style.fontFamily).toContain("Hadassah");
    expect(document.getElementById("localeHe").style.fontFamily).toContain("Heebo");
    locale = "he";
    expect(await controller.applyChoices(saved)).toBe(true);
    expect(document.body.style.fontFamily).toBe("");
    expect(document.getElementById("localeEn").style.fontFamily).toContain("Hadassah");
    expect(document.getElementById("localeHe").style.fontFamily).toContain("Heebo");
    locale = "en";
    expect(await controller.applyChoices(saved)).toBe(true);
    locale = "he";
    expect(await controller.applyChoices(saved)).toBe(true);
    expect(saved).toEqual({ he: "default", en: "hadassah" });
  });

  it("late_load_cannot_replace_newer_choice", async () => {
    let releaseFirst;
    load.mockImplementationOnce(() => new Promise((resolve) => { releaseFirst = resolve; }));
    const controller = createNliStaffFontController({ document, getLocale: () => locale, onError });
    const old = controller.applyChoices(choices);
    const latest = controller.applyChoices({ he: "default", en: "belleza" });
    expect(await latest).toBe(true);
    releaseFirst([face("NLI Content Hadassah Friedlaender")]);
    expect(await old).toBe(false);
    expect(document.body.style.fontFamily).toBe("");
  });

  it("startup_and_replacement_failure_are_distinct", async () => {
    load.mockRejectedValueOnce(new Error("startup face unavailable"));
    const controller = createNliStaffFontController({ document, getLocale: () => locale, onError });
    expect(await controller.applyChoices(choices)).toBe(false);
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ message: "startup face unavailable" }));
    load.mockImplementation(async (query) => [face(query.includes("Hadassah") ? "NLI Content Hadassah Friedlaender" : "NLI Content Belleza")]);
    expect(await controller.applyChoices(choices)).toBe(true);
    load.mockRejectedValueOnce(new Error("replacement face unavailable"));
    expect(await controller.applyChoices({ he: "default", en: "belleza" })).toBe(false);
    expect(document.body.style.fontFamily).toContain("Hadassah");
    expect(onError).toHaveBeenLastCalledWith(expect.objectContaining({ message: "replacement face unavailable" }));
  });

  it("uses the last fully loaded choice for the new locale when replacement loading fails", async () => {
    locale = "en";
    load.mockImplementation(async (query) => {
      const requestedFamily = query.match(/"([^"]+)"/)?.[1];
      if (requestedFamily?.includes("Marcellus")) throw new Error("blocked Marcellus");
      return [face(requestedFamily)];
    });
    const controller = createNliStaffFontController({ document, getLocale: () => locale, onError });
    const accepted = { he: "hadassah", en: "narkiss" };
    const replacement = { he: "hadassah", en: "marcellus" };
    expect(await controller.applyChoices(accepted)).toBe(true);
    expect(document.body.style.fontFamily).toContain("Narkiss");
    expect(await controller.applyChoices(replacement)).toBe(false);
    expect(document.body.style.fontFamily).toContain("Narkiss");
    locale = "he";
    expect(await controller.applyChoices(replacement)).toBe(false);
    expect(document.body.style.fontFamily).toContain("Hadassah");
    expect(onError).toHaveBeenLastCalledWith(expect.objectContaining({ message: "blocked Marcellus" }));
  });

  it("restores Hebrew Heebo from an accepted Default pair when the English replacement fails", async () => {
    locale = "en";
    load.mockImplementation(async (query) => {
      const requestedFamily = query.match(/"([^"]+)"/)?.[1];
      if (requestedFamily?.includes("Marcellus")) throw new Error("blocked Marcellus");
      return [face(requestedFamily)];
    });
    const controller = createNliStaffFontController({ document, getLocale: () => locale, onError });
    const accepted = { he: "default", en: "belleza" };
    const replacement = { he: "default", en: "marcellus" };
    expect(await controller.applyChoices(accepted)).toBe(true);
    expect(document.body.style.fontFamily).toContain("Belleza");
    expect(await controller.applyChoices(replacement)).toBe(false);
    locale = "he";
    expect(await controller.applyChoices(replacement)).toBe(false);
    expect(document.body.style.fontFamily).toBe("");
    expect(document.getElementById("localeHe").style.fontFamily).toContain("Heebo");
    expect(document.getElementById("localeEn").style.fontFamily).toContain("Belleza");
  });
});
