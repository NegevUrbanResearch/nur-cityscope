import { escapeHtml } from "../shared/html-utils.js";
import { COPY, HOME_SHOW_SHORTCUTS, NARRATIVES, SHOW, TIMELINE } from "./nli-staff-script.js";

function label(value, locale) {
  const lang = locale === "en" ? "en" : "he";
  return escapeHtml(value?.[lang] || value?.he || "");
}

function copy(key, locale) {
  const lang = locale === "en" ? "en" : "he";
  return escapeHtml(COPY[lang]?.[key] || COPY.he[key] || "");
}

function openButton(item, className, locale, disabled) {
  return `<button type="button" class="${className}" data-open="${escapeHtml(item.id)}"${disabled}><span class="nav-card-title">${label(item.title, locale)}</span></button>`;
}

export function homeListHtml({ locale, pending } = {}) {
  const disabled = pending ? " disabled" : "";
  const narratives = NARRATIVES.map((item) => `<button type="button" class="nav-card nav-card--narrative" data-open="${escapeHtml(item.id)}"${disabled}><span class="nav-card-index">${escapeHtml(item.index || "")}</span><span class="nav-card-title">${label(item.title, locale)}</span></button>`).join("");
  const names = HOME_SHOW_SHORTCUTS.map((item) => `<button type="button" class="home-names-btn" data-show-step="${escapeHtml(item.id)}"${disabled}><span class="nav-card-title">${label(item.title, locale)}</span></button>`).join("");
  const free = `<button type="button" class="nav-card nav-card--quiet" data-open-free="1"${disabled}><span class="nav-card-copy"><span class="nav-card-title">${copy("freeTitle", locale)}</span><span class="nav-card-meta">${copy("freeMeta", locale)}</span></span></button>`;
  return `<div class="home-lead">${openButton(SHOW, "nav-card nav-card--primary", locale, disabled)}${openButton(TIMELINE, "nav-card nav-card--timeline", locale, disabled)}</div><div class="nav-row">${narratives}</div><div class="home-names">${names}</div>${free}`;
}
