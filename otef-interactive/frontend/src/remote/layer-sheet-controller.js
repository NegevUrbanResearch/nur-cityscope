/**
 * Layer list controller (Layers tab)
 *
 * Overview: pack list with active counts, pack on/off, open/drill, pack-level Flow
 * (when the pack has animatable layers) — separate from per-row animation chips.
 * Focused: one pack with row toggles, pack controls, and row- / pack-level animation
 * as in the previous sheet implementation. Syncs with OTEFDataContext.
 */

import {
  formatLayerLabelForDisplay,
  normalizeLayerBaseName,
  parseLayerNameWithGeometrySuffix,
} from "../shared/layer-name-utils.js";
import { LOCALE_EVENT, applyRemoteChromeI18n, formatActiveLayerCount, t } from "./remote-locale.js";

function groupLayersByNameForSheet(layers, groupId) {
  const groups = new Map();
  const result = [];
  const processedIds = new Set();
  const standalones = [];

  for (const layer of layers) {
    if (processedIds.has(layer.id)) continue;
    const layerFullIds =
      Array.isArray(layer.fullLayerIds) && layer.fullLayerIds.length > 0
        ? layer.fullLayerIds
        : [`${groupId}.${layer.id}`];
    const parsed = parseLayerNameWithGeometrySuffix(layer.name || layer.id);
    if (parsed) {
      const rawBase = parsed.baseNameRaw;
      const baseName = parsed.baseNameNorm;
      let row = groups.get(baseName);
      if (!row) {
        row = {
          baseName,
          displayLabel: rawBase,
          fullLayerIds: [],
          layers: [],
        };
        groups.set(baseName, row);
        result.push(row);
      }
      row.fullLayerIds.push(...layerFullIds);
      row.layers.push(layer);
      processedIds.add(layer.id);
    } else {
      const rawName = layer.name || layer.id;
      standalones.push({
        baseName: normalizeLayerBaseName(rawName),
        displayLabel: rawName,
        fullLayerIds: layerFullIds,
        layers: [layer],
      });
      processedIds.add(layer.id);
    }
  }

  for (const row of result) {
    const baseName = row.baseName;
    for (let i = standalones.length - 1; i >= 0; i--) {
      if (standalones[i].baseName !== baseName) continue;
      const s = standalones[i];
      row.fullLayerIds.push(...s.fullLayerIds);
      row.layers.push(...s.layers);
      standalones.splice(i, 1);
    }
  }

  for (const row of result) {
    row.enabled = row.layers.every((l) => l.enabled);
  }
  for (const row of standalones) {
    row.enabled = row.layers.every((l) => l.enabled);
  }
  return result.concat(standalones);
}

function isLayerAnimatable(layer, groupId) {
  if (layer && layer.style && layer.style.animation) return true;
  if (
    groupId &&
    layer &&
    layer.id &&
    typeof layerRegistry !== "undefined" &&
    layerRegistry &&
    typeof layerRegistry.getLayerConfig === "function"
  ) {
    const cfg = layerRegistry.getLayerConfig(`${groupId}.${layer.id}`);
    return !!(cfg && cfg.style && cfg.style.animation);
  }
  return false;
}

function getRowAnimatableFullLayerIds(row, groupId) {
  if (!row || !Array.isArray(row.layers)) return [];
  return row.layers
    .filter((layer) => isLayerAnimatable(layer, groupId))
    .map((layer) => `${groupId}.${layer.id}`);
}

/**
 * @param {{ id?: string, name?: string }} group
 * @returns {string}
 */
function layerGroupTitle(group) {
  const id = group && group.id;
  const name = group && group.name;
  if (id === "curated" || name === "Curated") {
    return t("curatedGroupLabel");
  }
  return name ?? String(id ?? "");
}

function escapeHtmlSafe(value) {
  if (typeof escapeHtml === "function") {
    return escapeHtml(value);
  }
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function encAttrId(id) {
  return encodeURIComponent(String(id));
}

function renderLayerRow(row, options = {}) {
  const groupId = options.groupId || "";
  const checked =
    row.enabled !== undefined ? row.enabled : row.layers.every((l) => l.enabled);
  const layerIdsAttr = JSON.stringify(row.fullLayerIds || []).replace(
    /"/g,
    "&quot;",
  );
  const rawLabel =
    row.displayLabel ?? row.baseName ?? row.layers[0]?.name ?? row.layers[0]?.id ?? "";
  const label = formatLayerLabelForDisplay(rawLabel);
  const preview = options.stylePreview || {
    fillColor: "#808080",
    fillOpacity: 0.7,
    strokeColor: "#000000",
  };
  const animatableIds = getRowAnimatableFullLayerIds(row, groupId);
  const hasAnimationToggle = animatableIds.length > 0;
  const animIdsAttr = JSON.stringify(animatableIds).replace(/"/g, "&quot;");
  const animations = options.animations || {};
  const enabledAnimationCount = hasAnimationToggle
    ? animatableIds.filter((id) => !!animations[id]).length
    : 0;
  const animationEnabled = hasAnimationToggle && enabledAnimationCount > 0;
  const animationMixed =
    hasAnimationToggle &&
    enabledAnimationCount > 0 &&
    enabledAnimationCount < animatableIds.length;

  return `
    <div class="layer-item">
      <div class="layer-preview" style="background-color: ${preview.fillColor}; opacity: ${preview.fillOpacity}; border-color: ${preview.strokeColor};"></div>
      <label class="group-toggle" onclick="event.stopPropagation()">
        <input
          type="checkbox"
          data-layer-ids="${layerIdsAttr}"
          ${checked ? "checked" : ""}
          onchange="layerSheetController.toggleLayerRow(JSON.parse(this.getAttribute('data-layer-ids')), this.checked); event.stopPropagation();"
        />
        <span class="toggle-indicator"></span>
      </label>
      <span class="layer-label">${escapeHtmlSafe(label)}</span>
      ${
        hasAnimationToggle
          ? `<button
              type="button"
              class="animation-chip ${animationEnabled ? "active" : ""} ${animationMixed ? "mixed" : ""}"
              data-animation-toggle
              data-animation-layer-ids="${animIdsAttr}"
            >${escapeHtmlSafe(t("flowLabel"))}</button>`
          : ""
      }
    </div>
  `;
}

class LayerSheetController {
  /**
   * @param {{ rootId?: string }} [options]
   */
  constructor(options = {}) {
    this.rootId = options.rootId || "layerSheet";
    this.sheet = null;
    this.isOpen = false;
    /** @type {string | null} */
    this.focusedGroupId = null;

    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", () => {
        this.init().catch((err) => {
          console.error("[LayerSheetController] Initialization error:", err);
        });
      });
    } else {
      this.init().catch((err) => {
        console.error("[LayerSheetController] Initialization error:", err);
      });
    }
  }

  async init() {
    this.sheet = document.getElementById(this.rootId);
    if (!this.sheet) {
      console.warn("[LayerSheetController] Layer panel element not found");
      return;
    }

    if (typeof layerRegistry !== "undefined") {
      await layerRegistry.init();
    }

    this.setupEventListeners();
    this.render();

    if (typeof OTEFDataContext !== "undefined") {
      OTEFDataContext.subscribe("layerGroups", () => this.render());
      OTEFDataContext.subscribe("animations", () => this.render());
    }

    if (typeof window !== "undefined") {
      window.addEventListener(LOCALE_EVENT, () => this.render());
    }
  }

  setupEventListeners() {
    const back = document.getElementById("layerPanelBack");
    if (back) {
      back.addEventListener("click", (e) => {
        e.preventDefault();
        this.clearLayerFocus();
      });
    }

    const content = this.sheet.querySelector(".sheet-content");
    if (!content) return;

    content.addEventListener("click", (e) => {
      const openBtn = e.target.closest("[data-layers-open-pack]");
      if (openBtn) {
        e.preventDefault();
        e.stopPropagation();
        const enc = openBtn.getAttribute("data-layers-open-pack");
        if (!enc) return;
        try {
          this.focusOnGroup(decodeURIComponent(enc));
        } catch {
          // ignore malformed
        }
        return;
      }

      const chip = e.target.closest("[data-animation-toggle]");
      if (!chip) return;
      e.preventDefault();
      e.stopPropagation();
      let ids = [];
      try {
        ids = JSON.parse(chip.getAttribute("data-animation-layer-ids") || "[]");
      } catch {
        ids = [];
      }
      if (!Array.isArray(ids) || ids.length === 0) return;
      const nextEnabled = !chip.classList.contains("active");
      this.toggleLayerRowAnimations(ids, nextEnabled);
    });

    content.addEventListener("change", (e) => {
      const t = e.target;
      if (!(t instanceof HTMLInputElement)) return;
      if (t.matches("input[data-layers-group-toggle]")) {
        e.stopPropagation();
        const enc = t.getAttribute("data-layers-enc-gid");
        if (enc == null) return;
        let gid = "";
        try {
          gid = decodeURIComponent(enc);
        } catch {
          return;
        }
        this.toggleGroupEnabled(gid, t.checked);
      }
    });
  }

  /**
   * Leaving Layers tab: mark sheet not open. Drill-down (`focusedGroupId`) is kept
   * so returning to Layers restores the same pack view; use Back in-panel for overview.
   */
  onLayersTabHidden() {
    this.isOpen = false;
  }

  open() {
    this.isOpen = true;
    this.render();
  }

  close() {
    this.isOpen = false;
  }

  focusOnGroup(groupId) {
    this.focusedGroupId = String(groupId);
    this.render();
  }

  clearLayerFocus() {
    this.focusedGroupId = null;
    this.render();
  }

  async toggleGroupEnabled(groupId, enabled) {
    if (typeof OTEFDataContext === "undefined") return;
    try {
      if (groupId === "curated_moresht_axis") {
        const ctxGroups = OTEFDataContext.getLayerGroups?.() || [];
        const curatedIds = [];
        for (const group of ctxGroups) {
          if (!group || typeof group.id !== "string") continue;
          if (!group.id.startsWith("curated")) continue;
          for (const layer of group.layers || []) {
            const fullIds =
              Array.isArray(layer.fullLayerIds) && layer.fullLayerIds.length > 0
                ? layer.fullLayerIds
                : [`${group.id}.${layer.id}`];
            curatedIds.push(...fullIds);
          }
        }
        const deduped = Array.from(new Set(curatedIds));
        if (deduped.length > 0) {
          const result = await OTEFDataContext.setLayersEnabled(deduped, enabled);
          if (!result || !result.ok) {
            console.error(
              `[LayerSheet] Failed to toggle curated group ${groupId}:`,
              result?.error,
            );
          }
          return;
        }
      }
      const result = await OTEFDataContext.toggleGroup(groupId, enabled);
      if (!result || !result.ok) {
        console.error(
          `[LayerSheet] Failed to toggle group ${groupId}:`,
          result?.error,
        );
      }
    } catch (err) {
      console.error(`[LayerSheet] Error toggling group ${groupId}:`, err);
    }
  }

  async toggleLayer(layerId, enabled) {
    if (typeof OTEFDataContext !== "undefined") {
      await OTEFDataContext.toggleLayer(layerId, enabled);
    }
  }

  async toggleLayerRow(fullLayerIds, enabled) {
    if (!Array.isArray(fullLayerIds)) return;
    if (fullLayerIds.length === 0) return;
    if (typeof OTEFDataContext !== "undefined") {
      await OTEFDataContext.setLayersEnabled(fullLayerIds, enabled);
    }
  }

  async toggleLayerRowAnimations(fullLayerIds, enabled) {
    if (!Array.isArray(fullLayerIds) || fullLayerIds.length === 0) return;
    if (typeof OTEFDataContext !== "undefined") {
      await OTEFDataContext.setLayerAnimations(fullLayerIds, enabled);
    }
  }

  /**
   * @returns {Array}
   */
  getEffectiveGroupsForView() {
    let groups = [];
    if (
      typeof LayerStateHelper !== "undefined" &&
      typeof LayerStateHelper.getEffectiveLayerGroups === "function"
    ) {
      groups = LayerStateHelper.getEffectiveLayerGroups();
    } else if (typeof layerRegistry !== "undefined" && layerRegistry._initialized) {
      groups = layerRegistry.getGroups();
      if (typeof OTEFDataContext !== "undefined") {
        const contextGroups = OTEFDataContext.getLayerGroups();
        if (contextGroups && contextGroups.length > 0) {
          const stateMap = new Map();
          for (const group of contextGroups) {
            stateMap.set(group.id, group);
          }
          groups = groups.map((group) => {
            const state = stateMap.get(group.id);
            if (state) {
              const layers = group.layers.map((layer) => {
                const layerState = state.layers?.find((l) => l.id === layer.id);
                return {
                  ...layer,
                  name: layerState?.displayName ?? layer.name,
                  enabled: layerState ? layerState.enabled : false,
                };
              });
              const enabled =
                group.id === "_legacy"
                  ? state.enabled
                  : layers.length > 0 && layers.every((l) => l.enabled);
              return { ...group, enabled, layers };
            }
            return group;
          });
          for (const cg of contextGroups) {
            if (groups.some((g) => g.id === cg.id)) continue;
            let displayName = cg.name || cg.id;
            if (!cg.name && cg.id.startsWith("curated_")) {
              displayName = cg.id.slice("curated_".length).replace(/_/g, " ");
            }
            groups.push({
              id: cg.id,
              name:
                (cg.name &&
                  typeof cg.name === "string" &&
                  cg.name.trim() !== "") ||
                (cg.id === "curated"
                  ? t("curatedGroupLabel")
                  : typeof cg.id === "string" && cg.id.startsWith("curated_")
                    ? cg.id.slice("curated_".length).replace(/_/g, " ").trim() ||
                      t("curatedGroupLabel")
                    : cg.id),
              enabled: cg.enabled,
              layers: (cg.layers || []).map((l) => ({
                id: l.id,
                name: l.displayName || l.id,
                enabled: l.enabled,
              })),
            });
          }
        }
      }
    }
    return groups;
  }

  /**
   * @param {object} group
   * @param {Record<string, boolean>} [animations]
   * @returns {string}
   */
  buildLayerRowsHtml(group, animations) {
    const anims = animations || {};
    const rows =
      group.id === "october_7th" || group.id === "curated_moresht_axis"
        ? groupLayersByNameForSheet(group.layers, group.id)
        : (group.layers || []).map((layer) => ({
            baseName: layer.name || layer.id,
            fullLayerIds:
              Array.isArray(layer.fullLayerIds) && layer.fullLayerIds.length > 0
                ? layer.fullLayerIds
                : [`${group.id}.${layer.id}`],
            layers: [layer],
            enabled: layer.enabled,
          }));
    return rows
      .map((row) => {
        const style = this.getLayerStylePreview(row.layers[0]);
        return renderLayerRow(row, {
          groupId: group.id,
          stylePreview: style,
          animations: anims,
        });
      })
      .join("");
  }

  getLayerStylePreview(layer) {
    if (!layer) {
      return {
        fillColor: "#808080",
        fillOpacity: 0.7,
        strokeColor: "#000000",
      };
    }
    if (layer.format === "image" || layer.geometryType === "image") {
      return {
        fillColor: "#4a90e2",
        fillOpacity: 0.8,
        strokeColor: "#2a5a8a",
      };
    }

    return {
      fillColor: "#808080",
      fillOpacity: 0.7,
      strokeColor: "#000000",
    };
  }

  /**
   * @param {object} group
   * @param {Record<string, boolean>} animations
   * @returns {string}
   */
  renderPackOverviewCard(group, animations) {
    const enabledLayers = (group.layers || []).filter((l) => l.enabled).length;
    const totalLayers = (group.layers || []).length;
    const packAnimatableLayerIds = (group.layers || [])
      .filter((layer) => isLayerAnimatable(layer, group.id))
      .map((layer) => `${group.id}.${layer.id}`);
    const packHasAnimatable = packAnimatableLayerIds.length > 0;
    const enabledPackAnimations = packHasAnimatable
      ? packAnimatableLayerIds.filter((id) => !!animations[id]).length
      : 0;
    const packAnimationEnabled = packHasAnimatable && enabledPackAnimations > 0;
    const packAnimationMixed =
      packHasAnimatable &&
      enabledPackAnimations > 0 &&
      enabledPackAnimations < packAnimatableLayerIds.length;
    const packAnimLayerIdsAttr = JSON.stringify(packAnimatableLayerIds).replace(
      /"/g,
      "&quot;",
    );
    const enc = encAttrId(group.id);
    return `
    <div class="layer-pack-card" data-group-id="${enc}">
      <div class="layer-pack-card__top">
        <span class="layer-pack-card__title">${escapeHtmlSafe(layerGroupTitle(group))}</span>
        <span class="group-count" aria-hidden="true">${enabledLayers}/${totalLayers}</span>
      </div>
      <div class="layer-pack-card__actions">
        ${
          packHasAnimatable
            ? `<button
                type="button"
                class="animation-chip ${packAnimationEnabled ? "active" : ""} ${packAnimationMixed ? "mixed" : ""}"
                data-animation-toggle
                data-animation-layer-ids="${packAnimLayerIdsAttr}"
              >${escapeHtmlSafe(t("flowLabel"))}</button>`
            : ""
        }
        <label class="group-toggle" onclick="event.stopPropagation()">
          <input
            type="checkbox"
            data-layers-group-toggle
            data-layers-enc-gid="${enc}"
            ${group.enabled ? "checked" : ""}
          />
          <span class="toggle-indicator"></span>
        </label>
        <button
          type="button"
          class="layer-pack-open"
          data-layers-open-pack="${enc}"
          data-i18n-aria="ariaLayersOpenPack"
        >${escapeHtmlSafe(t("layersOpenPack"))}</button>
      </div>
    </div>`;
  }

  /**
   * @param {object} group
   * @param {Record<string, boolean>} animations
   * @returns {string}
   */
  renderFocusedPack(group, animations) {
    const enabledLayers = (group.layers || []).filter((l) => l.enabled).length;
    const totalLayers = (group.layers || []).length;
    const packAnimatableLayerIds = (group.layers || [])
      .filter((layer) => isLayerAnimatable(layer, group.id))
      .map((layer) => `${group.id}.${layer.id}`);
    const packHasAnimatable = packAnimatableLayerIds.length > 0;
    const enabledPackAnimations = packHasAnimatable
      ? packAnimatableLayerIds.filter((id) => !!animations[id]).length
      : 0;
    const packAnimationEnabled = packHasAnimatable && enabledPackAnimations > 0;
    const packAnimationMixed =
      packHasAnimatable &&
      enabledPackAnimations > 0 &&
      enabledPackAnimations < packAnimatableLayerIds.length;
    const packAnimLayerIdsAttr = JSON.stringify(packAnimatableLayerIds).replace(
      /"/g,
      "&quot;",
    );

    return `
    <div class="layer-group layer-group--focus" data-group-id="${encAttrId(group.id)}">
      <div class="group-header group-header--focus">
        <div class="group-title-row">
          <span class="group-title">${escapeHtmlSafe(layerGroupTitle(group))}</span>
          <span class="group-count">${enabledLayers}/${totalLayers}</span>
        </div>
        <div class="group-controls">
          ${
            packHasAnimatable
              ? `<button
                  type="button"
                  class="animation-chip ${packAnimationEnabled ? "active" : ""} ${packAnimationMixed ? "mixed" : ""}"
                  data-animation-toggle
                  data-animation-layer-ids="${packAnimLayerIdsAttr}"
                >${escapeHtmlSafe(t("flowLabel"))}</button>`
              : ""
          }
          <label class="group-toggle" onclick="event.stopPropagation()">
            <input
              type="checkbox"
              data-layers-group-toggle
              data-layers-enc-gid="${encAttrId(group.id)}"
              ${group.enabled ? "checked" : ""}
            />
            <span class="toggle-indicator"></span>
          </label>
        </div>
      </div>
      <div class="group-layers group-layers--expanded">
        ${this.buildLayerRowsHtml(group, animations)}
      </div>
    </div>
  `;
  }

  updatePanelChrome(groups) {
    const totalEnabled = groups.reduce((sum, group) => {
      return sum + (group.layers || []).filter((l) => l.enabled).length;
    }, 0);

    const countEl = this.sheet.querySelector(".layer-count");
    if (countEl) {
      countEl.setAttribute("data-i18n-n", String(totalEnabled));
      countEl.textContent = formatActiveLayerCount(totalEnabled);
    }

    const back = document.getElementById("layerPanelBack");
    const titleEl = document.getElementById("layerPanelTitle");
    if (this.focusedGroupId) {
      if (back) back.hidden = false;
      const fg = groups.find((g) => g.id === this.focusedGroupId);
      if (titleEl && fg) {
        titleEl.removeAttribute("data-i18n");
        titleEl.textContent = layerGroupTitle(fg);
      } else if (titleEl) {
        titleEl.removeAttribute("data-i18n");
        titleEl.textContent = t("layerSheetTitle");
      }
    } else {
      if (back) back.hidden = true;
      if (titleEl) {
        titleEl.setAttribute("data-i18n", "layerSheetTitle");
      }
    }
  }

  render() {
    const content = this.sheet && this.sheet.querySelector(".sheet-content");
    if (!content) return;

    const groups = this.getEffectiveGroupsForView();
    this.updatePanelChrome(groups);

    const animations =
      typeof OTEFDataContext !== "undefined" &&
      typeof OTEFDataContext.getAnimations === "function"
        ? OTEFDataContext.getAnimations() || {}
        : {};

    if (this.focusedGroupId) {
      const group = groups.find((g) => g.id === this.focusedGroupId);
      if (!group) {
        this.focusedGroupId = null;
        this.render();
        return;
      }
      content.innerHTML = this.renderFocusedPack(group, animations);
    } else if (groups.length === 0) {
      content.innerHTML = `<div class="sheet-empty">${escapeHtmlSafe(t("layerEmpty"))}</div>`;
    } else {
      const cards = groups
        .map((g) => this.renderPackOverviewCard(g, animations))
        .join("");
      content.innerHTML = `<div class="layers-overview">${cards}</div>`;
    }
    applyRemoteChromeI18n();
  }
}

let layerSheetController = null;
if (typeof document !== "undefined" && typeof window !== "undefined") {
  layerSheetController = new LayerSheetController();
  window.layerSheetController = layerSheetController;
}

export {
  LayerSheetController,
  groupLayersByNameForSheet,
  isLayerAnimatable,
  renderLayerRow,
};
