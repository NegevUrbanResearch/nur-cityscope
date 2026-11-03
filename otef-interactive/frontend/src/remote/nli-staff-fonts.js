import { resolveNliFont } from "../shared/nli-font-settings.js";
import { ensureNameFont } from "../shared/nli-name-font.js";

const languages = ["he", "en"];

function staffBaseline(language) {
  return {
    language,
    direction: language === "he" ? "rtl" : "ltr",
    fontFamily: "Heebo",
    canvasFontStack: '"Heebo", Arial, sans-serif',
    mapFontStack: ["Heebo", "Arial"],
  };
}

function copyChoices(value) {
  return { he: value?.he, en: value?.en };
}

function choicesKey(choices, locale) {
  return `${choices.he}\u0000${choices.en}\u0000${locale}`;
}

function fontStyle(language, choices) {
  return resolveNliFont(language, choices, staffBaseline(language));
}

export function createNliStaffFontController({ document = globalThis.document, getLocale = () => "he", onError = () => {} } = {}) {
  const root = document?.documentElement;
  const body = document?.body;
  if (!root || !body) throw new Error("NLI staff font controller requires a document body");

  const originalBodyFontFamily = body.style.fontFamily;
  let generation = 0;
  let disposed = false;
  let acceptedChoices = null;

  function applyStyle(language, style) {
    if (style.fontFamily === "Heebo") {
      root.style.removeProperty(`--nli-staff-font-${language}`);
    } else {
      root.style.setProperty(`--nli-staff-font-${language}`, style.canvasFontStack);
    }
  }

  function applyLocaleFont(locale, choices) {
    const style = fontStyle(locale, choices);
    body.style.fontFamily = style.fontFamily === "Heebo" ? originalBodyFontFamily : style.canvasFontStack;
  }

  async function applyChoices(input) {
    const choices = copyChoices(input);
    const locale = getLocale() === "en" ? "en" : "he";
    const requestKey = choicesKey(choices, locale);
    const requestGeneration = ++generation;
    if (disposed) return false;

    try {
      await Promise.all(languages.map((language) => {
        const style = fontStyle(language, choices);
        return style.fontFamily === "Heebo" ? Promise.resolve()
          : ensureNameFont(style, 16, document);
      }));
    } catch (error) {
      const currentLocale = getLocale() === "en" ? "en" : "he";
      const isLatest = !disposed && requestGeneration === generation && requestKey === choicesKey(choices, currentLocale);
      if (isLatest) {
        if (acceptedChoices) applyLocaleFont(currentLocale, acceptedChoices);
        try { onError(error); } catch { /* Error reporting must not break local fallback typography. */ }
      }
      return false;
    }

    if (disposed || requestGeneration !== generation || requestKey !== choicesKey(choices, getLocale() === "en" ? "en" : "he")) return false;
    for (const language of languages) applyStyle(language, fontStyle(language, choices));
    for (const button of root.querySelectorAll?.(".app #localeHe, .app #localeEn") || []) {
      const language = button.id === "localeEn" ? "en" : "he";
      const style = fontStyle(language, choices);
      button.style.fontFamily = style.canvasFontStack;
    }
    applyLocaleFont(locale, choices);
    acceptedChoices = choices;
    return true;
  }

  return {
    applyChoices,
    dispose() {
      if (disposed) return;
      disposed = true;
      generation += 1;
      root.style.removeProperty("--nli-staff-font-he");
      root.style.removeProperty("--nli-staff-font-en");
      body.style.fontFamily = originalBodyFontFamily;
      for (const button of root.querySelectorAll?.(".app #localeHe, .app #localeEn") || []) button.style.removeProperty("font-family");
    },
  };
}
