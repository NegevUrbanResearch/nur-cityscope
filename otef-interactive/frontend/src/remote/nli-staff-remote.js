import { getEffectiveLayerGroups } from "../shared/layer-state-helper.js";
import { getNliNarrative } from "../shared/nli-narratives.js";
import { NLI_PLAYABLE_IDS } from "../shared/nli-investigation-beats.js";
import {
  bindNliTimelinePointerListeners,
  consumeNliTimelineButtonClick,
  nliTimelineHostMethods,
  nliTransportSheetHtml,
} from "./nli-timeline-transport.js";
import {
  createNliNarrativePresentationController,
} from "./nli-narrative-controls.js";
import { consumeNliNovaEscapeClick, nliNovaEscapeTogglesHtml } from "./nli-nova-escape-toggles.js";
import { createCueRunner } from "./nli-staff-cues.js";
import { createPeopleSearchRuntime } from "./remote-people-search.js";
import {
  createRemotePeopleArchiveController,
  waitForInvestigationClockIdle,
} from "./remote-people-archive-controller.js";
import { createStaffPackMenus } from "./nli-staff-pack-menus.js";
import { labelForPlace, placeIsWithinRemoteBounds } from "./remote-place-navigation.js";
import { applyServerLocale, bindLocaleButtons, getLocale, t, LOCALE_EVENT } from "./remote-locale.js";
import { COPY, NARRATIVES, SCENES, SCRIPTS, SHOW } from "./nli-staff-script.js";
import { nextAction, prevAction, slideIndexes } from "./nli-staff-flow.js";
import { searchPlaces } from "../shared/place-navigation/place-catalog.js";

const NO_ESCAPE = Object.freeze({ individual: false, overlap: false, mor: false });

const $ = (id) => document.getElementById(id);

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
  };

  let lastPlaces = [];
  let archiveUiReady = false;
  let peopleArchive = null;
  let packMenus = null;

  const presentation = createNliNarrativePresentationController({
    dataContext,
    onStateChange: () => renderKit(),
  });

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
  const presentationId = () => {
    const id = script()?.narrative;
    return getNliNarrative(id)?.presentationUrl ? id : null;
  };

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
            <button type="button" class="nav-card nav-card--${variant}" data-open="${item.id}">
              <span class="nav-card-copy">
                <span class="nav-card-title">${loc(item.title)}</span>
                <span class="nav-card-meta">${loc(item.meta)} · ${item.steps.length} ${txt("steps")}</span>
              </span>
              <span class="nav-card-index">${item.index || ""}</span>
            </button>`;
  }

  function renderHome() {
    $("narrativeList").innerHTML =
      navCard(SHOW, "primary") +
      `<div class="nav-row">${NARRATIVES.map((item) => navCard(item, "narrative")).join("")}</div>` +
      `
          <button type="button" class="nav-card nav-card--quiet" data-open-free="1">
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
      presentation.getState()?.phase === "open",
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
        return `<button type="button" class="${cls}" data-step="${index}"${current} aria-label="${txt("stepAria", { n: n + 1 })}"></button>`;
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
    $("prevBtn").disabled = !prevAction(state);
    $("nextBtn").hidden = choices;
    $("nextBtn").textContent = txt({ step: "next", resume: "backToShow", finish: "done" }[next.kind] || "next");
    $("nextChoices").hidden = !choices;
    $("nextChoices").innerHTML = !choices ? "" : next.ids
      .map((id) => {
        const item = NARRATIVES.find((narrative) => narrative.id === id);
        const title = next.ids.length === 1 ? txt("startStory", { title: loc(item.title) }) : loc(item.title);
        return `<button type="button" class="branch-btn" data-branch="${id}">
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
      kitPresentation: kits.includes("presentation") && !!presentationId(),
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
    if (show.kitPresentation) {
      const phase = presentation.getState()?.phase || "closed";
      const pending = phase === "opening" || phase === "closing";
      const open = phase === "open" || phase === "closing";
      $("presentationBtn").textContent = t(
        pending
          ? open
            ? "nliNarrativePresentationClosing"
            : "nliNarrativePresentationOpening"
          : open
            ? "nliNarrativePresentationClose"
            : "nliNarrativePresentationOpen",
      );
      $("presentationBtn").disabled = !state.connected || pending;
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
      $("archiveBtn").disabled = !state.connected || pending;
    }
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
                <button type="button" data-kind="person" data-pid="${person.pid}" data-version="${person.datasetVersion}" data-archive="${person.hasArchiveRecord ? "1" : "0"}">
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
                <button type="button" data-kind="place" data-place-id="${place.id}">
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

  function paintFreeStatus(message, live) {
    const status = $("freeStatus");
    if (!status) return;
    status.replaceChildren();
    status.classList.toggle("is-live", !!live && !!message);
    if (!message) return;
    if (live) {
      const dot = document.createElement("span");
      dot.className = "live-dot";
      status.append(dot);
    }
    status.append(document.createTextNode(message));
  }

  function renderSearchStatus() {
    const archivePerson = peopleArchive?.getAcknowledgedPerson?.();
    if (state.freeError) {
      paintFreeStatus(state.freeError, false);
    } else if (archivePerson?.name) {
      paintFreeStatus(`${txt("nowShowing")}: ${archivePerson.name}`, true);
    } else if (state.placeName) {
      paintFreeStatus(`${txt("nowShowing")}: ${state.placeName}`, true);
    } else {
      paintFreeStatus("", false);
    }
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

  function resetSearch() {
    $("searchInput").value = "";
    renderResults("");
    state.freeError = null;
    state.placeName = null;
  }

  function goToStep(index) {
    const item = script();
    if (!item) return;
    state.step = Math.max(0, Math.min(index, item.steps.length - 1));
    const step = item.steps[state.step];
    const open = presentation.getState();
    if (open?.phase === "open" && !stepKits(step).includes("presentation")) {
      void presentation.run("close", open.id);
    }
    resetSearch();
    renderPlayer();
    void applyCue(step.cue, item.narrative);
  }

  function enterScript(id, { step = 0, returnTo = null } = {}) {
    state.scriptId = id;
    state.returnTo = returnTo;
    showScreen("player");
    goToStep(step);
    void timelineHost._ensureNliFeatureCache?.();
  }

  async function exitToHome() {
    cues.cancel();
    state.scriptId = null;
    state.step = 0;
    state.returnTo = null;
    state.scene = null;
    state.cueStatus = null;
    resetSearch();
    if (peopleArchive?.getArchivePhase?.() === "open") {
      void peopleArchive.closeArchive();
    }
    presentation.reset(null);
    showScreen("home");
    renderHome();
    if (dataContext?.setNarrative) {
      try {
        await dataContext.setNarrative(null);
      } catch {
        // ignore
      }
    }
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
  archiveUiReady = true;

  $("narrativeList").addEventListener("click", (event) => {
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
    const tick = event.target.closest("[data-step]");
    if (tick) goToStep(Number(tick.dataset.step));
  });

  $("prevBtn").addEventListener("click", () => {
    const prev = prevAction(state);
    if (!prev) return;
    if (prev.scriptId === state.scriptId) goToStep(prev.step);
    else enterScript(prev.scriptId, prev);
  });

  $("nextBtn").addEventListener("click", () => {
    const next = nextAction(state);
    if (next.kind === "step") goToStep(next.step);
    else if (next.kind === "resume") enterScript(next.scriptId, { step: next.step });
    else if (next.kind === "finish") void exitToHome();
  });

  $("nextChoices").addEventListener("click", (event) => {
    const btn = event.target.closest("[data-branch]");
    const next = nextAction(state);
    if (!btn || next.kind !== "choose") return;
    enterScript(btn.dataset.branch, { returnTo: { id: next.scriptId, step: next.junction } });
  });

  $("kitEscape").addEventListener("click", (event) => {
    consumeNliNovaEscapeClick(event, escapeHost);
  });

  $("presentationBtn").addEventListener("click", () => {
    const id = presentationId();
    if (!id) return;
    const phase = presentation.getState()?.phase || "closed";
    void presentation.run(phase === "open" ? "close" : "open", id);
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
    renderResults(event.target.value);
  });

  $("searchResults").addEventListener("click", (event) => {
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
      state.placeName = name;
      state.freeError = null;
      renderSearchStatus();
      void dataContext?.navigateToPlace?.(place).catch(() => {
        state.freeError = t("placeSearchFailed");
        renderSearchStatus();
      });
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
    state.placeName = null;
    state.freeError = null;
    $("searchInput").value = person.name;
    renderResults("");
    renderSearchStatus();
    void peopleArchive.selectPerson(person);
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
