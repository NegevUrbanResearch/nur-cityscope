import { escapeHtml } from "../shared/html-utils.js";
import { HOME_SHOW_SHORTCUTS, NARRATIVES, SHOW, TIMELINE } from "./nli-staff-script.js";

function label(value, locale) {
  const lang = locale === "en" ? "en" : "he";
  return escapeHtml(value?.[lang] || value?.he || "");
}

export function homeListHtml({ locale, pending } = {}) {
  const disabled = pending ? " disabled" : "";
  const card = (item, action, className = "") =>
    `<button type="button" class="nav-card ${className}" ${action}="${escapeHtml(item.id)}"${disabled}><span class="nav-card-index">${escapeHtml(item.index || "")}</span><span class="nav-card-title">${label(item.title, locale)}</span></button>`;
  const narratives = NARRATIVES.map((item) => card(item, "data-open", "nav-card--narrative")).join("");
  const names = HOME_SHOW_SHORTCUTS.map((item) => card(item, "data-show-step", "nav-card--quiet")).join("");
  return `<div class="home-lead">${card(SHOW, "data-open", "nav-card--primary")}${card(TIMELINE, "data-open", "nav-card--timeline")}</div><div class="nav-cards">${narratives}<div class="home-names">${names}</div></div>`;
}
