import { getEffectiveLayerGroups } from "../shared/layer-state-helper.js";
import { NLI_PLAYABLE_IDS } from "../shared/nli-investigation-beats.js";
import {
  bindNliTimelinePointerListeners,
  consumeNliTimelineButtonClick,
  nliTimelineHostMethods,
  nliTransportSheetHtml,
} from "./nli-timeline-transport.js";
import { consumeNliNovaEscapeClick, nliNovaEscapeTogglesHtml } from "./nli-nova-escape-toggles.js";
import { createCueRunner } from "./nli-staff-cues.js";
import { createNliStaffSearchTransition } from "./nli-staff-search-transition.js";
import { createPeopleSearchRuntime } from "./remote-people-search.js";
import {
  createRemotePeopleArchiveController,
  waitForInvestigationClockIdle,
} from "./remote-people-archive-controller.js";
import { createStaffPackMenus } from "./nli-staff-pack-menus.js";
import { labelForPlace, placeIsWithinRemoteBounds } from "./remote-place-navigation.js";
import { applyServerLocale, bindLocaleButtons, getLocale, t, LOCALE_EVENT } from "./remote-locale.js";
import { COPY, HOME_SHOW_SHORTCUTS, NARRATIVES, SCENES, SCRIPTS, SHOW } from "./nli-staff-script.js";
import { nextAction, prevAction, showStepIndex, slideIndexes } from "./nli-staff-flow.js";
import { searchPlaces } from "../shared/place-navigation/place-catalog.js";

const NO_ESCAPE = Object.freeze({ individual: false, overlap: false, mor: false });

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
} = {}) {
  function failClear(token) {
    if (!transition.isCurrent(token)) return false;
    setPending(false);
    restoreLiveSearchLabel();
    showClearFailed();
    renderPending();
    return false;
  }

  async function transitionToStep(item, index, returnTo) {
    if (!item) return false;
    const token = transition.begin();
    cancelCues();
    setPending(true);
    renderPending();
    const cleared = await transition.clearAll(token);
    if (!transition.isCurrent(token)) return false;
    if (!cleared) return failClear(token);
    clearSearchUi();
    setPending(false);
    renderPending();
    setDestination(item, index, returnTo);
    renderDestination();
    applyDestinationCue(item, index);
    return true;
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

export function initNliStaffRemote(dataContext) {
  const peopleSearch = createPeopleSearchRuntime();
  const placeFocusOwnership = createNliStaffPlaceFocusOwnership();
  void peopleSearch.load().catch(() => {});

  const state = {
    screen: "home",
    scriptId: null,
    step: 0,
    returnTo: null,
    cueStatus: null,
    connected: false,
    connectionStatus: "disconnected",
    scene: null,
    freeError: null,
    placeName: null,
    searchPending: false,
  };

  let lastPlaces = [];
  let archiveUiReady = false;
  let peopleArchive = null;
  let searchTransition = null;
  let searchActions = null;
  let packMenus = null;

  const timelineHost = Object.assign(
    {
      focusedGroupId: "nli",
      _nliFeatureCache: Object.create(null),
      _nliOptimisticClock: null,
      _nliScrub: null,
      _nliScrubEl: null,
      _nliPlayheadTimer: null,
      _nliEndTimer: null,
      sheet: $("kitTimeline"),
      getEffectiveGroupsForView() {
        try {
          return getEffectiveLayerGroups() || [];
        } catch {
          return [];
        }
      },
      render() {
        paintTimelineMounts();
      },
    },
    nliTimelineHostMethods,
    {
      _visibleNliPlayableIds() {
        return NLI_PLAYABLE_IDS.slice();
      },
      _nliCacheReady(ids) {
        const wanted = Array.isArray(ids) && ids.length ? ids : NLI_PLAYABLE_IDS;
        const cache = this._nliFeatureCache || {};
        return wanted.some((id) => Array.isArray(cache[id]) && cache[id].length > 0);
      },
    },
  );

  const escapeHost = {
    setEscapeOverlay: (patch) =>
      dataContext?.setEscapeOverlay?.({ ...NO_ESCAPE, ...dataContext.getEscapeOverlay?.(), ...patch }),
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

  async function waitForNliCache(timeoutMs = 4000) {
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
      if (timelineHost._nliCacheReady?.(NLI_PLAYABLE_IDS)) return true;
      await timelineHost._ensureNliFeatureCache?.();
      if (timelineHost._nliCacheReady?.(NLI_PLAYABLE_IDS)) return true;
      await new Promise((resolve) => setTimeout(resolve, 80));
    }
    return false;
  }

  function collectAllFullLayerIds() {
    const ids = new Set();
    const addGroups = (groups) => {
      for (const group of groups || []) {
        if (!group?.id) continue;
        for (const layer of group.layers || []) {
          if (!layer?.id) continue;
          ids.add(`${group.id}.${layer.id}`);
          if (Array.isArray(layer.fullLayerIds)) {
            for (const fullId of layer.fullLayerIds) {
              if (fullId) ids.add(String(fullId));
            }
          }
        }
      }
    };
    addGroups(dataContext?.getLayerGroups?.());
    addGroups(timelineHost.getEffectiveGroupsForView());
    return [...ids];
  }

  async function commitSceneLayers(enabledIds) {
    const want = [...new Set(enabledIds)];
    const wantSet = new Set(want);
    const off = collectAllFullLayerIds().filter((id) => !wantSet.has(id));
    if (off.length) await setLayerSet(off, false);
    if (want.length) await setLayerSet(want, true);
  }

  async function ensureClockIdle() {
    try {
      await waitForInvestigationClockIdle(dataContext);
    } catch {
      return;
    }
  }

  const cues = createCueRunner({
    dataContext,
    commitLayers: commitSceneLayers,
    stopClock: ensureClockIdle,
    playClock: async (window, live) => {
      await waitForNliCache();
      if (live()) await timelineHost.handleNliTimelinePlay({ loop: false, ...window });
    },
    onStatus: (status) => {
      state.cueStatus = status;
      renderCueStatus();
    },
  });
  const applyCue = (cue, narrativeId) => cues.apply(cue, narrativeId);

  function applyScene(id) {
    const scene = SCENES.find((item) => item.id === id);
    if (!scene) return;
    if (id === "layers") {
      if (packMenus?.isOpen()) packMenus.close();
      else packMenus?.open();
      renderFree();
      return;
    }
    packMenus?.close({ silent: true });
    const turningOff = state.scene === id;
    state.scene = turningOff ? null : id;
    state.freeError = null;
    state.placeName = null;
    renderFree();
    return applyCue(turningOff ? { layers: [], clock: "idle" } : scene.cue);
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
    document.title = getLocale() === "he" ? "הקרנה · הספרייה הלאומית" : "Projection · National Library";
    renderConnection();
  }

  function renderConnection() {
    const el = $("staffConnection");
    if (!el) return;
    el.textContent = state.connectionStatus === "connecting"
      ? t("statusConnecting") : state.connected ? txt("connected") : txt("disconnected");
    el.classList.toggle("is-on", state.connected);
  }

  function showScreen(name) {
    state.screen = name;
    document.querySelectorAll(".screen").forEach((el) => {
      const on = el.dataset.screen === name;
      el.classList.toggle("is-active", on);
      el.hidden = !on;
    });
    $("homeBtn").hidden = name === "home";
    if (name !== "free") packMenus?.close({ silent: true });
  }

  function navCard(item, variant) {
    return `
            <button type="button" class="nav-card nav-card--${variant}" data-open="${item.id}"${state.searchPending ? " disabled" : ""}>
              <span class="nav-card-copy">
                <span class="nav-card-title">${loc(item.title)}</span>
                <span class="nav-card-meta">${loc(item.meta)} · ${item.steps.length} ${txt("steps")}</span>
              </span>
              <span class="nav-card-index">${item.index || ""}</span>
            </button>`;
  }

  function renderHome() {
    const shortcutButtons = HOME_SHOW_SHORTCUTS.map((item) => `
          <button type="button" class="home-show-shortcut" data-show-step="${item.id}"${state.searchPending ? " disabled" : ""}>
            <span class="nav-card-title">${loc(item.title)}</span>
            <span class="nav-card-meta">${loc(item.meta)}</span>
          </button>`).join("");
    $("narrativeList").innerHTML =
      navCard(SHOW, "primary") +
      `<div class="nav-row">${NARRATIVES.map((item) => navCard(item, "narrative")).join("")}</div>` +
      `
          <section class="home-show-block" aria-labelledby="homeNamesTitle">
            <div class="home-show-block-copy">
              <h2 id="homeNamesTitle">${txt("namesHomeTitle")}</h2>
              <p>${txt("namesHomeMeta")}</p>
            </div>
            <div class="home-show-actions">${shortcutButtons}</div>
          </section>` +
      `
          <button type="button" class="nav-card nav-card--quiet" data-open-free="1"${state.searchPending ? " disabled" : ""}>
            <span class="nav-card-copy">
              <span class="nav-card-title">${txt("freeTitle")}</span>
              <span class="nav-card-meta">${txt("freeMeta")}</span>
            </span>
          </button>`;
  }

  function nliSelectedGroup() {
    const live = timelineHost.getEffectiveGroupsForView().find((group) => group?.id === "nli");
    if (live && Array.isArray(live.layers) && live.layers.length) {
      return {
        ...live,
        layers: live.layers.map((layer) =>
          NLI_PLAYABLE_IDS.includes(`nli.${layer.id}`) ? { ...layer, enabled: true } : layer,
        ),
      };
    }
    return {
      id: "nli",
      layers: NLI_PLAYABLE_IDS.map((fullId) => ({
        id: fullId.replace(/^nli\./, ""),
        enabled: true,
      })),
    };
  }

  function paintTimelineMounts() {
    const clock = dataContext?.getInvestigationClock?.() || null;
    const cache = timelineHost._nliFeatureCache;
    const html = nliTransportSheetHtml(
      nliSelectedGroup(),
      clock,
      cache,
      false,
      false,
      dataContext.getNarrativeState?.()?.id ?? null,
    );
    $("kitTimeline").innerHTML = html;
    timelineHost._syncNliPlayheadTicker?.(clock);
    timelineHost._syncNliEndedTimer?.(clock);
  }

  function renderPlayer() {
    const item = script();
    if (!item) return;
    const step = item.steps[state.step];
    const slides = slideIndexes(item);
    $("playerScript").textContent = loc(item.title);
    $("stepCount").textContent = `${slides.indexOf(state.step) + 1} ${txt("of")} ${slides.length}`;
    $("ticks").innerHTML = slides
      .map((index, n) => {
        const cls = index < state.step ? "is-done" : index === state.step ? "is-current" : "";
        const current = index === state.step ? ' aria-current="step"' : "";
        return `<button type="button" class="${cls}" data-step="${index}"${current}${state.searchPending ? " disabled" : ""} aria-label="${txt("stepAria", { n: n + 1 })}"></button>`;
      })
      .join("");
    $("stepClock").textContent = step.clock || "";
    $("stepTitle").textContent = loc(step.title);
    $("stepNote").textContent = loc(step.note);
    $("stepNote").classList.toggle("draft-note", Boolean(step.draft));
    $("stepGis").textContent = loc(step.gis);
    $("stepModel").textContent = loc(step.model);
    renderDock();
    renderKit();
  }

  function renderDock() {
    const next = nextAction(state);
    const choices = next.kind === "choose";
    $("prevBtn").disabled = state.searchPending || !prevAction(state);
    $("nextBtn").hidden = choices;
    $("nextBtn").textContent = txt({ step: "next", resume: "backToShow", finish: "done" }[next.kind] || "next");
    $("nextBtn").disabled = state.searchPending;
    $("nextChoices").hidden = !choices;
    $("nextChoices").innerHTML = !choices ? "" : next.ids
      .map((id) => {
        const item = NARRATIVES.find((narrative) => narrative.id === id);
        const title = next.ids.length === 1 ? txt("startStory", { title: loc(item.title) }) : loc(item.title);
        return `<button type="button" class="branch-btn" data-branch="${id}"${state.searchPending ? " disabled" : ""}>
              <span class="branch-btn-title">${title}</span>
              <span class="branch-btn-meta">${loc(item.meta)} · ${item.steps.length} ${txt("steps")}</span>
            </button>`;
      })
      .join("");
  }

  function renderCueStatus() {
    const key = { applying: "cueApplying", ready: "cueReady", failed: "cueFailed" }[state.cueStatus];
    ["cueStatus", "freeCueStatus"].forEach((id) => {
      const el = $(id);
      el.textContent = key ? txt(key) : "";
      el.dataset.status = state.cueStatus || "";
    });
  }

  function renderKit() {
    const step = currentStep();
    const kits = stepKits(step);
    const show = {
      kitTimeline: kits.includes("timeline"),
      kitArchive: kits.includes("archive"),
      kitSearch: kits.includes("search"),
      kitEscape: kits.includes("escape"),
    };
    Object.entries(show).forEach(([id, on]) => {
      $(id).hidden = !on;
    });
    $("kitIdle").hidden = Object.values(show).some(Boolean);
    $("kitIdle").textContent = txt("kitIdle");
    renderCueStatus();
    if (show.kitTimeline) {
      void timelineHost._ensureNliFeatureCache?.();
      paintTimelineMounts();
    }
    if (show.kitEscape) {
      $("kitEscape").innerHTML = nliNovaEscapeTogglesHtml(
        dataContext?.getNarrativeState?.(),
        dataContext?.getEscapeOverlay?.(),
      );
    }
    if (show.kitArchive) {
      const phase = peopleArchive?.getArchivePhase?.() || "closed";
      const pending = phase === "opening" || phase === "closing";
      const open = phase === "open" || phase === "closing";
      $("archiveBtn").textContent = t(
        phase === "closing"
          ? "nliArchiveClosing"
          : pending
            ? "nliArchiveOpening"
            : open
              ? "backToMap"
              : "openNliRecord",
      );
      $("archiveBtn").disabled = state.searchPending || !state.connected || pending;
    }
    const archivePhase = peopleArchive?.getArchivePhase?.() || "closed";
    $("freeArchiveBtn").disabled = state.searchPending || !state.connected || archivePhase === "opening" || archivePhase === "closing";
    $("searchInput").disabled = state.searchPending;
    $("searchResults").querySelectorAll("button").forEach((button) => { button.disabled = state.searchPending; });
    $("narrativeList").querySelectorAll("button").forEach((button) => { button.disabled = state.searchPending; });
    renderSearchStatus();
  }

  function renderResults(query) {
    const box = $("searchResults");
    const q = query.trim();
    if (!q) {
      box.classList.remove("is-open");
      box.innerHTML = "";
      lastPlaces = [];
      return;
    }
    const people = peopleSearch.search(q, getLocale(), 6);
    lastPlaces = searchPlaces(q, {
      limit: 6,
      canNavigateToPlace: (place) => placeIsWithinRemoteBounds(place, dataContext),
    });
    const peopleHtml = people.map(
      (person) => `
              <li>
                <button type="button" data-kind="person" data-pid="${person.pid}" data-version="${person.datasetVersion}" data-archive="${person.hasArchiveRecord ? "1" : "0"}"${state.searchPending ? " disabled" : ""}>
                  <span class="result-name">${person.name}</span>
                  <span class="result-place">${person.location || ""}</span>
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

  function paintFreeStatus(message) {
    const status = $("freeStatus");
    if (!status) return;
    status.replaceChildren();
    status.hidden = !message;
    if (!message) return;
    status.append(document.createTextNode(message));
  }

  function renderSearchStatus() {
    paintFreeStatus(state.searchPending ? txt("searchClearing") : state.freeError || "");
  }

  function renderFree() {
    $("sceneList").innerHTML = SCENES.map((scene) => {
      const active = scene.id === "layers" ? packMenus?.isOpen() : state.scene === scene.id;
      return `
            <button type="button" class="scene-btn${active ? " is-active" : ""}" data-scene="${scene.id}">
              <span class="scene-btn-title">${loc(scene.title)}</span>
              <span class="scene-btn-meta">${loc(scene.meta)}</span>
            </button>`;
    }).join("");
    packMenus?.render();
    renderCueStatus();
  }

  function render() {
    applyChrome();
    renderHome();
    if (state.screen === "player") renderPlayer();
    if (state.screen === "free") renderFree();
  }

  function clearSearchUi() {
    $("searchInput").value = "";
    renderResults("");
    state.freeError = null;
    state.placeName = null;
  }

  function restoreLiveSearchLabel() {
    const personName = peopleArchive?.getAcknowledgedPerson?.()?.name;
    $("searchInput").value = personName || placeFocusOwnership.getName() || state.placeName || "";
    renderResults("");
    renderSearchStatus();
  }

  function transitionToStep(item, index, { returnTo = state.returnTo } = {}) {
    return searchActions.transitionToStep(item, index, returnTo);
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
    state.freeError = txt("searchClearFailed");
    if (state.screen === "player") renderPlayer();
    else renderKit();
    return false;
  }

  async function clearSearchFocus() {
    if (state.searchPending) return;
    const token = searchTransition.begin();
    state.searchPending = true;
    renderKit();
    const cleared = await searchTransition.clearAll(token);
    if (!searchTransition.isCurrent(token)) return;
    if (!cleared) {
      failSearchClear(token);
      return;
    }
    state.searchPending = false;
    state.placeName = null;
    state.freeError = null;
    renderResults("");
    if (state.screen === "player") renderPlayer();
    else renderKit();
  }

  function selectPersonResult(person) {
    return searchActions.selectPerson(person, async (selectedPerson) => {
      state.placeName = null;
      state.freeError = null;
      $("searchInput").value = selectedPerson.name;
      renderResults("");
      const selected = await peopleArchive.selectPerson(selectedPerson);
      if (!selected) restoreLiveSearchLabel();
      return selected;
    });
  }

  function selectPlaceResult(place, name) {
    return searchActions.selectPlace(place, async (selectedPlace, token) => {
      state.freeError = null;
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
        state.freeError = t("placeSearchFailed");
        return false;
      }
    });
  }

  async function exitToHome() {
    const token = searchTransition.begin();
    cues.cancel();
    state.searchPending = true;
    renderKit();
    const cleared = await searchTransition.clearAll(token);
    if (!searchTransition.isCurrent(token)) return false;
    if (!cleared) return failSearchClear(token);
    state.scriptId = null;
    state.step = 0;
    state.returnTo = null;
    state.scene = null;
    state.cueStatus = null;
    state.searchPending = false;
    clearSearchUi();
    if (peopleArchive?.getArchivePhase?.() === "open") {
      void peopleArchive.closeArchive();
    }
    showScreen("home");
    renderHome();
    if (dataContext?.setNarrative) {
      try {
        await dataContext.setNarrative(null);
      } catch {
        // ignore
      }
    }
    return true;
  }

  function findPerson(query) {
    const variants = [query];
    const parts = String(query || "").trim().split(/\s+/).filter(Boolean);
    if (parts.length === 2) variants.push(`${parts[1]} ${parts[0]}`);
    for (const variant of variants) {
      const hits = peopleSearch.search(variant, getLocale(), 8);
      const person = hits.find((row) => row.hasArchiveRecord) || hits[0];
      if (person) return person;
    }
    return null;
  }

  async function selectAndOpenArchive(query) {
    try {
      await peopleSearch.load();
    } catch {
      state.freeError = txt("archiveMissing");
      renderKit();
      return;
    }
    const person = findPerson(query);
    if (!person) {
      state.freeError = txt("archiveMissing");
      renderKit();
      return;
    }
    await peopleArchive.openArchive(person);
  }

  packMenus = createStaffPackMenus({
    root: $("staffPackMenus"),
    getGroups: () => timelineHost.getEffectiveGroupsForView(),
    getClock: () => dataContext?.getInvestigationClock?.() || null,
    setLayersEnabled: (ids, enabled) => setLayerSet(ids, enabled),
    isConnected: () => state.connected,
    titleForPack: (id) => (id === "nli" ? txt("packLibrary") : txt("packBase")),
    emptyLabel: () => txt("packEmpty"),
    sheetTitle: () => txt("layersSheetTitle"),
    sheetLede: () => txt("layersSheetLede"),
    closeLabel: () => txt("layersClose"),
    onClose: () => {
      if (state.screen === "free") renderFree();
    },
  });

  peopleArchive = createRemotePeopleArchiveController({
    root: document.querySelector(".app"),
    input: $("searchInput"),
    list: $("searchResults"),
    navigationSection: $("searchKit"),
    archiveButton: $("freeArchiveBtn"),
    dataContext,
    peopleRuntime: peopleSearch,
    getMode: () => "people",
    setMode: () => {},
    renderSuggestions: () => renderResults(""),
    setStatus: (message) => {
      state.freeError = message || null;
      renderSearchStatus();
    },
    setRootClass: () => {},
    setHidden: () => {},
    syncInputDirection: () => {},
    isNarrativeActive: () => false,
    isConnected: () => state.connected,
    onStateChange: () => {
      if (!archiveUiReady) return;
      renderKit();
      renderSearchStatus();
    },
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
    showClearFailed: () => { state.freeError = txt("searchClearFailed"); },
    clearSearchUi,
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
    applyDestinationCue: (item, index) => {
      const destination = item.steps[Math.max(0, Math.min(index, item.steps.length - 1))];
      void applyCue(destination.cue, item.narrative);
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
    const free = event.target.closest("[data-open-free]");
    if (free) {
      showScreen("free");
      renderFree();
      void timelineHost._ensureNliFeatureCache?.();
      return;
    }
    const card = event.target.closest("[data-open]");
    if (card) enterScript(card.dataset.open);
  });

  $("homeBtn").addEventListener("click", () => {
    void exitToHome();
  });

  $("ticks").addEventListener("click", (event) => {
    if (state.searchPending) return;
    const tick = event.target.closest("[data-step]");
    if (tick) goToStep(Number(tick.dataset.step));
  });

  $("prevBtn").addEventListener("click", () => {
    if (state.searchPending) return;
    const prev = prevAction(state);
    if (!prev) return;
    if (prev.scriptId === state.scriptId) goToStep(prev.step);
    else enterScript(prev.scriptId, prev);
  });

  $("nextBtn").addEventListener("click", () => {
    if (state.searchPending) return;
    const next = nextAction(state);
    if (next.kind === "step") goToStep(next.step);
    else if (next.kind === "resume") enterScript(next.scriptId, { step: next.step });
    else if (next.kind === "finish") void exitToHome();
  });

  $("nextChoices").addEventListener("click", (event) => {
    if (state.searchPending) return;
    const btn = event.target.closest("[data-branch]");
    const next = nextAction(state);
    if (!btn || next.kind !== "choose") return;
    enterScript(btn.dataset.branch, { returnTo: { id: next.scriptId, step: next.junction } });
  });

  $("kitEscape").addEventListener("click", (event) => {
    consumeNliNovaEscapeClick(event, escapeHost);
  });

  $("archiveBtn").addEventListener("click", () => {
    if (peopleArchive.getArchivePhase() === "open") {
      void peopleArchive.closeArchive();
      return;
    }
    const query = currentStep()?.personQuery;
    if (query) void selectAndOpenArchive(query);
  });

  $("searchInput").addEventListener("input", (event) => {
    if (state.searchPending) return;
    if (!event.target.value.trim()) {
      renderResults("");
      void clearSearchFocus();
      return;
    }
    renderResults(event.target.value);
  });

  $("searchResults").addEventListener("click", (event) => {
    if (state.searchPending) return;
    const placeBtn = event.target.closest("[data-kind='place']");
    if (placeBtn) {
      const place = lastPlaces.find((item) => item.id === placeBtn.dataset.placeId);
      const name = placeBtn.querySelector(".result-name")?.textContent || "";
      $("searchInput").value = name;
      renderResults("");
      if (!place) return;
      if (placeIsWithinRemoteBounds(place, dataContext) === false) {
        state.freeError = t("placeSearchEmpty");
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

  $("sceneList")?.addEventListener("click", (event) => {
    const btn = event.target.closest("[data-scene]");
    if (btn?.dataset.scene) void applyScene(btn.dataset.scene);
  });

  initNliStaffLocaleControls(dataContext, {
    onFailure: () => {
      state.freeError = t("statusError");
      renderSearchStatus();
    },
  });
  dataContext?.subscribe?.("legendSettings", (settings) => {
    if (settings?.language) applyServerLocale(settings.language);
  });
  window.addEventListener(LOCALE_EVENT, () => {
    peopleArchive.handleLocaleChange();
    render();
  });

  const timelineRoot = $("playerKit");
  timelineRoot.addEventListener("click", (event) => {
    consumeNliTimelineButtonClick(event, timelineHost);
  });
  bindNliTimelinePointerListeners(timelineRoot, timelineHost);

  dataContext?.subscribe?.("connection", (isConnected) => {
    state.connected = !!isConnected;
    renderConnection();
    peopleArchive.syncArchiveButton();
    renderKit();
    if (state.screen === "free") renderFree();
  });
  dataContext?.subscribe?.("connectionStatus", (status) => {
    state.connectionStatus = status;
    renderConnection();
  });
  dataContext?.subscribe?.("investigationClock", () => {
    paintTimelineMounts();
    if (state.screen === "free") packMenus?.render();
  });
  dataContext?.subscribe?.("narrativeState", () => {
    timelineHost._clearNliScrubOnNarrativeChange?.();
    renderKit();
  });
  dataContext?.subscribe?.("escapeOverlay", () => {
    renderKit();
  });
  dataContext?.subscribe?.("layerGroups", () => {
    if (state.screen === "free") renderFree();
  });
  state.connected = dataContext?.isConnected?.() !== false;
  render();
  void timelineHost._ensureNliFeatureCache?.();
  return { render };
}
