import { getLocale, t, LOCALE_EVENT } from "./remote-locale.js";

export function createStaffRemoteUpdateView({ document: doc = globalThis.document, updates }) {
  const element = doc.createElement("aside");
  element.className = "staff-updates";
  const controls = doc.createElement("div"); controls.className = "staff-update-controls";
  const reminder = doc.createElement("button"); reminder.type = "button"; reminder.dataset.updateReminder = "";
  const setup = doc.createElement("button"); setup.type = "button";
  const setupError = doc.createElement("p"); setupError.setAttribute("role", "alert");
  reminder.className = setup.className = "staff-update-reminder";
  controls.append(reminder, setup, setupError);
  const dialog = doc.createElement("dialog"); dialog.className = "staff-update-dialog";
  dialog.setAttribute("aria-labelledby", "staff-update-title"); dialog.setAttribute("aria-describedby", "staff-update-body");
  const title = doc.createElement("h2"); title.id = "staff-update-title";
  const body = doc.createElement("p"); body.id = "staff-update-body"; body.className = "staff-update-body"; body.setAttribute("aria-live", "polite");
  const actions = doc.createElement("div"); actions.className = "staff-update-actions";
  const refresh = doc.createElement("button"); refresh.type = "button"; refresh.dataset.updateRefresh = ""; refresh.className = "staff-update-button staff-update-primary";
  const dismiss = doc.createElement("button"); dismiss.type = "button"; dismiss.dataset.updateDismiss = ""; dismiss.className = "staff-update-button";
  actions.append(refresh, dismiss); dialog.append(title, body, actions); element.append(controls, dialog);
  (doc.querySelector(".app") || doc.body).append(element);
  let savedFocus = null, state = updates.getState();

  function close() {
    if (!dialog.open) return;
    if (typeof dialog.close === "function") dialog.close(); else dialog.removeAttribute("open");
    const target = savedFocus?.isConnected && savedFocus !== doc.body && savedFocus !== doc.documentElement && !savedFocus.disabled && !savedFocus.hidden ? savedFocus :
      !reminder.hidden && !reminder.disabled ? reminder : doc.querySelector("#homeBtn:not([hidden]):not(:disabled), #fullscreenBtn:not(:disabled)");
    target?.focus(); savedFocus = null;
  }
  function render(value) {
    state = value;
    element.dir = dialog.dir = getLocale() === "he" ? "rtl" : "ltr";
    element.lang = getLocale();
    reminder.hidden = state.mode !== "reminder";
    reminder.disabled = !state.canRefresh;
    reminder.textContent = t(state.canRefresh ? "updateReminder" : "updateBusyReminder");
    setup.hidden = state.registration === "registered";
    setup.disabled = state.setupPending;
    setup.textContent = t(state.setupPending ? "updateRegistering" : "updateRegister");
    setupError.hidden = !state.error || setup.hidden;
    setupError.textContent = t("updateRegisterFailed");
    controls.hidden = reminder.hidden && setup.hidden && setupError.hidden;
    const modal = ["ready", "checking", "offline", "failed"].includes(state.mode);
    const prefix = ({ checking: "updateChecking", offline: "updateOffline", failed: "updateFailed" })[state.mode] || "update";
    title.textContent = t(prefix + "Title"); body.textContent = t(prefix + "Body");
    refresh.textContent = t(state.mode === "failed" ? "updateRetry" : "updateRefresh"); refresh.disabled = !state.canRefresh;
    dismiss.textContent = t(state.mode === "ready" ? "updateLater" : "updateContinue");
    if (modal) {
      if (!dialog.open) {
        savedFocus = doc.activeElement;
        if (typeof dialog.showModal === "function") dialog.showModal(); else dialog.setAttribute("open", "");
        dismiss.focus();
      } else if (refresh.disabled && doc.activeElement === refresh) dismiss.focus();
      if (state.mode === "checking") dismiss.focus();
    } else close();
  }
  refresh.addEventListener("click", () => { void updates.refresh(); });
  dismiss.addEventListener("click", () => updates.dismiss());
  reminder.addEventListener("click", () => updates.reopen());
  setup.addEventListener("click", () => {
    const replacement = state.activeDeviceId || null;
    if (replacement && !doc.defaultView.confirm(t("updateReplaceConfirm"))) return;
    void updates.register({ replaceDeviceId: replacement });
  });
  dialog.addEventListener("cancel", event => { event.preventDefault(); updates.dismiss(); });
  dialog.addEventListener("keydown", event => {
    if (event.key === "Escape") { event.preventDefault(); updates.dismiss(); }
    if (event.key === "Tab") {
      const first = refresh.disabled ? dismiss : refresh;
      if (event.shiftKey && doc.activeElement === first) { event.preventDefault(); dismiss.focus(); }
      else if (!event.shiftKey && doc.activeElement === dismiss) { event.preventDefault(); first.focus(); }
    }
  });
  const onLocale = () => render(state);
  doc.defaultView.addEventListener(LOCALE_EVENT, onLocale);
  const unsubscribe = updates.subscribe(render);
  return { element, dispose() { close(); unsubscribe(); doc.defaultView.removeEventListener(LOCALE_EVENT, onLocale); element.remove(); } };
}
