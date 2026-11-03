import { createExperienceSwitcher } from "./remote-experience-switcher.js";
import { getLocale, LOCALE_EVENT, t } from "./remote-locale.js";

const TABS = ["curation", "slideshow", "layers", "navigation"];
const LABELS = { curation: "navCuration", slideshow: "navSlideshow", layers: "navLayers", navigation: "navNavigation" };
const PATHS = {
  curation: "M12 5c-3-2-7-2-10-1v15c3-1 7-1 10 1 3-2 7-2 10-1V4c-3-1-7-1-10 1ZM12 5v15",
  slideshow: "M3 4h18v14H3zM8 22l4-4 4 4M9 8l6 3-6 3z",
  layers: "m12 3 10 5-10 5L2 8l10-5ZM2 12l10 5 10-5M2 16l10 5 10-5",
  navigation: "m3 11 19-9-9 19-2-8-8-2Z",
};

/** Shared destinations preserve each existing application's content and rules. */
export function installSharedExperienceNavigation({ dataContext, staffRemote, kind, onRegularTab, document: doc = document, window: win = window } = {}) {
  let nav = doc.getElementById("remoteBottomNav");
  const ownsNav = !nav;
  if (!nav) {
    nav = doc.createElement("nav");
    nav.id = "remoteBottomNav";
    nav.className = "experience-nav";
    nav.setAttribute("aria-label", t("navTablistAria"));
    nav.innerHTML = TABS.map(key => `<button type="button" data-remote-tab="${key}" class="experience-nav__tab"><svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${PATHS[key]}"/></svg><span data-shared-nav-label="${key}"></span></button>`).join("");
    doc.querySelector(".app")?.append(nav);
  }
  // These destinations include another document; link-like buttons use aria-current.
  nav.setAttribute("role", "navigation");
  nav.querySelectorAll("[data-remote-tab]").forEach(button => {
    button.removeAttribute("role"); button.removeAttribute("aria-selected"); button.removeAttribute("aria-controls"); button.tabIndex = 0;
  });
  const content = kind === "regular" ? doc.getElementById("remoteMain") : doc.querySelector(".app > .main");
  const banner = doc.createElement("div");
  banner.className = "experience-status";
  banner.setAttribute("role", "status"); banner.hidden = true;
  const statusText = doc.createElement("span");
  const cancel = doc.createElement("button"); cancel.type = "button";
  cancel.className = "experience-status__cancel";
  banner.append(statusText, cancel);
  nav.before(banner);
  let storage = null;
  try { storage = win.sessionStorage; } catch { /* In-document reconciliation still works. */ }
  const switcher = createExperienceSwitcher({ dataContext, staffRemote, storage, flushRegularSettings: () => win.slideshowTabController?.flushSettings?.() });
  let switching = false, failed = false, failureReason = null;
  let activeTab = kind === "nli" ? "curation" : new URL(win.location.href).searchParams.get("tab") || "navigation";
  if (!TABS.includes(activeTab) || (kind === "regular" && activeTab === "curation")) activeTab = "navigation";
  const text = (he, en) => getLocale() === "he" ? he : en;
  const render = () => {
    const state = dataContext.getExperienceState();
    const pending = switching || !!state?.pending_transition || switcher.isUncertain();
    const inactive = !!state && state.active_experience !== kind;
    const disconnected = dataContext.isConnected?.() === false;
    if (content) content.inert = pending || inactive || disconnected;
    const selected = state?.active_experience === "nli" ? "curation" : kind === "nli" ? "navigation" : activeTab;
    nav.querySelectorAll("[data-remote-tab]").forEach(button => {
      const selectedHere = button.dataset.remoteTab === selected;
      button.classList.toggle("is-active", selectedHere);
      selectedHere ? button.setAttribute("aria-current", "page") : button.removeAttribute("aria-current");
      button.disabled = disconnected || switching || (!!state?.pending_transition && !switcher.canRecover());
    });
    nav.querySelectorAll("[data-shared-nav-label]").forEach(label => { label.textContent = t(LABELS[label.dataset.sharedNavLabel]); });
    banner.hidden = !pending && !inactive && !failed;
    cancel.hidden = !pending || switching;
    cancel.textContent = text("ביטול מעבר", "Cancel switch");
    statusText.textContent = switcher.isUncertain() ? text("מצב המעבר לא אושר. התחברו מחדש ונסו שוב, או בטלו את המעבר.", "The switch is unconfirmed. Reconnect and retry, or cancel the switch.")
      : pending ? text("מחליפים תצוגה…", "Switching display…")
      : failed && failureReason === "cleanup_failed" ? text("סגירת התוכן של הספרייה לא הושלמה. בדקו את מסך המפה ונסו שוב.", "Library media did not finish closing. Check the map display and try again.")
      : failed && failureReason === "experience_scene_pending" ? text("הסצנה עדיין בהכנה. המתינו רגע ונסו שוב.", "The scene is still preparing. Wait a moment and try again.") : failed
      ? text("המעבר לא הושלם. בדקו שהמפה מחוברת ונסו שוב.", "The switch did not complete. Check that the map is connected and try again.")
      : inactive ? text("תצוגה אחרת פעילה. בחרו לשונית כדי לעבור אליה.", "Another view is active. Choose a tab to switch.") : "";
  };
  const click = async event => {
    const button = event.target.closest("[data-remote-tab]");
    if (!button || !nav.contains(button) || button.disabled || switching) return;
    const key = button.dataset.remoteTab;
    const target = key === "curation" ? "nli" : "regular";
    const state = dataContext.getExperienceState();
    if (key === activeTab && target === kind && state?.active_experience === kind && !state.pending_transition && !switcher.isUncertain()) return;
    switching = true; failed = false; render();
    try {
      await switcher.activate(target);
      if (target === kind) {
        activeTab = key;
        if (kind === "regular") onRegularTab?.(key);
        else await staffRemote?.hydrateExperience?.(dataContext.getExperienceState());
      } else {
        const url = new URL(target === "nli" ? "nli-staff-remote.html" : "remote-controller.html", win.location.href);
        if (target === "regular") url.searchParams.set("tab", key);
        win.location.assign(`${url.pathname}${url.search}`);
      }
    } catch (error) {
      failed = true; failureReason = error.code || error.details?.reason;
      console.error("[remote] Experience switch failed", error);
    } finally { switching = false; render(); }
  };
  const cancelSwitch = async () => {
    switching = true; render();
    try { await switcher.cancelPending(); failed = false; }
    catch (error) { failed = true; console.error("[remote] Switch recovery failed", error); }
    finally { switching = false; render(); }
  };
  cancel.addEventListener("click", cancelSwitch);
  nav.addEventListener("click", click);
  const unsubscribe = dataContext.subscribe("experienceState", render);
  const unsubscribeConnection = dataContext.subscribe("connection", render);
  win.addEventListener(LOCALE_EVENT, render);
  if (kind === "regular") onRegularTab?.(activeTab);
  render();
  return () => {
    unsubscribe?.(); unsubscribeConnection?.(); nav.removeEventListener("click", click); win.removeEventListener(LOCALE_EVENT, render);
    cancel.removeEventListener("click", cancelSwitch);
    banner.remove(); if (ownsNav) nav.remove(); if (content) content.inert = false;
  };
}
