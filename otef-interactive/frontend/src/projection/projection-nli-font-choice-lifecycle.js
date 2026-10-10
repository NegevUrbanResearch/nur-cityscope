import { createGisNliFontChoiceLifecycle } from "../entries/gis-nli-font-choice-lifecycle.js";
import { nameTextStyle } from "../shared/nli-name-language.js";
import { NLI_FONT_DEFAULTS } from "../shared/nli-font-settings.js";
import { ensureNameFont as ensureNameFontFace } from "../shared/nli-name-font.js";

function readLanguage(getLanguage) {
  return getLanguage?.() === "en" ? "en" : "he";
}

function abortStaleReadiness() {
  const error = new Error("Projection NLI font readiness was superseded");
  error.name = "AbortError";
  return error;
}

/** Keep projection owners on the active language's loaded NLI face. */
export function createProjectionNliFontChoiceLifecycle({
  initialChoices = NLI_FONT_DEFAULTS,
  getLanguage = () => "he",
  ensureNameFont = ensureNameFontFace,
  onChoices = () => {},
  onError = () => {},
} = {}) {
  let acceptedChoices = { he: initialChoices.he, en: initialChoices.en };
  let latestRequest = { choices: { ...acceptedChoices }, state: "accepted" };
  let generation = 0;
  let activeAttempt = null;
  const currentLanguage = () => readLanguage(getLanguage);
  const lifecycle = createGisNliFontChoiceLifecycle({
    ensureReady: async (choices) => {
      const attempt = activeAttempt;
      const language = currentLanguage();
      if (!attempt || attempt.language !== language) throw abortStaleReadiness();
      await ensureNameFont(nameTextStyle(language, choices), 14);
      if (attempt.generation !== generation || currentLanguage() !== language) throw abortStaleReadiness();
    },
    isCurrent: () => activeAttempt?.generation === generation && activeAttempt.language === currentLanguage(),
    applyChoices: (choices) => {
      const language = activeAttempt.language;
      acceptedChoices = { ...acceptedChoices, [language]: choices[language] };
      onChoices({ ...acceptedChoices });
    },
    onError: (error) => { if (error?.name !== "AbortError") onError(error); },
  });

  const run = (choices, language, request) => {
    const token = ++generation;
    activeAttempt = { generation: token, language };
    const pending = lifecycle.publish(choices);
    return pending.then(async (applied) => {
      if (token !== generation || currentLanguage() !== language) return false;
      if (request === latestRequest) request.state = applied ? "accepted" : "failed";
      if (!applied && request === latestRequest) {
        const retainedChoices = { ...acceptedChoices };
        try {
          await ensureNameFont(nameTextStyle(language, retainedChoices), 14);
        } catch (error) {
          if (token === generation && currentLanguage() === language && error?.name !== "AbortError") onError(error);
          return false;
        }
        if (token === generation && currentLanguage() === language) onChoices(retainedChoices);
      }
      return applied;
    });
  };

  return {
    getChoices: () => ({ ...acceptedChoices }),
    publish(choices) {
      latestRequest = { choices: { he: choices.he, en: choices.en }, state: "pending" };
      return run(latestRequest.choices, currentLanguage(), latestRequest);
    },
    languageChanged() {
      const language = currentLanguage();
      const request = latestRequest;
      if (request.state === "pending" || (request.state === "accepted" && request.choices[language] !== acceptedChoices[language])) {
        return run(request.choices, language, request);
      }
      return run(acceptedChoices, language, null);
    },
    dispose() {
      generation += 1;
      activeAttempt = null;
      lifecycle.dispose();
    },
  };
}
