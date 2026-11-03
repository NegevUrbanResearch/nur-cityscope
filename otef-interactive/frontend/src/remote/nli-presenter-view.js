import { buildPresenterRail, presenterRailKeyAtY } from "./nli-presenter-rail.js";
import { createPresenterBrowse } from "./nli-presenter-browse.js";
import { createPresenterTimingView } from "./nli-presenter-timing-view.js";
import presenterContent from "./nli-presenter-content.json" with { type: "json" };

const COPY = {
  he: { section: "ציר זמן למנחה", slider: "עיון באירועים לפי שעה", previous: "אירוע קודם", next: "אירוע הבא", play: "ניגון", pause: "השהיה", replay: "ניגון מחדש", preview: "תצוגה מקדימה", now: "חזרה לעכשיו", current: "אירוע נוכחי", unavailable: "ציר הזמן אינו זמין", retry: "ניסיון נוסף", browse: "עיון" },
  en: { section: "Presenter timeline", slider: "Browse events by hour", previous: "Previous event", next: "Next event", play: "Play", pause: "Pause", replay: "Replay", preview: "Preview", now: "Back to now", current: "Current event", unavailable: "Timeline unavailable", retry: "Retry", browse: "Browsing" },
};
const el = (tag, attrs = {}, parent) => { const node = document.createElement(tag); for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, value); parent?.append(node); return node; };
const svgEl = (tag, attrs = {}, parent) => { const node = document.createElementNS("http://www.w3.org/2000/svg", tag); for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, value); parent?.append(node); return node; };
const text = (node, value) => { node.textContent = value == null ? "" : String(value); };
const asLocale = (snapshot) => snapshot?.locale === "en" ? "en" : snapshot?.locale === "he" ? "he" : document.documentElement.lang === "en" ? "en" : "he";
const timeText = (minute) => Number.isFinite(minute) ? `${String(Math.floor(minute / 60)).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}` : "";
const titlesIn = (corpus) => [...new Set(Object.values(corpus?.records || {})
  .flatMap((record) => [record?.he?.title, record?.en?.title])
  .filter((title) => typeof title === "string" && title.trim()))];

export function createPresenterView({ root, commands, getSnapshot, onError = () => {}, onRetry = async () => {}, profileCorpus = presenterContent } = {}) {
  if (!root) throw new TypeError("Presenter view requires a root element");
  const browse = createPresenterBrowse();
  const listNodes = new Map();
  let snapshot = null, locale = "he", pending = false, localError = null, resolvedErrorBoundary = null;
  let appliedKey = null, lastConfirmed = null, boundaryKey = null, visible = true;
  let railModel = buildPresenterRail([]), railHeight = 0, programmaticScroll = 0, programmaticResetTimer = 0, disposed = false;
  let listPointer = null, railPointer = null, listTimer = 0, workspaceTimer = 0, listScrollUser = false, workspaceScrollUser = false;
  let resizeObserver = null, workspace = null, profileSize = { width: 0, height: 0, textScale: 1 };
  let requestedTextScale = 1, lastWrittenScale = null, profileKey = "";
  let titleMeasurementKey = "", measuredTitleLines = 1;
  const fontSet = document.fonts;
  const profileTitles = titlesIn(profileCorpus);
  const listenerController = new AbortController();
  const listen = (target, type, callback, options = {}) => target.addEventListener(type, callback, { ...options, signal: listenerController.signal });

  const section = el("section", { class: "nli-presenter", "aria-label": COPY.he.section }, root);
  const current = el("article", { class: "nli-presenter-current", "data-presenter-current": "" }, section);
  const timingView = createPresenterTimingView({ root: current, getSnapshot });
  const time = el("bdi", { class: "nli-presenter-time", dir: "ltr", "data-presenter-time": "" }, current);
  const cardText = el("div", { class: "nli-presenter-text", tabindex: "0", "data-presenter-text": "" }, current);
  const profileProbe = el("span", { class: "nli-presenter-rem-probe", "aria-hidden": "true" }, section);
  const titleProbe = el("span", { class: "nli-presenter-title-probe", "aria-hidden": "true" }, section);
  const title = el("h2", { "data-presenter-title": "" }, cardText); const summary = el("p", { "data-presenter-summary": "" }, cardText);
  const retry = el("button", { type: "button", "data-presenter-retry": "", hidden: "" }, cardText);
  const detailsText = el("p", { "data-presenter-inline-details": "", hidden: "" }, cardText);
  const transport = el("div", { class: "nli-presenter-controls", "data-presenter-controls": "" }, current);
  const prev = el("button", { type: "button", "data-presenter-prev": "" }, transport);
  const play = el("button", { type: "button", "data-presenter-play": "" }, transport);
  const next = el("button", { type: "button", "data-presenter-next": "" }, transport);
  const browser = el("div", { class: "nli-presenter-browser" }, section);
  const area = el("div", { class: "nli-presenter-browse-area" }, browser);
  const rail = el("div", { class: "nli-presenter-rail", tabindex: "0", role: "slider", "aria-label": COPY.he.slider, "aria-orientation": "vertical", "data-presenter-rail": "" }, area);
  const list = el("ol", { class: "nli-presenter-list", "data-presenter-list": "" }, area);
  const footer = el("div", { class: "nli-presenter-footer" }, browser);
  const now = el("button", { type: "button", "data-presenter-now": "" }, footer);
  const rootPlayer = root.closest?.("#player");
  rootPlayer?.classList.add("is-presenter-timeline");
  workspace = rootPlayer?.querySelector?.(".player-body") || root;
  const getFocus = () => document.activeElement;
  const focusedInside = (node) => node?.contains?.(getFocus());
  function centerOn(key, { instant = true } = {}) {
    const node = listNodes.get(key); if (!node) return;
    const row = node.li;
    const listRect = list.getBoundingClientRect?.(); const rowRect = row.getBoundingClientRect?.();
    const hasLayoutRects = Number.isFinite(listRect?.top) && Number.isFinite(rowRect?.top)
      && (listRect.top !== 0 || rowRect.top !== 0 || row.offsetTop === 0);
    const viewportTop = hasLayoutRects
      ? list.scrollTop + rowRect.top - listRect.top
      : row.offsetTop;
    const desired = viewportTop - (list.clientHeight - row.offsetHeight) / 2;
    programmaticScroll += 1;
    list.scrollTo?.({ top: Math.max(0, desired), behavior: instant ? "auto" : "smooth" });
    if (!list.scrollTo) list.scrollTop = Math.max(0, desired);
    clearTimeout(programmaticResetTimer);
    programmaticResetTimer = setTimeout(() => { programmaticScroll = 0; programmaticResetTimer = 0; }, 120);
  }
  function paintCurrent(nextSnapshot) {
    detailsText.hidden = true; text(detailsText, "");
    const key = nextSnapshot.appliedKey;
    const beat = nextSnapshot.beats.find((item) => item.key === key);
    if (!beat) {
      text(time, nextSnapshot.previewMinute != null ? timeText(nextSnapshot.previewMinute) : "");
      if (nextSnapshot.previewMinute != null) { text(title, COPY[locale].preview); summary.hidden = true; text(summary, ""); }
      else if (localError || (nextSnapshot.error && resolvedErrorBoundary !== nextSnapshot.boundaryKey)) { text(title, COPY[locale].unavailable); text(summary, localError || nextSnapshot.error); summary.hidden = false; }
      else { text(title, ""); text(summary, ""); summary.hidden = true; text(time, ""); }
      lastConfirmed = null;
    } else {
      const card = beat.copy;
      if (card) {
        lastConfirmed = beat; text(time, card.timeLabel); text(title, card.title); text(summary, card.summary || ""); summary.hidden = !card.summary;
        if (typeof card.details === "string" && card.details.trim()) { text(detailsText, card.details); detailsText.hidden = false; }
      } else { lastConfirmed = beat; text(time, timeText(beat.minute)); text(title, COPY[locale].unavailable); text(summary, ""); summary.hidden = true; }
      if (localError) { text(summary, localError); summary.hidden = false; }
    }
    retry.hidden = !(localError || (nextSnapshot.error && resolvedErrorBoundary !== nextSnapshot.boundaryKey)) || !visible;
    text(retry, COPY[locale].retry); retry.disabled = pending;
    const canStep = nextSnapshot.canMutate && !pending && nextSnapshot.beats.length > 0;
    prev.disabled = !canStep || !nextSnapshot.beats.some((item, index) => item.key === key ? index > 0 : false);
    next.disabled = !canStep || (!key && nextSnapshot.phase !== "playing") || (key && nextSnapshot.beats.at(-1)?.key === key);
    play.disabled = !canStep;
    text(prev, COPY[locale].previous); text(next, COPY[locale].next);
    const transportState = nextSnapshot.phase === "playing" ? "pause" : nextSnapshot.phase === "ended" ? "replay" : "play";
    const iconPaths = { play: "M6 4l14 8-14 8z", pause: "M7 5h4v14H7zM15 5h4v14h-4z", replay: "M12 5a7 7 0 1 1-6.3 4H3l4-4 4 4H8.8A4.5 4.5 0 1 0 12 7z" };
    play.replaceChildren(); const icon = svgEl("svg", { viewBox: "0 0 24 24", "aria-hidden": "true", focusable: "false" }, play);
    svgEl("path", { d: iconPaths[transportState], fill: "currentColor" }, icon);
    const label = el("span", {}, play); text(label, COPY[locale][transportState]);
    play.setAttribute("aria-label", COPY[locale][transportState]);
  }
  function paintRows(nextSnapshot) {
    const beats = Array.isArray(nextSnapshot.beats) ? nextSnapshot.beats : [];
    const wanted = new Set(beats.map((beat) => beat.key));
    const rowBoundaryKey = JSON.stringify([nextSnapshot.boundaryKey ?? null, nextSnapshot.datasetKey ?? nextSnapshot.datasetVersion ?? null, nextSnapshot.narrativeId ?? null]);
    if (boundaryKey !== rowBoundaryKey) {
      boundaryKey = rowBoundaryKey; list.replaceChildren(); listNodes.clear();
      for (const beat of beats) {
        const li = el("li", { "data-presenter-key": beat.key }); const button = el("button", { type: "button", "data-presenter-event": beat.key }, li);
        const rowTime = el("bdi", { dir: "ltr" }, button); const rowTitle = el("span", {}, button);
        list.append(li); listNodes.set(beat.key, { li, button, time: rowTime, title: rowTitle, beat });
      }
    }
    for (const beat of beats) {
      let row = listNodes.get(beat.key);
      if (!row) { // Membership can change within a stable boundary only for malformed input; patch it safely.
        const li = el("li", { "data-presenter-key": beat.key }); const button = el("button", { type: "button", "data-presenter-event": beat.key }, li);
        row = { li, button, time: el("bdi", { dir: "ltr" }, button), title: el("span", {}, button) }; listNodes.set(beat.key, row); list.append(li);
      }
      row.beat = beat; row.li.classList.toggle("is-current", beat.key === nextSnapshot.appliedKey);
      if (beat.key === nextSnapshot.appliedKey) row.button.setAttribute("aria-current", "true"); else row.button.removeAttribute("aria-current");
      const copy = beat.copy; text(row.time, copy?.timeLabel || timeText(beat.minute)); text(row.title, copy?.title || COPY[locale].unavailable);
      row.button.disabled = !copy;
      if (pending || nextSnapshot.canMutate !== true) row.button.setAttribute("aria-disabled", "true"); else row.button.removeAttribute("aria-disabled");
      row.button.setAttribute("aria-label", `${copy?.timeLabel || timeText(beat.minute)} ${copy?.title || COPY[locale].unavailable}${beat.key === nextSnapshot.appliedKey ? `, ${COPY[locale].current}` : ""}`);
      row.button.dir = locale === "he" ? "rtl" : "ltr";
    }
    for (const [key, row] of listNodes) if (!wanted.has(key)) { row.li.remove(); listNodes.delete(key); }
    list.dir = locale === "he" ? "rtl" : "ltr";
  }
  function paintRail(nextSnapshot) {
    const beats = Array.isArray(nextSnapshot.beats) ? nextSnapshot.beats : [];
    const isNova = nextSnapshot.narrativeId === "nova";
    const state = browse.getState(); const browseIndex = beats.findIndex((beat) => beat.key === state.browseKey);
    const isOpeningMinutes = nextSnapshot.sceneId === "opening-minutes";
    const hideRail = isNova || isOpeningMinutes;
    rail.hidden = hideRail; rail.setAttribute("aria-hidden", String(hideRail)); rail.tabIndex = hideRail ? -1 : 0;
    area.classList.toggle("is-nova", isNova); area.classList.toggle("is-no-rail", hideRail);
    footer.hidden = hideRail;
    now.hidden = hideRail;
    browser.classList.toggle("is-no-footer", hideRail);
    now.classList.toggle("is-browsing", state.mode === "browse");
    for (const [key, row] of listNodes) row.li.classList.toggle("is-browse", key === state.browseKey);
    rail.replaceChildren(); rail.setAttribute("aria-label", COPY[locale].slider);
    if (hideRail || !beats.length || browseIndex < 0) {
      rail.setAttribute("aria-disabled", "true"); for (const attr of ["aria-valuemin", "aria-valuemax", "aria-valuenow", "aria-valuetext"]) rail.removeAttribute(attr); return;
    }
    rail.removeAttribute("aria-disabled"); rail.setAttribute("aria-valuemin", "0"); rail.setAttribute("aria-valuemax", String(beats.length - 1)); rail.setAttribute("aria-valuenow", String(browseIndex));
    const selected = beats[browseIndex];
    railModel = buildPresenterRail(beats, { height: rail.clientHeight || railHeight, browseKey: state.browseKey });
    const breaks = railModel.breaks || [];
    const gapWords = locale === "he" ? "אין אירועים בציר" : "no listed events";
    const describedGaps = breaks.map((gap) => `${String(gap.omittedStartHour).padStart(2, "0")}–${String(gap.omittedEndHour).padStart(2, "0")}: ${gapWords}`);
    rail.setAttribute("aria-label", [COPY[locale].slider, ...describedGaps].join(". "));
    rail.setAttribute("aria-valuetext", `${COPY[locale].browse}: ${selected.copy?.timeLabel || timeText(selected.minute)} ${selected.copy?.title || COPY[locale].unavailable}`);
    const combinedMarkers = nextSnapshot.appliedKey === state.browseKey;
    for (const point of railModel.points) {
      const classes = ["nli-presenter-rail-point"];
      if (point.key === nextSnapshot.appliedKey) classes.push("is-current");
      if (point.key === state.browseKey) classes.push("is-browse");
      if (combinedMarkers && point.key === state.browseKey) classes.push("is-combined");
      const marker = el("i", { class: classes.join(" "), "data-marker-key": point.key, "aria-hidden": "true" }, rail);
      marker.style.top = `${point.y}px`;
      if (!combinedMarkers && point.key === nextSnapshot.appliedKey) marker.style.left = "16px";
      if (!combinedMarkers && point.key === state.browseKey) marker.style.left = "30px";
    }
    const browsePoint = railModel.points.find((point) => point.key === state.browseKey);
    if (browsePoint) { const label = el("span", { class: "nli-presenter-browse-label", "aria-hidden": "true" }, rail); text(label, selected.copy?.timeLabel || timeText(selected.minute)); label.style.top = `${browsePoint.y}px`; }
    const hourMarks = railModel.marks.filter((mark) => mark.kind === "hour");
    const endpointMarks = railModel.marks.filter((mark) => mark.kind === "endpoint");
    const occupiedHours = new Set(beats.map((beat) => Math.floor(beat.minute / 60)));
    const singleHourEndpoints = occupiedHours.size === 1 && endpointMarks.length > 0;
    const browsePointY = browsePoint?.y;
    const renderedMarks = railModel.marks.filter((mark) => {
      if (mark.kind !== "endpoint") return true;
      if (Number.isFinite(browsePointY) && Math.abs(mark.y - browsePointY) < 18) return false;
      if (occupiedHours.size > 1 && hourMarks.some((hour) => hour.label && Math.abs(mark.y - hour.y) < 18)) return false;
      return true;
    });
    const visibleEndpoint = renderedMarks.some((mark) => mark.kind === "endpoint");
    for (const mark of renderedMarks) {
      if (singleHourEndpoints && mark.kind === "hour" && visibleEndpoint) continue;
      const tick = el("i", { class: `nli-presenter-rail-mark is-${mark.kind}`, "data-rail-mark": mark.kind, "aria-hidden": "true" }, rail);
      tick.style.top = `${mark.y}px`;
      if (mark.label) {
        const label = el("span", { class: "nli-presenter-rail-label", "data-rail-lane": mark.lane || "static", "data-rail-essential": String(mark === hourMarks[0] || mark === hourMarks.at(-1) || mark.lane === "browse"), "aria-hidden": "true" }, rail);
        text(label, mark.label); label.style.top = `${mark.labelY ?? mark.y}px`;
      }
    }
  }
  function readProfile({ width, height, textScale }) {
    const remPx = Number.parseFloat(getComputedStyle(profileProbe).fontSize) || 16;
    const suppliedScale = Number(textScale);
    const cssScale = Number.parseFloat(getComputedStyle(section).getPropertyValue("--presenter-text-scale"));
    if (Number.isFinite(suppliedScale)) requestedTextScale = Math.max(1, suppliedScale);
    else if (Number.isFinite(cssScale) && cssScale !== lastWrittenScale) requestedTextScale = Math.max(1, cssScale);
    // Native root enlargement already changes remPx. Apply only the additional scale needed.
    const scale = Math.max(1, (16 * requestedTextScale) / remPx);
    const fontPx = remPx * scale;
    const profileWidth = width || root.clientWidth;
    const profileHeight = height || root.clientHeight;
    const viewportWidth = Number(window.innerWidth) || profileWidth;
    const viewportHeight = Number(window.innerHeight) || profileHeight;
    const compact = viewportHeight <= 700 && (viewportWidth <= 500 || viewportWidth > viewportHeight);
    const listWidth = list.clientWidth || list.getBoundingClientRect?.().width || Math.max(0, profileWidth - 48);
    const titleNode = list.querySelector("button > span");
    // The time column is fixed in CSS, so this available title width does not
    // depend on which beat or locale happened to render first.
    const titleWidth = Math.max(1, listWidth - (compact ? 14 : fontPx * 6 + 14));
    const titleStyle = titleNode ? getComputedStyle(titleNode) : getComputedStyle(section);
    titleProbe.style.width = `${titleWidth}px`;
    titleProbe.style.fontFamily = titleStyle.fontFamily || "system-ui, sans-serif";
    titleProbe.style.fontWeight = titleStyle.fontWeight || "400";
    titleProbe.style.fontStyle = titleStyle.fontStyle || "normal";
    titleProbe.style.letterSpacing = titleStyle.letterSpacing || "normal";
    titleProbe.style.fontSize = `${fontPx}px`;
    const probeStyle = getComputedStyle(titleProbe);
    const lineHeight = Number.parseFloat(probeStyle.lineHeight) || fontPx * 1.4;
    const measurementKey = [titleWidth, fontPx, titleStyle.fontFamily, titleStyle.fontWeight,
      titleStyle.fontStyle, titleStyle.letterSpacing, lineHeight, document.fonts?.status].join(":");
    if (measurementKey !== titleMeasurementKey) {
      titleMeasurementKey = measurementKey;
      measuredTitleLines = 1;
      for (const copy of profileTitles) {
        text(titleProbe, copy);
        const measuredHeight = titleProbe.getBoundingClientRect?.().height || 0;
        // jsdom has no layout engine; use a conservative code-point width estimate there.
        const fallbackLines = Math.max(1, Math.ceil(Array.from(copy).length / Math.max(1, titleWidth / (fontPx * 0.55))));
        measuredTitleLines = Math.max(measuredTitleLines, measuredHeight ? Math.ceil(measuredHeight / lineHeight) : fallbackLines);
      }
    }
    const titleLines = Math.max(compact ? 3 : 2, measuredTitleLines);
    const rowHeight = Math.max(48, Math.ceil((titleLines + Number(compact)) * 1.4 * fontPx + remPx));
    const key = [profileWidth, profileHeight, remPx, scale, listWidth, compact, titleLines].join(":");
    if (key !== profileKey) {
      profileKey = key;
      section.style.setProperty("--presenter-text-scale", String(scale));
      section.style.setProperty("--presenter-title-lines", String(titleLines));
      section.style.setProperty("--presenter-row-height", `${rowHeight}px`);
      lastWrittenScale = scale;
    }
    profileSize = { width: profileWidth, height: profileHeight, textScale: scale };
    return { ...profileSize, titleLines, rowHeight };
  }

  function activateRow(event) {
    const button = event.target.closest?.("[data-presenter-event]"); if (!button || !list.contains(button)) return;
    if (button.dataset.suppressClick === "true") {
      button.dataset.suppressClick = "false";
      if (event.detail !== 0) { event.preventDefault(); event.stopPropagation(); return; }
    }
    if (!visible || button.disabled || pending || snapshot?.canMutate !== true) return;
    void apply(commands?.select?.(button.dataset.presenterEvent), true);
  }
  async function apply(promise, follow) {
    const before = snapshot?.appliedKey;
    let result;
    try { result = await promise; } catch (error) { result = { ok: false, error }; }
    if (disposed) return;
    if (result?.ok) { localError = null; if (follow && snapshot) { browse.follow(snapshot); centerOn(snapshot.appliedKey, { instant: true }); paintRail(snapshot); } }
    else if (result && !result.stale) { localError = result.error?.message || result.error || "Presenter command failed"; onError(result); if (snapshot?.appliedKey === before && lastConfirmed) text(summary, localError); }
    if (snapshot) paintCurrent(snapshot);
  }
  function nearestVisibleRow() {
    const center = list.getBoundingClientRect().top + list.clientHeight / 2; let best = null, distance = Infinity;
    for (const [key, row] of listNodes) { const rect = row.li.getBoundingClientRect(); const d = Math.abs(rect.top + rect.height / 2 - center); if (d < distance) { distance = d; best = key; } }
    return best;
  }
  const listScroll = () => {
    if (programmaticScroll || !snapshot) return;
    browse.browse(nearestVisibleRow()); paintRail(snapshot);
  };
  const scrollStart = (kind) => {
    if (kind === "list") listScrollUser = true; else workspaceScrollUser = true;
    const timer = kind === "list" ? listTimer : workspaceTimer; clearTimeout(timer);
    const nextTimer = setTimeout(() => { if (kind === "list") { listScrollUser = false; listTimer = 0; } else { workspaceScrollUser = false; workspaceTimer = 0; } }, 120);
    if (kind === "list") listTimer = nextTimer; else workspaceTimer = nextTimer;
  };
  listen(list, "wheel", () => { programmaticScroll = 0; clearTimeout(programmaticResetTimer); if (snapshot) browse.browse(nearestVisibleRow()); scrollStart("list"); }, { passive: true });
  listen(list, "scroll", () => { if (programmaticScroll) { clearTimeout(programmaticResetTimer); programmaticResetTimer = setTimeout(() => { programmaticScroll = 0; programmaticResetTimer = 0; }, 120); return; } listScroll(); scrollStart("list"); }, { passive: true });
  listen(list, "scrollend", () => { if (programmaticScroll) { programmaticScroll = 0; clearTimeout(programmaticResetTimer); } listScrollUser = false; clearTimeout(listTimer); }, { passive: true });
  listen(workspace, "scroll", () => scrollStart("workspace"), { passive: true });
  listen(list, "pointerdown", (event) => { const button = event.target.closest?.("[data-presenter-event]"); listPointer = button ? { id: event.pointerId, y: event.clientY, scrollTop: list.scrollTop, workspaceTop: workspace.scrollTop, moved: false, scrolling: listScrollUser || workspaceScrollUser, button } : null; });
  listen(document, "pointermove", (event) => { if (!listPointer || listPointer.id !== event.pointerId) return; if (Math.abs(event.clientY - listPointer.y) > 8 || list.scrollTop !== listPointer.scrollTop || workspace.scrollTop !== listPointer.workspaceTop || listPointer.scrolling) listPointer.moved = true; });
  listen(document, "pointerup", (event) => {
    if (listPointer?.id !== event.pointerId) return;
    const scrolled = listScrollUser || workspaceScrollUser || listPointer.scrolling
      || list.scrollTop !== listPointer.scrollTop || workspace.scrollTop !== listPointer.workspaceTop;
    const moved = listPointer.moved || Math.abs(event.clientY - listPointer.y) > 8 || scrolled;
    if (moved) listPointer.button.dataset.suppressClick = "true";
    listPointer = null;
  });
  listen(document, "pointercancel", (event) => { if (listPointer?.id === event.pointerId) { listPointer.button.dataset.suppressClick = "true"; listPointer = null; } });
  listen(list, "lostpointercapture", () => {
    if (!listPointer) return;
    listPointer.button.dataset.suppressClick = "true";
    listPointer = null;
  });
  listen(list, "click", activateRow);
  listen(list, "focusin", (event) => { if (event.target.matches?.("[data-presenter-event]")) { browse.browse(event.target.dataset.presenterEvent); if (listPointer?.button !== event.target) centerOn(event.target.dataset.presenterEvent); if (snapshot) paintRail(snapshot); } });
  const keyForY = (clientY) => { const rect = rail.getBoundingClientRect(); const model = buildPresenterRail(snapshot?.beats || [], { height: rect.height }); return presenterRailKeyAtY(model, clientY - rect.top); };
  const railMove = (event) => { if (!railPointer || railPointer.id !== event.pointerId || !snapshot) return; browse.move(keyForY(event.clientY)); centerOn(browse.getState().browseKey); paintRail(snapshot); };
  listen(rail, "pointerdown", (event) => { if (!snapshot?.beats?.length) return; railPointer = { id: event.pointerId, listTop: list.scrollTop }; browse.begin(event.pointerId); rail.setPointerCapture?.(event.pointerId); browse.move(keyForY(event.clientY)); centerOn(browse.getState().browseKey); paintRail(snapshot); });
  listen(rail, "pointermove", railMove);
  listen(rail, "pointerup", (event) => { if (railPointer?.id !== event.pointerId) return; browse.end(event.pointerId); railPointer = null; paintRail(snapshot); });
  const cancelRail = () => { if (!railPointer) return; const { listTop } = railPointer; browse.cancel(); railPointer = null; programmaticScroll += 1; list.scrollTo?.({ top: listTop, behavior: "auto" }); if (!list.scrollTo) list.scrollTop = listTop; clearTimeout(programmaticResetTimer); programmaticResetTimer = setTimeout(() => { programmaticScroll = 0; programmaticResetTimer = 0; }, 120); if (snapshot) paintRail(snapshot); };
  listen(rail, "pointercancel", cancelRail); listen(rail, "lostpointercapture", cancelRail);
  listen(rail, "keydown", (event) => {
    const beats = snapshot?.beats || []; const index = beats.findIndex((beat) => beat.key === browse.getState().browseKey);
    const target = event.key === "ArrowUp" ? index - 1 : event.key === "ArrowDown" ? index + 1 : event.key === "Home" ? 0 : event.key === "End" ? beats.length - 1 : null;
    if (target == null || !beats.length) return; event.preventDefault(); const beat = beats[Math.max(0, Math.min(beats.length - 1, target))];
    browse.browse(beat.key); centerOn(beat.key); paintRail(snapshot);
  });
  const runStep = (delta) => { if (!pending) void apply(commands?.step?.(delta), true); };
  listen(prev, "click", () => runStep(-1)); listen(next, "click", () => runStep(1));
  listen(play, "click", async () => { if (pending) return; const phase = snapshot?.phase; await apply(commands?.toggle?.(), phase !== "playing"); });
  listen(now, "click", () => { if (!snapshot) return; browse.follow(snapshot); centerOn(snapshot.appliedKey || snapshot.beats[0]?.key); paintRail(snapshot); });
  listen(retry, "click", async () => {
    retry.disabled = true;
    const previousError = localError || snapshot?.error || COPY[locale].unavailable;
    try {
      const result = await onRetry();
      const ready = result == null ? snapshot?.ready === true && !snapshot?.error
        : result.ready === false || result.ok === false ? false : result.ready === true || result.ok === true;
      if (ready) { localError = null; resolvedErrorBoundary = snapshot?.boundaryKey ?? null; }
      else localError = result?.error?.message || result?.error || previousError;
    } catch (error) { localError = error?.message || String(error); }
    if (snapshot) paintCurrent(snapshot);
  });

  function cancelGestures() {
    if (listPointer) {
      listPointer.button.dataset.suppressClick = "true";
      listPointer = null;
    }
    const pointerId = railPointer?.id;
    railPointer = null;
    browse.cancel();
    if (pointerId != null) rail.releasePointerCapture?.(pointerId);
    listScrollUser = false;
    workspaceScrollUser = false;
    clearTimeout(listTimer);
    clearTimeout(workspaceTimer);
    listTimer = 0;
    workspaceTimer = 0;
  }

  function update(nextSnapshot) {
    if (disposed) return;
    const priorBoundary = boundaryKey; const priorApplied = appliedKey; const priorSnapshot = snapshot; const hadFocus = focusedInside(cardText);
    snapshot = nextSnapshot || {}; locale = asLocale(snapshot); appliedKey = snapshot.appliedKey ?? null;
    const nextBoundary = JSON.stringify([snapshot.boundaryKey ?? null, snapshot.datasetKey ?? snapshot.datasetVersion ?? null, snapshot.narrativeId ?? null]);
    const boundaryChanged = priorBoundary !== nextBoundary;
    if (boundaryChanged) cancelGestures();
    browse.sync(snapshot);
    if (priorSnapshot && boundaryChanged) browse.follow(snapshot);
    if (boundaryChanged) {
      localError = null; resolvedErrorBoundary = null;
      lastConfirmed = null;
      if (hadFocus) play.focus();
    }
    else if (priorApplied !== appliedKey) {
      cardText.scrollTop = 0;
    }
    section.setAttribute("aria-label", COPY[locale].section); section.dir = locale === "he" ? "rtl" : "ltr"; rail.setAttribute("aria-label", COPY[locale].slider);
    now.replaceChildren(); const nowIcon = svgEl("svg", { viewBox: "0 0 24 24", "aria-hidden": "true", focusable: "false" }, now);
    svgEl("path", { d: "M12 8v5l3 2M20 12a8 8 0 1 1-2.34-5.66L20 8", fill: "none", stroke: "currentColor", "stroke-width": "2", "stroke-linecap": "round", "stroke-linejoin": "round" }, nowIcon);
    const nowLabel = el("span", {}, now); text(nowLabel, COPY[locale].now); now.dir = locale === "he" ? "rtl" : "ltr";
    now.setAttribute("aria-label", COPY[locale].now);
    timingView.update(snapshot); paintRows(snapshot); paintCurrent(snapshot); paintRail(snapshot);
    if (visible && browse.getState().mode === "follow" && snapshot.appliedKey && (boundaryChanged || !listPointer)) centerOn(snapshot.appliedKey, { instant: true });
    readProfile({ width: root.clientWidth, height: root.clientHeight, textScale: snapshot.textScale });
  }
  function setPending(value) { pending = Boolean(value); if (snapshot) { paintRows(snapshot); paintCurrent(snapshot); } }
  function setError(message) { localError = message || null; if (!message && snapshot?.boundaryKey) resolvedErrorBoundary = snapshot.boundaryKey; if (snapshot) paintCurrent(snapshot); }
  function setVisible(value) {
    visible = Boolean(value);
    timingView.setVisible(visible);
    if (!visible) {
      cancelGestures();
      if (snapshot) { browse.follow(snapshot); paintRail(snapshot); }
    }
    section.hidden = !visible;
    rootPlayer?.classList.toggle("is-presenter-timeline", visible);
    if (visible && snapshot) update(snapshot);
  }
  function dispose() {
    if (disposed) return; disposed = true; cancelGestures(); listenerController.abort(); clearTimeout(listTimer); clearTimeout(workspaceTimer); clearTimeout(programmaticResetTimer); resizeObserver?.disconnect();
    timingView.dispose();
    fontSet?.removeEventListener?.("loadingdone", reprofileAfterFontLoad);
    fontSet?.removeEventListener?.("loadingerror", reprofileAfterFontLoad);
    rootPlayer?.classList.remove("is-presenter-timeline"); root.replaceChildren(); listNodes.clear();
  }
  if (typeof ResizeObserver !== "undefined") {
    resizeObserver = new ResizeObserver(() => {
      const rect = root.getBoundingClientRect();
      readProfile({ width: rect.width, height: rect.height, textScale: snapshot?.textScale });
      if (snapshot && browse.getState().browseKey) centerOn(browse.getState().browseKey);
    });
    resizeObserver.observe(root); resizeObserver.observe(profileProbe); resizeObserver.observe(titleProbe);
  }
  listen(window, "resize", () => {
    readProfile({ width: root.clientWidth, height: root.clientHeight, textScale: snapshot?.textScale });
    if (snapshot && browse.getState().browseKey) centerOn(browse.getState().browseKey);
  }, { passive: true });
  function reprofileAfterFontLoad() {
    if (disposed) return;
    titleMeasurementKey = "";
    if (snapshot) readProfile({ width: root.clientWidth, height: root.clientHeight, textScale: snapshot.textScale });
  }
  fontSet?.addEventListener?.("loadingdone", reprofileAfterFontLoad);
  fontSet?.addEventListener?.("loadingerror", reprofileAfterFontLoad);
  fontSet?.ready?.then(reprofileAfterFontLoad);
  return { update, setPending, setError, setVisible, dispose };
}
