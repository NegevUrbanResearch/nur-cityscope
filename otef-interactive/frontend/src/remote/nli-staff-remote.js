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
import { createPeopleSearchRuntime } from "./remote-people-search.js";
import {
  createRemotePeopleArchiveController,
  waitForInvestigationClockIdle,
} from "./remote-people-archive-controller.js";
import { createRemoteZoomController } from "./remote-zoom-controls.js";
import {
  createRemoteDpadController,
  createRemoteJoystickController,
} from "./remote-joystick-controls.js";
import { createStaffPackMenus } from "./nli-staff-pack-menus.js";
import { labelForPlace, placeIsWithinRemoteBounds } from "./remote-place-navigation.js";
import { applyServerLocale, bindLocaleButtons, getLocale, t, LOCALE_EVENT } from "./remote-locale.js";
import { COPY, NARRATIVES, SCENES } from "./nli-staff-script.js";
import { searchPlaces } from "../shared/place-navigation/place-catalog.js";

export const SETTLEMENT_LAYER_IDS = [
  "projector_base.שמות_יישובים",
  "projector_base.Locations_Lines",
  "projector_base.ישובים",
];
const ROAD_LAYER_IDS = ["nli.ציר_232"];
export const PEOPLE_NAMES_LAYER_IDS = ["nli.people_names"];
export const OPENING_LAYER_IDS = [
  ...SETTLEMENT_LAYER_IDS,
  ...ROAD_LAYER_IDS,
  "projector_base.רקע_שחור",
];
export const WALL_LAYER_IDS = [
  ...PEOPLE_NAMES_LAYER_IDS,
  "projector_base.רקע_שחור",
];

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
    narrativeId: null,
    step: 0,
    connected: false,
    scene: null,
    freeError: null,
    placeName: null,
  };

  let lastPlaces = [];
  let archiveUiReady = false;
  let peopleArchive = null;
  let viewerAngleDeg = 0;
  let packMenus = null;
  let joystickController = null;
  let joystickMountFrame = 0;

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
  const narrative = () => NARRATIVES.find((item) => item.id === state.narrativeId);
  const currentStep = () => narrative()?.steps[state.step] || null;
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

  let sceneApplyQueue = Promise.resolve();

  async function commitSceneLayers(enabledIds) {
    const want = [...new Set(enabledIds)];
    const wantSet = new Set(want);
    const off = collectAllFullLayerIds().filter((id) => !wantSet.has(id));
    if (off.length) await setLayerSet(off, false);
    if (want.length) await setLayerSet(want, true);
  }

  async function applyScene(id, options = {}) {
    const scene = SCENES.find((item) => item.id === id);
    if (!scene) return;
    if (id === "layers") {
      if (packMenus?.isOpen()) packMenus.close();
      else packMenus?.open();
      renderFree();
      return;
    }
    packMenus?.close({ silent: true });
    const turningOff = !options.force && state.scene === id;
    const target = turningOff ? null : id;
    state.scene = target;
    state.freeError = null;
    renderFree();

    const run = async () => {
      if (state.scene !== target) return;
      try {
        await ensureClockIdle();
        if (state.scene !== target) return;
        if (target === null) {
          await commitSceneLayers([]);
          return;
        }
        if (target === "open") {
          if (typeof dataContext?.setNarrative === "function") {
            try {
              await dataContext.setNarrative(null);
            } catch {
              try {
                await dataContext.setBasemap?.("dark");
              } catch {
                // Opening still applies layers even if the camera scene is unavailable.
              }
            }
          }
          if (state.scene !== target) return;
          await commitSceneLayers(OPENING_LAYER_IDS);
        } else if (target === "hour") {
          await commitSceneLayers(NLI_PLAYABLE_IDS);
          if (state.scene !== target) return;
          await waitForNliCache();
          if (state.scene !== target) return;
          await timelineHost.handleNliTimelinePlay?.();
        } else if (target === "wall") {
          if (typeof dataContext?.setNarrative === "function") {
            try {
              await dataContext.setNarrative(null);
            } catch {
              // Names still apply if the camera scene cannot be cleared.
            }
          }
          if (typeof dataContext?.clearPerson === "function") {
            try {
              await dataContext.clearPerson();
            } catch {
              // Keep the wall even if a leftover person selection cannot be cleared.
            }
          }
          if (state.scene !== target) return;
          await commitSceneLayers(WALL_LAYER_IDS);
        }
      } catch {
        if (state.scene === target) state.freeError = txt("disconnected");
      } finally {
        if (state.scene === target) renderFree();
      }
    };

    sceneApplyQueue = sceneApplyQueue.then(run, run);
    return sceneApplyQueue;
  }

  async function ensureClockIdle() {
    try {
      await waitForInvestigationClockIdle(dataContext);
    } catch {
      return;
    }
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
    el.textContent = state.connected ? txt("connected") : txt("disconnected");
    el.classList.toggle("is-on", state.connected);
  }

  function liveViewport() {
    const viewport = dataContext?.getViewport?.();
    return viewport?.bbox ? viewport : null;
  }

  function mountJoystick() {
    if (joystickMountFrame) cancelAnimationFrame(joystickMountFrame);
    let attempts = 0;
    const tryInit = () => {
      joystickMountFrame = 0;
      if (joystickController?.init()) return;
      if (attempts >= 12) return;
      attempts += 1;
      joystickMountFrame = requestAnimationFrame(tryInit);
    };
    tryInit();
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
    if (name !== "player") paintTimelineMounts();
    if (name === "free") mountJoystick();
    else joystickController?.destroy();
  }

  function renderHome() {
    $("narrativeList").innerHTML =
      NARRATIVES.map(
        (item) => `
            <button type="button" class="nav-card" data-open="${item.id}">
              <span class="nav-card-copy">
                <span class="nav-card-title">${loc(item.title)}</span>
                <span class="nav-card-meta">${loc(item.meta)} · ${item.steps.length} ${txt("steps")}</span>
              </span>
              <span class="nav-card-index">${item.index}</span>
            </button>`,
      ).join("") +
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
    ["kitTimeline", "freeTimeline"].forEach((id) => {
      const mount = $(id);
      if (!mount) return;
      mount.innerHTML = html;
    });
    timelineHost.sheet = state.screen === "free" ? $("freeTimeline") : $("kitTimeline");
    timelineHost._syncNliPlayheadTicker?.(clock);
    timelineHost._syncNliEndedTimer?.(clock);
  }

  function renderPlayer() {
    const item = narrative();
    if (!item) return;
    const step = item.steps[state.step];
    const total = item.steps.length;
    $("stepCount").textContent = `${state.step + 1} ${txt("of")} ${total}`;
    $("ticks").innerHTML = item.steps
      .map((_, index) => {
        const cls = index < state.step ? "is-done" : index === state.step ? "is-current" : "";
        return `<span class="${cls}"></span>`;
      })
      .join("");
    $("stepClock").textContent = step.clock && !String(step.clock).includes("x") ? step.clock : "";
    $("stepTitle").textContent = loc(step.title);
    $("stepNote").textContent = loc(step.note);
    $("stepNote").classList.toggle("draft-note", Boolean(step.draft));
    $("stepGis").textContent = loc(step.gis);
    $("stepModel").textContent = loc(step.model);
    $("prevBtn").disabled = state.step === 0;
    $("nextBtn").textContent = state.step === total - 1 ? txt("done") : txt("next");
    renderKit();
  }

  function renderKit() {
    const step = currentStep();
    const kits = stepKits(step);
    const hasTimeline = kits.includes("timeline");
    const hasPresentation = kits.includes("presentation");
    const hasArchive = kits.includes("archive");
    $("kitTimeline").hidden = !hasTimeline;
    $("kitPresentation").hidden = !hasPresentation;
    $("kitArchive").hidden = !hasArchive;
    $("kitIdle").hidden = kits.length > 0;
    $("kitIdle").textContent = txt("kitIdle");
    const clockLabel = step?.clock && !String(step.clock).includes("x") ? step.clock : "";
    $("kitReset").textContent = clockLabel ? txt("kitReset", { clock: clockLabel }) : txt("kitResetOpen");
    if (hasTimeline) {
      void timelineHost._ensureNliFeatureCache?.();
      paintTimelineMounts();
    }
    if (hasPresentation) {
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
      $("presentationBtn").disabled = !state.connected || pending || !getNliNarrative("segev")?.presentationUrl;
    }
    if (hasArchive) {
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

  function renderFree() {
    paintTimelineMounts();
    const list = $("sceneList");
    if (list) {
      list.innerHTML = SCENES.map((scene) => {
        const active = scene.id === "layers" ? packMenus?.isOpen() : state.scene === scene.id;
        return `
            <button type="button" class="scene-btn${active ? " is-active" : ""}" data-scene="${scene.id}">
              <span class="scene-btn-title">${loc(scene.title)}</span>
              <span class="scene-btn-meta">${loc(scene.meta)}</span>
            </button>`;
      }).join("");
    }
    packMenus?.render();
    const archivePerson = peopleArchive?.getAcknowledgedPerson?.();
    if (state.freeError) {
      paintFreeStatus(state.freeError, false);
    } else if (archivePerson?.name) {
      paintFreeStatus(`${txt("nowShowing")}: ${archivePerson.name}`, true);
    } else if (state.placeName) {
      paintFreeStatus(`${txt("nowShowing")}: ${state.placeName}`, true);
    } else if (state.scene) {
      const scene = SCENES.find((item) => item.id === state.scene);
      paintFreeStatus(scene ? `${txt("nowShowing")}: ${loc(scene.title)}` : "", true);
    } else {
      paintFreeStatus("", false);
    }
  }

  function render() {
    applyChrome();
    renderHome();
    if (state.screen === "player") renderPlayer();
    if (state.screen === "free") renderFree();
  }

  async function enterNarrative(id) {
    state.narrativeId = id;
    state.step = 0;
    if (dataContext?.setNarrative && ["segev", "nova"].includes(id)) {
      try {
        await dataContext.setNarrative(id);
      } catch {
        // Keep the staff script even if the map narrative is unavailable.
      }
    }
    showScreen("player");
    renderPlayer();
    void timelineHost._ensureNliFeatureCache?.();
  }

  async function exitNarrative() {
    state.narrativeId = null;
    state.step = 0;
    state.scene = null;
    state.placeName = null;
    state.freeError = null;
    if (dataContext?.setNarrative) {
      try {
        await dataContext.setNarrative(null);
      } catch {
        // ignore
      }
    }
    if (peopleArchive?.getArchivePhase?.() === "open") {
      void peopleArchive.closeArchive();
    }
    presentation.reset(null);
    showScreen("home");
    renderHome();
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

  const zoomController = createRemoteZoomController({
    slider: $("zoomSlider"),
    zoomIn: $("zoomIn"),
    zoomOut: $("zoomOut"),
    zoomValue: $("zoomValue"),
    getViewport: liveViewport,
    zoom: (level) => dataContext?.zoom?.(level),
    isConnected: () => state.connected,
  });
  zoomController.init();

  if (typeof dataContext?.getViewerAngleDeg === "function") {
    const angle = dataContext.getViewerAngleDeg();
    if (typeof angle === "number" && !Number.isNaN(angle)) viewerAngleDeg = angle;
  }

  const dpadController = createRemoteDpadController({
    root: $("free") || document,
    isConnected: () => state.connected,
    getViewport: liveViewport,
    getViewerAngleDeg: () => viewerAngleDeg,
    sendVelocity: (dx, dy) => dataContext?.sendVelocity?.(dx, dy),
  });
  dpadController.init();

  joystickController = createRemoteJoystickController({
    zone: $("joystickZone"),
    nipplejs: typeof globalThis.nipplejs !== "undefined" ? globalThis.nipplejs : null,
    isConnected: () => state.connected,
    getViewport: liveViewport,
    getViewerAngleDeg: () => viewerAngleDeg,
    sendVelocity: (dx, dy) => dataContext?.sendVelocity?.(dx, dy),
    onStart: () => dpadController.setEnabled(false),
    onEnd: () => dpadController.setEnabled(true),
    size: 100,
    color: "#1a1a1a",
    restOpacity: 0.6,
  });

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
    root: $("free"),
    input: $("searchInput"),
    list: $("searchResults"),
    navigationSection: $("free"),
    archiveButton: $("freeArchiveBtn"),
    dataContext,
    peopleRuntime: peopleSearch,
    getMode: () => "people",
    setMode: () => {},
    renderSuggestions: () => renderResults(""),
    setStatus: (message) => {
      state.freeError = message || null;
      if (state.screen === "free") renderFree();
    },
    setRootClass: () => {},
    setHidden: () => {},
    syncInputDirection: () => {},
    isNarrativeActive: () => false,
    isConnected: () => state.connected,
    onStateChange: () => {
      if (!archiveUiReady) return;
      renderKit();
      if (state.screen === "free") renderFree();
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
    if (card) void enterNarrative(card.dataset.open);
  });

  $("homeBtn").addEventListener("click", () => {
    $("searchInput").value = "";
    renderResults("");
    void exitNarrative();
  });

  $("prevBtn").addEventListener("click", () => {
    if (state.step === 0) return;
    state.step -= 1;
    renderPlayer();
  });

  $("nextBtn").addEventListener("click", () => {
    const item = narrative();
    if (!item) return;
    if (state.step >= item.steps.length - 1) {
      void exitNarrative();
      return;
    }
    state.step += 1;
    renderPlayer();
  });

  $("presentationBtn").addEventListener("click", () => {
    const phase = presentation.getState()?.phase || "closed";
    const action = phase === "open" ? "close" : "open";
    void presentation.run(action, "segev");
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
        renderFree();
        return;
      }
      state.placeName = name;
      state.freeError = null;
      renderFree();
      void dataContext?.navigateToPlace?.(place).catch(() => {
        state.freeError = t("placeSearchFailed");
        renderFree();
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
    renderFree();
    void peopleArchive.selectPerson(person);
  });

  $("sceneList")?.addEventListener("click", (event) => {
    const btn = event.target.closest("[data-scene]");
    if (btn?.dataset.scene) void applyScene(btn.dataset.scene);
  });

  initNliStaffLocaleControls(dataContext, {
    onFailure: () => {
      state.freeError = t("statusError");
      renderFree();
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
  $("freeTimeline").addEventListener("click", (event) => {
    consumeNliTimelineButtonClick(event, timelineHost);
  });
  bindNliTimelinePointerListeners(timelineRoot, timelineHost);
  bindNliTimelinePointerListeners($("freeTimeline"), timelineHost);

  dataContext?.subscribe?.("connection", (isConnected) => {
    state.connected = !!isConnected;
    renderConnection();
    peopleArchive.syncArchiveButton();
    renderKit();
    renderFree();
  });
  dataContext?.subscribe?.("investigationClock", () => {
    paintTimelineMounts();
    if (state.screen === "free") packMenus?.render();
  });
  dataContext?.subscribe?.("narrativeState", () => {
    renderKit();
  });
  dataContext?.subscribe?.("layerGroups", () => {
    if (state.screen === "free") renderFree();
  });
  dataContext?.subscribe?.("orientation", (angle) => {
    if (typeof angle === "number" && !Number.isNaN(angle)) viewerAngleDeg = angle;
  });
  dataContext?.subscribe?.("viewport", (viewport) => {
    zoomController.syncFromViewport(viewport);
  });

  state.connected = dataContext?.isConnected?.() !== false;
  render();
  void timelineHost._ensureNliFeatureCache?.();
  return { render };
}
