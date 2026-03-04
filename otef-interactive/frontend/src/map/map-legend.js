/**
 * Cartographic legend renderer for the Leaflet GIS map.
 * Render-only: receives a model from legend-model-builder.js and produces HTML.
 */

import { buildLegendModel, getDashBackground } from "./legend-model-builder.js";

// escapeHtml is provided by html-utils.js (loaded via script tag)

// ---------------------------------------------------------------------------
// renderLegend — paint the legend into the DOM
// ---------------------------------------------------------------------------

function renderLegend(model) {
  const legend = document.getElementById("mapLegend");
  if (!legend) return;

  const packs = model.packs || [];
  if (packs.length === 0) {
    legend.innerHTML = "";
    legend.classList.remove("map-legend-has-content");
    return;
  }

  legend.classList.add("map-legend-has-content");
  let html = '<div class="map-legend-title has-groups">Legend</div>';

  for (const pack of packs) {
    html += '<div class="map-legend-group">';
    html += `<div class="map-legend-group-title" dir="auto">${escapeHtml(
      pack.name,
    )}</div>`;

    const layers = (pack.layers || []).slice();

    for (const layer of layers) {
      html += '<div class="map-legend-layer">';

      const isComposite = layer.isComposite;
      const singleRow = layer.singleRowMultiSymbol === true;
      const oneRowWithMultipleSymbols = isComposite || singleRow;

      const showLayerTitle =
        !oneRowWithMultipleSymbols && (layer.items || []).length > 1;

      if (showLayerTitle) {
        html += `<div class="map-legend-layer-title" dir="auto">${escapeHtml(
          layer.name,
        )}</div>`;
      }

      if (oneRowWithMultipleSymbols) {
        html += '<div class="map-legend-item">';
        const shapePriority = { point: 0, line: 1, polygon: 2 };
        const sortedItems = (layer.items || [])
          .slice()
          .sort(
            (a, b) =>
              (shapePriority[a.shape] || 3) - (shapePriority[b.shape] || 3),
          );
        for (const item of sortedItems) {
          html += renderSymbolSpan(item);
        }
        html += `<span class="map-legend-label" dir="auto">${escapeHtml(layer.name)}</span>`;
        html += "</div>";
      } else {
        for (const item of layer.items) {
          html += '<div class="map-legend-item">';
          html += renderSymbolSpan(item);
          html += `<span class="map-legend-label" dir="auto">${escapeHtml(
            item.label,
          )}</span>`;
          html += "</div>";
        }
      }

      html += "</div>";
    }

    html += "</div>";
  }

  legend.innerHTML = html;
}

// ---------------------------------------------------------------------------
// renderSymbolSpan — HTML for a single legend swatch
// ---------------------------------------------------------------------------

function renderSymbolSpan(item) {
  const shape = item.shape || "polygon";
  const symbolClass = `map-legend-symbol map-legend-symbol--${shape}`;
  let style = "";

  if (shape === "none") {
    style = "background: transparent; border: none;";
  } else if (shape === "line") {
    const baseStyle = "border: none; height: 2px; margin-top: 6px;";
    const swatches =
      item.strokeSwatches && item.strokeSwatches.length > 0
        ? item.strokeSwatches
        : item.stroke != null || item.strokeSecondary != null
          ? [
              { color: item.stroke || item.fill, dash: item.dash },
              ...(item.strokeSecondary != null
                ? [{ color: item.strokeSecondary, dash: null }]
                : []),
            ].filter((s) => s.color)
          : [];
    if (swatches.length === 0) {
      swatches.push({
        color: item.stroke || item.fill || "#808080",
        dash: item.dash,
      });
    }
    let span = "";
    for (const sw of swatches) {
      const dashArr =
        sw.dash && (Array.isArray(sw.dash) ? sw.dash : sw.dash.array);
      const bg =
        dashArr && dashArr.length > 0
          ? getDashBackground(dashArr, sw.color || "#808080")
          : sw.color || "#808080";
      span += `<span class="${symbolClass}" style="background: ${bg}; ${baseStyle}" aria-hidden="true"></span>`;
    }
    return span;
  } else {
    const strokeColor = item.stroke != null ? item.stroke : "#000000";
    const fillBg = item.fill || "#808080";
    if (item.hatchStyle2 && item.hatchStyle) {
      style = `background: ${item.hatchStyle2}, ${item.hatchStyle}, ${fillBg}; border-color: ${strokeColor};`;
    } else if (item.hatchStyle) {
      style = `background: ${item.hatchStyle}, ${fillBg}; border-color: ${strokeColor};`;
    } else {
      style = `background: ${fillBg}; border-color: ${strokeColor};`;
    }
  }

  return `<span class="${symbolClass}" style="${style}" aria-hidden="true"></span>`;
}

// ---------------------------------------------------------------------------
// updateMapLegend — public API (called by layer loaders)
// ---------------------------------------------------------------------------

/**
 * Update cartographic legend from OTEFDataContext and layerRegistry.
 * Shows only enabled layers, grouped by pack and layer, with geometry-aware symbols.
 */
async function updateMapLegend() {
  try {
    const model = await buildLegendModel();
    renderLegend(model);
  } catch (e) {
    console.warn("[MapLegend] updateMapLegend failed:", e);
    const el = document.getElementById("mapLegend");
    if (el) {
      el.innerHTML = "";
      el.classList.remove("map-legend-has-content");
    }
  }
}

export { updateMapLegend };
