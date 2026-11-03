import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createProjectionNliFontChoiceLifecycle } from "../../frontend/src/projection/projection-nli-font-choice-lifecycle.js";
import { createProjectionCaptionAdapter } from "../../frontend/src/projection/projection-caption-adapter.js";
import { nameTextStyle } from "../../frontend/src/shared/nli-name-language.js";

function canvasFactory() {
  const calls = [];
  const context = new Proxy({ calls }, { get(target, key) {
    if (key in target) return target[key];
    if (key === "measureText") return () => ({ width: 30, actualBoundingBoxAscent: 18, actualBoundingBoxDescent: 5 });
    return (...args) => calls.push([key, ...args]);
  } });
  return { width: 0, height: 0, context, getContext: () => context };
}

describe("projection NLI font choice lifecycle", () => {
  it("projection entry refreshes live owners only through accepted font choices", () => {
    const entry = readFileSync(resolve(import.meta.dirname, "../../frontend/src/entries/projection-main.js"), "utf8");
    expect(entry).toMatch(/onChoices: \(choices\) => \{\s*settlementNameRuntime\?\.fontChoicesChanged\?\.\(\);\s*refreshProjectionNliFontOwners\(choices\);/);
    expect(entry).toMatch(/getLanguage: \(\) => OTEFDataContext\.getLegendSettings\?\.\(\)\?\.language === 'en' \? 'en' : 'he'/);
    expect(entry).toMatch(/const getNliFontChoices = \(\) => projectionNliFontLifecycle\.getChoices\(\)/);
    expect(entry).toMatch(/void projectionNliFontLifecycle\.publish\(nextConfig\.nliFonts \|\| NLI_FONT_DEFAULTS\)/);
    expect(entry).toMatch(/registerDisposer\(OTEFDataContext\.subscribe\('legendSettings', \(\) => \{\s*void projectionNliFontLifecycle\.languageChanged\(\);/);
  });

  it("accepts the active language choice after its exact face is ready", async () => {
    const pending = [];
    const onChoices = vi.fn();
    const lifecycle = createProjectionNliFontChoiceLifecycle({
      initialChoices: { he: "default", en: "hadassah" },
      getLanguage: () => "he",
      ensureNameFont: (style, size) => new Promise((resolve, reject) => pending.push({ style, size, resolve, reject })),
      onChoices,
    });
    const published = lifecycle.publish({ he: "narkiss", en: "marcellus" });
    expect(pending.map(({ style, size }) => [style.language, style.fontFamily, size])).toEqual([
      ["he", "NLI Content Narkiss Block", 14],
    ]);
    expect(lifecycle.getChoices()).toEqual({ he: "default", en: "hadassah" });
    pending[0].resolve({ fontIdentity: "he:narkiss" });
    await expect(published).resolves.toBe(true);
    expect(lifecycle.getChoices()).toEqual({ he: "narkiss", en: "hadassah" });
    expect(onChoices).toHaveBeenCalledOnce();
    lifecycle.dispose();
  });

  it("preserves the previously accepted English face when an inactive English choice is unavailable", async () => {
    const pending = [];
    const onChoices = vi.fn();
    let language = "he";
    const lifecycle = createProjectionNliFontChoiceLifecycle({
      initialChoices: { he: "default", en: "hadassah" },
      getLanguage: () => language,
      ensureNameFont: (style, size) => new Promise((resolve, reject) => {
        pending.push({ style, size, resolve, reject });
        if (style.fontFamily === "NLI Content Arial") reject(new Error("inactive face unavailable"));
      }),
      onChoices,
    });

    const hebrew = lifecycle.publish({ he: "narkiss", en: "arial" });
    expect(pending.map(({ style }) => [style.language, style.fontFamily])).toEqual([
      ["he", "NLI Content Narkiss Block"],
    ]);
    pending[0].resolve({ fontIdentity: "he:narkiss" });
    await expect(hebrew).resolves.toBe(true);
    expect(lifecycle.getChoices()).toEqual({ he: "narkiss", en: "hadassah" });

    language = "en";
    const english = lifecycle.languageChanged();
    expect(pending.map(({ style }) => [style.language, style.fontFamily])).toEqual([
      ["he", "NLI Content Narkiss Block"],
      ["en", "NLI Content Arial"],
    ]);
    pending[1].reject(new Error("inactive face unavailable"));
    await vi.waitFor(() => expect(pending).toHaveLength(3));
    expect(pending[2].style.language).toBe("en");
    expect(pending[2].style.fontFamily).toBe("NLI Content Hadassah Friedlaender");
    expect(onChoices).toHaveBeenCalledOnce();
    expect(lifecycle.getChoices()).toEqual({ he: "narkiss", en: "hadassah" });
    pending[2].resolve({ fontIdentity: "fallback:hadassah" });
    await expect(english).resolves.toBe(false);
    expect(lifecycle.getChoices()).toEqual({ he: "narkiss", en: "hadassah" });
    expect(onChoices).toHaveBeenCalledTimes(2);
    lifecycle.dispose();
  });

  it("keeps existing owners untouched when both the requested and accepted active faces fail", async () => {
    const pending = [];
    const onChoices = vi.fn();
    let language = "he";
    const lifecycle = createProjectionNliFontChoiceLifecycle({
      initialChoices: { he: "default", en: "hadassah" },
      getLanguage: () => language,
      ensureNameFont: (style) => new Promise((resolve, reject) => pending.push({ style, resolve, reject })),
      onChoices,
    });

    const hebrew = lifecycle.publish({ he: "narkiss", en: "marcellus" });
    pending[0].resolve({ fontIdentity: "he:narkiss" });
    await expect(hebrew).resolves.toBe(true);
    expect(onChoices).toHaveBeenCalledOnce();
    const previousContent = onChoices.mock.lastCall[0];

    language = "en";
    const english = lifecycle.languageChanged();
    expect(pending[1].style.fontFamily).toBe("NLI Content Marcellus");
    pending[1].reject(new Error("requested face unavailable"));
    await vi.waitFor(() => expect(pending).toHaveLength(3));
    expect(pending[2].style.fontFamily).toBe("NLI Content Hadassah Friedlaender");
    expect(onChoices).toHaveBeenCalledOnce();
    pending[2].reject(new Error("accepted face unavailable"));
    await expect(english).resolves.toBe(false);

    expect(lifecycle.getChoices()).toEqual({ he: "narkiss", en: "hadassah" });
    expect(onChoices).toHaveBeenCalledOnce();
    expect(onChoices.mock.lastCall[0]).toEqual(previousContent);
    lifecycle.dispose();
  });

  it("refreshes the accepted language font after a choice-pair failure without retrying its obsolete family", async () => {
    const pending = [];
    const onChoices = vi.fn();
    const canvas = canvasFactory();
    const adapter = createProjectionCaptionAdapter({ canvasFactory: () => canvas });
    let accepted = { he: "default", en: "hadassah" };
    let language = "he";
    let snapshot = { visible: true, model: { clockLabel: "05:42", phase: "paused" }, fontStyle: nameTextStyle("he", accepted) };
    const renderAcceptedSnapshot = (choices) => {
      accepted = choices;
      snapshot = { ...snapshot, fontStyle: nameTextStyle(language, accepted) };
      adapter.sync({ layout: { leftPct: 10, topPct: 20, widthPct: 30, heightPct: 10, fontPx: 24, rotateDeg: 0 }, snapshot });
    };
    renderAcceptedSnapshot(accepted);
    adapter.draw();
    const lifecycle = createProjectionNliFontChoiceLifecycle({
      initialChoices: { he: "default", en: "hadassah" },
      getLanguage: () => language,
      ensureNameFont: (style) => new Promise((resolve, reject) => pending.push({ style, resolve, reject })),
      onChoices: (choices) => { onChoices(choices); renderAcceptedSnapshot(choices); },
    });
    const first = lifecycle.publish({ he: "narkiss", en: "marcellus" });
    expect(pending.map(({ style }) => style.language)).toEqual(["he"]);
    pending[0].resolve({ fontIdentity: "accepted:narkiss" });
    await expect(first).resolves.toBe(true);

    language = "en";
    const acceptedEnglish = lifecycle.languageChanged();
    expect(pending.at(-1).style.language).toBe("en");
    expect(pending.at(-1).style.fontFamily).toBe("NLI Content Marcellus");
    pending.at(-1).resolve({ fontIdentity: "accepted:marcellus" });
    await expect(acceptedEnglish).resolves.toBe(true);
    expect(lifecycle.getChoices()).toEqual({ he: "narkiss", en: "marcellus" });

    language = "he";
    const acceptedHebrew = lifecycle.languageChanged();
    pending.at(-1).resolve({ fontIdentity: "cached:narkiss" });
    await expect(acceptedHebrew).resolves.toBe(true);
    expect(lifecycle.getChoices()).toEqual({ he: "narkiss", en: "marcellus" });

    expect(snapshot.model).toEqual({ clockLabel: "05:42", phase: "paused" });
    adapter.draw();
    expect(canvas.context.font).toContain('"NLI Content Narkiss Block", sans-serif');

    const rejected = lifecycle.publish({ he: "arial", en: "belleza" });
    expect(pending.at(-1).style.fontFamily).toBe("NLI Content Arial");
    pending.at(-1).reject(new Error("face unavailable"));
    await vi.waitFor(() => expect(pending).toHaveLength(5));
    expect(pending.at(-1).style.fontFamily).toBe("NLI Content Narkiss Block");
    expect(onChoices).toHaveBeenCalledTimes(3);
    pending.at(-1).resolve({ fontIdentity: "retained:narkiss" });
    await expect(rejected).resolves.toBe(false);
    expect(lifecycle.getChoices()).toEqual({ he: "narkiss", en: "marcellus" });
    adapter.draw();
    expect(canvas.context.font).toContain('"NLI Content Narkiss Block", sans-serif');

    language = "en";
    const restoredAcceptedChoices = lifecycle.languageChanged();
    expect(pending.at(-1).style.language).toBe("en");
    expect(pending.at(-1).style.fontFamily).toBe("NLI Content Marcellus");
    pending.at(-1).resolve({ fontIdentity: "accepted:marcellus" });
    await expect(restoredAcceptedChoices).resolves.toBe(true);
    expect(onChoices).toHaveBeenCalledTimes(5);
    expect(lifecycle.getChoices()).toEqual({ he: "narkiss", en: "marcellus" });
    adapter.draw();
    expect(canvas.context.font).toContain('"NLI Content Marcellus", sans-serif');
    lifecycle.dispose();
    adapter.dispose();
  });

  it("does not apply a face load captured under a language that is no longer active", async () => {
    const pending = [];
    const applied = [];
    let language = "he";
    const lifecycle = createProjectionNliFontChoiceLifecycle({
      initialChoices: { he: "default", en: "hadassah" },
      getLanguage: () => language,
      ensureNameFont: (style) => new Promise((resolve, reject) => pending.push({ style, resolve, reject })),
      onChoices: choices => applied.push(choices),
    });
    const oldLanguage = lifecycle.publish({ he: "narkiss", en: "marcellus" });
    language = "en";
    const activeLanguage = lifecycle.languageChanged();
    expect(pending.map(({ style }) => style.language)).toEqual(["he", "en"]);
    pending[1].resolve({ fontIdentity: "current:marcellus" });
    await expect(activeLanguage).resolves.toBe(true);
    pending[0].resolve({ fontIdentity: "stale:narkiss" });
    await expect(oldLanguage).resolves.toBe(false);
    expect(applied).toEqual([{ he: "default", en: "marcellus" }]);
    lifecycle.dispose();
  });
});
