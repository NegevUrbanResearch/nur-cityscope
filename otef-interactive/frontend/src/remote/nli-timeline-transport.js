/**
 * NLI pack transport: render, scrub paint, and play/stop/loop/step/scrub handlers.
 * The staff timeline host mounts the HTML and forwards events.
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
  collectTimelineBeats,
  finiteClockMinutes,
  formatMinutesAsLocalClock,
  isNliPlayableFullId,
  timelineBeatDurationMs,
} from "../shared/nli-investigation-beats.js";
import {
  beatsForMembership,
  clockPositionMs,
  endNliClock,
  evaluateClock,
  idleNliClock,
  nliPlayableIdsFromGroups,
  pauseNliClock,
  playNliClock,
  replayNliClock,
  resumeNliClock,
  rewindNliClock,
  seekNliClock,
  setNliLoop,
  stepNliClock,
} from "../shared/nli-investigation-clock.js";
import { completedInvestigationBeats } from "../shared/nli-investigation-visual-state.js";
import { NLI_NOVA_STORY, novaBeatIndexFromPercent, novaBeatPercent } from "../shared/nli-nova-story.js";
import { novaVirtualMembership } from "../shared/nli-nova-virtual-membership.js";
import { resolveMotionMode } from "../shared/reduced-motion.js";
import { materialIcon } from "./nli-staff-icons.js";
import { getLocale } from "./remote-locale.js";

const NLI_ICON_PLAY = materialIcon("play", 20);
const NLI_ICON_PAUSE = materialIcon("pause", 20);
const NLI_ICON_STOP = materialIcon("stop", 18);
const NLI_ICON_LOOP = materialIcon("repeat", 20);
const NLI_ICON_BACK = materialIcon("chevronLeft", 22);
const NLI_ICON_FWD = materialIcon("chevronRight", 22);

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

function nliNarrativeId() {
  return typeof OTEFDataContext !== "undefined"
    ? OTEFDataContext.getNarrativeState?.()?.id
    : null;
}

function nliNarrativeBoundary() {
  const state = typeof OTEFDataContext !== "undefined"
    ? OTEFDataContext.getNarrativeState?.()
    : null;
  return {
    id: state?.id ?? null,
    revision: Number.isInteger(state?.revision) ? state.revision : null,
  };
}

function sameNarrativeBoundary(left, right) {
  return left?.id === right?.id && left?.revision === right?.revision;
}

function nliCacheIdsForTransport(visible, clock, narrativeId, arm) {
  if (narrativeId === "nova") {
    if (clock.phase === "idle") return arm?.visibleMembership || [];
    return clock.membership?.length
      ? clock.membership
      : novaVirtualMembership(visible, narrativeId, { phase: clock.phase });
  }
  return clock.phase === "idle" ? visible : clock.membership?.length ? clock.membership : visible;
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
  return ids.every((id) => Array.isArray(src[id]));
}

function playableMembership(ids) {
  const seen = new Set();
  const out = [];
  for (const id of Array.isArray(ids) ? ids : []) {
    const key = String(id);
    if (!isNliPlayableFullId(key) || seen.has(key)) continue;
    seen.add(key);
    out.push(key);
  }
  return out;
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
  if (vis.leadIn) {
    const lead = Number(clock.leadInMinutes);
    const start = beats.findIndex((minutes) => Number(minutes) >= lead);
    return start < 0 ? 0 : start;
  }
  if (vis.mode === "beat" && vis.index >= 0 && vis.index < n) return vis.index;
  return n - 1;
}

function nliStoryClockLabel(clock, displayBeats) {
  if (clock && clock.phase !== "idle") {
    const vis = evaluateClock(clock, nliNowMs());
    const minutes = finiteClockMinutes(vis.clock);
    if (minutes != null) return formatMinutesAsLocalClock(minutes);
  }
  const beats = nliDisplayBeats(clock, displayBeats);
  const index = nliThumbIndex(clock, displayBeats);
  return formatMinutesAsLocalClock(beats[index]);
}

export function nliBeatIndexFromPointer(el, clientX, beats, options = {}) {
  const list = nliFiniteBeatMinutes(beats);
  const n = list.length;
  if (n <= 1) return 0;
  const rect = typeof el.getBoundingClientRect === "function" ? el.getBoundingClientRect() : { left: 0, width: 1 };
  const width = rect.width || 1;
  const t = (Number(clientX) - rect.left) / width;
  const clamped = Math.max(0, Math.min(1, t));
  return options.narrativeId === "nova"
    ? novaBeatIndexFromPercent(clamped * 100)
    : nliBeatIndexFromOccupiedHourPct(clamped, list);
}

function novaClockIndex(clock, beats, nowMs) {
  if (!clock || clock.phase === "idle") return 0;
  if (clock.phase === "ended") return NLI_NOVA_STORY.beats.length - 1;
  const vis = evaluateClock(clock, nowMs, { narrativeId: "nova" });
  return vis.phase === "ended" ? NLI_NOVA_STORY.beats.length - 1 : Math.max(0, vis.index);
}

function paintNovaCopy(root, index) {
  if (!root || typeof root.querySelector !== "function") return;
  const beat = NLI_NOVA_STORY.beats[Math.max(0, Math.min(NLI_NOVA_STORY.beats.length - 1, index))];
  const locale = getLocale();
  const time = root.querySelector(".nli-tl-nova-time");
  const title = root.querySelector(".nli-tl-nova-title");
  const copy = root.querySelector(".nli-tl-nova-presenter");
  if (time) time.textContent = beat.eventTime[locale];
  if (title) title.textContent = beat.title[locale];
  if (copy) copy.textContent = beat.presenterText[locale];
  for (const mark of root.querySelectorAll?.(".nli-tl-nova-mark") || []) {
    const markIndex = Number(mark.dataset?.beatIndex);
    mark.classList?.toggle("is-active", markIndex === index);
  }
}

export function paintNliTransportPlayhead(root, clock, beats, options = {}) {
  if (!root || typeof root.querySelector !== "function") return;
  const displayBeats = nliDisplayBeats(clock, beats);
  const isNova = options.narrativeId === "nova";
  const now = options.nowMs ?? nliNowMs();
  const index = isNova ? novaClockIndex(clock, displayBeats, now) : nliThumbIndex(clock, displayBeats);
  paintNliScrubPreview(root.querySelector("[data-nli-tl-scrub]"), index, displayBeats, options);
  if (isNova) {
    paintNovaCopy(root, index);
    const slider = root.querySelector("[data-nli-tl-scrub]");
    const controlsDisabled = slider?.getAttribute?.("aria-disabled") === "true";
    const back = root.querySelector("[data-nli-tl-step-back]");
    const forward = root.querySelector("[data-nli-tl-step-forward]");
    if (back) back.disabled = controlsDisabled || index <= 0;
    if (forward) forward.disabled = controlsDisabled || index >= NLI_NOVA_STORY.beats.length - 1;
  }
  const clockEl = root.querySelector(".nli-tl-clock");
  if (clockEl) {
    const vis = clock && clock.phase !== "idle" ? evaluateClock(clock, now, { narrativeId: "nova" }) : null;
    clockEl.textContent = isNova
      ? clock?.phase === "idle" ? formatMinutesAsLocalClock(NLI_NOVA_STORY.startMinutes)
        : formatMinutesAsLocalClock(finiteClockMinutes(vis?.clock) ?? NLI_NOVA_STORY.representativeMinutes[index])
      : nliStoryClockLabel(clock, displayBeats);
  }
}

export function paintNliScrubPreview(track, index, beats, options = {}) {
  if (!track || typeof track.querySelector !== "function") return;
  const list = Array.isArray(beats) ? beats : [];
  const n = list.length;
  const i = n === 0 ? 0 : Math.max(0, Math.min(n - 1, Number(index) || 0));
  const isNova = options.narrativeId === "nova";
  const pct = isNova ? novaBeatPercent(i) : nliBeatPctOccupiedHour(i, list);
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
  if (isNova) paintNovaCopy(track.closest?.(".nli-tl-sheet") || track.parentElement, i);
}

export function isNliPlayableLayerLocked(clock, fullLayerIds) {
  if (!clock || (clock.phase !== "playing" && clock.phase !== "paused" && clock.phase !== "ended")) {
    return false;
  }
  return (fullLayerIds || []).some((id) => isNliPlayableFullId(id));
}

function completedNliBeats(clock, options, nowMs) {
  if (Array.isArray(options.completedBeats)) {
    return nliFiniteBeatMinutes(options.completedBeats);
  }
  const beats = nliFiniteBeatMinutes(clock?.beats);
  if (beats.length === 0) return [];
  const vis = evaluateClock(clock, nowMs);
  return completedInvestigationBeats(vis, clock, beats);
}

/**
 * Derive route-flow status from visible line membership and completed line
 * feature beats. A missing line bag or reduced motion fails closed.
 */
export function isNliRouteFlowActive(clock, options = {}) {
  if (options.motionMode === "reduced") return false;
  const visibleMembership = options.visibleMembership ??
    clock?.visibleMembership ?? clock?.effectiveMembership ?? clock?.membership;
  if (!Array.isArray(visibleMembership) || !visibleMembership.includes(INVESTIGATION_LINES_FULL_ID)) return false;
  const lineBeats = nliFiniteBeatMinutes(options.lineBeats ?? collectTimelineBeats(options.lineFeatures));
  if (lineBeats.length === 0) return false;
  const completed = completedNliBeats(clock, options, options.nowMs ?? nliNowMs());
  const lineBeatSet = new Set(lineBeats);
  return completed.some((beat) => lineBeatSet.has(beat));
}

/**
 * @param {import("../shared/nli-investigation-clock.js").NliInvestigationClock} clock
 * @param {{
 *   playDisabled?: boolean,
 *   stepScrubDisabled?: boolean,
 *   presentationActive?: boolean,
 *   narrativeActive?: boolean,
 *   displayBeats?: number[],
 *   visibleMembership?: string[],
 *   lineFeatures?: object[],
 *   lineBeats?: number[],
 *   completedBeats?: number[],
 *   motionMode?: 'full'|'reduced',
 *   nowMs?: number,
 * }} [options]
 * @returns {string}
 */
export function renderNliTimelineTransport(clock, options = {}) {
  const src = clock && typeof clock === "object" ? clock : idleNliClock();
  const playDisabled = !!options.playDisabled;
  const stepScrubDisabled = !!options.stepScrubDisabled;
  const presentationActive = !!options.presentationActive;
  const displayBeats = Array.isArray(options.displayBeats) ? options.displayBeats : [];
  const allOff = presentationActive || !!options.controlsBusy;
  const playOff = allOff || playDisabled;
  const stepOff = allOff || stepScrubDisabled;
  const isNova = options.narrativeId === "nova";
  const locale = getLocale();
  const nowMs = options.nowMs ?? nliNowMs();
  const vis = evaluateClock(src, nowMs, isNova ? { narrativeId: "nova" } : {});
  const isPlaying = src.phase === "playing" && vis.phase !== "ended";
  const story = isNova
    ? src.phase === "idle" ? formatMinutesAsLocalClock(NLI_NOVA_STORY.startMinutes)
      : formatMinutesAsLocalClock(finiteClockMinutes(vis.clock) ?? NLI_NOVA_STORY.representativeMinutes[novaClockIndex(src, displayBeats, nowMs)])
    : nliStoryClockLabel(src, displayBeats);
  const beats = nliDisplayBeats(src, displayBeats);
  const index = isNova ? novaClockIndex(src, beats, nowMs) : nliThumbIndex(src, displayBeats);
  const { ticks } = isNova
    ? { ticks: NLI_NOVA_STORY.beats.map((beat, beatIndex) => ({
        index: beatIndex,
        pct: novaBeatPercent(beatIndex),
        label: beat.eventTime[locale],
        title: beat.title[locale],
        kind: "nova",
      })) }
    : nliAxisMarksFromBeats(beats);
  const pct = isNova ? novaBeatPercent(index) : nliBeatPctOccupiedHour(index, beats);
  const activeNovaBeat = isNova ? NLI_NOVA_STORY.beats[index] : null;
  const showBubble = src.phase !== "idle" && story;
  const loopOn = !!src.loop;
  const playAria = isPlaying ? "ariaNliTimelinePause" : "ariaNliTimelinePlay";
  const playIcon = isPlaying ? NLI_ICON_PAUSE : NLI_ICON_PLAY;
  const disabledAttr = (off) => (off ? " disabled" : "");
  const tickHtml = ticks
    .map((mark) => {
      const hourClass = mark.kind === "hour" ? " nli-tl-tick--hour" : "";
      const novaMark = isNova ? ` nli-tl-nova-mark${mark.index === index ? " is-active" : ""}` : "";
      const novaAttrs = isNova
        ? ` data-beat-index="${mark.index}" role="img" aria-label="${escapeHtmlSafe(`${mark.label}: ${mark.title}`)}" title="${escapeHtmlSafe(`${mark.label}: ${mark.title}`)}"`
        : "";
      return `<i class="nli-tl-tick${hourClass}${novaMark}"${novaAttrs} style="left:${mark.pct}%"></i>`;
    })
    .join("");
  const hourHtml = ticks
    .filter((mark) => mark.label)
    .map(
      (mark) =>
        `<span${isNova ? ` class="nli-tl-nova-mark-label" data-beat-index="${mark.index}"` : ""} style="left:${mark.pct}%">${escapeHtmlSafe(mark.label)}</span>`,
    )
    .join("");
  const novaCopy = isNova ? `<div class="nli-tl-nova-copy" aria-live="polite">
    <div class="nli-tl-nova-event"><span class="nli-tl-nova-time">${escapeHtmlSafe(activeNovaBeat.eventTime[locale])}</span> <span class="nli-tl-nova-title">${escapeHtmlSafe(activeNovaBeat.title[locale])}</span></div>
    <p class="nli-tl-nova-presenter">${escapeHtmlSafe(activeNovaBeat.presenterText[locale])}</p>
  </div>` : "";
  const beatDisabled = (target) => isNova && (target < 0 || target >= NLI_NOVA_STORY.beats.length);
  return `<div class="nli-tl-sheet" aria-disabled="${allOff ? "true" : "false"}"${isNova ? ' data-narrative-id="nova"' : ""}>
  <div class="nli-tl-clock" dir="ltr">${escapeHtmlSafe(story)}</div>
  ${novaCopy}
  <div class="nli-tl-dock">
    <button type="button" class="nli-tl-btn" data-nli-tl-stop data-i18n-aria="ariaNliTimelineStop" aria-label="${escapeHtmlSafe(t("ariaNliTimelineStop"))}"${disabledAttr(allOff)}>${NLI_ICON_STOP}</button>
    <button type="button" class="nli-tl-btn nli-tl-btn--play" data-nli-tl-play data-i18n-aria="${playAria}" aria-label="${escapeHtmlSafe(t(playAria))}"${disabledAttr(playOff)}>${playIcon}</button>
    <button type="button" class="nli-tl-btn nli-tl-loop${loopOn ? " nli-tl-loop--on" : ""}" data-nli-tl-loop data-i18n-aria="ariaNliTimelineLoop" aria-label="${escapeHtmlSafe(t("ariaNliTimelineLoop"))}" aria-pressed="${loopOn ? "true" : "false"}"${disabledAttr(allOff)}>${NLI_ICON_LOOP}</button>
  </div>
  <div class="nli-tl-scrub-row">
    <button type="button" class="nli-tl-step" data-nli-tl-step-back data-i18n-aria="ariaNliTimelineStepBack" aria-label="${escapeHtmlSafe(t("ariaNliTimelineStepBack"))}"${disabledAttr(stepOff || beatDisabled(index - 1))}>${NLI_ICON_BACK}</button>
    <div class="nli-tl-track${src.phase === "idle" ? " nli-tl-track--idle" : ""}" data-nli-tl-scrub${isNova ? ' data-narrative-id="nova"' : ""} dir="ltr" data-i18n-aria="ariaNliTimelineScrub" aria-label="${escapeHtmlSafe(t("ariaNliTimelineScrub"))}" role="slider" aria-valuemin="0" aria-valuemax="${Math.max(0, beats.length - 1)}" aria-valuenow="${index}"${stepOff ? ' aria-disabled="true"' : isNova ? ' tabindex="0"' : ""}>
      ${showBubble ? `<div class="nli-tl-bubble" dir="ltr" style="left:${pct}%">${escapeHtmlSafe(story)}</div>` : ""}
      <div class="nli-tl-track-line"></div>
      <div class="nli-tl-track-fill" style="width:${src.phase === "idle" ? 0 : pct}%"></div>
      <div class="nli-tl-ticks">${tickHtml}</div>
      <div class="nli-tl-hours">${hourHtml}</div>
      <div class="nli-tl-thumb" style="left:${pct}%"></div>
    </div>
    <button type="button" class="nli-tl-step" data-nli-tl-step-forward data-i18n-aria="ariaNliTimelineStepForward" aria-label="${escapeHtmlSafe(t("ariaNliTimelineStepForward"))}"${disabledAttr(stepOff || beatDisabled(index + 1))}>${NLI_ICON_FWD}</button>
  </div>
</div>`;
}

export function nliTransportSheetHtml(
  selected,
  clock,
  cache,
  presentationActive,
  narrativeActive = false,
  narrativeId = null,
  mutationBusy = false,
) {
  if (!selected || selected.id !== "nli") return "";
  const isNova = narrativeId === "nova";
  const visible = isNova
    ? novaVirtualMembership(nliPlayableIdsFromGroups([selected]), narrativeId, { phase: "paused" })
    : nliPlayableIdsFromGroups([selected]);
  const cacheReady = nliCacheReadyForIds(cache, visible);
  const displayBeats =
    isNova ? NLI_NOVA_STORY.representativeMinutes
    : clock && clock.phase !== "idle" && Array.isArray(clock.beats) && clock.beats.length > 0
      ? clock.beats
      : beatsForMembership(visible, nliFeatureBagsFromCache(cache));
  const controlsOff = presentationActive || mutationBusy || visible.length === 0 || !cacheReady;
  return renderNliTimelineTransport(clock, {
    playDisabled: controlsOff,
    stepScrubDisabled: controlsOff,
    presentationActive,
    controlsBusy: mutationBusy,
    displayBeats,
    visibleMembership: visible,
    lineFeatures: nliFeatureBagsFromCache(cache).lineFeatures,
    motionMode: resolveMotionMode(),
    narrativeId,
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
    host._nliScrubPointerId = e.pointerId;
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
      : nliBeatIndexFromPointer(scrub, e.clientX, beats, {
          narrativeId: scrub.getAttribute?.("data-narrative-id") ?? null,
        });
    host._nliScrubEl = null;
    void host.handleNliTimelineScrubPointerUp(index);
  });

  content.addEventListener("pointercancel", () => {
    host._nliScrubEl = null;
    void host.handleNliTimelineScrubPointerCancel();
  });

  content.addEventListener("keydown", (e) => {
    const slider = e.target instanceof Element ? e.target.closest('[data-nli-tl-scrub][data-narrative-id="nova"]') : null;
    if (!slider) return;
    const index = Number(slider.getAttribute("aria-valuenow")) || 0;
    const next = e.key === "ArrowLeft" ? index - 1
      : e.key === "ArrowRight" ? index + 1
        : e.key === "Home" ? 0
          : e.key === "End" ? NLI_NOVA_STORY.beats.length - 1
            : null;
    if (next == null) return;
    e.preventDefault();
    const clamped = Math.max(0, Math.min(NLI_NOVA_STORY.beats.length - 1, next));
    if (clamped !== index) void host.handleNliTimelineSelectBeat(clamped);
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

  _isNliControlDisabled() {
    return this._isPresentationActive();
  },

  _manualMutationsOpen() {
    if (this._isNliControlDisabled()) return false;
    return typeof this.isManualMutationAllowed !== "function" || this.isManualMutationAllowed() !== false;
  },

  invalidateTransport() {
    this._nliTransportEpoch = (Number(this._nliTransportEpoch) || 0) + 1;
    const captured = this._nliScrubEl;
    const pointerId = this._nliScrubPointerId;
    if (captured && pointerId != null && typeof captured.releasePointerCapture === "function") {
      try {
        captured.releasePointerCapture(pointerId);
      } catch {
        // The pointer may already have been released.
      }
    }
    this._nliScrub = null;
    this._nliScrubEl = null;
    this._nliScrubPointerId = null;
    this._nliOptimisticClock = null;
    this._clearNliPlayheadTicker();
    if (this._nliEndTimer != null) {
      clearTimeout(this._nliEndTimer);
      this._nliEndTimer = null;
    }
  },

  _clearNliScrubOnNarrativeChange() {
    if (!this._nliScrub || sameNarrativeBoundary(this._nliScrub.narrativeBoundary, nliNarrativeBoundary())) {
      return false;
    }
    this._nliScrub = null;
    this._nliScrubEl = null;
    this._nliOptimisticClock = null;
    return true;
  },

  _visibleNliPlayableIds() {
    return nliPlayableIdsFromGroups(this.getEffectiveGroupsForView());
  },

  _nliCacheReady(ids) {
    return nliCacheReadyForIds(this._nliFeatureCache, ids);
  },

  _playbackWindow() {
    if (typeof this.getPlaybackConfig !== "function") {
      return { membership: this._visibleNliPlayableIds() };
    }
    const config = this.getPlaybackConfig() || {};
    const from = Number(config.from);
    const to = Number(config.to);
    return {
      membership: playableMembership(config.membership),
      ...(Number.isFinite(from) ? { from } : {}),
      ...(Number.isFinite(to) ? { to } : {}),
    };
  },

  _nliArmPayload() {
    const playback = this._playbackWindow();
    const narrativeId = nliNarrativeId();
    const visibleMembership = novaVirtualMembership(playback.membership, narrativeId, { phase: "paused" });
    let beats = narrativeId === "nova"
      ? NLI_NOVA_STORY.representativeMinutes.slice()
      : beatsForMembership(visibleMembership, nliFeatureBagsFromCache(this._nliFeatureCache));
    if (narrativeId !== "nova" && Number.isFinite(playback.to)) {
      beats = beats.filter((minutes) => minutes <= playback.to);
    }
    return {
      visibleMembership,
      beats,
      ...(Number.isFinite(playback.from) ? { from: playback.from } : {}),
      ...(Number.isFinite(playback.to) ? { to: playback.to } : {}),
    };
  },

  async _patchNliClock(next, { isCurrent } = {}) {
    if (
      typeof OTEFDataContext === "undefined" ||
      typeof OTEFDataContext.patchInvestigationClock !== "function"
    ) {
      return;
    }
    this._nliOptimisticClock = null;
    const epoch = this._nliTransportEpoch || 0;
    const callerCurrent = typeof isCurrent === "function" ? isCurrent : () => true;
    return this._trackNliTransport(OTEFDataContext.patchInvestigationClock(next, {
      isCurrent: () => (this._nliTransportEpoch || 0) === epoch && callerCurrent(),
    }));
  },

  _trackNliTransport(request) {
    this._nliTransportPending = (this._nliTransportPending || 0) + 1;
    return Promise.resolve(request).finally(() => {
      this._nliTransportPending = Math.max(0, (this._nliTransportPending || 1) - 1);
    });
  },

  _clearNliPlayheadTicker() {
    if (this._nliPlayheadTimer != null) {
      clearTimeout(this._nliPlayheadTimer);
      this._nliPlayheadTimer = null;
    }
  },

  _paintNliPlayhead(clock) {
    if (this._nliScrub) return;
    if (typeof this._nliStaffPaintPlayhead === "function") {
      this._nliStaffPaintPlayhead(clock);
      return;
    }
    const sheet = this.sheet && typeof this.sheet.querySelector === "function" ? this.sheet : null;
    const content = sheet?.querySelector(".sheet-content") || sheet;
    if (!content) return;
    const fallbackBeats = this._nliArmPayload().beats;
    paintNliTransportPlayhead(content, clock, fallbackBeats, { narrativeId: nliNarrativeId() });
  },

  _syncNliPlayheadTicker(clock) {
    this._clearNliPlayheadTicker();
    if (this._nliScrub) return;
    if (!clock || clock.phase !== "playing") return;
    const narrativeId = nliNarrativeId();
    const clockOptions = narrativeId === "nova" ? { narrativeId } : {};
    const vis = evaluateClock(clock, nliNowMs(), clockOptions);
    if (vis.phase === "ended") return;
    const elapsed = Number(vis.beatElapsedMs);
    const beatMs = narrativeId === "nova" ? NLI_NOVA_STORY.beatDurationMs : Number.isFinite(Number(vis.clock))
      ? timelineBeatDurationMs(vis.clock)
      : TIMELINE_BEAT_MS;
    const delay = Math.max(0, beatMs - (Number.isFinite(elapsed) ? elapsed : 0));
    this._nliPlayheadTimer = setTimeout(() => {
      this._nliPlayheadTimer = null;
      if (this._nliScrub) return;
      if (!clock || clock.phase !== "playing") return;
      const visNow = evaluateClock(clock, nliNowMs(), clockOptions);
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
    const narrativeId = nliNarrativeId();
    const clockOptions = narrativeId === "nova" ? { narrativeId } : {};
    const dur = clockStoryDurationMs(clock.beats, clock, clockOptions);
    const delay = Math.max(0, dur - clockPositionMs(clock, now));
    const revision = clock.revision;
    const epoch = this._nliTransportEpoch || 0;
    this._nliEndTimer = setTimeout(() => {
      this._nliEndTimer = null;
      const isCurrent = () => {
        if ((this._nliTransportEpoch || 0) !== epoch) return false;
        if (typeof OTEFDataContext === "undefined" || typeof OTEFDataContext.getInvestigationClock !== "function") {
          return false;
        }
        const current = OTEFDataContext.getInvestigationClock();
        return !!current
          && current.revision === revision
          && current.phase === "playing"
          && !current.loop;
      };
      if (!isCurrent()) return;
      void this._patchNliClock(endNliClock(OTEFDataContext.getInvestigationClock(), clockOptions), { isCurrent });
    }, delay);
  },

  _storeNliCachedFeatures(id, features) {
    this._nliFeatureCache[id] = features;
    this._nliStaffCacheChanged?.(id, features);
  },

  _hasPendingNliTransport() {
    return (this._nliTransportPending || 0) > 0;
  },

  async _ensureNliFeatureCache(ids, options = {}) {
    if (this.focusedGroupId !== "nli") return false;
    const wanted = Array.isArray(ids) && ids.length ? playableMembership(ids) : NLI_PLAYABLE_IDS.slice();
    if (this._nliCacheFetchInflight && !(options.timeoutMs > 0)) {
      await this._nliCacheFetchInflight;
      if (this._nliCacheReady(wanted)) return true;
    }
    return this._loadNliFeatureAttempt(wanted, options);
  },

  async _loadNliFeatureAttempt(ids, { timeoutMs = 0, isCurrent = () => true } = {}) {
    if (this._nliCacheAttempt) this._nliCacheAttempt.aborted = true;
    const attempt = { aborted: false };
    this._nliCacheAttempt = attempt;
    const live = () => this._nliCacheAttempt === attempt && !attempt.aborted && isCurrent();
    if (!this._nliFeatureCache) this._nliFeatureCache = Object.create(null);
    const missing = ids.filter((id) => !Array.isArray(this._nliFeatureCache[id]));
    if (missing.length === 0) return live();
    const controller = typeof AbortController === "function" ? new AbortController() : null;
    const work = (async () => {
      let loaded = false;
      for (const id of missing) {
        if (!live()) return false;
        try {
          const url =
            typeof layerRegistry !== "undefined" &&
            typeof layerRegistry.getLayerDataUrl === "function"
              ? layerRegistry.getLayerDataUrl(id)
              : null;
          if (!url || typeof fetch !== "function") {
            if (live()) this._storeNliCachedFeatures(id, null);
            continue;
          }
          const res = await fetch(url, controller ? { signal: controller.signal } : undefined);
          if (!live()) return false;
          if (!res.ok) {
            if (live()) this._storeNliCachedFeatures(id, null);
            continue;
          }
          const json = await res.json();
          if (!live()) return false;
          this._storeNliCachedFeatures(id, Array.isArray(json?.features) ? json.features : []);
          loaded = true;
        } catch {
          if (live()) this._storeNliCachedFeatures(id, null);
        }
      }
      if (loaded && live()) this.render();
      return live();
    })();
    this._nliCacheFetchInflight = work;
    this._nliCacheFetchAttempt = attempt;
    let timer;
    try {
      if (timeoutMs > 0) {
        const timeout = new Promise((resolve) => {
          timer = setTimeout(() => resolve("timeout"), timeoutMs);
        });
        const outcome = await Promise.race([work.then(() => "done", () => "done"), timeout]);
        if (outcome === "timeout") {
          attempt.aborted = true;
          controller?.abort();
          if (this._nliCacheFetchInflight === work) this._nliCacheFetchInflight = null;
          throw new Error("Timeline cache timed out");
        }
      }
      return await work;
    } finally {
      if (timer != null) clearTimeout(timer);
      if (this._nliCacheFetchAttempt === attempt && this._nliCacheFetchInflight === work) {
        this._nliCacheFetchInflight = null;
      }
    }
  },

  async startNliTimelineWindow({
    membership,
    from,
    to,
    loop = false,
    playLeadIn = false,
    replace = false,
    isCurrent = () => true,
  } = {}) {
    const current = typeof isCurrent === "function" ? isCurrent : () => true;
    if (!current()) return false;
    if (this._isPresentationActive()) throw new Error("Slideshow is active");
    const clock = this._liveNliClock();
    if (!clock) throw new Error("Timeline is not idle");
    if (clock.phase !== "idle" && replace !== true) throw new Error("Timeline is not idle");
    const boundary = nliNarrativeBoundary();
    const narrativeId = boundary.id;
    const requested = playableMembership(membership);
    if (!requested.length) throw new Error("Timeline membership is empty");
    const ids = novaVirtualMembership(requested, narrativeId, { phase: "paused" });
    if (!this._nliCacheReady(ids)) {
      await this._ensureNliFeatureCache(ids, { timeoutMs: 4000, isCurrent: current });
      if (!current()) return false;
      if (!sameNarrativeBoundary(boundary, nliNarrativeBoundary())) return false;
      if (!this._nliCacheReady(ids)) throw new Error("Timeline cache unavailable");
    }
    if (!current()) return false;
    if (!sameNarrativeBoundary(boundary, nliNarrativeBoundary())) return false;
    const now = nliNowMs();
    const windowTo = Number(to);
    const windowFrom = Number(from);
    let beats = narrativeId === "nova"
      ? NLI_NOVA_STORY.representativeMinutes.slice()
      : beatsForMembership(ids, nliFeatureBagsFromCache(this._nliFeatureCache));
    if (narrativeId !== "nova" && Number.isFinite(windowTo)) {
      beats = beats.filter((minutes) => minutes <= windowTo);
    }
    if (!beats.length) throw new Error("Timeline beats are empty");
    const clockOptions = narrativeId === "nova" ? { narrativeId } : {};
    const leadInMinutes = Number.isFinite(windowFrom) ? windowFrom : undefined;
    const result = await this._patchNliClock(playNliClock(setNliLoop(clock, loop), ids, beats, now, {
      ...clockOptions,
      ...(!clockOptions.narrativeId && leadInMinutes != null ? {
        leadInMinutes,
        ...(playLeadIn === true ? { playLeadIn: true } : {}),
      } : {}),
    }), { isCurrent: current });
    if (!current()) return false;
    if (!sameNarrativeBoundary(boundary, nliNarrativeBoundary())) return false;
    if (result?.stale) return false;
    if (!result?.ok) throw result?.error || new Error("Clock update was not acknowledged");
    return true;
  },

  /** `from` starts playback at that minute; `to` drops later beats; a boolean `loop` sets looping. All apply only when arming from idle. */
  async handleNliTimelinePlay({ from, to, loop } = {}) {
    const epoch = this._nliTransportEpoch || 0;
    const isCurrent = () => (this._nliTransportEpoch || 0) === epoch && this._manualMutationsOpen();
    if (!isCurrent()) return;
    const clock = this._nliOptimisticClock || this._liveNliClock();
    const now = nliNowMs();
    const narrativeId = nliNarrativeId();
    const narrativeBoundary = nliNarrativeBoundary();
    const clockOptions = narrativeId === "nova" ? { narrativeId } : {};
    const vis = evaluateClock(clock, now, clockOptions);
    const leadInMinutes = Number.isFinite(from)
      ? from
      : undefined;
    if (clock.phase === "ended" || vis.phase === "ended") {
      await this._patchNliClock(replayNliClock(clock, now, {
        ...clockOptions,
        ...(!clockOptions.narrativeId && { leadInMinutes: clock.leadInMinutes ?? leadInMinutes }),
      }), { isCurrent });
      return;
    }
    if (clock.phase === "playing") {
      await this._patchNliClock(pauseNliClock(clock, now, clockOptions), { isCurrent });
      return;
    }
    if (clock.phase === "paused") {
      await this._patchNliClock(resumeNliClock(clock, now), { isCurrent });
      return;
    }
    const playback = this._playbackWindow();
    const windowFrom = Number.isFinite(leadInMinutes) ? leadInMinutes : playback.from;
    const windowTo = Number.isFinite(Number(to)) ? Number(to) : playback.to;
    try {
      await this.startNliTimelineWindow({
        membership: playback.membership,
        from: windowFrom,
        to: windowTo,
        loop: typeof loop === "boolean" ? loop : clock.loop,
        isCurrent: () => isCurrent()
          && sameNarrativeBoundary(narrativeBoundary, nliNarrativeBoundary()),
      });
    } catch {
      return;
    }
  },

  async handleNliTimelineStop() {
    const epoch = this._nliTransportEpoch || 0;
    const isCurrent = () => (this._nliTransportEpoch || 0) === epoch && this._manualMutationsOpen();
    if (!isCurrent()) return;
    const narrativeId = nliNarrativeId();
    const options = narrativeId === "nova"
      ? { narrativeId }
      : { leadInMinutes: this._playbackWindow().from };
    await this._patchNliClock(rewindNliClock(this._liveNliClock(), options), { isCurrent });
  },

  async handleNliTimelineLoop() {
    if (!this._manualMutationsOpen()) return;
    const clock = this._liveNliClock();
    await this._patchNliClock(setNliLoop(clock, !clock.loop));
  },

  async handleNliTimelineStep(delta) {
    const epoch = this._nliTransportEpoch || 0;
    const isCurrent = () => (this._nliTransportEpoch || 0) === epoch && this._manualMutationsOpen();
    if (!isCurrent()) return;
    if (nliNarrativeId() === "nova") {
      const clock = this._liveNliClock();
      const vis = evaluateClock(clock, nliNowMs(), { narrativeId: "nova" });
      const current = clock.phase === "idle" ? -1
        : clock.phase === "ended" || vis.phase === "ended" ? NLI_NOVA_STORY.beats.length - 1
          : Math.max(0, vis.index);
      const index = current < 0 ? (delta > 0 ? 0 : -1) : current + Math.trunc(Number(delta) || 0);
      if (index < 0 || index >= NLI_NOVA_STORY.beats.length) return;
      return this.handleNliTimelineSelectBeat(index);
    }
    const clock = this._liveNliClock();
    const visible = this._playbackWindow().membership;
    if (visible.length === 0 && !(clock.membership?.length)) return;
    const cacheIds = clock.phase === "idle" ? visible : clock.membership.length ? clock.membership : visible;
    if (!this._nliCacheReady(cacheIds)) {
      await this._ensureNliFeatureCache(cacheIds, { isCurrent });
      if (!isCurrent()) return;
      if (!this._nliCacheReady(cacheIds)) return;
    }
    const arm = clock.phase === "idle" ? this._nliArmPayload() : undefined;
    if (clock.phase === "idle" && (!arm.beats || arm.beats.length === 0)) return;
    const next = stepNliClock(clock, delta, nliNowMs(), arm);
    if (next === clock || next.phase === "idle") return;
    await this._patchNliClock(next, { isCurrent });
  },

  async handleNliTimelineSelectBeat(index) {
    const epoch = this._nliTransportEpoch || 0;
    const isCurrent = () => (this._nliTransportEpoch || 0) === epoch && this._manualMutationsOpen();
    const narrativeId = nliNarrativeId();
    if (!isCurrent() || narrativeId !== "nova") return;
    const narrativeBoundary = nliNarrativeBoundary();
    const clock = this._nliOptimisticClock || this._liveNliClock();
    const visible = this._playbackWindow().membership;
    const arm = clock.phase === "idle" ? this._nliArmPayload() : undefined;
    const cacheIds = nliCacheIdsForTransport(visible, clock, "nova", arm);
    if (cacheIds.length === 0 || !this._nliCacheReady(cacheIds)) {
      await this._ensureNliFeatureCache(cacheIds, { isCurrent });
      if (!isCurrent()) return;
      if (nliNarrativeId() !== narrativeId
          || !sameNarrativeBoundary(narrativeBoundary, nliNarrativeBoundary())) return;
      if (cacheIds.length === 0 || !this._nliCacheReady(cacheIds)) return;
    }
    if (clock.phase === "idle" && (!arm.beats || arm.beats.length === 0)) return;
    const next = seekNliClock(clock, index, nliNowMs(), arm, { narrativeId: "nova" });
    if (next.phase === "idle") return;
    this._nliScrub = null;
    this._nliOptimisticClock = null;
    await this._patchNliClock(next, { isCurrent });
  },

  handleNliTimelineScrubPointerDown(clientX) {
    if (!this._manualMutationsOpen()) return;
    const epoch = this._nliTransportEpoch || 0;
    const clock = this._liveNliClock();
    const visible = this._playbackWindow().membership;
    const narrativeId = nliNarrativeId();
    const clockOptions = narrativeId === "nova" ? { narrativeId } : {};
    const arm = narrativeId === "nova" && clock.phase === "idle" ? this._nliArmPayload() : undefined;
    const cacheIds = nliCacheIdsForTransport(visible, clock, narrativeId, arm);
    if (cacheIds.length === 0 || !this._nliCacheReady(cacheIds)) return;
    let restoreClock = clock;
    if (clock.phase === "playing") {
      this._nliOptimisticClock = pauseNliClock(clock, nliNowMs(), clockOptions);
      restoreClock = this._nliOptimisticClock;
      this._syncNliEndedTimer(this._nliOptimisticClock);
      if (
        typeof OTEFDataContext !== "undefined" &&
        typeof OTEFDataContext.patchInvestigationClock === "function"
      ) {
        const epoch = this._nliTransportEpoch || 0;
        const paused = this._nliOptimisticClock;
        void this._trackNliTransport(OTEFDataContext.patchInvestigationClock(paused, {
          isCurrent: () => (this._nliTransportEpoch || 0) === epoch,
        }));
      }
    } else if (narrativeId === "nova" && clock.phase === "idle") {
      restoreClock = seekNliClock(clock, 0, nliNowMs(), arm, clockOptions);
      this._nliOptimisticClock = restoreClock;
    } else if (narrativeId === "nova") {
      restoreClock = clock;
      this._nliOptimisticClock = clock;
    }
    this._nliScrub = {
      epoch,
      fromPlaying: clock.phase === "playing",
      restoreClock,
      narrativeId,
      narrativeBoundary: nliNarrativeBoundary(),
    };
    if (typeof clientX === "number") {
      this.handleNliTimelineScrubPointerMove(clientX);
    }
  },

  handleNliTimelineScrubPointerMove(clientX) {
    if (this._clearNliScrubOnNarrativeChange()) return;
    if (!this._manualMutationsOpen()) return;
    const track = this._nliScrubEl;
    if (!track || !this._nliScrub) return;
    const clock = this._readNliClock();
    const beats = nliDisplayBeats(clock, this._nliArmPayload().beats);
    const narrativeId = nliNarrativeId();
    const index = nliBeatIndexFromPointer(track, clientX, beats, { narrativeId });
    this._nliScrub.previewIndex = index;
    paintNliScrubPreview(track, index, beats, { narrativeId });
  },

  async handleNliTimelineScrubPointerUp(beatIndex) {
    const epoch = this._nliScrub?.epoch ?? (this._nliTransportEpoch || 0);
    const isCurrent = () => (this._nliTransportEpoch || 0) === epoch && this._manualMutationsOpen();
    if (this._clearNliScrubOnNarrativeChange()) return;
    if (!isCurrent()) return;
    if (nliNarrativeId() === "nova") {
      const index = Math.max(0, Math.min(NLI_NOVA_STORY.beats.length - 1, Math.trunc(Number(beatIndex) || 0)));
      return this.handleNliTimelineSelectBeat(index);
    }
    const clock = this._liveNliClock();
    const visible = this._playbackWindow().membership;
    const cacheIds = clock.phase === "idle" ? visible : clock.membership.length ? clock.membership : visible;
    if (visible.length === 0 || !this._nliCacheReady(cacheIds)) {
      await this._ensureNliFeatureCache(cacheIds, { isCurrent });
      if (!isCurrent()) {
        this._nliScrub = null;
        this._nliOptimisticClock = null;
        return;
      }
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
    await this._patchNliClock(next, { isCurrent });
  },

  async handleNliTimelineScrubPointerCancel() {
    if (this._clearNliScrubOnNarrativeChange()) return;
    if (!this._manualMutationsOpen()) return;
    const epoch = this._nliTransportEpoch || 0;
    const scrub = this._nliScrub;
    this._nliScrub = null;
    if (!scrub) {
      this._nliOptimisticClock = null;
      return;
    }
    if (scrub.narrativeId === "nova") {
      this._nliOptimisticClock = null;
      if (scrub.restoreClock?.phase !== "idle") {
        await this._patchNliClock(scrub.restoreClock, {
          isCurrent: () => (this._nliTransportEpoch || 0) === epoch,
        });
      }
      return;
    }
    if (!scrub.fromPlaying) {
      this._nliOptimisticClock = null;
      return;
    }
    const clock = this._liveNliClock();
    this._nliOptimisticClock = null;
    await this._patchNliClock(pauseNliClock(clock, nliNowMs()), {
      isCurrent: () => (this._nliTransportEpoch || 0) === epoch,
    });
  },
};
