import { getEffectiveLayerGroups } from "../shared/layer-state-helper.js";
import {
  createNliStaffTimelineHost,
  staffPlaybackConfig,
} from "./nli-staff-timeline-host.js";
import { finiteClockMinutes, NLI_PLAYABLE_IDS } from "../shared/nli-investigation-beats.js";
import { createPresenterDatasetGate } from "./nli-presenter-content.js";
import presenterContent from "./nli-presenter-content.json" with { type: "json" };
import { buildPresenterSnapshot } from "./nli-presenter-snapshot.js";
import { createPresenterCommands } from "./nli-presenter-commands.js";
import { createPresenterView } from "./nli-presenter-view.js";
import { consumeNliNovaEscapeClick, nliNovaEscapeTogglesHtml } from "./nli-nova-escape-toggles.js";
import { buildNovaEndedClock, commitSceneLayers, createCueRunner } from "./nli-staff-cues.js";
import { createNliStaffSearchTransition } from "./nli-staff-search-transition.js";
import { createPeopleSearchRuntime } from "./remote-people-search.js";
import { createNliStaffFontController } from "./nli-staff-fonts.js";
import { NLI_FONT_DEFAULTS } from "../shared/nli-font-settings.js";
import {
  createRemotePeopleArchiveController,
  waitForInvestigationClockIdle,
} from "./remote-people-archive-controller.js";
import { createStaffFullscreenControl } from "./nli-staff-fullscreen.js";
import { labelForPlace, placeIsWithinRemoteBounds } from "./remote-place-navigation.js";
import { applyServerLocale, bindLocaleButtons, getLocale, messageForLocale, t, LOCALE_EVENT } from "./remote-locale.js";
import { homeListHtml } from "./nli-staff-home.js";
import { navigationButtonContent } from "./nli-staff-icons.js";
import { COPY, HOME_CUE, NARRATIVES, SCRIPTS, SHOW } from "./nli-staff-script.js";
import { isCanonicalHome } from "./staff-remote-refresh-guard.js";
import { createNliStaffNavigationSession } from "./nli-staff-navigation-session.js";
import { hasSceneStrip, navigationLabel, optionalStoryActions, optionalStoryContext, storyChooserHtml } from "./nli-staff-navigation-view.js";
import { nextAction, showStepIndex, slideIndexes } from "./nli-staff-flow.js";
import { searchPlaces } from "../shared/place-navigation/place-catalog.js";
import {
  createNliStaffPresentationButtonHandler,
  createNliStaffPresentationController,
  nliPresentationUsesRemoteControls,
  presentationControlsHtml,
  shouldAutoOpenNliPresentation,
} from "./nli-staff-presentation.js";
import {
  archiveControlsHtml,
  createArchivePageHold,
} from "./nli-staff-archive-controls.js";

const NO_ESCAPE = Object.freeze({ individual: false, overlap: false, mor: false, settled: false });
const STAFF_PEOPLE_SEARCH_OPTIONS = { excludeStatuses: ["Kidnap survivor"] };

const $ = (id) => document.getElementById(id);

export function createNliStaffPlaceFocusOwnership() {
  let owner = null;
  let cancellationTail = Promise.resolve();
  const isAcknowledged = (result) => result?.ok === true || result?.status === "ok";

  return {
    start(name, navigate) {
      const request = { name, pending: true, settled: null };
      owner = request;
      request.settled = cancellationTail.catch(() => undefined).then(() => navigate()).finally(() => {
        request.pending = false;
      });
      return request;
    },
    release(request) {
      if (owner !== request) return false;
      owner = null;
      return true;
    },
    async waitForNavigation() {
      const request = owner;
      if (request?.pending) await request.settled.then(() => undefined, () => undefined);
    },
    hasFocus() {
      return Boolean(owner);
    },
    getName() {
      return owner?.name || null;
    },
    cancel(cancelNavigationFocus) {
      const ownerAtStart = owner;
      const cancellation = cancellationTail.catch(() => undefined).then(async () => {
        const result = await cancelNavigationFocus?.();
        if (isAcknowledged(result) && owner === ownerAtStart) owner = null;
        return result;
      });
      cancellationTail = cancellation;
      return cancellation;
    },
  };
}

export function createNliStaffSearchEventHandlers({
  transition,
  cancelCues = () => {},
  isPending = () => false,
  setPending = () => {},
  renderPending = () => {},
  restoreLiveSearchLabel = () => {},
  showClearFailed = () => {},
  clearSearchUi = () => {},
  setDestination = () => {},
  renderDestination = () => {},
  applyDestinationCue = () => {},
  runDestinationTransition,
  beforeTransition = () => {},
  onNavigationCleanupComplete = () => {},
  afterDestinationCue = () => {},
} = {}) {
  function failClear(token) {
    if (!transition.isCurrent(token)) return false;
    setPending(false);
    restoreLiveSearchLabel();
    showClearFailed();
    renderPending();
    return false;
  }

  async function transitionToStep(item, index, returnTo, operationContext = null) {
    if (!item) return false;
    const token = transition.begin();
    cancelCues();
    setPending(true);
    renderPending();
    let prepared = false;
    try {
      const prepareDestination = async (isCueCurrent = () => true) => {
        const live = () => transition.isCurrent(token) && isCueCurrent();
        if (!live()) return false;
        const before = beforeTransition(item, index);
        const closed = before && typeof before.then === "function" ? await before : before;
        if (!live() || closed === false) return false;
        const cleared = await transition.clearAll(token);
        if (!live()) return false;
        if (!cleared) return failClear(token);
        clearSearchUi();
        onNavigationCleanupComplete();
        setPending(false);
        renderPending();
        setDestination(item, index, returnTo);
        renderDestination();
        prepared = true;
        return true;
      };
      let cueResult;
      if (runDestinationTransition) {
        cueResult = await runDestinationTransition(item, index, prepareDestination, operationContext);
      } else {
        if (!await prepareDestination()) return false;
        cueResult = await applyDestinationCue(item, index);
      }
      if (!transition.isCurrent(token)) return false;
      afterDestinationCue(item, index, cueResult, operationContext);
      if (!prepared) return false;
      return true;
    } finally {
      if (transition.isCurrent(token)) {
        setPending(false);
        renderPending();
      }
    }
  }

  async function selectWithClear(kind, value, action) {
    if (isPending()) return false;
    const token = transition.begin();
    setPending(true);
    renderPending();
    const cleared = await transition[kind](token);
    if (!transition.isCurrent(token)) return false;
    if (!cleared) return failClear(token);
    let result;
    try {
      result = await action(value, token);
    } finally {
      if (transition.isCurrent(token)) {
        setPending(false);
        renderPending();
      }
    }
    return transition.isCurrent(token) ? result : false;
  }

  return {
    transitionToStep,
    selectPerson: (person, action) => selectWithClear("beforePerson", person, action),
    selectPlace: (place, action) => selectWithClear("beforePlace", place, action),
  };
}

export function initNliStaffLocaleControls(dataContext, { onFailure } = {}) {
  return bindLocaleButtons({
    heButton: $("localeHe"),
    enButton: $("localeEn"),
    dataContext,
    onFailure,
  });
}

export function initNliStaffRemote(dataContext, {
  presenterManifest = presenterContent,
  onHomeSuccess,
  getNliFontChoices = () => ({ ...NLI_FONT_DEFAULTS }),
  onNliFontError = (error) => console.warn("[nli-staff-remote] NLI staff font unavailable", error),
  navigationSession = createNliStaffNavigationSession(),
} = {}) {
  dataContext.setExhibitMode(true);
  const releaseExhibitMode = () => {
    dataContext.setExhibitMode(false);
  };
  window.addEventListener("pagehide", releaseExhibitMode);
  window.addEventListener("beforeunload", releaseExhibitMode);
  const peopleSearch = createPeopleSearchRuntime();
  const staffFonts = createNliStaffFontController({ document, getLocale, onError: onNliFontError });
  const placeFocusOwnership = createNliStaffPlaceFocusOwnership();
  void peopleSearch.load().catch(() => {});

  const state = {
    screen: "home",
    scriptId: null,
    step: 0,
    returnTo: null,
    cueStatus: null,
    cueAttempt: null,
    failedCue: null,
    navigationFailure: false,
    presenterError: null,
    connected: false,
    connectionStatus: "disconnected",
    scene: null,
    searchError: null,
    placeName: null,
    searchPending: false,
    navigationPending: false,
    presentationClosePending: false,
    homeFailure: false,
    homeReady: false,
  };

  let lastPlaces = [];
  let archiveUiReady = false;
  let peopleArchive = null;
  let archivePageHold = null;
  let searchTransition = null;
  let searchActions = null;
  let presentation = null;
  const fullscreenLabels = { enter: "", exit: "", unavailable: "" };
  const fullscreen = createStaffFullscreenControl({
    root: document.querySelector(".app"),
    button: $("fullscreenBtn"),
    status: $("fullscreenStatus"),
    labels: fullscreenLabels,
  });
  let navigationGeneration = 0;
  let activeNavigationAttempt = null;
  let failedNavigationAttempt = null;
  let presenterGeneration = 0;
  let presenterGate;
  let presenterCommands;
  let presenterView;
  let disposed = false;
  let paintingTimeline = false;
  let storyChooserOpen = false;
  let chooserOpenerKey = "navigation-choose";
  let chooserFocusKey = "story-sderot";

  const timelineHost = createNliStaffTimelineHost({
    sheet: $("kitTimeline"),
    getGroups() {
      try {
        return getEffectiveLayerGroups() || [];
      } catch {
        return [];
      }
    },
    render() {
      paintTimelineMounts();
    },
    paintPlayhead() {
      if (presenterView && !disposed) presenterView.update(currentPresenterSnapshot());
    },
    cacheChanged() {
      presenterGeneration += 1;
      presenterCommands?.invalidate();
      void presenterGate?.refresh();
      if (presenterView && !disposed) presenterView.update(currentPresenterSnapshot());
    },
  });

  const escapeHost = {
    setEscapeOverlay: (patch) => {
      const overlay = { ...NO_ESCAPE, ...dataContext.getEscapeOverlay?.(), ...patch };
      if (currentStep()?.cue?.escape?.settled === true && typeof patch.individual === "boolean") {
        overlay.settled = !patch.individual;
      }
      return dataContext?.setEscapeOverlay?.(overlay);
    },
  };

  const loc = (value) => (value ? value[getLocale()] || value.he || "" : "");
  const txt = (key, vars) => {
    let value = COPY[getLocale()]?.[key] || COPY.he[key] || "";
    if (vars) {
      Object.keys(vars).forEach((name) => {
        value = value.replaceAll(`{{${name}}}`, vars[name]);
      });
    }
    return value;
  };
  const script = () => SCRIPTS.find((item) => item.id === state.scriptId);
  const currentStep = () => (state.screen === "player" ? script()?.steps[state.step] : null) || null;
  const stepKits = (step) => (Array.isArray(step?.kit) ? step.kit : []);
  async function setLayerSet(ids, enabled) {
    if (typeof dataContext?.setLayersEnabled !== "function" || !ids.length) return;
    try {
      await dataContext.setLayersEnabled(ids, enabled);
    } catch {
      // Keep the staff chrome even if the layer patch is rejected.
    }
  }

  async function ensureClockIdle(isCurrent = () => true) {
    const current = dataContext?.getInvestigationClock?.();
    await waitForInvestigationClockIdle(dataContext, {
      forceStop: current?.phase !== "idle",
      isCancelled: () => !isCurrent(),
    });
    if (!isCurrent()) return;
    const clock = dataContext?.getInvestigationClock?.();
    if (clock && clock.phase !== "idle") {
      throw new Error("Investigation clock did not become idle");
    }
  }

  const cues = createCueRunner({
    dataContext,
    commitLayers: (ids) => commitSceneLayers(dataContext, ids),
    stopClock: (isCurrent) => ensureClockIdle(isCurrent),
    startClock: (window, membership, isCurrent) => timelineHost.startNliTimelineWindow({
      membership,
      from: window?.from,
      to: window?.to,
      loop: window?.loop === true,
      playLeadIn: true,
      replace: true,
      isCurrent,
    }),
    endClock: async (isCurrent) => {
      const result = await dataContext.patchInvestigationClock(buildNovaEndedClock(dataContext.getInvestigationClock()), { isCurrent });
      if (typeof isCurrent === "function" && !isCurrent()) return;
      if (!result?.ok || result.stale) {
        throw result?.error || new Error("Clock update was not acknowledged");
      }
    },
    onStatus: (status) => {
      if (disposed) return;
      state.cueStatus = status;
      if (status === "applying") state.failedCue = null;
      else if (status === "failed") state.failedCue = state.cueAttempt;
      else if (status === "ready" || status === null) state.failedCue = null;
      renderCueStatus();
      if (state.screen === "player") renderKit();
      if (state.screen === "home") renderHome();
    },
  });
  const applyCue = (cue, narrativeId, beforeApply = null) => {
    dataContext.setExhibitMode(true);
    const attempt = { cue, narrativeId, beforeApply };
    state.cueAttempt = attempt;
    return cues.apply(cue, narrativeId, beforeApply).then((result) => {
      if (state.cueAttempt === attempt && result?.status !== "failed") state.cueAttempt = null;
      return result;
    });
  };

  function manualMutationsOpen() {
    return timelineHost.isManualMutationAllowed?.() !== false;
  }

  function chooserManualMutationsOpen() {
    return !storyChooserOpen && manualMutationsOpen();
  }

  function rearmTransport() {
    const clock = dataContext?.getInvestigationClock?.() || null;
    timelineHost._syncNliPlayheadTicker?.(clock);
    timelineHost._syncNliEndedTimer?.(clock);
  }

  function applyChrome() {
    const locale = getLocale();
    document.documentElement.lang = locale === "he" ? "he" : "en";
    document.documentElement.dir = locale === "he" ? "rtl" : "ltr";
    $("localeHe").classList.toggle("is-active", locale === "he");
    $("localeEn").classList.toggle("is-active", locale === "en");
    $("localeHe").setAttribute("aria-pressed", String(locale === "he"));
    $("localeEn").setAttribute("aria-pressed", String(locale === "en"));
    document.querySelectorAll("[data-i18n]").forEach((el) => {
      el.textContent = txt(el.dataset.i18n);
    });
    document.querySelectorAll("[data-i18n-aria]").forEach((el) => {
      el.setAttribute("aria-label", txt(el.dataset.i18nAria));
    });
    document.querySelectorAll("[data-i18n-placeholder]").forEach((el) => {
      el.setAttribute("placeholder", txt(el.dataset.i18nPlaceholder));
    });
    fullscreenLabels.enter = txt("fullscreenEnter");
    fullscreenLabels.exit = txt("fullscreenExit");
    fullscreenLabels.unavailable = txt("fullscreenUnavailable");
    fullscreen.render();
    document.title = getLocale() === "he" ? "הקרנה · הספרייה הלאומית" : "Projection · National Library";
    renderConnection();
  }

  function renderConnection() {
    const el = $("staffConnection");
    const label = $("staffConnectionLabel");
    if (!el || !label) return;
    label.textContent = state.connectionStatus === "connecting"
      ? t("statusConnecting") : state.connected ? txt("connected") : txt("disconnected");
    const details = $("staffConnectionDetails");
    if (details) details.textContent = label.textContent;
    el.classList.toggle("is-on", state.connected);
  }

  function showScreen(name) {
    dataContext.setExhibitMode(true);
    state.screen = name;
    if (name !== "player") presenterView?.setVisible(false);
    document.querySelectorAll(".screen").forEach((el) => {
      const on = el.dataset.screen === name;
      el.classList.toggle("is-active", on);
      el.hidden = !on;
    });
    $("homeBtn").hidden = name === "home";
  }

  function renderHome() {
    $("narrativeList").innerHTML = homeListHtml({ locale: getLocale(), pending: state.searchPending });
  }

  function sceneCue() {
    if (state.screen === "player") return currentStep()?.cue || null;
    return null;
  }

  timelineHost.getPlaybackConfig = () => staffPlaybackConfig({
    clock: dataContext?.getInvestigationClock?.() || null,
    cue: sceneCue(),
    groups: timelineHost.getEffectiveGroupsForView(),
    manualFree: false,
  });
  timelineHost.isManualMutationAllowed = () => state.cueStatus !== "applying" && !state.searchPending;

  function canReplaceNavigation() {
    return !state.searchPending || state.navigationPending || state.presentationClosePending;
  }

  function currentPresenterSnapshot() {
    const window = currentStep()?.cue?.clock;
    const cueWindow = {
      membership: (currentStep()?.cue?.layers || []).filter((id) => NLI_PLAYABLE_IDS.includes(id)),
      from: finiteClockMinutes(window && typeof window === "object" ? window.from : null),
      to: finiteClockMinutes(window && typeof window === "object" ? window.to : null),
    };
    return buildPresenterSnapshot({
      host: timelineHost,
      clock: dataContext?.getInvestigationClock?.(),
      nowMs: dataContext?.correctedNow?.() ?? Date.now(),
      narrative: dataContext?.getNarrativeState?.(),
      sceneKey: `${state.scriptId || "home"}:${state.step}:${navigationGeneration}`,
      sceneId: currentStep()?.id || null,
      cueWindow,
      locale: getLocale(),
      manifest: presenterManifest,
      dataset: { ...presenterGate?.getState(), identity: presenterManifest.datasetVersion,
        generation: presenterGeneration },
      connected: dataContext?.isConnected?.() === true || state.connected,
      mutationAllowed: chooserManualMutationsOpen() && !state.navigationPending && !state.presentationClosePending,
    });
  }

  function paintTimelineMounts() {
    if (disposed || paintingTimeline || !presenterView) return;
    paintingTimeline = true;
    try {
      presenterView.update(currentPresenterSnapshot());
      const clock = dataContext?.getInvestigationClock?.() || null;
      timelineHost._syncNliPlayheadTicker?.(clock);
      timelineHost._syncNliEndedTimer?.(clock);
    } finally {
      paintingTimeline = false;
    }
  }

  function onPresenterError(error) {
    state.presenterError = getLocale() === "he" ? "הפעלת ציר הזמן נכשלה" : "Timeline action failed";
    presenterView?.setError(state.presenterError);
    renderCueStatus();
  }

  function clearPresenterError() {
    if (!state.presenterError) return;
    state.presenterError = null;
    presenterView.setError(null);
    renderCueStatus();
  }

  async function retryPresenterTimeline() {
    const boundary = currentPresenterSnapshot().sceneBoundaryKey;
    const isCurrent = () => !disposed && currentPresenterSnapshot().sceneBoundaryKey === boundary;
    try {
      const ids = timelineHost._nliArmPayload().visibleMembership;
      if (!presenterGate.getState().ready) {
        for (const id of ids) timelineHost._storeNliCachedFeatures(id, null);
      }
      await timelineHost._ensureNliFeatureCache(ids, { timeoutMs: 4000, isCurrent });
      if (!isCurrent()) return { ready: false };
      const verified = await presenterGate.refresh();
      if (!isCurrent()) return { ready: false };
      if (verified.ready) { state.presenterError = null; presenterView.setError(null); renderCueStatus(); }
      paintTimelineMounts();
      return verified;
    } catch (error) {
      if (isCurrent()) onPresenterError(error);
      return { ready: false, error };
    }
  }

  presenterGate = createPresenterDatasetGate({ host: timelineHost, manifest: presenterManifest,
    onChange(next) {
      if (disposed) return;
      if (!next.ready) presenterCommands?.invalidate();
      if (!paintingTimeline) paintTimelineMounts();
    } });
  presenterCommands = createPresenterCommands({ host: timelineHost, context: dataContext,
    getSnapshot: currentPresenterSnapshot,
    onPending: (pending) => presenterView?.setPending(pending),
    onError: onPresenterError });
  presenterView = createPresenterView({ root: $("kitTimeline"), commands: presenterCommands,
    getSnapshot: currentPresenterSnapshot,
    onError: onPresenterError, onRetry: retryPresenterTimeline });
  presenterView.setVisible(false);

  function renderPlayer() {
    const item = script();
    if (!item) return;
    const focusKey = storyChooserOpen ? (document.activeElement?.dataset?.focusKey || chooserFocusKey) : null;
    const step = item.steps[state.step];
    const slides = slideIndexes(item);
    $("stepCount").textContent = "";
    $("stepCount").hidden = true;
    $("ticks").hidden = !hasSceneStrip(item.id);
    const visitedScenes = navigationSession.getState().visitedScenes;
    $("ticks").innerHTML = slides
      .map((index, n) => {
        const visited = visitedScenes.some((ref) => ref.scriptId === item.id && ref.step === index);
        const cls = [index === state.step ? "is-current" : "", visited ? "is-visited" : ""].filter(Boolean).join(" ");
        const current = index === state.step ? ' aria-current="step"' : "";
        return `<button type="button" class="${cls}" data-step="${index}"${current}${state.searchPending ? " disabled" : ""} aria-label="${txt("stepAria", { n: n + 1 })}"></button>`;
      })
      .join("");
    $("stepClock").textContent = step.clock || "";
    $("stepTitle").textContent = loc(step.title);
    $("stepNote").textContent = "";
    $("stepNote").hidden = true;
    renderDock();
    renderKit();
    renderStoryChooser();
    applyChooserFocusScope();
    if (storyChooserOpen && focusKey) focusSemanticControl(focusKey);
  }

  function currentDisplayedRef() {
    return state.scriptId ? { scriptId: state.scriptId, step: state.step, returnTo: state.returnTo } : null;
  }

  function optionalActionsAvailable() {
    return optionalStoryActions({
      current: navigationSession.getState().current,
      displayed: currentDisplayedRef(),
      navigationPending: state.navigationPending || Boolean(activeNavigationAttempt),
      searchPending: state.searchPending || state.presentationClosePending,
      cueStatus: state.cueStatus,
      presentationPhase: presentation?.getState?.()?.phase || "closed",
      navigationFailed: state.navigationFailure || Boolean(failedNavigationAttempt),
    });
  }

  function renderStoryChooser() {
    const mount = $("storyChooserMount");
    if (!mount) return;
    const scrollTop = storyChooserOpen ? $("storyChooser")?.scrollTop || 0 : 0;
    mount.innerHTML = storyChooserHtml({
      locale: getLocale(),
      visitedStoryIds: navigationSession.getState().visitedStoryIds,
      pending: state.navigationPending || state.searchPending,
    });
    const dialog = $("storyChooser");
    dialog.hidden = !storyChooserOpen;
    dialog.scrollTop = scrollTop;
    if (storyChooserOpen) {
      dialog.querySelector("#storyChooserStatus").textContent = "";
    }
  }

  function chooserAllowed(element) {
    return Boolean(element?.closest?.("#storyChooser, #homeBtn, #localeHe, #localeEn, #fullscreenBtn, #staffConnection, #staffConnectionDetails"));
  }

  function applyChooserFocusScope() {
    const body = $("player")?.querySelector(".player-body");
    if (body) {
      body.inert = storyChooserOpen;
      body.setAttribute("aria-hidden", String(storyChooserOpen));
    }
    const dock = $("player")?.querySelector(".dock");
    if (dock) {
      dock.inert = storyChooserOpen;
      dock.setAttribute("aria-hidden", String(storyChooserOpen));
    }
  }

  function focusSemanticControl(key) {
    const target = [...document.querySelectorAll("[data-focus-key]")]
      .find((element) => element.dataset.focusKey === key && !element.hidden && !element.disabled);
    target?.focus?.();
    if (target) chooserFocusKey = key;
  }

  function openStoryChooser() {
    if (!optionalActionsAvailable() || storyChooserOpen) return false;
    storyChooserOpen = true;
    chooserOpenerKey = document.activeElement?.dataset?.focusKey || "navigation-choose";
    chooserFocusKey = "story-sderot";
    renderStoryChooser();
    applyChooserFocusScope();
    focusSemanticControl(chooserFocusKey);
    return true;
  }

  function closeStoryChooser({ restoreFocus = true } = {}) {
    if (!storyChooserOpen) return false;
    storyChooserOpen = false;
    renderStoryChooser();
    applyChooserFocusScope();
    if (restoreFocus) {
      const key = optionalActionsAvailable() ? chooserOpenerKey : "navigation-back";
      focusSemanticControl(key);
    }
    return true;
  }

  function selectOptionalStory(id, sourceButton) {
    if (!storyChooserOpen || !sourceButton || !$("storyChooser")?.contains(sourceButton) ||
      sourceButton.disabled || !optionalActionsAvailable()) return false;
    const item = NARRATIVES.find((narrative) => narrative.id === id && ["sderot", "shura", "hostages"].includes(id));
    if (!item) return false;
    closeStoryChooser({ restoreFocus: false });
    enterScript(item.id, { step: 0, returnTo: { id: "show", step: showStepIndex("narratives") } });
    return true;
  }

  function renderDock() {
    const next = nextAction(state);
    const optionalContext = optionalStoryContext(currentDisplayedRef());
    const choices = next.kind === "choose" && !optionalContext;
    const sessionState = navigationSession.getState();
    const canRecover = Boolean(sessionState.current && activeNavigationAttempt);
    const canGoBack = canRecover || Boolean(navigationSession.backTarget());
    const backTarget = canGoBack ? navigationSession.backTarget({ recoverCurrent: Boolean(activeNavigationAttempt) }) : null;
    const backText = backTarget
      ? navigationLabel({ current: currentDisplayedRef(), target: backTarget, direction: "back", locale: getLocale() })
      : txt("prev");
    $("prevBtn").setAttribute("aria-label", backText);
    $("prevBtn").innerHTML = navigationButtonContent(backText, "previous", getLocale());
    const nextTarget = next.kind === "step" || next.kind === "resume"
      ? { scriptId: next.scriptId, step: next.step, returnTo: next.kind === "resume" ? null : state.returnTo }
      : null;
    const nextText = nextTarget
      ? navigationLabel({ current: currentDisplayedRef(), target: nextTarget, direction: "next", locale: getLocale() })
      : txt({ step: "next", resume: "backToShow", finish: "done" }[next.kind] || "next");
    const optionalActions = optionalActionsAvailable();
    $("prevBtn").hidden = false;
    $("prevBtn").disabled = !canReplaceNavigation() || !canGoBack;
    $("nextBtn").hidden = choices;
    $("nextBtn").innerHTML = navigationButtonContent(nextText, "next", getLocale());
    $("nextBtn").disabled = !canReplaceNavigation();
    $("nextChoices").hidden = !choices;
    const chooseStoryLabel = messageForLocale(getLocale(), state.scriptId === "nova" ? "chooseStory" : "chooseAnotherStory");
    const nextButton = $("nextBtn");
    if (optionalContext) {
      nextButton.setAttribute("aria-label", chooseStoryLabel);
      nextButton.innerHTML = navigationButtonContent(chooseStoryLabel, "next", getLocale());
      nextButton.dataset.navigationAction = "choose-story";
      nextButton.disabled = !optionalActions || !canReplaceNavigation();
    } else {
      nextButton.removeAttribute("aria-label");
      nextButton.dataset.navigationAction = "next";
    }
    $("nextChoices").innerHTML = !choices ? "" : next.ids
      .map((id) => {
        const item = NARRATIVES.find((narrative) => narrative.id === id);
        const title = next.ids.length === 1 ? txt("startStory", { title: loc(item.title) }) : loc(item.title);
        return `<button type="button" class="branch-btn" data-branch="${id}"${canReplaceNavigation() ? "" : " disabled"}><span class="branch-btn-title">${title}</span></button>`;
      })
      .join("");
  }

  function renderCueStatus() {
    const key = { applying: "cueApplying", ready: "cueReady", failed: "cueFailed" }[state.cueStatus];
    const cueStatus = $("cueStatus");
    if (cueStatus) {
      const scenePriority = state.cueStatus === "applying" || state.cueStatus === "failed";
      cueStatus.textContent = scenePriority ? txt(key) : state.presenterError || (key ? txt(key) : "");
      cueStatus.dataset.status = scenePriority ? state.cueStatus : state.presenterError ? "presenter-failed" : state.cueStatus || "";
    }
    const playerFailure = $("playerCueFailure");
    if (playerFailure) {
      const failed = state.screen === "player" && (state.navigationFailure ||
        (state.cueStatus === "failed" && Boolean(state.failedCue)));
      playerFailure.hidden = !failed;
      $("playerCueFailureText").textContent = failed ? txt("cueFailed") : "";
    }
    const homeFailure = state.screen === "home" && (state.cueStatus === "failed" || state.homeFailure);
    const homeStatus = $("homeCueStatus");
    const homeRetry = $("homeRetry");
    if (homeStatus) {
      homeStatus.hidden = !homeFailure;
      homeStatus.textContent = homeFailure
        ? txt(state.homeFailure ? "searchClearFailed" : "cueFailed")
        : "";
    }
    if (homeRetry) homeRetry.hidden = !homeFailure;
  }

  function renderKit() {
    const step = currentStep();
    const kits = stepKits(step);
    const show = {
      kitTimeline: kits.includes("timeline"),
      kitArchive: kits.includes("archive"),
      kitSearch: kits.includes("search"),
      kitEscape: kits.includes("escape"),
      kitPresentation: nliPresentationUsesRemoteControls(step?.presentation),
    };
    Object.entries(show).forEach(([id, on]) => {
      const el = $(id);
      if (el) el.hidden = !on;
    });
    presenterView.setVisible(show.kitTimeline);
    if (show.kitPresentation) {
      $("kitPresentation").innerHTML = presentationControlsHtml(step, presentation?.getState(), getLocale(), state.cueStatus === "applying" || state.searchPending);
    } else {
      $("kitPresentation").innerHTML = "";
    }
    renderCueStatus();
    if (show.kitTimeline) {
      void timelineHost._ensureNliFeatureCache?.();
      void presenterGate.refresh();
      paintTimelineMounts();
    }
    if (show.kitEscape) {
      $("kitEscape").innerHTML = nliNovaEscapeTogglesHtml(
        dataContext?.getNarrativeState?.(),
        dataContext?.getEscapeOverlay?.(),
        step?.escapeKinds,
        state.cueStatus === "applying" || state.searchPending,
      );
    }
    archivePageHold?.clear?.();
    if (show.kitArchive) {
      paintArchiveMount($("kitArchive"), { always: true });
    } else if ($("kitArchive")) {
      $("kitArchive").innerHTML = "";
    }
    const searchMount = $("searchArchiveMount");
    if (searchMount) {
      if (show.kitSearch) paintArchiveMount(searchMount);
      else searchMount.innerHTML = "";
    }
    $("searchInput").disabled = state.searchPending;
    $("searchResults").querySelectorAll("button").forEach((button) => { button.disabled = state.searchPending; });
    $("narrativeList").querySelectorAll("button").forEach((button) => { button.disabled = state.searchPending; });
    renderSearchStatus();
  }

  function renderResults(query) {
    renderSearchReset();
    const box = $("searchResults");
    const q = query.trim();
    if (!q) {
      box.classList.remove("is-open");
      box.innerHTML = "";
      lastPlaces = [];
      return;
    }
    const people = peopleSearch.search(q, getLocale(), 6, STAFF_PEOPLE_SEARCH_OPTIONS);
    lastPlaces = searchPlaces(q, {
      limit: 6,
      canNavigateToPlace: (place) => placeIsWithinRemoteBounds(place, dataContext),
    });
    const peopleHtml = people.map(
      (person) => `
              <li>
                <button type="button" data-kind="person" data-pid="${person.pid}" data-version="${person.datasetVersion}" data-archive="${person.hasArchiveRecord ? "1" : "0"}"${state.searchPending ? " disabled" : ""}>
                  <span class="result-name" lang="${person.nameLanguage}">${person.name}</span>
                  <span class="result-place"${person.locationLanguage ? ` lang="${person.locationLanguage}"` : ""}>${person.location || ""}</span>
                </button>
              </li>`,
    );
    const placesHtml = lastPlaces.map(
      (place) => {
        const name = labelForPlace(place);
        return `
              <li>
                <button type="button" data-kind="place" data-place-id="${place.id}"${state.searchPending ? " disabled" : ""}>
                  <span class="result-name">${name}</span>
                  <span class="result-place">${place.type === "settlement" ? txt("placeTypeSettlement") : ""}</span>
                </button>
              </li>`;
      },
    );
    const html = [...peopleHtml, ...placesHtml].join("");
    box.classList.toggle("is-open", html.length > 0);
    box.innerHTML = html;
  }

  function paintSearchStatus(message) {
    const status = $("searchStatus");
    if (!status) return;
    status.replaceChildren();
    status.hidden = !message;
    if (!message) return;
    status.append(document.createTextNode(message));
  }

  function renderSearchStatus() {
    renderSearchReset();
    paintSearchStatus(state.searchPending ? txt("searchClearing") : state.searchError || "");
  }

  function renderSearchReset() {
    const button = $("searchReset");
    if (!button) return;
    const hasSearch = $("searchInput").value.trim() || peopleArchive?.getAcknowledgedPerson?.() ||
      dataContext?.getPersonSelection?.()?.personId || state.placeName || placeFocusOwnership.hasFocus();
    button.disabled = state.searchPending || !hasSearch;
  }

  function archiveLocaleLabels() {
    return {
      openNliRecord: t("openNliRecord"),
      backToMap: t("backToMap"),
      nliArchiveScrollUp: t("nliArchiveScrollUp"),
      nliArchiveScrollDown: t("nliArchiveScrollDown"),
      nliArchiveRecord: t("nliArchiveRecord"),
    };
  }

  function paintArchiveMount(el, { always = false } = {}) {
    if (!el) return;
    const phase = peopleArchive?.getArchivePhase?.() || "closed";
    const person = peopleArchive?.getAcknowledgedPerson?.() || null;
    if (!always && phase === "closed" && !person) {
      el.innerHTML = "";
      return;
    }
    el.innerHTML = archiveControlsHtml({
      phase,
      localeLabels: archiveLocaleLabels(),
      personName: person?.name || "",
      disabled: state.searchPending || !state.connected,
    });
  }

  function render() {
    applyChrome();
    renderHome();
    if (state.screen === "player") renderPlayer();
  }

  function clearSearchUi() {
    $("searchInput").value = "";
    renderResults("");
    state.searchError = null;
    state.placeName = null;
  }

  function restoreLiveSearchLabel() {
    const personName = peopleArchive?.getAcknowledgedPerson?.()?.name;
    $("searchInput").value = personName || placeFocusOwnership.getName() || state.placeName || "";
    renderResults("");
    renderSearchStatus();
  }

  function beginNavigationAttempt(destination, intent, kind) {
    if (activeNavigationAttempt) navigationSession.abandon(activeNavigationAttempt.ticket);
    const ticket = navigationSession.begin(destination, intent);
    const attempt = Object.freeze({
      ticket,
      generation: navigationGeneration,
      destination,
      kind,
    });
    activeNavigationAttempt = attempt;
    failedNavigationAttempt = null;
    state.navigationFailure = false;
    return attempt;
  }

  function settleNavigationAttempt(attempt, result) {
    if (disposed || !attempt || activeNavigationAttempt !== attempt ||
      attempt.generation !== navigationGeneration) return false;
    const ready = attempt.kind === "fixed-presentation"
      ? result === true
      : result?.status === "ready";
    if (ready && navigationSession.complete(attempt.ticket)) {
      activeNavigationAttempt = null;
      failedNavigationAttempt = null;
      state.navigationFailure = false;
      return true;
    }
    const failed = attempt.kind === "fixed-presentation" ? result === false : result?.status === "failed";
    if (failed) {
      failedNavigationAttempt = attempt;
      state.navigationFailure = true;
      renderCueStatus();
    }
    return false;
  }

  async function transitionToStep(item, index, {
    returnTo = state.returnTo,
    navigationIntent = "forward",
  } = {}) {
    if (storyChooserOpen) closeStoryChooser({ restoreFocus: false });
    const nextIndex = Math.max(0, Math.min(index, item.steps.length - 1));
    const destination = item.steps[nextIndex];
    navigationGeneration += 1;
    const generation = navigationGeneration;
    const fixedSceneSwitch = state.screen === "player" && state.scriptId === item.id &&
      state.cueStatus === "ready" && !state.searchPending &&
      [currentStep(), destination].every((step) =>
        ["names_wall", "credits"].includes(step?.presentation?.segmentId));
    const junction = Array.isArray(destination?.branch);
    const intent = navigationIntent === "forward" && state.screen === "home" && !navigationSession.getState().current
      ? "entry" : navigationIntent;
    const kind = fixedSceneSwitch ? "fixed-presentation" : "cue";
    let operationContext = null;
    if (junction) {
      if (activeNavigationAttempt) navigationSession.abandon(activeNavigationAttempt.ticket);
      activeNavigationAttempt = null;
      failedNavigationAttempt = null;
      state.navigationFailure = false;
    } else {
      operationContext = beginNavigationAttempt({
        scriptId: item.id,
        step: nextIndex,
        returnTo: returnTo == null ? null : { id: returnTo.id, step: returnTo.step },
      }, intent, kind);
    }
    state.presentationClosePending = false;
    clearPresenterError();
    state.navigationPending = true;
    if (state.screen === "home") renderHome();
    timelineHost.invalidateTransport();
    presenterCommands.invalidate();
    presenterView.setVisible(false);
    try {
      if (fixedSceneSwitch) {
        searchTransition.begin();
        cues.cancel();
        state.cueStatus = "ready";
        state.step = nextIndex;
        state.returnTo = returnTo;
        renderPlayer();
        const replaced = await presentation.replace(destination.presentation.segmentId);
        settleNavigationAttempt(operationContext, replaced);
        return replaced;
      }
      return await searchActions.transitionToStep(item, index, returnTo, operationContext);
    } finally {
      if (generation === navigationGeneration) {
        state.navigationPending = false;
        if (state.screen === "player") renderPlayer();
        rearmTransport();
      }
    }
  }

  function goToStep(index) {
    const item = script();
    if (item) void transitionToStep(item, index, { returnTo: state.returnTo });
  }

  function enterScript(id, { step = 0, returnTo = null } = {}) {
    const item = SCRIPTS.find((entry) => entry.id === id);
    if (item) void transitionToStep(item, step, { returnTo });
  }

  function failSearchClear(token) {
    if (!searchTransition.isCurrent(token)) return false;
    state.searchPending = false;
    restoreLiveSearchLabel();
    state.searchError = txt("searchClearFailed");
    if (state.screen === "home") state.homeFailure = true;
    if (state.screen === "player") renderPlayer();
    else renderKit();
    return false;
  }

  async function clearSearchFocus() {
    if (storyChooserOpen || state.searchPending) return;
    const previousQuery = $("searchInput").value;
    const token = searchTransition.begin();
    state.searchPending = true;
    if (state.screen === "player") renderPlayer();
    else renderKit();
    const cleared = await searchTransition.clearAll(token);
    if (!searchTransition.isCurrent(token)) return;
    if (!cleared) {
      failSearchClear(token);
      if (!$("searchInput").value) $("searchInput").value = previousQuery;
      renderSearchReset();
      return;
    }
    state.searchPending = false;
    clearSearchUi();
    if (state.screen === "player") renderPlayer();
    else renderKit();
  }

  function selectPersonResult(person) {
    return searchActions.selectPerson(person, async (selectedPerson) => {
      state.placeName = null;
      state.searchError = null;
      $("searchInput").value = selectedPerson.name;
      renderResults("");
      const selected = await peopleArchive.selectPerson(selectedPerson);
      if (!selected) restoreLiveSearchLabel();
      return selected;
    });
  }

  function selectPlaceResult(place, name) {
    return searchActions.selectPlace(place, async (selectedPlace, token) => {
      state.searchError = null;
      $("searchInput").value = name;
      renderResults("");
      let request;
      try {
        if (typeof dataContext?.navigateToPlace !== "function") throw new Error("place navigation unavailable");
        request = placeFocusOwnership.start(name, () => dataContext.navigateToPlace(selectedPlace));
        const result = await request.settled;
        if (result?.ok === false || (result?.status && result.status !== "ok")) throw new Error("place navigation rejected");
        if (!searchTransition.isCurrent(token)) return false;
        state.placeName = name;
        return true;
      } catch {
        if (!searchTransition.isCurrent(token)) return false;
        if (request) placeFocusOwnership.release(request);
        restoreLiveSearchLabel();
        state.searchError = t("placeSearchFailed");
        return false;
      }
    });
  }

  let bootArmed = true;
  let hydrated = false;
  function maybeBootHome() {
    if (!bootArmed || !hydrated || !state.connected) return;
    if (state.screen !== "home" || state.scriptId) {
      bootArmed = false;
      return;
    }
    bootArmed = false;
    void exitToHome();
  }

  function exitToHome() {
    if (storyChooserOpen) closeStoryChooser({ restoreFocus: false });
    bootArmed = false;
    state.homeFailure = false;
    renderCueStatus();
    return performHomeExit();
  }

  async function performHomeExit(replayAttempt = null) {
    state.homeReady = false;
    let homeCueResult = null;
    navigationGeneration += 1;
    const attempt = replayAttempt
      ? Object.freeze({ ...replayAttempt, generation: navigationGeneration })
      : beginNavigationAttempt(null, "home", "home");
    if (replayAttempt) {
      activeNavigationAttempt = attempt;
      failedNavigationAttempt = null;
      state.navigationFailure = false;
    }
    let navigationSettled = false;
    clearPresenterError();
    const generation = navigationGeneration;
    state.navigationPending = true;
    const previous = {
      screen: state.screen,
      scriptId: state.scriptId,
      step: state.step,
      returnTo: state.returnTo,
    };
    timelineHost.invalidateTransport();
    presenterCommands.invalidate();
    presenterView.setVisible(false);
    const token = searchTransition.begin();
    cues.cancel();
    state.searchPending = true;
    const paintPending = () => {
      if (state.screen === "player") renderPlayer();
      else renderHome();
    };
    paintPending();
    try {
      let closed = true;
      try {
        homeCueResult = await applyCue(HOME_CUE, null, async (isCurrent, options) => {
          if (!isCurrent() || !searchTransition.isCurrent(token)) return false;
          const cleared = await searchTransition.clearAll(token);
          if (!isCurrent() || !searchTransition.isCurrent(token)) return false;
          if (!cleared) return failSearchClear(token);
          state.navigationPending = false;
          state.searchPending = false;
          clearSearchUi();
          if (peopleArchive?.getArchivePhase?.() === "open") void peopleArchive.closeArchive();
          state.presentationClosePending = true;
          paintPending();
          return presentation.closeScene(options);
        });
        closed = homeCueResult?.status === "ready";
      } finally {
        if (searchTransition.isCurrent(token)) {
          state.presentationClosePending = false;
          paintPending();
        }
      }
      if (!searchTransition.isCurrent(token) || closed === false) return false;
      state.scriptId = null;
      state.step = 0;
      state.returnTo = null;
      showScreen("home");
      renderHome();
      const result = homeCueResult ?? await applyCue(HOME_CUE, null);
      if (!searchTransition.isCurrent(token)) return false;
      if (result?.status !== "ready") {
        state.scriptId = previous.scriptId;
        state.step = previous.step;
        state.returnTo = previous.returnTo;
        showScreen(previous.screen);
        if (previous.screen === "player") renderPlayer();
        else renderHome();
        return false;
      }
      state.homeReady = true;
      navigationSettled = settleNavigationAttempt(attempt, { status: "ready" });
      try { onHomeSuccess?.(); } catch { /* completion notification must not change Home behavior */ }
      return true;
    } finally {
      if (!navigationSettled && attempt.generation === navigationGeneration) {
        settleNavigationAttempt(attempt, { status: "failed" });
      }
      if (searchTransition.isCurrent(token)) {
        state.presentationClosePending = false;
        state.searchPending = false;
        if (state.screen === "player") renderPlayer();
        else renderHome();
      }
      if (generation === navigationGeneration) {
        state.navigationPending = false;
        if (state.screen === "player") renderPlayer();
        else if (state.screen === "home") renderHome();
        rearmTransport();
      }
    }
  }

  async function retrySceneNavigation() {
    const failed = failedNavigationAttempt;
    if (!failed || activeNavigationAttempt !== failed || disposed) return false;
    state.navigationFailure = false;
    if (failed.kind === "home") {
      state.homeFailure = false;
      return performHomeExit(failed);
    }
    if (failed.kind === "fixed-presentation") {
      const item = SCRIPTS.find((entry) => entry.id === failed.destination.scriptId);
      const step = item?.steps[failed.destination.step];
      state.navigationPending = true;
      try {
        const result = await presentation.replace(step?.presentation?.segmentId);
        settleNavigationAttempt(failed, result);
        return result;
      } finally {
        if (failed.generation === navigationGeneration) {
          state.navigationPending = false;
          if (state.screen === "player") renderPlayer();
          rearmTransport();
        }
      }
    }
    const failedCue = state.failedCue;
    if (!failedCue || state.cueStatus !== "failed") return false;
    const result = await applyCue(failedCue.cue, failedCue.narrativeId, failedCue.beforeApply);
    settleNavigationAttempt(failed, result);
    rearmTransport();
    if (state.screen === "player") renderPlayer();
    if (result?.status === "ready" && !failedCue.beforeApply) {
      const item = script();
      const step = currentStep();
      if (shouldAutoOpenNliPresentation({
        item, index: state.step, currentScript: item, currentStep: step, cueStatus: "ready",
      })) void presentation.run("open", step.presentation.segmentId);
    }
    return result?.status === "ready";
  }

  function findPerson(query) {
    const hits = peopleSearch.search(query, getLocale(), 8, STAFF_PEOPLE_SEARCH_OPTIONS);
    return hits.find((row) => row.hasArchiveRecord) || hits[0] || null;
  }

  async function selectAndOpenArchive(query) {
    try {
      await peopleSearch.load();
    } catch {
      state.searchError = txt("archiveMissing");
      renderKit();
      return;
    }
    const person = findPerson(query);
    if (!person) {
      state.searchError = txt("archiveMissing");
      renderKit();
      return;
    }
    await peopleArchive.openArchive(person);
  }

  peopleArchive = createRemotePeopleArchiveController({
    root: document.querySelector(".app"),
    input: $("searchInput"),
    list: $("searchResults"),
    navigationSection: $("searchKit"),
    archiveButton: null,
    dataContext,
    peopleRuntime: peopleSearch,
    getMode: () => "people",
    setMode: () => {},
    renderSuggestions: () => renderResults(""),
    setStatus: (message) => {
      state.searchError = message || null;
      renderSearchStatus();
    },
    setRootClass: () => {},
    setHidden: () => {},
    syncInputDirection: () => {},
    isNarrativeActive: () => false,
    isConnected: () => state.connected,
    onArchiveClosed: () => { void clearSearchFocus(); },
    onStateChange: () => {
      if (!archiveUiReady) return;
      renderKit();
      renderSearchStatus();
    },
  });
  archivePageHold = createArchivePageHold({
    page: (direction) => peopleArchive.pageArchive(direction),
    isOpen: () => peopleArchive.getArchivePhase() === "open",
  });
  searchTransition = createNliStaffSearchTransition({
    clearPersonSelection: () => peopleArchive.clearPersonSelection(),
    cancelPlaceFocus: async () => {
      const result = await placeFocusOwnership.cancel(() => dataContext?.cancelNavigationFocus?.());
      if (result?.ok === true || result?.status === "ok") state.placeName = placeFocusOwnership.getName();
      return result;
    },
    waitForPlaceNavigation: () => placeFocusOwnership.waitForNavigation(),
    hasPlaceFocus: () => Boolean(state.placeName || placeFocusOwnership.hasFocus()),
  });
  presentation = createNliStaffPresentationController({
    dataContext,
    onStateChange: () => {
      if (archiveUiReady && state.screen === "player") {
        renderKit();
        renderDock();
      }
    },
  });
  const handlePresentationButton = createNliStaffPresentationButtonHandler({
    getCurrentStep: currentStep,
    getNavigationGeneration: () => navigationGeneration,
    run: (action, segmentId) => presentation.run(action, segmentId),
    nextFromExplicitClose: () => {
      const next = nextAction(state);
      if (next.kind === "step") goToStep(next.step);
      else if (next.kind === "resume") enterScript(next.scriptId, { step: next.step });
      else if (next.kind === "finish") void exitToHome();
    },
    resumeFromExplicitClose: () => {
      const next = nextAction(state);
      if (next.kind === "resume") enterScript(next.scriptId, { step: next.step });
    },
  });
  searchActions = createNliStaffSearchEventHandlers({
    transition: searchTransition,
    cancelCues: () => cues.cancel(),
    isPending: () => state.searchPending,
    setPending: (pending) => { state.searchPending = pending; },
    renderPending: () => {
      if (state.screen === "player") renderPlayer();
      else renderKit();
    },
    restoreLiveSearchLabel,
    showClearFailed: () => { state.searchError = txt("searchClearFailed"); },
    clearSearchUi,
    beforeTransition: () => true,
    onNavigationCleanupComplete: () => { state.navigationPending = false; },
    setDestination: (item, index, returnTo) => {
      const nextIndex = Math.max(0, Math.min(index, item.steps.length - 1));
      const step = item.steps[nextIndex];
      state.scriptId = item.id;
      state.step = nextIndex;
      state.returnTo = returnTo;
      showScreen("player");
    },
    renderDestination: () => {
      renderPlayer();
      void timelineHost._ensureNliFeatureCache?.();
    },
    runDestinationTransition: async (item, index, prepareDestination, operationContext) => {
      const generation = navigationGeneration;
      try {
        const destination = item.steps[Math.max(0, Math.min(index, item.steps.length - 1))];
        const beforeApply = async (isCurrent, options) => {
          if (!isCurrent()) return false;
          if (!await prepareDestination(isCurrent) || !isCurrent()) return false;
          if (!destination?.cue) return true;
          if (destination?.presentation?.open === "auto") {
            // The API validates the segment against the active narrative,
            // including Shura's required null narrative. Stage it under the hold.
            await options.prepareNarrative();
            if (!isCurrent()) return false;
            return presentation.prepareScene(destination.presentation.segmentId, options);
          }
          return presentation.closeScene(options);
        };
        return await applyCue(destination?.cue, item.narrative, beforeApply);
      } finally {
        if (generation === navigationGeneration) rearmTransport();
      }
    },
    afterDestinationCue: (item, index, cueResult, operationContext) => {
      settleNavigationAttempt(operationContext, cueResult);
      if (cueResult?.status !== "ready") return;
      const nextIndex = Math.max(0, Math.min(index, item.steps.length - 1));
      if (state.scriptId !== item.id || state.step !== nextIndex) return;
      const destination = item.steps[nextIndex];
      const opened = presentation.getState();
      if (opened.phase === "open" && opened.segmentId === destination.presentation?.segmentId) return;
      if (shouldAutoOpenNliPresentation({
        item, index: nextIndex, currentScript: script(), currentStep: currentStep(), cueStatus: "ready",
      })) {
        void presentation.run("open", destination.presentation.segmentId);
      }
    },
  });
  archiveUiReady = true;

  $("narrativeList").addEventListener("click", (event) => {
    if (state.searchPending) return;
    const shortcut = event.target.closest("[data-show-step]");
    if (shortcut) {
      enterScript(SHOW.id, { step: showStepIndex(shortcut.dataset.showStep) });
      return;
    }
    const card = event.target.closest("[data-open]");
    if (card) enterScript(card.dataset.open);
  });

  $("homeBtn").addEventListener("click", () => {
    if (storyChooserOpen) closeStoryChooser({ restoreFocus: false });
    void exitToHome();
  });

  $("homeRetry")?.addEventListener("click", () => {
    void retrySceneNavigation();
  });

  $("playerCueRetry")?.addEventListener("click", async () => {
    if (failedNavigationAttempt) {
      await retrySceneNavigation();
      return;
    }
    const failedCue = state.failedCue;
    if (!failedCue || state.cueStatus !== "failed") return;
    if (failedCue.cue === HOME_CUE && failedCue.narrativeId === null) {
      await exitToHome();
      return;
    }
    const result = await applyCue(failedCue.cue, failedCue.narrativeId, failedCue.beforeApply);
    rearmTransport();
    if (result?.status !== "ready" || failedCue.beforeApply) return;
    const item = script();
    const step = currentStep();
    if (shouldAutoOpenNliPresentation({
      item, index: state.step, currentScript: item, currentStep: step, cueStatus: "ready",
    })) void presentation.run("open", step.presentation.segmentId);
  });

  $("ticks").addEventListener("click", (event) => {
    if (state.searchPending) return;
    const tick = event.target.closest("[data-step]");
    if (tick) goToStep(Number(tick.dataset.step));
  });

  function navigateBack() {
    if (storyChooserOpen) return;
    if (!canReplaceNavigation()) return;
    const sessionState = navigationSession.getState();
    const recovering = Boolean(sessionState.current && activeNavigationAttempt);
    const target = navigationSession.backTarget({ recoverCurrent: recovering });
    if (!target) return;
    const item = SCRIPTS.find((entry) => entry.id === target.scriptId);
    if (item) void transitionToStep(item, target.step, {
      returnTo: target.returnTo,
      navigationIntent: recovering ? "reapply" : "back",
    });
  }

  $("prevBtn").addEventListener("click", navigateBack);
  $("nextBtn").addEventListener("click", () => {
    if (storyChooserOpen) return;
    if (!canReplaceNavigation()) return;
    if (optionalStoryContext(currentDisplayedRef())) {
      if (optionalActionsAvailable()) openStoryChooser();
      return;
    }
    const next = nextAction(state);
    if (next.kind === "step") goToStep(next.step);
    else if (next.kind === "resume") enterScript(next.scriptId, { step: next.step });
    else if (next.kind === "finish") void exitToHome();
  });

  $("nextChoices").addEventListener("click", (event) => {
    if (storyChooserOpen || optionalStoryContext(currentDisplayedRef())) return;
    if (!canReplaceNavigation()) return;
    const btn = event.target.closest("[data-branch]");
    const next = nextAction(state);
    if (!btn || next.kind !== "choose") return;
    enterScript(btn.dataset.branch, { returnTo: { id: next.scriptId, step: next.junction } });
  });

  $("storyChooserMount")?.addEventListener("click", (event) => {
    const continueIdentity = event.target.closest?.('[data-chooser-action="continue-identity"]');
    if (continueIdentity && storyChooserOpen && $("storyChooser")?.contains(continueIdentity) &&
      !continueIdentity.disabled && optionalActionsAvailable() && canReplaceNavigation()) {
      closeStoryChooser({ restoreFocus: false });
      enterScript(SHOW.id, { step: showStepIndex("identity-database") });
      return;
    }
    const cancel = event.target.closest?.('[data-chooser-action="cancel"]');
    if (cancel && storyChooserOpen) {
      closeStoryChooser();
      return;
    }
    const story = event.target.closest?.("[data-story-id]");
    if (story) selectOptionalStory(story.dataset.storyId, story);
  });

  const onChooserDocumentClick = (event) => {
    if (storyChooserOpen && !chooserAllowed(event.target)) {
      event.preventDefault();
      event.stopImmediatePropagation();
    }
  };
  document.addEventListener("click", onChooserDocumentClick, true);

  const onChooserFocusIn = (event) => {
    if (storyChooserOpen && chooserAllowed(event.target) && event.target.dataset?.focusKey) {
      chooserFocusKey = event.target.dataset.focusKey;
    }
  };
  document.addEventListener("focusin", onChooserFocusIn);

  const onChooserKeydown = (event) => {
    if (!storyChooserOpen) return;
    if (event.key === "Escape") {
      event.preventDefault();
      closeStoryChooser();
      return;
    }
    if (event.key !== "Tab") return;
    const scope = [...document.querySelectorAll("#storyChooser button, #homeBtn, #localeHe, #localeEn, #fullscreenBtn, #staffConnection")]
      .filter((element) => !element.disabled && !element.closest("[hidden]") && element.getAttribute("aria-hidden") !== "true");
    if (!scope.length) return;
    const index = scope.indexOf(document.activeElement);
    const nextIndex = event.shiftKey
      ? (index <= 0 ? scope.length - 1 : index - 1)
      : (index < 0 || index === scope.length - 1 ? 0 : index + 1);
    event.preventDefault();
    scope[nextIndex].focus();
  };
  document.addEventListener("keydown", onChooserKeydown);

  $("kitPresentation").addEventListener("click", (event) => {
    if (!chooserManualMutationsOpen()) return;
    const button = event.target.closest("[data-presentation-action]");
    if (!button) return;
    const action = button.dataset.presentationAction;
    if (action === "recover-open") {
      void presentation.recoverOpen(currentStep()?.presentation?.segmentId);
    } else if (action === "recover-home") {
      if (presentation.releaseFailedSession()) void exitToHome();
    } else void handlePresentationButton(action);
  });

  $("kitEscape").addEventListener("click", (event) => {
    if (!chooserManualMutationsOpen()) return;
    consumeNliNovaEscapeClick(event, escapeHost);
  });

  function archiveActionFrom(event) {
    const button = event.target.closest?.("[data-archive-action]");
    return { button, action: button?.dataset?.archiveAction };
  }

  function onArchiveClick(event) {
    if (storyChooserOpen) return;
    const { button, action } = archiveActionFrom(event);
    if (!button || (action !== "open" && action !== "close")) return;
    if (action === "close") {
      void peopleArchive.closeArchive();
      return;
    }
    if ($("kitArchive")?.contains(button)) {
      const query = currentStep()?.personQuery;
      if (query) void selectAndOpenArchive(query);
      return;
    }
    void peopleArchive.openArchive();
  }

  function onArchivePointerDown(event) {
    if (storyChooserOpen) return;
    const { action } = archiveActionFrom(event);
    if (action !== "page_up" && action !== "page_down") return;
    archivePageHold?.start(event);
  }

  $("kitArchive")?.addEventListener("click", onArchiveClick);
  $("searchArchiveMount")?.addEventListener("click", onArchiveClick);
  $("kitArchive")?.addEventListener("pointerdown", onArchivePointerDown);
  $("searchArchiveMount")?.addEventListener("pointerdown", onArchivePointerDown);

  $("searchReset")?.addEventListener("click", () => { void clearSearchFocus(); });
  $("searchInput").addEventListener("input", (event) => {
    if (storyChooserOpen || state.searchPending) return;
    if (!event.target.value.trim()) {
      renderResults("");
      void clearSearchFocus();
      return;
    }
    renderResults(event.target.value);
  });

  $("searchResults").addEventListener("click", (event) => {
    if (storyChooserOpen || state.searchPending) return;
    const placeBtn = event.target.closest("[data-kind='place']");
    if (placeBtn) {
      const place = lastPlaces.find((item) => item.id === placeBtn.dataset.placeId);
      const name = placeBtn.querySelector(".result-name")?.textContent || "";
      $("searchInput").value = name;
      renderResults("");
      if (!place) return;
      if (placeIsWithinRemoteBounds(place, dataContext) === false) {
        state.searchError = t("placeSearchEmpty");
        renderSearchStatus();
        return;
      }
      void selectPlaceResult(place, name);
      return;
    }
    const btn = event.target.closest("[data-kind='person']");
    if (!btn) return;
    const person = {
      pid: btn.dataset.pid,
      datasetVersion: btn.dataset.version || peopleSearch.datasetVersion(),
      name: btn.querySelector(".result-name")?.textContent || "",
      hasArchiveRecord: btn.dataset.archive !== "0",
    };
    void selectPersonResult(person);
  });


  initNliStaffLocaleControls(dataContext, {
    onFailure: () => {
      state.searchError = t("statusError");
      renderSearchStatus();
    },
  });
  const unsubscribers = [];
  const subscribe = (topic, listener) => {
    const unsubscribe = dataContext?.subscribe?.(topic, listener);
    if (typeof unsubscribe === "function") unsubscribers.push(unsubscribe);
  };
  subscribe("legendSettings", (settings) => {
    if (settings?.language) applyServerLocale(settings.language);
  });
  const onLocaleChange = () => {
    peopleArchive.handleLocaleChange();
    if (state.presenterError) onPresenterError();
    render();
    void applyNliFontChoices(getNliFontChoices());
  };
  window.addEventListener(LOCALE_EVENT, onLocaleChange);

  async function applyNliFontChoices(choices) {
    const adopted = await staffFonts.applyChoices(choices);
    if (!disposed) render();
    return adopted;
  }

  subscribe("connection", (isConnected) => {
    state.connected = !!isConnected;
    renderConnection();
    peopleArchive.syncArchiveButton();
    renderKit();
    maybeBootHome();
  });
  subscribe("connectionStatus", (status) => {
    state.connectionStatus = status;
    renderConnection();
  });
  subscribe("investigationClock", () => {
    paintTimelineMounts();
  });
  subscribe("narrativeState", () => {
    hydrated = true;
    timelineHost._clearNliScrubOnNarrativeChange?.();
    renderKit();
    maybeBootHome();
  });
  subscribe("escapeOverlay", () => {
    renderKit();
  });
  subscribe("layerGroups", () => {
    presenterCommands.invalidate();
    void presenterGate.refresh();
    paintTimelineMounts();
  });
  state.connected = dataContext?.isConnected?.() !== false;
  render();
  void applyNliFontChoices(getNliFontChoices());
  void timelineHost._ensureNliFeatureCache?.();
  function getRefreshState() {
    const connected = state.connected && dataContext?.isConnected?.() === true;
    const ready = state.homeReady && connected;
    let canonicalHome = false;
    try {
      canonicalHome = isCanonicalHome({
        narrativeState: dataContext?.getNarrativeState?.(),
        investigationClock: dataContext?.getInvestigationClock?.(),
        layerGroups: dataContext?.getLayerGroups?.(),
        personSelection: dataContext?.getPersonSelection?.(),
        escapeOverlay: dataContext?.getEscapeOverlay?.(),
        nowMs: dataContext?.correctedNow?.() ?? Date.now(),
      });
    } catch {
      canonicalHome = false;
    }
    let presentationOwned = false;
    try {
      const phase = presentation?.getState?.()?.phase;
      presentationOwned = phase !== undefined && phase !== "closed" && phase !== "released";
    } catch {
      presentationOwned = true;
    }
    const archiveRestriction = peopleArchive?.getRefreshRestriction?.() || null;
    const busy = state.navigationPending || state.searchPending || state.presentationClosePending ||
      state.cueStatus === "applying" || presenterCommands?.isPending?.() === true ||
      timelineHost._hasPendingNliTransport?.() === true || placeFocusOwnership.hasFocus() ||
      archiveRestriction === "busy";
    const refreshBlockReason = !ready ? "not_ready"
      : presentationOwned || archiveRestriction === "owned_session" ? "owned_session"
        : busy ? "busy"
          : !canonicalHome ? "not_home" : null;
    return { ready, refreshBlockReason };
  }

  return { render, applyNliFontChoices, getRefreshState, dispose() {
    if (disposed) return;
    disposed = true;
    staffFonts.dispose();
    archiveUiReady = false;
    navigationGeneration += 1;
    if (activeNavigationAttempt) navigationSession.abandon(activeNavigationAttempt.ticket);
    activeNavigationAttempt = null;
    failedNavigationAttempt = null;
    searchTransition.begin();
    cues.cancel();
    presentation.destroy();
    for (const unsubscribe of unsubscribers) unsubscribe();
    window.removeEventListener(LOCALE_EVENT, onLocaleChange);
    document.removeEventListener("click", onChooserDocumentClick, true);
    document.removeEventListener("focusin", onChooserFocusIn);
    document.removeEventListener("keydown", onChooserKeydown);
    window.removeEventListener("pagehide", releaseExhibitMode);
    window.removeEventListener("beforeunload", releaseExhibitMode);
    timelineHost.invalidateTransport();
    presenterCommands.dispose();
    presenterGate.dispose();
    presenterView.dispose();
    archivePageHold?.destroy?.();
    peopleArchive?.destroy?.();
  } };
}
