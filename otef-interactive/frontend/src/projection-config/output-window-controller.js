import { createDisplayIdentifier, numberDisplays } from "./display-identification.js";

const ASSIGNMENTS_STORAGE_KEY = "otef.projection.display-assignments.v1";
const OUTPUTS = ["left", "right"];
const FULLSCREEN_TIMEOUT_MS = 10000;

function browserUrl(base, span) {
  const url = new URL(base, typeof window !== "undefined" ? window.location.href : "http://localhost/");
  url.searchParams.set("span", span);
  url.searchParams.set("outputMode", "browser");
  return url.href;
}

function finite(value) { return Number.isFinite(Number(value)); }
function number(value) { return Number(value); }
function displayBounds(display) { return { left: number(display.left), top: number(display.top), width: number(display.width), height: number(display.height) }; }
function sameBounds(a, b) { return ["left", "top", "width", "height"].every((key) => number(a?.[key]) === number(b?.[key])); }

function normalizeDisplay(display) {
  const bounds = displayBounds(display || {});
  if (typeof display?.label !== "string" || !Object.values(bounds).every(finite) || bounds.width <= 0 || bounds.height <= 0) {
    throw new Error("window-management returned an invalid display description");
  }
  const key = `${display.label}\u0000${bounds.left},${bounds.top},${bounds.width},${bounds.height}`;
  return { key, label: display.label, ...bounds,
    availLeft: finite(display.availLeft) ? number(display.availLeft) : bounds.left,
    availTop: finite(display.availTop) ? number(display.availTop) : bounds.top,
    availWidth: finite(display.availWidth) ? number(display.availWidth) : bounds.width,
    availHeight: finite(display.availHeight) ? number(display.availHeight) : bounds.height };
}

function assignmentFor(display) { return { label: display.label, bounds: displayBounds(display) }; }
function parseAssignments(storage) {
  if (!storage?.getItem) return { left: null, right: null };
  try {
    const value = JSON.parse(storage.getItem(ASSIGNMENTS_STORAGE_KEY) || "null");
    return { left: typeof value?.left?.label === "string" && value?.left?.bounds ? value.left : null, right: typeof value?.right?.label === "string" && value?.right?.bounds ? value.right : null };
  } catch { return { left: null, right: null }; }
}
function saveAssignments(storage, assignments) {
  if (!storage?.setItem) return false;
  try { storage.setItem(ASSIGNMENTS_STORAGE_KEY, JSON.stringify(assignments)); return true; } catch { return false; }
}
function makeSessionId(value) {
  if (String(value || "").trim()) return String(value).replace(/[^a-z0-9_-]+/gi, "-");
  try { return globalThis.crypto?.randomUUID?.() || `session-${Date.now()}`; } catch { return `session-${Date.now()}`; }
}
function errorMessage(error) { return String(error?.message || error || "Unable to control browser projection outputs"); }
function screenMatchesAssignment(screen, assignment) { return typeof assignment?.label === "string" && screen.label === assignment.label && sameBounds(screen, assignment.bounds); }
function buildWindowFeatures(base, screen) {
  const kept = String(base || "").split(",").map((item) => item.trim()).filter((item) => item && !/^(left|top|width|height)=/i.test(item));
  const bounds = [["left", screen.availLeft ?? screen.left], ["top", screen.availTop ?? screen.top], ["width", screen.availWidth ?? screen.width], ["height", screen.availHeight ?? screen.height]];
  return [...kept, ...bounds.map(([key, value]) => `${key}=${Math.round(value)}`)].join(",");
}

function childScreenFor(details, assignment) {
  const screens = Array.isArray(details?.screens) ? details.screens : [];
  const matches = screens.filter((screen) => screenMatchesAssignment(normalizeDisplay(screen), assignment));
  if (matches.length === 0) throw new Error("fullscreen target display is unavailable in the output window");
  if (matches.length > 1) throw new Error("fullscreen target display is ambiguous in the output window");
  return matches[0];
}

export function createOutputWindowController({
  open = globalThis.open, location = "projection.html", features = "popup,width=1920,height=1080", screenApi = globalThis,
  navigatorApi = screenApi?.permissions ? screenApi : (screenApi?.navigator || globalThis.navigator),
  storage = (() => { try { return globalThis.localStorage; } catch { return null; } })(), sessionId,
} = {}) {
  const owned = new Map(); const trackers = new Map(); const subscriptions = new Set(); const assignments = parseAssignments(storage); const id = makeSessionId(sessionId);
  const identifier = createDisplayIdentifier({ open, location, sessionId: id });
  let screenDetails = null;
  let watchedScreens = [];
  let disposed = false;
  const onScreensChange = () => { identifier.close(); refreshDisplays().catch(() => {}); };
  const onPageHide = () => identifier.close();
  screenApi?.addEventListener?.("pagehide", onPageHide);
  let generation = 0; let operationToken = 0; let openingPromise = null;
  let state = { screens: [], assignments, error: "", message: "Detecting connected displays…", ownedSpans: [] };
  function setState(patch) { state = { ...state, ...patch, ownedSpans: [...owned.keys()] }; subscriptions.forEach((listener) => listener(state)); return state; }
  function pruneOwned() {
    for (const [span, win] of owned) {
      if (!win?.closed) continue;
      trackers.get(span)?.cancel(new Error("browser output window closed"));
      trackers.delete(span);
      owned.delete(span);
    }
  }
  function closeOwnedWindows(predicate = () => true) {
    const failed = [];
    for (const [span, win] of owned) {
      if (!predicate(span, win)) continue;
      trackers.get(span)?.cancel(new Error("browser output opening cancelled by window cleanup"));
      trackers.delete(span);
      try {
        if (typeof win?.close !== "function") throw new Error("close API unavailable");
        win.close();
        owned.delete(span);
      } catch (error) { failed.push({ span, error }); }
    }
    return failed;
  }
  function assertCurrentOperation(token) {
    if (token !== operationToken) throw new Error("browser output opening cancelled by a newer control action");
  }
  async function readScreens() {
    const permissionQuery = navigatorApi?.permissions?.query;
    if (typeof permissionQuery === "function") {
      let permission;
      try { permission = await permissionQuery.call(navigatorApi.permissions, { name: "window-management" }); }
      catch (error) { throw new Error(`window-management permission unavailable: ${errorMessage(error)}`); }
      if (permission?.state === "denied") throw new Error("window-management permission denied; allow display identification on this workstation");
    }
    if (typeof screenApi?.getScreenDetails !== "function") throw new Error("window-management display API unavailable; use a supported workstation browser");
    const details = await screenApi.getScreenDetails();
    if (disposed) throw new Error("Display discovery cancelled.");
    if (screenDetails !== details) {
      screenDetails?.removeEventListener?.("screenschange", onScreensChange);
      screenDetails = details;
      screenDetails?.addEventListener?.("screenschange", onScreensChange);
    }
    watchedScreens.forEach((screen) => screen.removeEventListener?.("change", onScreensChange));
    watchedScreens = Array.from(details?.screens || []);
    watchedScreens.forEach((screen) => screen.addEventListener?.("change", onScreensChange));
    const screens = Array.isArray(details?.screens) ? details.screens.map(normalizeDisplay) : [];
    if (!screens.length) throw new Error("window-management returned no displays");
    return numberDisplays(screens);
  }
  function assignmentScreens(screens) {
    const result = {};
    for (const span of OUTPUTS) {
      const assignment = state.assignments[span]; const matches = screens.filter((screen) => screenMatchesAssignment(screen, assignment));
      if (!assignment || matches.length === 0) throw new Error(`${span} display assignment is missing or reconfigured; identify displays and reassign`);
      if (matches.length > 1) throw new Error(`${span} display assignment is ambiguous; identify displays and reassign`);
      result[span] = matches[0];
    }
    if (result.left.key === result.right.key) throw new Error("left and right display assignments must be distinct; identify displays and reassign");
    return result;
  }
  async function refreshDisplays() {
    try { const screens = await readScreens(); return setState({ screens, error: "", message: `${screens.length} displays detected. Identify displays shows their numbers for 5 seconds.` }).screens; }
    catch (error) {
      if (!disposed) setState({ screens: [], error: `${errorMessage(error)}. Allow display access in browser site settings, then reload.`, message: "Display detection unavailable." });
      throw error;
    }
  }
  function identifyDisplays() {
    try {
      if (!state.screens.length) throw new Error("Display detection is unavailable. Allow display access in browser site settings, then reload.");
      identifier.show(state.screens);
      setState({ error: "", message: "Display numbers shown for 5 seconds. Match them to the numbered choices below." });
      return state.screens;
    } catch (error) { setState({ error: errorMessage(error) }); throw error; }
  }
  function assignDisplays(selected) {
    const screens = state.screens; if (!screens.length) throw new Error("identify displays before saving an assignment");
    const next = {};
    for (const span of OUTPUTS) { const key = selected?.[span]; const matches = screens.filter((screen) => screen.key === key); if (!key || matches.length !== 1) throw new Error(`${span} display selection is missing or ambiguous`); next[span] = assignmentFor(matches[0]); }
    if (selected.left === selected.right) throw new Error("left and right display assignments must be distinct");
    const persisted = saveAssignments(storage, next);
    return setState({ assignments: next, error: "", message: persisted ? "Display assignment saved. Re-identify after any display change." : "Display assignment is session-only because local storage is unavailable." });
  }
  function closeBoth() {
    identifier.close();
    operationToken += 1;
    const failed = closeOwnedWindows();
    if (failed.length) return setState({ error: `Could not close ${failed.map(({ span }) => span).join(" and ")} browser output window${failed.length === 1 ? "" : "s"}.`, message: "Some browser output windows remain open; manually close them before reopening." });
    return setState({ error: "", message: "Browser projection windows closed." });
  }
  function fullscreenTracker(span, win, assignment, token, currentGeneration) {
    const initialDocument = win?.document;
    let doc; let target;
    let settled = false; let loaded = false; let resolveReady; let rejectReady; let timeoutId;
    const readiness = new Promise((resolve, reject) => { resolveReady = resolve; rejectReady = reject; });
    readiness.catch(() => {});
    const current = () => token === operationToken && owned.get(span) === win && trackers.get(span)?.generation === currentGeneration;
    const activeSpans = () => OUTPUTS.filter((candidate) => trackers.get(candidate)?.isActive?.());
    const remove = () => {
      try { win?.removeEventListener?.("load", onLoad); } catch { /* popup test doubles may not support removal */ }
      try { doc?.removeEventListener?.("fullscreenchange", onFullscreenChange); } catch { /* popup test doubles may not support removal */ }
      try { doc?.removeEventListener?.("fullscreenerror", onFullscreenError); } catch { /* popup test doubles may not support removal */ }
    };
    const settleError = (error) => {
      if (settled) return;
      clearTimeout(timeoutId);
      settled = true;
      rejectReady(error instanceof Error ? error : new Error(errorMessage(error)));
    };
    const onFullscreenChange = () => {
      if (!current()) return;
      if (doc.fullscreenElement === target) {
        if (!settled) { clearTimeout(timeoutId); settled = true; resolveReady(win); }
        const active = activeSpans();
        setState({ error: "", message: active.length === OUTPUTS.length ? "Both browser outputs fullscreen active." : `${span} fullscreen active; waiting for the other output.` });
      } else if (loaded) {
        const active = activeSpans();
        setState({ message: active.length ? `${span} fullscreen exited; ${active.join(" and ")} fullscreen remains active.` : `${span} fullscreen exited; no browser output is fullscreen active.` });
      }
    };
    const onFullscreenError = () => {
      if (!current()) return;
      settleError(new Error(`${span} fullscreen error: fullscreen request failed`));
    };
    const onLoad = async () => {
      if (loaded || !current()) return;
      const candidate = win?.document;
      if (!candidate || candidate === initialDocument) return;
      loaded = true;
      doc = candidate; target = doc.documentElement;
      if (typeof target?.requestFullscreen !== "function") { settleError(new Error(`${span} fullscreen error: fullscreen API unavailable in this browser window`)); return; }
      if (typeof doc?.addEventListener !== "function") { settleError(new Error(`${span} fullscreen error: fullscreen event API unavailable in this browser window`)); return; }
      try {
        doc.addEventListener("fullscreenchange", onFullscreenChange);
        doc.addEventListener("fullscreenerror", onFullscreenError);
      } catch (error) {
        settleError(new Error(`${span} fullscreen error: ${errorMessage(error)}`));
        return;
      }
      if (typeof win?.getScreenDetails !== "function") { settleError(new Error(`${span} fullscreen error: display details unavailable in the output window`)); return; }
      setState({ message: `${span} fullscreen pending.` });
      try {
        const details = await win.getScreenDetails();
        if (!current()) return;
        const screen = childScreenFor(details, assignment);
        await target.requestFullscreen({ screen });
        if (current() && doc.fullscreenElement === target) onFullscreenChange();
      } catch (error) {
        if (current()) settleError(new Error(`${span} fullscreen error: ${errorMessage(error)}`));
      }
    };
    try { win?.addEventListener?.("load", onLoad); } catch (error) { settleError(new Error(`${span} fullscreen error: ${errorMessage(error)}`)); }
    timeoutId = setTimeout(() => { if (current()) settleError(new Error(`${span} fullscreen error: timed out waiting for fullscreen`)); }, FULLSCREEN_TIMEOUT_MS);
    return { generation: currentGeneration, readiness, isActive: () => Boolean(doc && target && doc.fullscreenElement === target), cancel: (error) => { remove(); settleError(error); } };
  }
  function openOne(span, screen, assignment, currentGeneration, token) {
    if (typeof open !== "function") throw new Error("browser popup API unavailable");
    const url = browserUrl(location, span); const name = `otef-projector-${span}-${id}-${currentGeneration}`; const win = open(url, name, buildWindowFeatures(features, screen));
    if (!win) throw new Error(`${span} projector popup was blocked; allow popups for this workstation`);
    owned.set(span, win);
    const tracker = fullscreenTracker(span, win, assignment, token, currentGeneration);
    trackers.set(span, tracker);
    return { win, readiness: tracker.readiness };
  }
  async function performOpenBoth(token) {
    let selected;
    try {
      const screens = await readScreens();
      assertCurrentOperation(token);
      setState({ screens, error: "", message: "Current displays validated." });
      selected = assignmentScreens(screens);
    } catch (error) {
      if (token !== operationToken) throw new Error("browser output opening cancelled by a newer control action");
      const remains = owned.size ? " Existing browser output windows remain open; close them manually if needed." : "";
      setState({ error: errorMessage(error), message: `Display assignment is invalid; no new browser windows opened.${remains}` });
      throw error;
    }
    pruneOwned();
    const closeFailures = closeOwnedWindows();
    if (closeFailures.length) {
      const error = new Error("existing browser output windows could not be closed");
      setState({ error: error.message, message: "Some existing browser output windows remain open; manually close them before reopening." });
      throw error;
    }
    const currentGeneration = ++generation;
    assertCurrentOperation(token);
    try {
      const opened = [openOne("left", selected.left, state.assignments.left, currentGeneration, token), openOne("right", selected.right, state.assignments.right, currentGeneration, token)];
      await Promise.all(opened.map(({ readiness }) => readiness));
      assertCurrentOperation(token);
      return setState({ error: "", message: "Browser outputs opened fullscreen on their assigned displays." }).ownedSpans;
    }
    catch (error) {
      const failed = closeOwnedWindows();
      if (token !== operationToken) throw error;
      const cleanupMessage = failed.length ? " Some newly opened windows remain; close them manually." : " Any newly opened window was closed.";
      setState({ error: `${errorMessage(error)}${failed.length ? " Cleanup incomplete." : ""}`, message: `Browser output opening failed.${cleanupMessage}` });
      throw error;
    }
  }
  function openBoth() {
    identifier.close();
    if (openingPromise) return openingPromise;
    const token = ++operationToken;
    const pending = performOpenBoth(token);
    const wrapped = pending.finally(() => { if (openingPromise === wrapped) openingPromise = null; });
    openingPromise = wrapped;
    return wrapped;
  }
  return {
    refreshDisplays, identifyDisplays, assignDisplays, openBoth, closeBoth,
    dispose() {
      disposed = true;
      identifier.close();
      screenDetails?.removeEventListener?.("screenschange", onScreensChange);
      watchedScreens.forEach((screen) => screen.removeEventListener?.("change", onScreensChange));
      screenApi?.removeEventListener?.("pagehide", onPageHide);
      subscriptions.clear();
    },
    getState: () => ({ ...state, screens: [...state.screens], assignments: { ...state.assignments }, ownedSpans: [...owned.keys()] }),
    getOwnedWindows: () => { pruneOwned(); return new Map(owned); },
    subscribe(listener) { subscriptions.add(listener); listener(state); return () => subscriptions.delete(listener); },
  };
}

export { ASSIGNMENTS_STORAGE_KEY, FULLSCREEN_TIMEOUT_MS, browserUrl, normalizeDisplay };
