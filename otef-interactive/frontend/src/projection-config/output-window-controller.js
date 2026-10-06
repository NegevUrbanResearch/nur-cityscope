import { createDisplayIdentifier, numberDisplays } from "./display-identification.js";

const ASSIGNMENTS_STORAGE_KEY = "otef.projection.display-assignments.v1";
const REVERSE_MODEL_STORAGE_KEY = "otef.projection.reverse-model.v1";
const RESOLUTIONS_STORAGE_KEY = 'otef.projection.output-resolutions.v1';
const OUTPUTS = ["left", "right"];
const FULLSCREEN_TIMEOUT_MS = 10000;

function browserUrl(base, span, reverseModel = false, resolution = '1080p') {
  const url = new URL(base, typeof window !== "undefined" ? window.location.href : "http://localhost/");
  if (reverseModel) url.pathname = url.pathname.replace(/[^/]*$/, "projection-reversed.html");
  url.searchParams.set("span", span);
  url.searchParams.set("outputMode", "browser");
  if (resolution === '4k') url.searchParams.set('outputResolution', '4k');
  else url.searchParams.delete('outputResolution');
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
function readReverseModel(storage) {
  try { return storage?.getItem?.(REVERSE_MODEL_STORAGE_KEY) === "true"; } catch { return false; }
}
function readResolutions(storage) {
  let value;
  try { value = JSON.parse(storage?.getItem?.(RESOLUTIONS_STORAGE_KEY) || 'null'); } catch { /* use lab defaults */ }
  return Object.fromEntries(OUTPUTS.map(side => [side, value?.[side] === '4k' ? '4k' : '1080p']));
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
  const launchUrls = new Map();
  const identifier = createDisplayIdentifier({ open, location, sessionId: id });
  let screenDetails = null;
  let liveScreens = null;
  const sideErrors = new Map();
  let watchedScreens = [];
  let disposed = false;
  const onScreensChange = () => { liveScreens = null; identifier.close(); setState({ screens: [], message: "Display layout changed; refreshing display detection." }); refreshDisplays().catch(() => {}); };
  const onPageHide = () => identifier.close();
  screenApi?.addEventListener?.("pagehide", onPageHide);
  let generation = 0; let operationToken = 0; let openingPromise = null;
  const supported = typeof screenApi?.getScreenDetails === "function";
  let state = { screens: [], assignments, supported, reverseModel: readReverseModel(storage), resolutions: readResolutions(storage), error: "", message: supported ? "Detecting connected displays…" : "Display management unavailable in this browser.", ownedSpans: [] };
  function setState(patch) { state = { ...state, ...patch, ownedSpans: [...owned.keys()] }; subscriptions.forEach((listener) => listener(state)); return state; }
  function setReverseModel(value) {
    if (openingPromise) throw new Error("Wait for output opening to finish before changing model orientation.");
    const reverseModel = value === true;
    let persisted = false;
    try { if (storage?.setItem) { storage.setItem(REVERSE_MODEL_STORAGE_KEY, String(reverseModel)); persisted = true; } } catch { /* keep the session setting */ }
    return setState({ reverseModel, error: "", message: `Model orientation ${persisted ? 'saved' : 'is session-only'}. Use Open to apply it to outputs.` });
  }
  function setResolution(side, resolution) {
    if (!OUTPUTS.includes(side) || !['1080p', '4k'].includes(resolution)) throw new Error('Invalid output resolution.');
    if (openingPromise) throw new Error('Wait for output opening to finish before changing resolution.');
    const resolutions = { ...state.resolutions, [side]: resolution };
    let persisted = false;
    try { if (storage?.setItem) { storage.setItem(RESOLUTIONS_STORAGE_KEY, JSON.stringify(resolutions)); persisted = true; } } catch { /* keep session setting */ }
    return setState({ resolutions, error: '', message: `${side === 'left' ? 'Left' : 'Right'} ${resolution === '4k' ? '4K · 3840 × 2160' : '1080p · 1920 × 1080'} ${persisted ? 'saved on this workstation' : 'is session-only'}. Use Open to apply.` });
  }
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
    liveScreens = numberDisplays(screens);
    return liveScreens;
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
      liveScreens = null;
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
    let settled = false; let loaded = false; let resolveReady; let rejectReady; let timeoutId; let verifiedScreen = null;
    const retryCancels = new Set();
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
        if (active.includes(span)) sideErrors.delete(span);
        setState({ error: sideErrors.size ? [...sideErrors.values()].join("; ") : (active.length === OUTPUTS.length ? "" : state.error), message: active.length === OUTPUTS.length ? "Both browser outputs fullscreen active." : `${span} fullscreen active; waiting for the other output.` });
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
        verifiedScreen = screen;
        await target.requestFullscreen({ screen });
        if (current() && doc.fullscreenElement === target) onFullscreenChange();
      } catch (error) {
        if (current()) settleError(new Error(`${span} fullscreen error: ${errorMessage(error)}`));
      }
    };
    try { win?.addEventListener?.("load", onLoad); } catch (error) { settleError(new Error(`${span} fullscreen error: ${errorMessage(error)}`)); }
    timeoutId = setTimeout(() => { if (current()) settleError(new Error(`${span} fullscreen error: timed out waiting for fullscreen`)); }, FULLSCREEN_TIMEOUT_MS);
    const retry = () => {
      try { win?.focus?.(); } catch { /* focus is best effort */ }
      if (!current() || !doc || !target || !verifiedScreen || !liveScreens || typeof target.requestFullscreen !== "function") {
        throw new Error(`${span} fullscreen retry unavailable; identify displays and verify the assignment first`);
      }
      try {
        assignmentScreens(liveScreens);
        if (!screenMatchesAssignment(normalizeDisplay(verifiedScreen), state.assignments[span])) throw new Error("the verified output screen no longer matches its current assignment");
      } catch { throw new Error(`${span} fullscreen retry unavailable; identify displays and reassign the projector first`); }
      if (doc.fullscreenElement === target) return Promise.resolve(win);
      setState({ message: `${span} fullscreen retry pending.` });
      const retryReady = new Promise((resolve, reject) => {
        let retryTimer; let retrySettled = false;
        const finish = (fn, value) => {
          if (retrySettled) return;
          retrySettled = true;
          clearTimeout(retryTimer);
          doc.removeEventListener?.("fullscreenchange", onRetryChange);
          retryCancels.delete(cancelRetry);
          fn(value);
        };
        const onRetryChange = () => {
          if (!current()) { finish(reject, new Error("browser output opening cancelled by a newer control action")); return; }
          if (doc.fullscreenElement === target) finish(resolve, win);
        };
        const cancelRetry = (error) => finish(reject, error);
        retryCancels.add(cancelRetry);
        retryTimer = setTimeout(() => finish(reject, new Error(`${span} fullscreen error: timed out waiting for fullscreen`)), FULLSCREEN_TIMEOUT_MS);
        doc.addEventListener("fullscreenchange", onRetryChange);
        Promise.resolve(target.requestFullscreen({ screen: verifiedScreen })).catch((error) => {
          finish(reject, new Error(`${span} fullscreen error: ${errorMessage(error)}`));
        });
      });
      return retryReady;
    };
    return { generation: currentGeneration, readiness, retry, isActive: () => Boolean(doc && target && doc.fullscreenElement === target), cancel: (error) => { remove(); settleError(error); retryCancels.forEach((cancelRetry) => cancelRetry(error)); } };
  }
  function openOne(span, screen, assignment, currentGeneration, token) {
    if (typeof open !== "function") throw new Error("browser popup API unavailable");
    const url = browserUrl(location, span, state.reverseModel, state.resolutions[span]); const name = `otef-projector-${span}-${id}-${currentGeneration}`; const win = open(url, name, buildWindowFeatures(features, screen));
    if (!win) throw new Error(`${span} projector popup was blocked; allow popups for this workstation`);
    owned.set(span, win);
    launchUrls.set(span, url);
    const tracker = fullscreenTracker(span, win, assignment, token, currentGeneration);
    trackers.set(span, tracker);
    return { win, readiness: tracker.readiness };
  }
  function assignedScreensFromCache() {
    try {
      if (!liveScreens || !screenDetails || !Array.isArray(screenDetails.screens)) throw new Error("identify displays or refresh display detection before opening outputs");
      const screens = numberDisplays(screenDetails.screens.map(normalizeDisplay));
      if (!screens.length) throw new Error("identify displays or refresh display detection before opening outputs");
      liveScreens = screens;
      setState({ screens, error: "", message: "Current displays validated." });
      return assignmentScreens(screens);
    } catch (error) {
      liveScreens = null;
      const remains = owned.size ? " Existing browser output windows remain open." : "";
      setState({ error: errorMessage(error), message: `Display assignment is invalid; no new browser windows opened.${remains}` });
      throw error;
    }
  }
  function performOpenBoth(token) {
    const selected = assignedScreensFromCache();
    assertCurrentOperation(token);
    sideErrors.clear();
    pruneOwned();
    const closeFailures = closeOwnedWindows();
    if (closeFailures.length) {
      const error = new Error("existing browser output windows could not be closed");
      setState({ error: error.message, message: "Some existing browser output windows remain open; manually close them before reopening." });
      throw error;
    }
    const currentGeneration = ++generation;
    assertCurrentOperation(token);
    const opened = []; const failures = [];
    for (const span of OUTPUTS) {
      try { opened.push({ span, ...openOne(span, selected[span], state.assignments[span], currentGeneration, token) }); }
      catch (error) { failures.push({ span, error }); }
    }
    const readiness = opened.map(({ span, readiness: ready }) => ready.then(() => ({ span }), (error) => ({ span, error })));
    return Promise.all(readiness).then((results) => {
      assertCurrentOperation(token);
      const errors = [...failures, ...results.filter((result) => result.error)];
      errors.forEach(({ span, error }) => sideErrors.set(span, `${span}: ${errorMessage(error)}`));
      const detail = errors.map(({ span, error }) => `${span}: ${errorMessage(error)}`).join("; ");
      const active = results.filter(({ span }) => trackers.get(span)?.isActive?.()).map(({ span }) => span);
      if (errors.length) {
        setState({ error: [...sideErrors.values()].join("; ") || detail, message: `${active.join(" and ") || "No"} browser output${active.length === 1 ? " is" : "s are"} fullscreen; opened windows remain available for recovery.` });
        throw new Error(detail);
      }
      return setState({ error: "", message: "Browser outputs opened fullscreen on their assigned displays." }).ownedSpans;
    });
  }
  function openBoth() {
    identifier.close();
    if (openingPromise) return openingPromise;
    const token = ++operationToken;
    let pending;
    try { pending = Promise.resolve(performOpenBoth(token)); }
    catch (error) { pending = Promise.reject(error); }
    const wrapped = pending.finally(() => { if (openingPromise === wrapped) openingPromise = null; });
    openingPromise = wrapped;
    return wrapped;
  }
  function openSide(span) {
    if (!OUTPUTS.includes(span)) return Promise.reject(new Error("unknown browser output side"));
    identifier.close();
    if (owned.get(span) && launchUrls.get(span) !== browserUrl(location, span, state.reverseModel, state.resolutions[span])) {
      try { assignedScreensFromCache(); } catch (error) { return Promise.reject(error); }
      if (closeOwnedWindows(side => side === span).length) return Promise.reject(new Error('Existing browser output could not be closed; close it manually before reopening.'));
    }
    const existing = owned.get(span);
    if (existing && !existing.closed) {
      pruneOwned();
      const tracker = trackers.get(span);
      const token = operationToken;
      const trackerGeneration = tracker?.generation;
      const stillOwned = () => token === operationToken && owned.get(span) === existing && !existing.closed && trackers.get(span) === tracker && tracker?.generation === trackerGeneration;
      try {
        const pending = tracker?.retry?.();
        return Promise.resolve(pending).then(() => {
          if (!stillOwned()) throw new Error("browser output opening cancelled by a newer control action");
          sideErrors.delete(span);
          setState({ error: [...sideErrors.values()].join("; "), message: `${span} fullscreen recovered; other browser output windows remain open.` });
        }, (error) => {
          if (!stillOwned()) throw error;
          sideErrors.set(span, `${span}: ${errorMessage(error)}`);
          setState({ error: [...sideErrors.values()].join("; "), message: `${span} output remains open. ${errorMessage(error)}. Identify displays and verify or reassign its display before retrying fullscreen.` }); throw error;
        });
      } catch (error) {
        if (!stillOwned()) return Promise.reject(error);
        sideErrors.set(span, `${span}: ${errorMessage(error)}`);
        setState({ error: [...sideErrors.values()].join("; "), message: `${span} output remains open. ${errorMessage(error)}. Identify displays and verify or reassign its display before retrying fullscreen.` });
        return Promise.reject(error);
      }
    }
    const token = operationToken;
    let selected;
    try { selected = assignedScreensFromCache()[span]; }
    catch (error) { return Promise.reject(error); }
    const currentGeneration = ++generation;
    try {
      const opened = openOne(span, selected, state.assignments[span], currentGeneration, token);
      const win = opened.win; const tracker = trackers.get(span);
      const stillOwned = () => token === operationToken && owned.get(span) === win && !win.closed && trackers.get(span) === tracker && tracker?.generation === currentGeneration;
      return opened.readiness.then(() => {
        if (!stillOwned()) throw new Error("browser output opening cancelled by a newer control action");
        sideErrors.delete(span);
        setState({ error: [...sideErrors.values()].join("; "), message: `${span} output opened fullscreen on its assigned display.` });
      }, (error) => {
        if (!stillOwned()) throw error;
        sideErrors.set(span, `${span}: ${errorMessage(error)}`);
        setState({ error: [...sideErrors.values()].join("; "), message: `${span} output remains open for fullscreen recovery.` }); throw error;
      });
    } catch (error) {
      setState({ error: errorMessage(error), message: `${span} output could not be opened. The other output remains open.` });
      return Promise.reject(error);
    }
  }
  return {
    refreshDisplays, identifyDisplays, assignDisplays, setReverseModel, setResolution, openBoth, openSide, closeBoth,
    dispose() {
      disposed = true;
      identifier.close();
      screenDetails?.removeEventListener?.("screenschange", onScreensChange);
      watchedScreens.forEach((screen) => screen.removeEventListener?.("change", onScreensChange));
      screenApi?.removeEventListener?.("pagehide", onPageHide);
      subscriptions.clear();
    },
    getState: () => ({ ...state, screens: [...state.screens], assignments: { ...state.assignments }, resolutions: { ...state.resolutions }, ownedSpans: [...owned.keys()] }),
    getOwnedWindows: () => { pruneOwned(); return new Map(owned); },
    subscribe(listener) { subscriptions.add(listener); listener(state); return () => subscriptions.delete(listener); },
  };
}

export { ASSIGNMENTS_STORAGE_KEY, REVERSE_MODEL_STORAGE_KEY, FULLSCREEN_TIMEOUT_MS, browserUrl, normalizeDisplay };
