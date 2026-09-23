import { buildLegendModel, getDashBackground } from "./legend-model-builder.js";
import { packLegendPages } from "./legend-pagination.js";
import { escapeHtml } from "../shared/html-utils.js";

function symbolMarkup(part = {}) {
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
  const legendStrokeWidth = part.captivityBleed && part.swatchDataUrl ? 0 : width;
  const style = `--legend-fill:${background};--legend-fill-opacity:${fillOpacity};--legend-stroke:${legendStroke};--legend-stroke-width:${legendStrokeWidth}px;--legend-stroke-opacity:${strokeOpacity};--legend-halo:${halo};${part.alarmShockwave ? `--legend-alarm-shockwave:${shockwaveColor};` : ""}${swatchImage}`;
  return `<span class="map-legend-symbol map-legend-symbol--${escapeHtml(shape)}${shockwave}${captivityBleed}" style="${escapeHtml(style)}" aria-hidden="true"></span>`;
}

function itemMarkup(item) {
  const components = Array.isArray(item.components) && item.components.length
    ? item.components
    : Array.isArray(item.strokeSwatches) && item.strokeSwatches.length
      ? item.strokeSwatches.map((swatch) => ({ ...item, stroke: swatch.color, dash: swatch.dash, strokeWidth: swatch.width, strokeOpacity: swatch.opacity }))
      : [item];
  return `<div class="map-legend-item" data-legend-item-id="${escapeHtml(item.id || "")}"><span class="map-legend-symbols">${components.map(symbolMarkup).join("")}</span><span class="map-legend-label" dir="auto">${escapeHtml(item.label || "")}</span></div>`;
}

function layerMarkup(layer, items = layer.items || []) {
  return `<section class="map-legend-layer" data-legend-block-id="${escapeHtml(layer.id)}">${items.map(itemMarkup).join("")}</section>`;
}

function packMarkup(pack, layersMarkup) {
  return `<section class="map-legend-group" data-legend-pack-id="${escapeHtml(pack.id || "")}"><div class="map-legend-group-title" dir="auto">${escapeHtml(pack.name || "")}</div><div class="map-legend-layers">${layersMarkup}</div></section>`;
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

function mountMapLegend({ element, surface = "gis", projectionSpan = "full", dataContext, registry, buildModel = buildLegendModel, onRenderSnapshot } = {}) {
  if (!element) return { refresh: async () => {}, setEditing: () => {}, dispose: () => {} };
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
  const listeners = [];
  const on = (target, name, callback) => { target?.addEventListener?.(name, callback); if (target?.removeEventListener) listeners.push(() => target.removeEventListener(name, callback)); };
  const clearTimer = () => { if (timer != null) clearInterval(timer); timer = null; };
  const settings = () => dataContext?.getLegendSettings?.() || {};
  const language = () => settings().language === "en" ? "en" : "he";
  const panelHeight = () => Math.max(1, element.clientHeight || (mode === "projection" ? 400 : 130));
  const panelWidth = () => {
    if (mode === "gis" && typeof window !== "undefined" && Number.isFinite(window.innerWidth)) {
      return Math.max(1, window.innerWidth - (window.innerWidth <= 720 ? 18 : 36));
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
  const blockHeight = (html) => measureBlock(html, "height");
  const blockWidth = (html) => content?.ownerDocument?.createElement
    ? measureBlock(html, "width")
    : Math.max(1, html.split("map-legend-item").length * 140);
  const fitsGisTwoRows = (html, available) => {
    if (!content?.ownerDocument?.createElement) return Math.ceil(blockWidth(html) / 2) <= available;
    const holder = content.ownerDocument.createElement("div");
    if (!holder.querySelectorAll) return Math.ceil(blockWidth(html) / 2) <= available;
    holder.className = "map-legend map-legend-gis map-legend-measurement";
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
    holder.remove();
    return rowTops.size <= 2;
  };
  const makeGisBlock = (pack, fragments, suffix = "") => {
    const layersMarkup = fragments.map(({ layer, items }) => (
      layerMarkup(layer, items)
    )).join("");
    const html = packMarkup(pack, layersMarkup);
    const naturalWidth = blockWidth(html);
    return {
      id: `${pack.id}${suffix}`,
      groupId: pack.id,
      height: Math.ceil(naturalWidth / 2),
      fits: fitsGisTwoRows(html, panelWidth()),
      pack,
      layers: fragments,
      layersMarkup,
    };
  };
  const buildBlocks = (model) => {
    if (mode === "gis") {
      return (model?.packs || []).flatMap((pack) => {
        const layers = pack.layers || [];
        const full = makeGisBlock(pack, layers.map((layer) => ({
          layer,
          items: layer.items || [],
        })));
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
          if (fragments.length && !makeGisBlock(pack, candidate).fits) {
            const firstId = fragments[0]?.items[0]?.id || blocks.length;
            blocks.push(makeGisBlock(pack, fragments, `#${firstId}`));
            fragments = appendEntry([], entry);
          } else {
            fragments = candidate;
          }
        }
        if (fragments.length) {
          const firstId = fragments[0]?.items[0]?.id || blocks.length;
          blocks.push(makeGisBlock(pack, fragments, `#${firstId}`));
        }
        return blocks.length ? blocks : [full];
      });
    }
    const blocks = [];
    const appendEntry = (source, entry) => {
      const next = source.map((fragment) => ({
        ...fragment,
        items: [...fragment.items],
      }));
      const prior = next.at(-1);
      if (prior?.layer.id === entry.layer.id) prior.items.push(entry.item);
      else next.push({ layer: entry.layer, items: [entry.item] });
      return next;
    };
    const makeProjectionBlock = (pack, fragments, suffix = "") => {
      const layersMarkup = fragments.map(({ layer, items }) => (
        layerMarkup(layer, items)
      )).join("");
      const html = packMarkup(pack, layersMarkup);
      return {
        id: `${pack.id}${suffix}`,
        height: blockHeight(html),
        pack,
        layers: fragments,
        layersMarkup,
      };
    };
    for (const pack of model?.packs || []) {
      const entries = (pack.layers || []).flatMap((layer) => (
        (layer.items || []).map((item) => ({ layer, item }))
      ));
      const fullFragments = (pack.layers || []).map((layer) => ({
        layer,
        items: layer.items || [],
      }));
      const full = makeProjectionBlock(pack, fullFragments);
      const available = panelHeight();
      if (full.height <= available || entries.length <= 1) {
        blocks.push(full);
        continue;
      }

      let fragments = [];
      for (const entry of entries) {
        const candidate = appendEntry(fragments, entry);
        if (fragments.length && makeProjectionBlock(pack, candidate).height > available) {
          const firstId = fragments[0]?.items[0]?.id || blocks.length;
          blocks.push(makeProjectionBlock(pack, fragments, `#${firstId}`));
          fragments = appendEntry([], entry);
        } else {
          fragments = candidate;
        }
      }
      if (fragments.length) {
        const firstId = fragments[0]?.items[0]?.id || blocks.length;
        blocks.push(makeProjectionBlock(pack, fragments, `#${firstId}`));
      }
    }
    return blocks;
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
        const projection = settings().projection || {};
        const dwell = projection[projectionSpan]?.dwellSeconds
          || projection.full?.dwellSeconds
          || projection.dwellSeconds
          || 8;
        timer = setInterval(() => { page = (page + 1) % pages.length; renderPage(); }, dwell * 1000);
      }
    }
  };
  const renderSnapshot = (visibleBlocks = []) => {
    const layout = settings().projection?.[projectionSpan] || settings().projection?.full || null;
    return {
      model: currentModel,
      pages: pages.map((ids) => [...ids]),
      pageIndex: page,
      blocks: visibleBlocks.map((block) => ({ id: block.id, pack: block.pack, layers: block.layers || [] })),
      language: language(),
      spanId: projectionSpan,
      visible: !(mode === "projection" && projectionSpan === "right") && layout?.visible !== false && visibleBlocks.length > 0,
      editing,
      layout,
      animationNow: Date.now(),
    };
  };
  const renderPage = () => {
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
      element.dir = language() === "en" ? "ltr" : "rtl";
      const model = await buildModel({ surface: mode, dataContext, registry, language: current.language, summarizedGroupIds: current.summarizedGroupIds });
      if (disposed || version !== generation) return;
      const blocks = buildBlocks(model);
      const packed = mode === "gis" ? (() => {
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
          if (page.length && (samePack || !fitsGisTwoRows(htmlFor([...page, block]), panelWidth()))) {
            pages.push(page.map((entry) => entry.id));
            page = [block];
          } else page.push(block);
        }
        if (page.length) pages.push(page.map((entry) => entry.id));
        return { pages, oversizedBlockIds: [] };
      })() : packLegendPages(blocks, panelHeight());
      currentBlocks = blocks;
      currentModel = model;
      pages = packed.pages;
      if (pager) pager.dataset.legendOverflow = packed.oversizedBlockIds.length > 0 ? "true" : "false";
      page = Math.max(0, pages.findIndex((ids) => ids.includes(priorId || currentBlocks[0]?.id)));
      if (page < 0) page = 0;
      element.classList?.toggle("map-legend-has-content", pages.length > 0);
      renderPage();
    } catch (error) {
      console.warn("[MapLegend] build failed", error);
      content.innerHTML = "";
      currentModel = null;
      currentBlocks = [];
      pages = [];
      page = 0;
      renderPager();
      onRenderSnapshot?.(renderSnapshot([]));
    }
  };
  const setEditing = (next) => { editing = !!next; if (editing) clearTimer(); else renderPager(); };
  on(typeof document !== "undefined" ? document : null, "visibilitychange", () => { if (document.hidden) clearTimer(); else renderPager(); });
  if (typeof ResizeObserver !== "undefined") { const observer = new ResizeObserver(() => { if (!disposed) refresh(); }); observer.observe(element); listeners.push(() => observer.disconnect()); }
  if (typeof document !== "undefined" && document.fonts?.addEventListener) { const callback = () => refresh(); document.fonts.addEventListener("loadingdone", callback); listeners.push(() => document.fonts.removeEventListener("loadingdone", callback)); }
  return {
    refresh,
    setEditing,
    getRenderSnapshot: () => {
      const visible = currentBlocks.filter((block) => (pages[page] || []).includes(block.id));
      return renderSnapshot(visible);
    },
    dispose() {
      if (!disposed) onRenderSnapshot?.(renderSnapshot([]));
      disposed = true;
      generation += 1;
      clearTimer();
      listeners.splice(0).forEach((remove) => remove());
      content.innerHTML = "";
      currentModel = null;
      currentBlocks = [];
      pages = [];
    },
  };
}

export { mountMapLegend };
