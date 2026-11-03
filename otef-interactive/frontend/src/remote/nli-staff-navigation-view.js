import { NARRATIVES, SCRIPTS } from "./nli-staff-script.js";
import { showStepIndex } from "./nli-staff-flow.js";
import { messageForLocale } from "./remote-locale.js";

const OPTIONAL_IDS = ["sderot", "shura", "hostages"];
const SCENE_STRIP_IDS = new Set(["nova", "hostages", "timeline"]);
const scriptFor = (id) => SCRIPTS.find((script) => script.id === id);
const sameRef = (left, right) => left?.scriptId === right?.scriptId && left?.step === right?.step &&
  left?.returnTo?.id === right?.returnTo?.id && left?.returnTo?.step === right?.returnTo?.step;
const exactReturnTo = (actual, expected) => actual?.id === expected.id && actual?.step === expected.step;

export function navigationLabel({ current, target, direction, locale }) {
  const language = locale === "he" ? "he" : "en";
  const backwards = direction === "back" || direction === "previous";
  if (target?.scriptId === "show") {
    const step = scriptFor("show")?.steps[target.step];
    if (step?.id === "identity-database") return backwards
      ? messageForLocale(language, "backToIdentity")
      : messageForLocale(language, "navigationIdentity");
    if (step?.id === "names-wall") {
      return backwards
        ? messageForLocale(language, "navigationWall")
        : messageForLocale(language, "continueWall");
    }
    if (step?.id === "credits") return step.title?.[language] || messageForLocale(language, "navigationNextScene");
    if (["opening-minutes", "rest-of-day"].includes(step?.id)) {
      return step.title?.[language] || messageForLocale(language, "navigationNextScene");
    }
    if (current?.scriptId !== "show") return step?.title?.[language] || messageForLocale(language, "navigationNextScene");
  }
  if (current?.scriptId === target?.scriptId) {
    return messageForLocale(language, backwards ? "navigationPreviousScene" : "navigationNextScene");
  }
  if (target?.scriptId === "nova") return backwards
    ? messageForLocale(language, "backToNova")
    : language === "he" ? "נובה" : "Nova";
  if (target?.scriptId === "timeline") return language === "he" ? "ציר הזמן" : "Timeline";
  const narrative = NARRATIVES.find((item) => item.id === target?.scriptId);
  if (narrative) return narrative.title[language];
  return messageForLocale(language, backwards ? "navigationPreviousScene" : "navigationNextScene");
}

export function hasSceneStrip(scriptId) {
  return SCENE_STRIP_IDS.has(scriptId);
}

export function optionalStoryContext(ref) {
  if (!ref) return false;
  const item = scriptFor(ref.scriptId);
  if (!item || ref.step !== item.steps.length - 1) return false;
  if (ref.scriptId === "nova") {
    return exactReturnTo(ref.returnTo, { id: "show", step: showStepIndex("nova-mor-levy") });
  }
  if (OPTIONAL_IDS.includes(ref.scriptId)) {
    return exactReturnTo(ref.returnTo, { id: "show", step: showStepIndex("narratives") });
  }
  return false;
}

export function optionalStoryActions({
  current,
  displayed,
  navigationPending,
  searchPending,
  cueStatus,
  presentationPhase,
  navigationFailed,
}) {
  return sameRef(current, displayed) && optionalStoryContext(current) && cueStatus === "ready" &&
    !navigationPending && !searchPending && !navigationFailed &&
    !["opening", "applying", "closing"].includes(presentationPhase);
}

function escapeHtml(value) {
  return String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;");
}

export function storyChooserHtml({ locale, visitedStoryIds = [], pending = false }) {
  const language = locale === "he" ? "he" : "en";
  const labels = {
    sderot: { he: "שדרות", en: "Sderot" },
    shura: { he: "מחנה שורה", en: "Shura Camp" },
    hostages: { he: "חיים פרי וחטופים", en: "Haim Peri and hostages" },
  };
  return `<div class="story-chooser" id="storyChooser" role="dialog" aria-modal="true" aria-labelledby="storyChooserTitle" aria-describedby="storyChooserStatus" hidden dir="${language === "he" ? "rtl" : "ltr"}">
    <h2 id="storyChooserTitle">${escapeHtml(messageForLocale(language, "storyChooserTitle"))}</h2>
    <p class="visually-hidden" id="storyChooserStatus" role="status"></p>
    <div class="story-chooser-actions">${OPTIONAL_IDS.map((id) => {
      const visited = visitedStoryIds.includes(id);
      const status = visited ? messageForLocale(language, "storyVisited") : messageForLocale(language, "storyNotVisited");
      const icon = visited
        ? '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="m5 12 4 4L19 6"/></svg>'
        : '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><circle cx="12" cy="12" r="8"/></svg>';
      return `<button type="button" class="story-chooser-action" data-story-id="${id}" data-focus-key="story-${id}" aria-label="${escapeHtml(`${labels[id][language]}, ${status}`)}"${pending ? " disabled" : ""}><span class="story-chooser-caption">${escapeHtml(labels[id][language])}</span><span class="story-visited" data-visited-status aria-label="${escapeHtml(status)}">${icon}</span></button>`;
    }).join("")}</div>
    <button type="button" class="btn story-chooser-continue" data-chooser-action="continue-identity" data-focus-key="chooser-identity"${pending ? " disabled" : ""}>${escapeHtml(messageForLocale(language, "continueIdentity"))}</button>
    <button type="button" class="btn btn--outline story-chooser-cancel" data-chooser-action="cancel" data-focus-key="chooser-cancel">${escapeHtml(messageForLocale(language, "storyCancel"))}</button>
  </div>`;
}
