import { buildLegendModel, getDashBackground } from "./legend-model-builder.js";
import { escapeHtml } from "../shared/html-utils.js";
import { resolveLegendLayout } from "../projection/legend-layout.js";
import { OUTPUT_HEIGHT, OUTPUT_WIDTH } from "../projection/projection-overlay-placement.js";
import { layoutProjectionLegend, PROJECTION_LEGEND_FONT, resolveLegendRasterSize } from "../projection/legend-content-layout.js";

export function applyProjectionLegendLayout(element, layout, { span = "full", referenceElement } = {}) {
  if (!element?.style) return;
  const reference = referenceElement?.getBoundingClientRect?.() || {};
  const width = Number(reference.width) || OUTPUT_WIDTH;
  const height = Number(reference.height) || OUTPUT_HEIGHT;
  const scale = width / OUTPUT_WIDTH;
  Object.assign(element.style, {
    position: "absolute",
    left: `${width * (Number(layout?.leftPct) || 0) / 100}px`,
    top: `${height * (Number(layout?.topPct) || 0) / 100}px`,
    width: `${width * (Number(layout?.widthPct) || 0) / 100}px`,
    height: `${height * (Number(layout?.heightPct) || 0) / 100}px`,
    fontSize: `${(Number(layout?.fontPx) || 16) * scale}px`,
    transform: `rotate(${Number(layout?.rotateDeg) || 0}deg)`,
    transformOrigin: "center center",
    boxSizing: "border-box",
    overflow: "hidden",
    display: span === "right" ? "none" : "",
  });
}

function symbolMarkup(part = {}, geometry = null, fontPx = 22) {
  const shape = part.shape || "polygon";
  const stroke = part.stroke ?? "transparent";
  const width = Number.isFinite(part.strokeWidth) ? part.strokeWidth : 1;
  const strokeOpacity = Number.isFinite(part.strokeOpacity) ? part.strokeOpacity : 1;
  const fillOpacity = Number.isFinite(part.fillOpacity)
    ? part.fillOpacity
    : (Number.isFinite(part.opacity) ? part.opacity : 1);
  const fill = part.fill ?? "transparent";
  let background = fill;
  if (shape === "line") {
    const dash = part.dash && (Array.isArray(part.dash) ? part.dash : part.dash.array);
    const dashColor = part.stroke || fill || "#808080";
    if (part.carrier) {
      const on = Math.max(2, Math.round((dash?.[0] || 4) * 0.5));
      const off = Math.max(2, Math.round((dash?.[1] != null ? dash[1] : dash?.[0] || 4) * 0.5));
      background = `repeating-linear-gradient(90deg, ${dashColor} 0px, ${dashColor} ${on}px, transparent ${on}px, transparent ${on + off}px), linear-gradient(${part.carrier}, ${part.carrier})`;
    } else {
      background = dash?.length ? getDashBackground(dash, dashColor) : dashColor;
    }
  } else if (part.hatchStyle2 && part.hatchStyle) background = `${part.hatchStyle2}, ${part.hatchStyle}, ${fill}`;
  else if (part.hatchStyle) background = `${part.hatchStyle}, ${fill}`;
  const halo = part.halo || "transparent";
  const shockwave = part.alarmShockwave
    ? ` map-legend-symbol--alarm-shockwave`
    : "";
  const shockwaveColor = part.alarmShockwaveColor || part.fill || "transparent";
  const captivityBleed = part.captivityBleed && part.swatchDataUrl
    ? ` map-legend-symbol--captivity-bleed`
    : "";
  const swatchImage = part.captivityBleed && part.swatchDataUrl
    ? `--legend-swatch-image:url("${part.swatchDataUrl}");`
    : "";
  const legendStroke = part.captivityBleed && part.swatchDataUrl ? "transparent" : stroke;
  const legendStrokeWidth = part.captivityBleed && part.swatchDataUrl ? 0 : (geometry ? width || 1 : width);
  // CSS borders occupy the outer box; canvas strokes straddle the planned path.
  // A diamond's planned width/height are its diagonals, not its rotated sides.
  const border = shape === "line" || captivityBleed ? 0 : legendStrokeWidth;
  const cssWidth = geometry ? geometry.width / (shape === "diamond" ? Math.SQRT2 : 1) + border : 0;
  const cssHeight = geometry ? (shape === "line" && part.carrier
    ? Math.max(2, (Number(part.strokeWidth) || 1) + 2)
    : geometry.height / (shape === "diamond" ? Math.SQRT2 : 1) + border) : 0;
  const position = geometry ? `position:absolute;left:${geometry.x - cssWidth / 2}px;top:${geometry.y - cssHeight / 2}px;width:${cssWidth}px;height:${cssHeight}px;margin:0;flex:none;${shape !== "point" && shape !== "line" ? "border-radius:0px;" : ""}` : "";
  const lineStroke = geometry && shape === "line" && part.carrier
    ? `<span class="map-legend-projection-line-stroke" style="position:absolute;left:0;top:${(cssHeight - geometry.height) / 2}px;width:${geometry.width}px;height:${geometry.height}px;background:${escapeHtml(background)}" aria-hidden="true"></span>`
    : "";
  if (lineStroke) background = part.carrier;
  const style = `${position}--legend-fill:${background};--legend-fill-opacity:${fillOpacity};--legend-stroke:${legendStroke};--legend-stroke-width:${legendStrokeWidth}px;--legend-stroke-opacity:${strokeOpacity};--legend-halo:${halo};${part.alarmShockwave ? `--legend-alarm-shockwave:${shockwaveColor};` : ""}${swatchImage}`;
  const ringSize = geometry && part.alarmShockwave ? Math.max(geometry.width, geometry.height) + fontPx * 0.56 + 1.6 : 0;
  const ring = ringSize ? `<span class="map-legend-projection-shockwave" style="position:absolute;left:${geometry.x - ringSize / 2}px;top:${geometry.y - ringSize / 2}px;width:${ringSize}px;height:${ringSize}px;border:1.6px solid ${escapeHtml(shockwaveColor)};opacity:0.4;border-radius:50%;box-sizing:border-box" aria-hidden="true"></span>` : "";
  return `<span class="map-legend-symbol map-legend-symbol--${escapeHtml(shape)}${shockwave}${captivityBleed}" style="${escapeHtml(style)}" aria-hidden="true">${lineStroke}</span>${ring}`;
}

function itemMarkup(item) {
  const components = Array.isArray(item.components) && item.components.length
    ? item.components
    : Array.isArray(item.strokeSwatches) && item.strokeSwatches.length
      ? item.strokeSwatches.map((swatch) => ({ ...item, stroke: swatch.color, dash: swatch.dash, strokeWidth: swatch.width, strokeOpacity: swatch.opacity }))
      : [item];
  return `<div class="map-legend-item" data-legend-item-id="${escapeHtml(item.id || "")}"><span class="map-legend-symbols">${components.map((part) => symbolMarkup(part)).join("")}</span><span class="map-legend-label" dir="auto">${escapeHtml(item.label || "")}</span></div>`;
}

function projectionItemMarkup(placement, fontPx, layerId = "") {
  const geometry = placement.labelGeometry;
  const symbolGeometry = placement.symbolGeometry;
  // SVG text accepts the same alphabetic baseline as canvas, independent of
  // each line's glyph ascent, descent, or the browser's CSS line-box leading.
  const labels = placement.labelLines.map((line, index) =>
    `<text class="map-legend-label map-legend-projection-line" x="${geometry.x - placement.x}" y="${geometry.y - placement.y + index * geometry.lineHeight}" dominant-baseline="alphabetic" direction="${geometry.direction}" text-anchor="start" style="letter-spacing:0px">${escapeHtml(line)}</text>`,
  ).join("");
  const symbols = symbolGeometry.components.map((component) => symbolMarkup(component.part, {
    ...component, x: component.x - placement.x, y: component.y - placement.y,
  }, fontPx)).join("");
  return `<div class="map-legend-item map-legend-projection-item" data-legend-item-id="${escapeHtml(placement.itemId)}" data-legend-layer-id="${escapeHtml(layerId)}" data-legend-pack-id="${escapeHtml(placement.packId)}" style="position:absolute;left:${placement.x}px;top:${placement.y}px;width:${placement.width}px;height:${placement.height}px"><span class="map-legend-symbols map-legend-projection-symbols" style="position:absolute;left:0;top:0;width:${symbolGeometry.width}px;height:${symbolGeometry.height}px">${symbols}</span><svg xmlns="http://www.w3.org/2000/svg" class="map-legend-projection-labels" width="${placement.width}" height="${placement.height}" style="position:absolute;left:0;top:0;overflow:visible">${labels}</svg></div>`;
}

function layerMarkup(layer, items = layer.items || []) {
  return `<section class="map-legend-layer" data-legend-block-id="${escapeHtml(layer.id)}">${items.map(itemMarkup).join("")}</section>`;
}

function packMarkup(pack, layersMarkup) {
  return `<section class="map-legend-group" data-legend-pack-id="${escapeHtml(pack.id || "")}"><div class="map-legend-layers">${layersMarkup}</div></section>`;
}

function makeChildren(element) {
  const doc = element.ownerDocument || (typeof document !== "undefined" ? document : null);
  if (!doc?.createElement) return { content: element, pager: null };
  let content = element.querySelector?.(".map-legend-content");
  if (!content) { content = doc.createElement("div"); content.className = "map-legend-content"; element.appendChild(content); }
  let pager = element.querySelector?.(".map-legend-pager");
  if (!pager) { pager = doc.createElement("div"); pager.className = "map-legend-pager"; element.appendChild(pager); }
  return { content, pager };
}

function mountMapLegend({ element, surface = "gis", projectionSpan = "full", dataContext, registry, buildModel = buildLegendModel, onRenderSnapshot, measureText } = {}) {
  if (!element) return { refresh: async () => {}, setEditing: () => {}, setPage: () => 0, dispose: () => {} };
  const mode = surface === "projection" ? "projection" : "gis";
  const { content, pager } = makeChildren(element);
  element.classList?.add?.(`map-legend-${mode}`);
  let generation = 0;
  let disposed = false;
  let editing = false;
  let timer = null;
  let page = 0;
  let pages = [];
  let currentBlocks = [];
  let currentModel = null;
  let contentLayout = null;
  let fontRevision = 0;
  let measurementCanvas = null;
  let measurementContext = null;
  if (mode === "projection") {
    measurementCanvas = (element.ownerDocument || (typeof document !== "undefined" ? document : null))?.createElement?.("canvas") || null;
    measurementContext = measurementCanvas?.getContext?.("2d") || null;
  }
  const listeners = [];
  const on = (target, name, callback) => { target?.addEventListener?.(name, callback); if (target?.removeEventListener) listeners.push(() => target.removeEventListener(name, callback)); };
  const clearTimer = () => { if (timer != null) clearInterval(timer); timer = null; };
  const settings = () => dataContext?.getLegendSettings?.() || {};
  const language = () => settings().language === "en" ? "en" : "he";
  const buildProjectionPlan = (blocks, layout) => {
    const { width, height } = resolveLegendRasterSize(layout);
    const context = measurementContext;
    if (context) {
      context.textAlign = "left";
      context.textBaseline = "alphabetic";
      context.font = `${layout.fontPx}px ${PROJECTION_LEGEND_FONT}`;
      context.letterSpacing = "0px";
    }
    const measure = typeof measureText === "function"
      ? measureText
      : (text) => context?.measureText?.(text) || {};
    return layoutProjectionLegend({ blocks, width, height, fontPx: layout.fontPx, columns: layout.columns, language: language(), measureText: measure });
  };
  const projectionBlocks = (model) => (model?.packs || []).flatMap((pack, index) => {
    const layers = (pack.layers || []).map((layer) => ({ ...layer, items: layer.items || [] }));
    if (!layers.some((layer) => layer.items.length)) return [];
    return [{ id: String(pack.id || `pack-${index}`), pack, layers }];
  });
  const panelHeight = () => Math.max(1, element.clientHeight || (mode === "projection" ? 400 : 130));
  const panelWidth = () => {
    if (mode === "gis" && typeof window !== "undefined" && Number.isFinite(window.innerWidth)) {
      const scale = Number(window.document?.body?.dataset.gisDisplayScale) || 1;
      const width = window.innerWidth / scale;
      return Math.max(1, width - (width <= 720 ? 18 : 36));
    }
    return Math.max(1, element.clientWidth || 500);
  };
  const measureBlock = (html, dimension) => {
    if (!content?.ownerDocument?.createElement) return Math.max(28, html.split("map-legend-item").length * 28);
    const holder = content.ownerDocument.createElement("div");
    holder.className = `map-legend map-legend-${mode} map-legend-measurement`;
    holder.style.width = dimension === "width" ? "max-content" : `${content.clientWidth || element.clientWidth || 300}px`;
    if (typeof getComputedStyle === "function") {
      const liveStyle = getComputedStyle(element);
      holder.style.fontSize = liveStyle.fontSize;
      holder.style.fontFamily = liveStyle.fontFamily;
    }
    holder.innerHTML = html;
    (content.ownerDocument.body || element).appendChild(holder);
    const rect = holder.getBoundingClientRect?.() || {};
    const size = dimension === "width"
      ? (holder.scrollWidth || rect.width || holder.offsetWidth || 0)
      : (rect.height || holder.offsetHeight || 0);
    holder.remove();
    return size;
  };
  const blockWidth = (html) => content?.ownerDocument?.createElement
    ? measureBlock(html, "width")
    : Math.max(1, html.split("map-legend-item").length * 140);
  const fitsTwoRowWrap = (html, available, surfaceClass) => {
    if (!content?.ownerDocument?.createElement) return Math.ceil(blockWidth(html) / 2) <= available;
    const holder = content.ownerDocument.createElement("div");
    if (!holder.querySelectorAll) return Math.ceil(blockWidth(html) / 2) <= available;
    holder.className = `map-legend ${surfaceClass} map-legend-measurement`;
    holder.style.width = `${available}px`;
    if (typeof getComputedStyle === "function") {
      const liveStyle = getComputedStyle(element);
      holder.style.fontSize = liveStyle.fontSize;
      holder.style.fontFamily = liveStyle.fontFamily;
    }
    holder.innerHTML = `<div class="map-legend-content">${html}</div>`;
    (content.ownerDocument.body || element).appendChild(holder);
    const rowTops = new Set(Array.from(
      holder.querySelectorAll(".map-legend-item"),
      (node) => Math.round(node.getBoundingClientRect().top),
    ));
    const measuredHeight = holder.getBoundingClientRect?.()?.height || holder.offsetHeight || 0;
    holder.remove();
    if (surfaceClass !== "map-legend-projection") return rowTops.size <= 2;
    return rowTops.size <= 2 && measuredHeight <= panelHeight();
  };
  const packWrapPages = (blocks, availableWidth, surfaceClass) => {
    const pages = [];
    let page = [];
    const htmlFor = (candidate) => {
      const groups = [];
      for (const block of candidate) {
        const prior = groups.at(-1);
        if (prior?.pack.id === block.pack.id) prior.layersMarkup += block.layersMarkup;
        else groups.push({ pack: block.pack, layersMarkup: block.layersMarkup });
      }
      return groups.map(({ pack, layersMarkup }) => packMarkup(pack, layersMarkup)).join("");
    };
    for (const block of blocks) {
      const samePack = page.some((entry) => entry.pack.id === block.pack.id);
      if (page.length && (samePack || !fitsTwoRowWrap(htmlFor([...page, block]), availableWidth, surfaceClass))) {
        pages.push(page.map((entry) => entry.id));
        page = [block];
      } else page.push(block);
    }
    if (page.length) pages.push(page.map((entry) => entry.id));
    return { pages, oversizedBlockIds: [] };
  };
  const buildBlocks = (model) => {
    const surfaceClass = mode === "projection" ? "map-legend-projection" : "map-legend-gis";
    const makeWrapBlock = (pack, fragments, suffix = "") => {
      const layersMarkup = fragments.map(({ layer, items }) => layerMarkup(layer, items)).join("");
      const html = packMarkup(pack, layersMarkup);
      const naturalWidth = blockWidth(html);
      return {
        id: `${pack.id}${suffix}`,
        groupId: pack.id,
        height: Math.ceil(naturalWidth / 2),
        fits: fitsTwoRowWrap(html, panelWidth(), surfaceClass),
        pack,
        layers: fragments,
        layersMarkup,
      };
    };
    return (model?.packs || []).flatMap((pack) => {
      const layers = pack.layers || [];
      const full = makeWrapBlock(pack, layers.map((layer) => ({ layer, items: layer.items || [] })));
      if (full.fits) return [full];
      const entries = layers.flatMap((layer) => (layer.items || []).map((item) => ({ layer, item })));
      const blocks = [];
      let fragments = [];
      const appendEntry = (source, entry) => {
        const next = source.map((fragment) => ({ ...fragment, items: [...fragment.items] }));
        const prior = next.at(-1);
        if (prior?.layer.id === entry.layer.id) prior.items.push(entry.item);
        else next.push({ layer: entry.layer, items: [entry.item] });
        return next;
      };
      for (const entry of entries) {
        const candidate = appendEntry(fragments, entry);
        if (fragments.length && !makeWrapBlock(pack, candidate).fits) {
          const firstId = fragments[0]?.items[0]?.id || blocks.length;
          blocks.push(makeWrapBlock(pack, fragments, `#${firstId}`));
          fragments = appendEntry([], entry);
        } else {
          fragments = candidate;
        }
      }
      if (fragments.length) {
        const firstId = fragments[0]?.items[0]?.id || blocks.length;
        blocks.push(makeWrapBlock(pack, fragments, `#${firstId}`));
      }
      return blocks.length ? blocks : [full];
    });
  };
  const renderPager = () => {
    if (!pager) return;
    clearTimer();
    const hasMultiplePages = pages.length > 1;
    const pageCount = `<span dir="ltr" data-legend-count>${page + 1} / ${pages.length}</span>`;
    const controls = mode === "gis"
      ? `<span class="map-legend-page-controls"><button type="button" data-legend-prev aria-label="Previous legend page">‹</button>${pageCount}<button type="button" data-legend-next aria-label="Next legend page">›</button></span>`
      : pageCount;
    pager.innerHTML = hasMultiplePages ? controls : "";
    pager.hidden = !hasMultiplePages;
    if (pages.length > 1) {
      pager.querySelector?.("[data-legend-prev]")?.addEventListener("click", () => { page = (page + pages.length - 1) % pages.length; renderPage(); });
      pager.querySelector?.("[data-legend-next]")?.addEventListener("click", () => { page = (page + 1) % pages.length; renderPage(); });
      if (!editing && !(typeof document !== "undefined" && document.hidden)) {
        const dwell = resolveLegendLayout({ settings: settings(), span: projectionSpan }).dwellSeconds;
        timer = setInterval(() => { page = (page + 1) % pages.length; renderPage(); }, dwell * 1000);
      }
    }
  };
  const renderSnapshot = (visibleBlocks = [], emptyProjection = false) => {
    const layout = resolveLegendLayout({ settings: settings(), span: projectionSpan });
    const snapshotBlocks = mode === "projection" ? (emptyProjection ? [] : currentBlocks) : visibleBlocks;
    const snapshotPages = mode === "projection" ? (snapshotBlocks.length ? [snapshotBlocks.map((block) => block.id)] : []) : pages;
    return {
      model: currentModel,
      pages: snapshotPages.map((ids) => [...ids]),
      pageIndex: mode === "projection" ? 0 : page,
      blocks: snapshotBlocks.map((block) => ({ id: block.id, pack: block.pack, layers: block.layers || [] })),
      language: language(),
      spanId: projectionSpan,
      visible: !(mode === "projection" && projectionSpan === "right") && layout?.visible !== false && visibleBlocks.length > 0,
      editing,
      layout,
      contentLayout,
      fontRevision,
      animationNow: Date.now(),
    };
  };
  const renderPage = () => {
    if (mode === "projection") {
      clearTimer();
      const layout = resolveLegendLayout({ settings: settings(), span: projectionSpan });
      const { width, height } = resolveLegendRasterSize(layout);
      const reference = element.parentElement?.getBoundingClientRect?.() || {};
      const referenceWidth = Number(reference.width) || OUTPUT_WIDTH;
      const referenceHeight = Number(reference.height) || OUTPUT_HEIGHT;
      const referenceScale = referenceWidth / OUTPUT_WIDTH;
      const savedWidth = referenceWidth * (Number(layout.widthPct) || 0) / 100;
      const savedHeight = referenceHeight * (Number(layout.heightPct) || 0) / 100;
      const offsetX = (savedWidth - width * referenceScale) / 2;
      const offsetY = (savedHeight - height * referenceScale) / 2;
      const scale = (contentLayout?.scale || 1) * referenceScale;
      if (content?.style) Object.assign(content.style, {
        position: "absolute", left: `${offsetX}px`, top: `${offsetY}px`, width: `${width}px`, height: `${height}px`,
        padding: "0", border: "0", boxSizing: "content-box", fontSize: `${Number(layout.fontPx) || 22}px`,
        fontFamily: PROJECTION_LEGEND_FONT, transform: `scale(${scale})`, transformOrigin: "top left", overflow: "visible", direction: "ltr",
      });
      const byId = new Map(currentBlocks.map((block) => [block.id, block]));
      const rendered = (contentLayout?.placements || []).map((placement) => {
        const block = byId.get(placement.packId);
        const layer = block?.layers?.find((candidate) => candidate.items?.includes(placement.item));
        return projectionItemMarkup(placement, Number(layout.fontPx) || 22, layer?.id || "");
      }).join("");
      content.innerHTML = rendered;
      if (pager) { pager.innerHTML = ""; pager.hidden = true; }
      onRenderSnapshot?.(renderSnapshot(currentBlocks));
      return;
    }
    const ids = pages[page] || [];
    const visible = currentBlocks.filter((block) => ids.includes(block.id));
    const groups = [];
    for (const block of visible) {
      const prior = groups.at(-1);
      if (prior?.pack.id === block.pack.id) prior.layersMarkup += block.layersMarkup;
      else groups.push({ pack: block.pack, layersMarkup: block.layersMarkup });
    }
    content.innerHTML = groups.map(({ pack, layersMarkup }) => packMarkup(pack, layersMarkup)).join("");
    renderPager();
    onRenderSnapshot?.(renderSnapshot(visible));
  };
  const refresh = async () => {
    if (disposed) return;
    const version = ++generation;
    const priorId = pages[page]?.[0] || null;
    try {
      const current = settings();
      if (mode === "projection") {
        applyProjectionLegendLayout(element, resolveLegendLayout({ settings: current, span: projectionSpan }), {
          span: projectionSpan,
          referenceElement: element.parentElement,
        });
      }
      element.dir = language() === "en" ? "ltr" : "rtl";
      const model = await buildModel({ surface: mode, dataContext, registry, language: current.language, summarizedGroupIds: current.summarizedGroupIds });
      if (disposed || version !== generation) return;
      if (mode === "projection") {
        const layout = resolveLegendLayout({ settings: current, span: projectionSpan });
        currentBlocks = projectionBlocks(model);
        currentModel = model;
        pages = currentBlocks.length ? [currentBlocks.map((block) => block.id)] : [];
        page = 0;
        contentLayout = currentBlocks.length ? buildProjectionPlan(currentBlocks, layout) : null;
        if (pager) pager.dataset.legendOverflow = "false";
        element.classList?.toggle("map-legend-has-content", pages.length > 0);
        renderPage();
        return;
      }
      const blocks = buildBlocks(model);
      const packed = packWrapPages(
        blocks,
        panelWidth(),
        mode === "projection" ? "map-legend-projection" : "map-legend-gis",
      );
      currentBlocks = blocks;
      currentModel = model;
      pages = packed.pages;
      if (pager) pager.dataset.legendOverflow = packed.oversizedBlockIds.length > 0 ? "true" : "false";
      page = Math.max(0, pages.findIndex((ids) => ids.includes(priorId || currentBlocks[0]?.id)));
      if (page < 0) page = 0;
      element.classList?.toggle("map-legend-has-content", pages.length > 0);
      renderPage();
    } catch (error) {
      if (disposed || version !== generation) return;
      console.warn("[MapLegend] build failed", error);
      content.innerHTML = "";
      currentModel = null;
      currentBlocks = [];
      contentLayout = null;
      pages = [];
      page = 0;
      renderPager();
      onRenderSnapshot?.(renderSnapshot([]));
    }
  };
  const setEditing = (next) => { editing = !!next; if (editing) clearTimer(); else renderPager(); };
  on(typeof document !== "undefined" ? document : null, "visibilitychange", () => { if (document.hidden) clearTimer(); else renderPager(); });
  if (typeof ResizeObserver !== "undefined") {
    const observer = new ResizeObserver(() => { if (!disposed) refresh(); });
    observer.observe(element);
    if (mode === "projection" && element.parentElement && element.parentElement !== element) observer.observe(element.parentElement);
    listeners.push(() => observer.disconnect());
  }
  if (typeof document !== "undefined" && document.fonts?.addEventListener) { const callback = () => { if (mode === "projection") fontRevision += 1; refresh(); }; document.fonts.addEventListener("loadingdone", callback); listeners.push(() => document.fonts.removeEventListener("loadingdone", callback)); }
  return {
    refresh,
    setEditing,
    setPage(index) {
      if (disposed || !Number.isSafeInteger(index)) return page;
      page = Math.max(0, Math.min(index, Math.max(0, pages.length - 1)));
      renderPage();
      return page;
    },
    getRenderSnapshot: () => {
      const visible = currentBlocks.filter((block) => (pages[page] || []).includes(block.id));
      return renderSnapshot(visible);
    },
    dispose() {
      if (!disposed) onRenderSnapshot?.(renderSnapshot([], mode === "projection"));
      disposed = true;
      generation += 1;
      clearTimer();
      listeners.splice(0).forEach((remove) => remove());
      content.innerHTML = "";
      currentModel = null;
      currentBlocks = [];
      contentLayout = null;
      pages = [];
      measurementContext = null;
      measurementCanvas = null;
    },
  };
}

export { mountMapLegend };
