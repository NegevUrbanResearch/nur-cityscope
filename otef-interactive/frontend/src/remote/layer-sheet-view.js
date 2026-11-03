import { t } from "./remote-locale.js";

export function escapeLayerHtml(value) {
  return String(value).replace(/&/g, "&amp;").replace(/</g, "&lt;")
    .replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

const paths = {
  eye: '<path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/>',
  hidden: '<path d="m3 3 18 18M10.6 5.1 12 5c6.4 0 10 7 10 7a18 18 0 0 1-3.1 3.9M6.2 6.2A19 19 0 0 0 2 12s3.6 7 10 7a12 12 0 0 0 5-1.1M9.9 9.9a3 3 0 0 0 4.2 4.2"/>',
  play: '<path d="m8 5 11 7-11 7V5Z"/>',
  pause: '<path d="M8 5v14M16 5v14"/>',
};

export function layerIcon(name) {
  return `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${paths[name] || paths.eye}</svg>`;
}

export function renderVisibilityTile({ label, enabled, layerIds, animationIds, animationVisibilityIds, animationEnabled, animationMixed, pinkLine }) {
  const hasAnimation = animationIds.length > 0;
  const classes = ["layer-tile", enabled ? "is-on" : "is-off", hasAnimation ? "layer-tile--anim" : "", pinkLine ? "layer-tile--pink-line" : ""].filter(Boolean).join(" ");
  const state = t(enabled ? "layerShown" : "layerHidden");
  return `<div class="layer-tile-wrap">
    <button type="button" class="${classes}" aria-pressed="${enabled}" aria-label="${escapeLayerHtml(label)}: ${escapeLayerHtml(state)}" data-layer-ids="${escapeLayerHtml(JSON.stringify(layerIds))}">
      <span class="layer-tile__label">${escapeLayerHtml(label)}</span>
      <span class="layer-tile__state">${layerIcon(enabled ? "eye" : "hidden")}<span>${escapeLayerHtml(state)}</span></span>
    </button>
    ${hasAnimation ? `<button type="button" class="anim-btn ${animationEnabled ? "active" : ""}${animationMixed ? " mixed" : ""}" data-animation-toggle data-animation-layer-ids="${escapeLayerHtml(JSON.stringify(animationIds))}" data-animation-visibility-ids="${escapeLayerHtml(JSON.stringify(animationVisibilityIds))}" aria-pressed="${animationEnabled}" aria-label="${escapeLayerHtml(t("ariaLayerAnimationToggle"))}">
      ${layerIcon(animationEnabled ? "pause" : "play")}<span>${escapeLayerHtml(t(animationEnabled ? "layerFlowStop" : "layerFlowStart"))}</span>
    </button>` : ""}
  </div>`;
}

export function renderLayerWorkspace({ packs, selectedId, selectedTitle, enabledCount, totalCount, allLayersOn, rowsHtml }) {
  return `<div class="layers-workspace">
    <aside class="layers-pack-pane">
      <h2 class="layers-pack-heading">${escapeLayerHtml(t("layersPackList"))}</h2>
      <div class="layers-pack-list" role="group" aria-label="${escapeLayerHtml(t("layersPackList"))}">
        ${packs.map((pack) => `<button type="button" class="pack-chip${pack.id === selectedId ? " pack-chip--selected" : ""}" data-layers-select-pack="${encodeURIComponent(pack.id)}" aria-pressed="${pack.id === selectedId}" ${pack.id === selectedId ? 'aria-current="true"' : ""}>
          <span class="pack-chip__name">${escapeLayerHtml(pack.title)}</span><span class="group-count" dir="ltr">${pack.enabled} / ${pack.total}</span>
        </button>`).join("")}
      </div>
    </aside>
    <section class="layers-focused-pack" aria-label="${escapeLayerHtml(selectedTitle)}">
      <div class="focused-pack-toolbar">
        <div><h2>${escapeLayerHtml(selectedTitle)}</h2><p class="remote-meta">${escapeLayerHtml(t("layersPackSummary", { e: enabledCount, t: totalCount }))}</p></div>
        <button type="button" class="layers-bulk-action" data-layers-bulk-visibility data-layers-enc-gid="${encodeURIComponent(selectedId)}" data-enabled="${!allLayersOn}">${layerIcon(allLayersOn ? "hidden" : "eye")}<span>${escapeLayerHtml(t(allLayersOn ? "layersHideAll" : "layersShowAll"))}</span></button>
      </div>
      <div id="layerPackScroll" class="group-layers group-layers--expanded group-layers--tiles" tabindex="0" role="region" aria-label="${escapeLayerHtml(selectedTitle)}"><div class="layer-tile-grid">${rowsHtml}</div></div>
      <button type="button" class="layers-more" data-layers-more aria-controls="layerPackScroll" hidden>${escapeLayerHtml(t("layersMore"))}</button>
    </section>
  </div>`;
}
