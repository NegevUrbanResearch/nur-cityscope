import {
  NOVA_EXPLAINER_OBJECT_IDS,
  clampCardBox,
  normalizeNovaExplainerMaps,
  novaExplainerCamera,
  polygonAnchorLngLat,
} from "../shared/nli-nova-explainer-layout.js";
import { NLI_NOVA_STORY } from "../shared/nli-nova-story.js";
import { novaExplainerName } from "../shared/nli-nova-explainer-copy.js";
import { nameTextStyle } from "../shared/nli-name-language.js";

const STORY_IDS = new Set(NOVA_EXPLAINER_OBJECT_IDS);
const SVG_NS = "http://www.w3.org/2000/svg";
const CARD_GAP_PX = 14;
const MAX_CARD_WIDTH_PX = 280;
const CANVAS_INSET_PX = 8;
const ENGLISH_FONT_STACK = nameTextStyle('en').canvasFontStack;

function canonicalObjectId(value) {
  if (typeof value === "number" && Number.isInteger(value) && value > 0) return value;
  if (typeof value === "string" && /^[1-9][0-9]*$/.test(value)) {
    const number = Number(value);
    return Number.isSafeInteger(number) ? number : null;
  }
  return null;
}

function currentBeatObjectIds(frame) {
  const beats = NLI_NOVA_STORY.beats;
  let index = Number.isInteger(frame?.novaBeatIndex) ? frame.novaBeatIndex : -1;
  if (index < 0 && frame?.phase === "ended") index = beats.length - 1;
  if (index < 0 || index >= beats.length) return new Set();
  return new Set(beats[index].polygonObjectIds);
}

function finitePoint(point) {
  const x = point?.x;
  const y = point?.y;
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  return { x, y };
}

function anchorOnCanvas(point, width, height) {
  return point.x >= 0 && point.y >= 0 && point.x <= width && point.y <= height;
}

function cardMaxWidth(containerWidth) {
  return Math.min(MAX_CARD_WIDTH_PX, Math.max(0, containerWidth - CANVAS_INSET_PX));
}

function fmt(value) {
  return Object.is(value, -0) ? "0" : String(value);
}

function nearestBoundaryPoint(anchor, box) {
  const right = box.left + box.width;
  const bottom = box.top + box.height;
  const inside = anchor.x >= box.left && anchor.x <= right && anchor.y >= box.top && anchor.y <= bottom;
  if (!inside) {
    return {
      x: Math.min(right, Math.max(box.left, anchor.x)),
      y: Math.min(bottom, Math.max(box.top, anchor.y)),
    };
  }
  const edges = [
    { x: anchor.x, y: box.top },
    { x: anchor.x, y: bottom },
    { x: box.left, y: anchor.y },
    { x: right, y: anchor.y },
  ];
  let best = edges[0];
  let bestDistance = Infinity;
  for (const edge of edges) {
    const distance = (edge.x - anchor.x) ** 2 + (edge.y - anchor.y) ** 2;
    if (distance < bestDistance) {
      best = edge;
      bestDistance = distance;
    }
  }
  return best;
}

function leaderPoints(anchor, box) {
  const end = nearestBoundaryPoint(anchor, box);
  if (anchor.x === end.x || anchor.y === end.y) {
    return `${fmt(anchor.x)},${fmt(anchor.y)} ${fmt(end.x)},${fmt(end.y)}`;
  }
  return `${fmt(anchor.x)},${fmt(anchor.y)} ${fmt(end.x)},${fmt(anchor.y)} ${fmt(end.x)},${fmt(end.y)}`;
}

function prefersReducedMotion() {
  try {
    return window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches === true;
  } catch {
    return false;
  }
}

export function createNovaExplainerOverlay({
  map,
  container,
  getLayout,
  getNarrativeId,
  getEscapeOverlay,
  motionMode,
  cameraOverride,
  getLanguage,
} = {}) {
  const cards = new Map();
  const leaderGroups = new Map();
  const measured = new Map();
  let lastFrame = null;
  let lastModels = [], lastLanguage = 'he';
  let escapeScene = false;
  let disposed = false;
  let sceneDeparting = false, cancelSceneHidden = null;
  const reducedMotion = motionMode === "reduced";

  const host = document.createElement("div");
  host.id = "nliNovaExplainerHost";
  host.style.position = "absolute";
  host.style.inset = "0";
  host.style.overflow = "hidden";
  host.style.pointerEvents = "none";
  if (reducedMotion) host.style.transition = "none";

  const svg = document.createElementNS(SVG_NS, "svg");
  svg.style.position = "absolute";
  svg.style.inset = "0";
  svg.style.overflow = "visible";
  svg.style.pointerEvents = "none";
  host.appendChild(svg);
  container?.appendChild(host);

  function containerSize() {
    return {
      width: Number(container?.clientWidth) || 0,
      height: Number(container?.clientHeight) || 0,
    };
  }

  function projectAnchor(feature) {
    const lngLat = polygonAnchorLngLat(feature);
    if (!lngLat || typeof map?.project !== "function") return null;
    try {
      return finitePoint(map.project(lngLat));
    } catch {
      return null;
    }
  }

  function cameraFor(frame) {
    const override = typeof cameraOverride === "function" ? cameraOverride() : undefined;
    if (override === "close" || override === "wide") return override;
    return novaExplainerCamera({
      narrativeId: frame?.narrativeId,
      phase: frame?.phase,
      novaBeatIndex: frame?.novaBeatIndex,
    });
  }

  function visibleModels(frame, language) {
    if (typeof getNarrativeId === "function" && getNarrativeId() !== "nova") return [];
    if (!frame || frame.phase === "idle") return [];
    const achieved = Array.isArray(frame.achievedPolygonObjectIds) ? frame.achievedPolygonObjectIds : [];
    if (achieved.length === 0) return [];
    const features = Array.isArray(frame.polygonFeatures) ? frame.polygonFeatures : [];
    const byId = new Map();
    for (const feature of features) {
      const id = canonicalObjectId(feature?.properties?.OBJECTID);
      if (id == null || byId.has(id)) continue;
      byId.set(id, feature);
    }
    const { width, height } = containerSize();
    const savedMaps = normalizeNovaExplainerMaps(typeof getLayout === "function" ? getLayout() : null);
    const camera = cameraFor(frame);
    const currentIds = currentBeatObjectIds(frame);
    const models = [];
    const seen = new Set();
    for (const rawId of achieved) {
      const id = canonicalObjectId(rawId);
      if (id == null || !STORY_IDS.has(id) || seen.has(id)) continue;
      seen.add(id);
      const feature = byId.get(id);
      if (!feature) continue;
      const name = novaExplainerName(feature.properties, language);
      if (!name) continue;
      const anchor = projectAnchor(feature);
      const saved = savedMaps[camera]?.[String(id)] || null;
      const onCanvas = anchor ? anchorOnCanvas(anchor, width, height) : false;
      if (!saved && !onCanvas) continue;
      models.push({ id, name, language, properties: feature.properties, anchor, saved, width, height, past: currentIds.size > 0 && !currentIds.has(id) });
    }
    return models;
  }

  function ensureCard(model, maxWidth) {
    let card = cards.get(model.id);
    if (!card) {
      card = document.createElement("div");
      card.className = "nli-nova-explainer-card";
      card.dataset.objectId = String(model.id);
      card.setAttribute("dir", "auto");
      card.style.position = "absolute";
      card.style.boxSizing = "border-box";
      card.style.pointerEvents = "none";
      const nameEl = document.createElement("div");
      nameEl.className = "nli-nova-explainer-card__name";
      card.appendChild(nameEl);
      if (!reducedMotion && !prefersReducedMotion()) {
        card.classList.add("nli-nova-explainer-card--in");
      }
      host.appendChild(card);
      cards.set(model.id, card);
    }
    const nameEl = card.querySelector(".nli-nova-explainer-card__name");
    setAttr(card, 'lang', model.language);
    setAttr(card, 'dir', model.language === 'en' ? 'ltr' : 'auto');
    const font = model.language === 'en' ? ENGLISH_FONT_STACK : '';
    if (nameEl.style.fontFamily !== font) nameEl.style.fontFamily = font;
    if (nameEl.textContent !== model.name) nameEl.textContent = model.name;
    card.classList.toggle("nli-nova-explainer-card--past", model.past === true);
    const maxWidthPx = `${maxWidth}px`;
    if (card.style.maxWidth !== maxWidthPx) card.style.maxWidth = maxWidthPx;
    return card;
  }

  function measureCard(card, model, maxWidth, usedKeys) {
    const key = `${model.id}\n${model.language}\n${model.name}\n${maxWidth}\n${model.width}\n${model.height}`;
    usedKeys.add(key);
    const cached = measured.get(key);
    if (cached) return cached;
    const size = { width: card.offsetWidth, height: card.offsetHeight };
    measured.set(key, size);
    return size;
  }

  function placeCard(card, model, size) {
    const left = model.saved
      ? (model.saved.leftPct / 100) * model.width
      : model.anchor.x - size.width / 2;
    const top = model.saved
      ? (model.saved.topPct / 100) * model.height
      : model.anchor.y - size.height - CARD_GAP_PX;
    const clamped = clampCardBox({
      left,
      top,
      width: size.width,
      height: size.height,
      containerWidth: model.width,
      containerHeight: model.height,
    });
    const leftPx = `${clamped.left}px`;
    const topPx = `${clamped.top}px`;
    if (card.style.left !== leftPx) card.style.left = leftPx;
    if (card.style.top !== topPx) card.style.top = topPx;
    return { left: clamped.left, top: clamped.top, width: size.width, height: size.height };
  }

  function setAttr(el, name, value) {
    if (el.getAttribute(name) !== value) el.setAttribute(name, value);
  }

  function ensureLeader(item) {
    let group = leaderGroups.get(item.id);
    if (!group) {
      group = document.createElementNS(SVG_NS, "g");
      group.setAttribute("data-object-id", String(item.id));
      const dot = document.createElementNS(SVG_NS, "circle");
      dot.setAttribute("r", "3");
      dot.setAttribute("fill", "#000");
      const line = document.createElementNS(SVG_NS, "polyline");
      line.setAttribute("fill", "none");
      line.setAttribute("stroke", "#000");
      line.setAttribute("stroke-width", "1");
      group.append(dot, line);
      svg.appendChild(group);
      leaderGroups.set(item.id, group);
    }
    const dot = group.firstElementChild;
    const line = group.lastElementChild;
    setAttr(dot, "cx", fmt(item.anchor.x));
    setAttr(dot, "cy", fmt(item.anchor.y));
    setAttr(line, "points", leaderPoints(item.anchor, item.box));
    group.classList.toggle("nli-nova-explainer-leader--past", item.past === true);
    return group;
  }

  function drawLeaders(placed) {
    setAttr(svg, "width", String(placed.containerWidth));
    setAttr(svg, "height", String(placed.containerHeight));
    const nextIds = new Set(placed.leaders.map((item) => item.id));
    for (const [id, group] of leaderGroups) {
      if (nextIds.has(id)) continue;
      group.remove();
      leaderGroups.delete(id);
    }
    for (const item of placed.leaders) ensureLeader(item);
  }

  function paint() {
    if (disposed) return;
    const language = getLanguage?.() === 'en' ? 'en' : 'he';
    if (sceneDeparting && language === lastLanguage) return;
    const escape = typeof getEscapeOverlay === "function" ? getEscapeOverlay() : null;
    if (!sceneDeparting && ["individual", "overlap", "mor", "settled"].some((flag) => escape?.[flag] === true)) {
      escapeScene = true;
    } else if (!sceneDeparting && (lastFrame?.phase !== "ended" || getNarrativeId?.() !== "nova")) {
      escapeScene = false;
    }
    host.classList.toggle("nli-nova-explainers--hidden", escapeScene);
    setAttr(host, "aria-hidden", String(escapeScene));
    const models = sceneDeparting ? lastModels.map(model => ({ ...model, language,
      name: novaExplainerName(model.properties, language) })).filter(model => model.name) : visibleModels(lastFrame, language);
    lastModels = models; lastLanguage = language;
    const nextIds = new Set(models.map((model) => model.id));
    for (const [id, card] of cards) {
      if (nextIds.has(id)) continue;
      card.remove();
      cards.delete(id);
    }
    const { width, height } = containerSize();
    const maxWidth = cardMaxWidth(width);
    const pending = [];
    for (const model of models) {
      pending.push({ model, card: ensureCard(model, maxWidth) });
    }
    const usedKeys = new Set();
    for (const item of pending) {
      item.size = measureCard(item.card, item.model, maxWidth, usedKeys);
    }
    const leaders = [];
    for (const item of pending) {
      const box = placeCard(item.card, item.model, item.size);
      if (item.model.anchor) leaders.push({ id: item.model.id, anchor: item.model.anchor, box, past: item.model.past === true });
    }
    for (const key of measured.keys()) {
      if (!usedKeys.has(key)) measured.delete(key);
    }
    drawLeaders({ leaders, containerWidth: width, containerHeight: height });
  }

  function sync(frame) {
    if (disposed) return;
    if (sceneDeparting) return;
    lastFrame = frame;
    paint();
  }

  function refresh() {
    if (disposed) return;
    paint();
  }

  function onView() {
    refresh();
  }

  map?.on?.("move", onView);
  map?.on?.("resize", onView);

  const fontsReady = typeof document !== "undefined" ? document.fonts?.ready : null;
  if (fontsReady && typeof fontsReady.then === "function") {
    fontsReady.then(() => {
      if (disposed) return;
      measured.clear();
      paint();
    }, () => {});
  }

  function dispose() {
    if (disposed) return;
    disposed = true; cancelSceneHidden?.();
    measured.clear();
    cards.clear();
    leaderGroups.clear();
    map?.off?.("move", onView);
    map?.off?.("resize", onView);
    host.remove();
  }

  function applyScene(snapshot, { runtime } = {}) {
    if (disposed) return;
    cancelSceneHidden?.(); cancelSceneHidden = null;
    const fullId = "nli.investigation_polygons";
    sceneDeparting = snapshot.narrativeState?.id !== "nova" || !runtime?.getDesiredIds().includes(fullId);
    if (sceneDeparting) {
      cancelSceneHidden = runtime?.onMemberHidden(fullId, () => {
        if (!sceneDeparting || disposed) return;
        lastFrame = null; sceneDeparting = false; paint(); host.hidden = true;
      });
      return;
    }
    host.hidden = false; host.style.transition = "none";
    runtime?.registerElement(fullId, host);
  }
  return { sync, refresh, applyScene, dispose };
}
