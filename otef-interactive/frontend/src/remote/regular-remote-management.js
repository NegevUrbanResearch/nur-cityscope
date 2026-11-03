import { createStaffRemoteDocumentIdentity, createStaffRemoteManagement } from "./staff-remote-management.js";
import { createStaffRemoteReload } from "./staff-remote-reload.js";
import { createStaffRemoteUpdates } from "./staff-remote-updates.js";
import { createStaffRemoteUpdateView } from "./staff-remote-update-view.js";
import { createStaffRemoteUpdateApi, readFrontendBuildId } from "../shared/staff-remote-update-api.js";
import { OTEF_API } from "../shared/api-client.js";
import { getRegularRemoteRefreshState, isCanonicalRegularIdle } from "./regular-remote-refresh.js";

export function installRegularRemoteManagement({ dataContext, loadedBuildId, window: win = window, document: doc = document }) {
  let sessionStorage = null, localStorage = null;
  try { sessionStorage = win.sessionStorage; } catch { /* reload fails closed without storage */ }
  try { localStorage = win.localStorage; } catch { /* update registration reports unavailable storage */ }
  const socket = dataContext.getManagementSocket();
  const ids = createStaffRemoteDocumentIdentity({ storage: sessionStorage });
  const pointers = new Set();
  const inputBaselines = new WeakMap();
  const dirtyInputs = new Set();
  let updates = null;
  const hasDirtyInputs = () => {
    for (const target of dirtyInputs) if (!target.isConnected) dirtyInputs.delete(target);
    return dirtyInputs.size > 0;
  };
  const getRefreshState = () => getRegularRemoteRefreshState({ dataContext,
    busy: pointers.size > 0 || hasDirtyInputs() || OTEF_API.hasPendingWrites("otef") ||
      win.slideshowTabController?.settingsPersistence?.hasPending?.() === true });
  const readCanonicalState = async ({ signal }) => {
    const response = await win.fetch(`${OTEF_API.baseUrl}/otef/`, { signal, cache: "no-store" });
    if (!response.ok) throw new Error(`Failed to fetch canonical state: ${response.status}`);
    return response.json();
  };
  const reloadController = createStaffRemoteReload({ getRefreshState, readCanonicalState, canonicalBlockReason: "owned_session",
    isCanonicalRefreshSafe: snapshot => isCanonicalRegularIdle(snapshot) &&
      snapshot.experience_state.revision === dataContext.getExperienceState()?.revision,
    isConnected: () => socket.getConnected(), storage: sessionStorage, ...ids, reload: () => win.location.reload() });
  const management = createStaffRemoteManagement({ socket, ids, reloadController, buildId: loadedBuildId,
    getDeviceId: () => updates?.getStoredDeviceId() ?? null, getRefreshState, readCanonicalState,
    storage: sessionStorage, window: win, document: doc });
  updates = createStaffRemoteUpdates({ api: createStaffRemoteUpdateApi(), readBuildId: () => readFrontendBuildId(),
    loadedBuildId, socket, reloadController, getIdentity: management.getIdentity,
    reportBinding: management.reportDeviceBinding, getRefreshState, localStorage, document: doc, window: win });
  const view = createStaffRemoteUpdateView({ document: doc, updates, busyReminderKey: "updateRegularBusyReminder" });
  const changed = () => {
    if (getRefreshState().refreshBlockReason === null) management.noteHomeSuccess();
    updates.refreshStateChanged();
  };
  const editable = target => !view.element?.contains(target) && target?.matches?.("input, textarea, select") ? target : null;
  const inputValue = target => target.type === "checkbox" || target.type === "radio" ? target.checked : target.value;
  const onFocusIn = event => {
    const target = editable(event.target);
    if (target && !dirtyInputs.has(target)) inputBaselines.set(target, inputValue(target));
  };
  const afterInputHandlers = callback => queueMicrotask(() => { if (!disposed) { callback?.(); changed(); } });
  const onInput = event => {
    const target = editable(event.target);
    if (!target) return;
    if (inputBaselines.has(target) && inputBaselines.get(target) === inputValue(target)) dirtyInputs.delete(target);
    else dirtyInputs.add(target);
    afterInputHandlers();
  };
  const onChange = event => {
    const target = editable(event.target);
    if (!target) return;
    const committed = inputValue(target);
    dirtyInputs.add(target);
    afterInputHandlers(() => {
      inputBaselines.set(target, committed);
      if (inputValue(target) === committed) dirtyInputs.delete(target);
    });
  };
  let lastState = JSON.stringify(getRefreshState());
  const timer = win.setInterval(() => {
    const state = JSON.stringify(getRefreshState());
    if (state !== lastState) { lastState = state; changed(); }
  }, 500);
  const onPointerDown = event => {
    if (view.element?.contains(event.target)) return;
    pointers.add(event.pointerId); changed();
  };
  const onPointerEnd = event => { if (pointers.delete(event.pointerId)) changed(); };
  const onBlur = () => { pointers.clear(); changed(); };
  doc.addEventListener("pointerdown", onPointerDown, true);
  doc.addEventListener("focusin", onFocusIn, true);
  doc.addEventListener("input", onInput, true);
  doc.addEventListener("change", onChange, true);
  win.addEventListener("pointerup", onPointerEnd, true);
  win.addEventListener("pointercancel", onPointerEnd, true);
  win.addEventListener("blur", onBlur);
  const stops = ["experienceState", "narrativeState", "investigationClock", "projectionSlideshow", "connection"].map(topic =>
    dataContext.subscribe(topic, changed));
  changed();
  let disposed = false;
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    win.clearInterval(timer);
    stops.forEach(stop => stop?.());
    doc.removeEventListener("pointerdown", onPointerDown, true);
    doc.removeEventListener("focusin", onFocusIn, true);
    doc.removeEventListener("input", onInput, true);
    doc.removeEventListener("change", onChange, true);
    dirtyInputs.clear();
    win.removeEventListener("pointerup", onPointerEnd, true);
    win.removeEventListener("pointercancel", onPointerEnd, true);
    win.removeEventListener("blur", onBlur);
    win.removeEventListener("pagehide", onPageHide);
    view.dispose(); updates.dispose(); management.dispose(); reloadController.dispose();
  };
  const onPageHide = event => { if (!event.persisted) dispose(); };
  win.addEventListener("pagehide", onPageHide);
  return { dispose, getRefreshState };
}
