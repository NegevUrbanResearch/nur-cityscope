/**
 * NLI pack transport: render, scrub paint, and play/stop/loop/step/scrub handlers.
 * LayerSheetController mounts the HTML when the selected pack is `nli` and forwards events.
 */

import { t } from "./remote-locale.js";
import { escapeHtml } from "../shared/html-utils.js";
import {
  INVESTIGATION_ALARMS_FULL_ID,
  INVESTIGATION_LINES_FULL_ID,
  INVESTIGATION_POLYGONS_FULL_ID,
  NLI_PLAYABLE_IDS,
  TIMELINE_BEAT_MS,
  clockStoryDurationMs,
  formatMinutesAsLocalClock,
  isNliPlayableFullId,
} from "../shared/nli-investigation-beats.js";
import {
  beatsForMembership,
  endNliClock,
  evaluateClock,
  idleNliClock,
  nliPlayableIdsFromGroups,
  pauseNliClock,
  playNliClock,
  replayNliClock,
  resumeNliClock,
  seekNliClock,
  setNliLoop,
  stepNliClock,
  stopNliClock,
} from "../shared/nli-investigation-clock.js";

const NLI_ICON_PLAY = `<svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path fill="currentColor" d="M8 5v14l11-7z"/></svg>`;
const NLI_ICON_PAUSE = `<svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path fill="currentColor" d="M6 5h4v14H6zm8 0h4v14h-4z"/></svg>`;
const NLI_ICON_STOP = `<svg width="14" height="14" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><rect fill="currentColor" x="6" y="6" width="12" height="12" rx="1"/></svg>`;
const NLI_ICON_LOOP = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M17 2l4 4-4 4"/><path d="M3 12a8 8 0 0 1 14-5.3L21 10"/><path d="M7 22l-4-4 4-4"/><path d="M21 12a8 8 0 0 1-14 5.3L3 14"/></svg>`;

function escapeHtmlSafe(value) {
  return escapeHtml(value);
}

function nliNowMs() {
  if (
    typeof OTEFDataContext !== "undefined" &&
    typeof OTEFDataContext.correctedNow === "function"
  ) {
    return OTEFDataContext.correctedNow();
  }
  return Date.now();
}

function nliFiniteBeatMinutes(beats) {
  return Array.isArray(beats)
    ? beats.filter((n) => typeof n !== "boolean" && Number.isFinite(Number(n))).map(Number)
    : [];
}

/**
 * Sorted unique hours that contain ≥1 beat.
 * @param {number[]} beats
 * @returns {number[]}
 */
export function nliOccupiedHours(beats) {
  const hours = new Set();
  for (const minutes of nliFiniteBeatMinutes(beats)) {
    hours.add(Math.floor(minutes / 60));
  }
  return [...hours].sort((a, b) => a - b);
}

function nliBeatsInHour(list, hour) {
  const indexes = [];
  for (let i = 0; i < list.length; i += 1) {
    if (Math.floor(list[i] / 60) === hour) indexes.push(i);
  }
  return indexes;
}

/**
 * Equal-width occupied-hour columns; equal-width beat bins inside each column.
 * column hIdx = [hIdx/H, (hIdx+1)/H); beat j = [j/k, (j+1)/k) inside the column.
 * Thumb is the bin center: (hIdx + (j+0.5)/k) / H. Pointer is the bin that contains t.
 * @param {number[]} beats
 * @returns {{ list: number[], hours: number[], H: number, columns: number[][] }}
 */
function nliOccupiedHourLayout(beats) {
  const list = nliFiniteBeatMinutes(beats);
  const hours = nliOccupiedHours(list);
  const columns = hours.map((hour) => nliBeatsInHour(list, hour));
  return { list, hours, H: hours.length, columns };
}

/**
 * Thumb / tick %: occupied hours are equal-width columns; beats are equal-index inside the column.
 * @param {number} index
 * @param {number[]} beats
 * @returns {number}
 */
export function nliBeatPctOccupiedHour(index, beats) {
  const { list, hours, H, columns } = nliOccupiedHourLayout(beats);
  const n = list.length;
  if (n === 0 || H <= 0) return 0;
  const i = Math.max(0, Math.min(n - 1, Number(index)));
  if (!Number.isFinite(i)) return 0;
  const hour = Math.floor(list[i] / 60);
  const hIdx = Math.max(0, hours.indexOf(hour));
  const inHour = columns[hIdx] || [];
  const k = inHour.length;
  if (k <= 0) return 0;
  const j = Math.max(0, inHour.indexOf(i));
  return ((hIdx + (j + 0.5) / k) / H) * 100;
}

export function nliBeatIndexFromOccupiedHourPct(t, beats) {
  const { hours, H, columns } = nliOccupiedHourLayout(beats);
  if (H <= 0) return 0;
  const clamped = Math.max(0, Math.min(1, Number(t)));
  if (!Number.isFinite(clamped)) return 0;
  const hIdx = Math.min(H - 1, Math.floor(clamped * H));
  const inHour = columns[hIdx] || [];
  const k = inHour.length;
  if (k <= 0) return 0;
  const local = clamped * H - hIdx;
  const j = Math.min(k - 1, Math.floor(local * k));
  return inHour[Math.max(0, j)];
}

/**
 * Axis marks on occupied-hour columns (same mapping as the thumb).
 * Sparse (n ≤ 16): one tick per beat; label first, last, and hour-change as HH:MM.
 * Dense (n > 16): hour labels at occupied-hour column centers. Empty hours are omitted.
 * @param {number[]} beats
 * @returns {{ ticks: Array<{ index: number, minutes: number, pct: number, label: string, kind: "beat"|"hour" }> }}
 */
export function nliAxisMarksFromBeats(beats) {
  const { list, hours, H, columns } = nliOccupiedHourLayout(beats);
  const n = list.length;
  if (n === 0) return { ticks: [] };
  const ticks = [];
  if (n > 16) {
    for (let hIdx = 0; hIdx < H; hIdx += 1) {
      const hour = hours[hIdx];
      const inHour = columns[hIdx] || [];
      const index = inHour[0] ?? 0;
      ticks.push({
        index,
        minutes: list[index],
        pct: H <= 0 ? 0 : ((hIdx + 0.5) / H) * 100,
        label: String(hour).padStart(2, "0"),
        kind: "hour",
      });
    }
    return { ticks };
  }
  for (let i = 0; i < n; i += 1) {
    const minutes = list[i];
    const hour = Math.floor(minutes / 60);
    const prevHour = i > 0 ? Math.floor(list[i - 1] / 60) : null;
    const labeled = i === 0 || i === n - 1 || hour !== prevHour;
    ticks.push({
      index: i,
      minutes,
      pct: nliBeatPctOccupiedHour(i, list),
      label: labeled ? formatMinutesAsLocalClock(minutes) : "",
      kind: labeled ? "hour" : "beat",
    });
  }
  return { ticks };
}

export function nliFeatureBagsFromCache(cache) {
  const src = cache && typeof cache === "object" ? cache : {};
  return {
    polygonFeatures: src[INVESTIGATION_POLYGONS_FULL_ID],
    lineFeatures: src[INVESTIGATION_LINES_FULL_ID],
    alarmFeatures: src[INVESTIGATION_ALARMS_FULL_ID],
  };
}

export function nliCacheReadyForIds(cache, ids) {
  if (!Array.isArray(ids) || ids.length === 0) return false;
  const src = cache && typeof cache === "object" ? cache : {};
  return ids.every((id) => Array.isArray(src[id]) && src[id].length > 0);
}

function nliDisplayBeats(clock, fallbackBeats) {
  if (clock && clock.phase !== "idle" && Array.isArray(clock.beats) && clock.beats.length > 0) {
    return clock.beats;
  }
  return Array.isArray(fallbackBeats) ? fallbackBeats : [];
}

function nliThumbIndex(clock, displayBeats) {
  const beats = nliDisplayBeats(clock, displayBeats);
  const n = beats.length;
  if (n === 0) return 0;
  if (!clock || clock.phase === "idle") return 0;
  const vis = evaluateClock(clock, nliNowMs());
  if (vis.mode === "beat" && vis.index >= 0 && vis.index < n) return vis.index;
  return n - 1;
}

function nliStoryClockLabel(clock, displayBeats) {
  const beats = nliDisplayBeats(clock, displayBeats);
  const index = nliThumbIndex(clock, displayBeats);
  const minutes = beats[index];
  return formatMinutesAsLocalClock(minutes);
}

export function nliBeatIndexFromPointer(el, clientX, beats) {
  const list = nliFiniteBeatMinutes(beats);
  const n = list.length;
  if (n <= 1) return 0;
  const rect = typeof el.getBoundingClientRect === "function" ? el.getBoundingClientRect() : { left: 0, width: 1 };
  const width = rect.width || 1;
  const t = (Number(clientX) - rect.left) / width;
  const clamped = Math.max(0, Math.min(1, t));
  return nliBeatIndexFromOccupiedHourPct(clamped, list);
}

export function paintNliTransportPlayhead(root, clock, beats) {
  if (!root || typeof root.querySelector !== "function") return;
  const displayBeats = nliDisplayBeats(clock, beats);
  const index = nliThumbIndex(clock, displayBeats);
  paintNliScrubPreview(root.querySelector("[data-nli-tl-scrub]"), index, displayBeats);
  const clockEl = root.querySelector(".nli-tl-clock");
  if (clockEl) {
    clockEl.textContent = nliStoryClockLabel(clock, displayBeats);
  }
}

export function paintNliScrubPreview(track, index, beats) {
  if (!track || typeof track.querySelector !== "function") return;
  const list = Array.isArray(beats) ? beats : [];
  const n = list.length;
  const i = n === 0 ? 0 : Math.max(0, Math.min(n - 1, Number(index) || 0));
  const pct = nliBeatPctOccupiedHour(i, list);
  const label = formatMinutesAsLocalClock(n ? list[i] : NaN);
  const thumb = track.querySelector(".nli-tl-thumb");
  const fill = track.querySelector(".nli-tl-track-fill");
  let bubble = track.querySelector(".nli-tl-bubble");
  if (thumb && thumb.style) thumb.style.left = `${pct}%`;
  if (fill && fill.style) fill.style.width = `${pct}%`;
  if (bubble) {
    if (bubble.style) bubble.style.left = `${pct}%`;
    if (label) bubble.textContent = label;
  } else if (
    label &&
    typeof document !== "undefined" &&
    typeof track.insertBefore === "function"
  ) {
    bubble = document.createElement("div");
    bubble.className = "nli-tl-bubble";
    bubble.dir = "ltr";
    bubble.style.left = `${pct}%`;
    bubble.textContent = label;
    track.insertBefore(bubble, track.firstChild);
  }
  if (typeof track.setAttribute === "function") {
    track.setAttribute("aria-valuenow", String(i));
  }
}

export function isNliPlayableLayerLocked(clock, fullLayerIds) {
  if (!clock || (clock.phase !== "playing" && clock.phase !== "paused" && clock.phase !== "ended")) {
    return false;
  }
  return (fullLayerIds || []).some((id) => isNliPlayableFullId(id));
}

/**
 * @param {import("../shared/nli-investigation-clock.js").NliInvestigationClock} clock
 * @param {{
 *   playDisabled?: boolean,
 *   stepScrubDisabled?: boolean,
 *   presentationActive?: boolean,
 *   displayBeats?: number[],
 * }} [options]
 * @returns {string}
 */
export function renderNliTimelineTransport(clock, options = {}) {
  const src = clock && typeof clock === "object" ? clock : idleNliClock();
  const playDisabled = !!options.playDisabled;
  const stepScrubDisabled = !!options.stepScrubDisabled;
  const presentationActive = !!options.presentationActive;
  const displayBeats = Array.isArray(options.displayBeats) ? options.displayBeats : [];
  const allOff = presentationActive;
  const playOff = allOff || playDisabled;
  const stepOff = allOff || stepScrubDisabled;
  const vis = evaluateClock(src, nliNowMs());
  const isPlaying = src.phase === "playing" && vis.phase !== "ended";
  const story = nliStoryClockLabel(src, displayBeats);
  const beats = nliDisplayBeats(src, displayBeats);
  const { ticks } = nliAxisMarksFromBeats(beats);
  const index = nliThumbIndex(src, displayBeats);
  const pct = nliBeatPctOccupiedHour(index, beats);
  const showBubble = src.phase !== "idle" && story;
  const loopOn = !!src.loop;
  const playAria = isPlaying ? "ariaNliTimelinePause" : "ariaNliTimelinePlay";
  const playIcon = isPlaying ? NLI_ICON_PAUSE : NLI_ICON_PLAY;
  const disabledAttr = (off) => (off ? " disabled" : "");
  const tickHtml = ticks
    .map((mark) => {
      const hourClass = mark.kind === "hour" ? " nli-tl-tick--hour" : "";
      return `<i class="nli-tl-tick${hourClass}" style="left:${mark.pct}%"></i>`;
    })
    .join("");
  const hourHtml = ticks
    .filter((mark) => mark.label)
    .map(
      (mark) =>
        `<span style="left:${mark.pct}%">${escapeHtmlSafe(mark.label)}</span>`,
    )
    .join("");
  return `<div class="nli-tl-sheet" aria-disabled="${allOff ? "true" : "false"}">
  <div class="nli-tl-clock" dir="ltr">${escapeHtmlSafe(story)}</div>
  <div class="nli-tl-dock">
    <button type="button" class="nli-tl-btn" data-nli-tl-stop data-i18n-aria="ariaNliTimelineStop" aria-label="${escapeHtmlSafe(t("ariaNliTimelineStop"))}"${disabledAttr(allOff)}>${NLI_ICON_STOP}</button>
    <button type="button" class="nli-tl-btn nli-tl-btn--play" data-nli-tl-play data-i18n-aria="${playAria}" aria-label="${escapeHtmlSafe(t(playAria))}"${disabledAttr(playOff)}>${playIcon}</button>
    <button type="button" class="nli-tl-btn nli-tl-loop${loopOn ? " nli-tl-loop--on" : ""}" data-nli-tl-loop data-i18n-aria="ariaNliTimelineLoop" aria-label="${escapeHtmlSafe(t("ariaNliTimelineLoop"))}" aria-pressed="${loopOn ? "true" : "false"}"${disabledAttr(allOff)}>${NLI_ICON_LOOP}</button>
  </div>
  <div class="nli-tl-scrub-row">
    <button type="button" class="nli-tl-step" data-nli-tl-step-back data-i18n-aria="ariaNliTimelineStepBack" aria-label="${escapeHtmlSafe(t("ariaNliTimelineStepBack"))}"${disabledAttr(stepOff)}>‹</button>
    <div class="nli-tl-track${src.phase === "idle" ? " nli-tl-track--idle" : ""}" data-nli-tl-scrub dir="ltr" data-i18n-aria="ariaNliTimelineScrub" aria-label="${escapeHtmlSafe(t("ariaNliTimelineScrub"))}" role="slider" aria-valuemin="0" aria-valuemax="${Math.max(0, beats.length - 1)}" aria-valuenow="${index}"${stepOff ? ' aria-disabled="true"' : ""}>
      ${showBubble ? `<div class="nli-tl-bubble" dir="ltr" style="left:${pct}%">${escapeHtmlSafe(story)}</div>` : ""}
      <div class="nli-tl-track-line"></div>
      <div class="nli-tl-track-fill" style="width:${src.phase === "idle" ? 0 : pct}%"></div>
      <div class="nli-tl-ticks">${tickHtml}</div>
      <div class="nli-tl-hours">${hourHtml}</div>
      <div class="nli-tl-thumb" style="left:${pct}%"></div>
    </div>
    <button type="button" class="nli-tl-step" data-nli-tl-step-forward data-i18n-aria="ariaNliTimelineStepForward" aria-label="${escapeHtmlSafe(t("ariaNliTimelineStepForward"))}"${disabledAttr(stepOff)}>›</button>
  </div>
</div>`;
}

export function nliTransportSheetHtml(selected, clock, cache, presentationActive) {
  if (!selected || selected.id !== "nli") return "";
  const visible = nliPlayableIdsFromGroups([selected]);
  const cacheReady = nliCacheReadyForIds(cache, visible);
  const displayBeats =
    clock && clock.phase !== "idle" && Array.isArray(clock.beats) && clock.beats.length > 0
      ? clock.beats
      : beatsForMembership(visible, nliFeatureBagsFromCache(cache));
  const controlsOff = presentationActive || visible.length === 0 || !cacheReady;
  return renderNliTimelineTransport(clock, {
    playDisabled: controlsOff,
    stepScrubDisabled: controlsOff,
    presentationActive,
    displayBeats,
  });
}

export function consumeNliTimelineButtonClick(e, host) {
  const target = e.target;
  if (!target || typeof target.closest !== "function") return false;
  const nliStop = target.closest("[data-nli-tl-stop]");
  if (nliStop) {
    e.preventDefault();
    e.stopPropagation();
    void host.handleNliTimelineStop();
    return true;
  }
  const nliPlay = target.closest("[data-nli-tl-play]");
  if (nliPlay) {
    e.preventDefault();
    e.stopPropagation();
    void host.handleNliTimelinePlay();
    return true;
  }
  const nliLoop = target.closest("[data-nli-tl-loop]");
  if (nliLoop) {
    e.preventDefault();
    e.stopPropagation();
    void host.handleNliTimelineLoop();
    return true;
  }
  const nliBack = target.closest("[data-nli-tl-step-back]");
  if (nliBack) {
    e.preventDefault();
    e.stopPropagation();
    void host.handleNliTimelineStep(-1);
    return true;
  }
  const nliFwd = target.closest("[data-nli-tl-step-forward]");
  if (nliFwd) {
    e.preventDefault();
    e.stopPropagation();
    void host.handleNliTimelineStep(1);
    return true;
  }
  return false;
}

export function bindNliTimelinePointerListeners(content, host) {
  content.addEventListener("pointerdown", (e) => {
    const scrub = e.target instanceof Element ? e.target.closest("[data-nli-tl-scrub]") : null;
    if (!scrub) return;
    e.preventDefault();
    host._nliScrubEl = scrub;
    host.handleNliTimelineScrubPointerDown(e.clientX);
    if (typeof scrub.setPointerCapture === "function") {
      try {
        scrub.setPointerCapture(e.pointerId);
      } catch {
        // ignore
      }
    }
  });

  content.addEventListener("pointermove", (e) => {
    if (!host._nliScrubEl || !host._nliScrub) return;
    host.handleNliTimelineScrubPointerMove(e.clientX);
  });

  content.addEventListener("pointerup", (e) => {
    if (!host._nliScrubEl || !host._nliScrub) return;
    const live =
      host.sheet && typeof host.sheet.querySelector === "function"
        ? host.sheet.querySelector("[data-nli-tl-scrub]")
        : null;
    const scrub = live || host._nliScrubEl;
    if (!scrub) return;
    const preview = host._nliScrub.previewIndex;
    const clock = typeof host._readNliClock === "function" ? host._readNliClock() : null;
    const fallbackBeats =
      typeof host._nliArmPayload === "function" ? host._nliArmPayload().beats : [];
    const beats = nliDisplayBeats(clock, fallbackBeats);
    const index = Number.isFinite(preview)
      ? preview
      : nliBeatIndexFromPointer(scrub, e.clientX, beats);
    host._nliScrubEl = null;
    void host.handleNliTimelineScrubPointerUp(index);
  });

  content.addEventListener("pointercancel", () => {
    host._nliScrubEl = null;
    void host.handleNliTimelineScrubPointerCancel();
  });
}

export const nliTimelineHostMethods = {
  _readNliClock() {
    if (this._nliOptimisticClock) return this._nliOptimisticClock;
    if (
      typeof OTEFDataContext !== "undefined" &&
      typeof OTEFDataContext.getInvestigationClock === "function"
    ) {
      return OTEFDataContext.getInvestigationClock() || idleNliClock();
    }
    return idleNliClock();
  },

  _liveNliClock() {
    if (
      typeof OTEFDataContext !== "undefined" &&
      typeof OTEFDataContext.getInvestigationClock === "function"
    ) {
      return OTEFDataContext.getInvestigationClock() || idleNliClock();
    }
    return idleNliClock();
  },

  _isPresentationActive() {
    if (typeof OTEFDataContext === "undefined") return false;
    const slideshow =
      typeof OTEFDataContext.getProjectionSlideshow === "function"
        ? OTEFDataContext.getProjectionSlideshow()
        : null;
    return !!(slideshow && slideshow.type === "start");
  },

  _visibleNliPlayableIds() {
    return nliPlayableIdsFromGroups(this.getEffectiveGroupsForView());
  },

  _nliCacheReady(ids) {
    return nliCacheReadyForIds(this._nliFeatureCache, ids);
  },

  _nliArmPayload() {
    const visibleMembership = this._visibleNliPlayableIds();
    return {
      visibleMembership,
      beats: beatsForMembership(visibleMembership, nliFeatureBagsFromCache(this._nliFeatureCache)),
    };
  },

  async _patchNliClock(next) {
    if (
      typeof OTEFDataContext === "undefined" ||
      typeof OTEFDataContext.patchInvestigationClock !== "function"
    ) {
      return;
    }
    this._nliOptimisticClock = null;
    await OTEFDataContext.patchInvestigationClock(next);
  },

  _clearNliPlayheadTicker() {
    if (this._nliPlayheadTimer != null) {
      clearTimeout(this._nliPlayheadTimer);
      this._nliPlayheadTimer = null;
    }
  },

  _paintNliPlayhead(clock) {
    if (this._nliScrub) return;
    const content =
      this.sheet && typeof this.sheet.querySelector === "function"
        ? this.sheet.querySelector(".sheet-content")
        : null;
    if (!content) return;
    const fallbackBeats = this._nliArmPayload().beats;
    paintNliTransportPlayhead(content, clock, fallbackBeats);
  },

  _syncNliPlayheadTicker(clock) {
    this._clearNliPlayheadTicker();
    if (this._nliScrub) return;
    if (!clock || clock.phase !== "playing") return;
    const vis = evaluateClock(clock, nliNowMs());
    if (vis.phase === "ended") return;
    const elapsed = Number(vis.beatElapsedMs);
    const delay = Math.max(0, TIMELINE_BEAT_MS - (Number.isFinite(elapsed) ? elapsed : 0));
    this._nliPlayheadTimer = setTimeout(() => {
      this._nliPlayheadTimer = null;
      if (this._nliScrub) return;
      if (!clock || clock.phase !== "playing") return;
      const visNow = evaluateClock(clock, nliNowMs());
      if (visNow.phase === "ended") return;
      this._paintNliPlayhead(clock);
      this._syncNliPlayheadTicker(clock);
    }, delay);
  },

  _syncNliEndedTimer(clock) {
    if (this._nliEndTimer != null) {
      clearTimeout(this._nliEndTimer);
      this._nliEndTimer = null;
    }
    if (!clock || clock.loop || clock.phase !== "playing") return;
    const now = nliNowMs();
    const epoch = Number(clock.playEpochMs);
    const dur = clockStoryDurationMs(clock.beats);
    const delay = Number.isFinite(epoch) ? Math.max(0, epoch + dur - now) : dur;
    const revision = clock.revision;
    this._nliEndTimer = setTimeout(() => {
      this._nliEndTimer = null;
      if (typeof OTEFDataContext === "undefined") return;
      const current =
        typeof OTEFDataContext.getInvestigationClock === "function"
          ? OTEFDataContext.getInvestigationClock()
          : null;
      if (!current || current.revision !== revision) return;
      void OTEFDataContext.patchInvestigationClock(endNliClock(current));
    }, delay);
  },

  async _ensureNliFeatureCache() {
    if (this.focusedGroupId !== "nli") return;
    if (this._nliCacheFetchInflight) return;
    const ids = NLI_PLAYABLE_IDS;
    if (!this._nliFeatureCache) this._nliFeatureCache = Object.create(null);
    const missing = ids.filter((id) => !Array.isArray(this._nliFeatureCache[id]));
    if (missing.length === 0) return;
    this._nliCacheFetchInflight = true;
    let loaded = false;
    try {
      for (const id of missing) {
        try {
          const url =
            typeof layerRegistry !== "undefined" &&
            typeof layerRegistry.getLayerDataUrl === "function"
              ? layerRegistry.getLayerDataUrl(id)
              : null;
          if (!url || typeof fetch !== "function") {
            this._nliFeatureCache[id] = null;
            continue;
          }
          const res = await fetch(url);
          if (!res.ok) {
            this._nliFeatureCache[id] = null;
            continue;
          }
          const json = await res.json();
          this._nliFeatureCache[id] = Array.isArray(json?.features) ? json.features : [];
          loaded = true;
        } catch {
          this._nliFeatureCache[id] = null;
        }
      }
    } finally {
      this._nliCacheFetchInflight = false;
    }
    if (loaded) this.render();
  },

  async handleNliTimelinePlay() {
    if (this._isPresentationActive()) return;
    const clock = this._liveNliClock();
    const now = nliNowMs();
    const vis = evaluateClock(clock, now);
    if (clock.phase === "ended" || vis.phase === "ended") {
      await this._patchNliClock(replayNliClock(clock, now));
      return;
    }
    if (clock.phase === "playing") {
      await this._patchNliClock(pauseNliClock(clock, now));
      return;
    }
    if (clock.phase === "paused") {
      await this._patchNliClock(resumeNliClock(clock, now));
      return;
    }
    const membership = this._visibleNliPlayableIds();
    if (!this._nliCacheReady(membership)) {
      await this._ensureNliFeatureCache();
      if (!this._nliCacheReady(membership)) return;
    }
    const beats = beatsForMembership(membership, nliFeatureBagsFromCache(this._nliFeatureCache));
    if (!beats.length) return;
    await this._patchNliClock(playNliClock(clock, membership, beats, now));
  },

  async handleNliTimelineStop() {
    if (this._isPresentationActive()) return;
    await this._patchNliClock(stopNliClock(this._liveNliClock()));
  },

  async handleNliTimelineLoop() {
    if (this._isPresentationActive()) return;
    const clock = this._liveNliClock();
    await this._patchNliClock(setNliLoop(clock, !clock.loop));
  },

  async handleNliTimelineStep(delta) {
    if (this._isPresentationActive()) return;
    const clock = this._liveNliClock();
    const visible = this._visibleNliPlayableIds();
    if (visible.length === 0) return;
    const cacheIds = clock.phase === "idle" ? visible : clock.membership.length ? clock.membership : visible;
    if (!this._nliCacheReady(cacheIds)) {
      await this._ensureNliFeatureCache();
      if (!this._nliCacheReady(cacheIds)) return;
    }
    const arm = clock.phase === "idle" ? this._nliArmPayload() : undefined;
    if (clock.phase === "idle" && (!arm.beats || arm.beats.length === 0)) return;
    const next = stepNliClock(clock, delta, nliNowMs(), arm);
    if (next === clock || next.phase === "idle") return;
    await this._patchNliClock(next);
  },

  handleNliTimelineScrubPointerDown(clientX) {
    if (this._isPresentationActive()) return;
    const clock = this._liveNliClock();
    const visible = this._visibleNliPlayableIds();
    const cacheIds = clock.phase === "idle" ? visible : clock.membership.length ? clock.membership : visible;
    if (visible.length === 0 || !this._nliCacheReady(cacheIds)) return;
    this._nliScrub = { fromPlaying: clock.phase === "playing" };
    if (clock.phase === "playing") {
      this._nliOptimisticClock = pauseNliClock(clock, nliNowMs());
      this._syncNliEndedTimer(this._nliOptimisticClock);
      if (
        typeof OTEFDataContext !== "undefined" &&
        typeof OTEFDataContext.patchInvestigationClock === "function"
      ) {
        void OTEFDataContext.patchInvestigationClock(this._nliOptimisticClock);
      }
    }
    if (typeof clientX === "number") {
      this.handleNliTimelineScrubPointerMove(clientX);
    }
  },

  handleNliTimelineScrubPointerMove(clientX) {
    if (this._isPresentationActive()) return;
    const track = this._nliScrubEl;
    if (!track || !this._nliScrub) return;
    const clock = this._readNliClock();
    const beats = nliDisplayBeats(clock, this._nliArmPayload().beats);
    const index = nliBeatIndexFromPointer(track, clientX, beats);
    this._nliScrub.previewIndex = index;
    paintNliScrubPreview(track, index, beats);
  },

  async handleNliTimelineScrubPointerUp(beatIndex) {
    if (this._isPresentationActive()) return;
    const clock = this._liveNliClock();
    const visible = this._visibleNliPlayableIds();
    const cacheIds = clock.phase === "idle" ? visible : clock.membership.length ? clock.membership : visible;
    if (visible.length === 0 || !this._nliCacheReady(cacheIds)) {
      await this._ensureNliFeatureCache();
      if (visible.length === 0 || !this._nliCacheReady(cacheIds)) {
        this._nliScrub = null;
        this._nliOptimisticClock = null;
        return;
      }
    }
    const arm = clock.phase === "idle" ? this._nliArmPayload() : undefined;
    if (clock.phase === "idle" && (!arm.beats || arm.beats.length === 0)) {
      this._nliScrub = null;
      this._nliOptimisticClock = null;
      return;
    }
    const next = seekNliClock(clock, beatIndex, nliNowMs(), arm);
    this._nliScrub = null;
    this._nliOptimisticClock = null;
    if (next.phase === "idle") return;
    await this._patchNliClock(next);
  },

  async handleNliTimelineScrubPointerCancel() {
    if (this._isPresentationActive()) return;
    const scrub = this._nliScrub;
    this._nliScrub = null;
    if (!scrub || !scrub.fromPlaying) {
      this._nliOptimisticClock = null;
      return;
    }
    const clock = this._liveNliClock();
    this._nliOptimisticClock = null;
    await this._patchNliClock(pauseNliClock(clock, nliNowMs()));
  },
};
