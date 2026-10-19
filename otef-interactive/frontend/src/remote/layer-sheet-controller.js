/**
 * Layer list controller (Layers tab).
 */

import {
  normalizeLayerBaseName,
  parseLayerNameWithGeometrySuffix,
} from "../shared/layer-name-utils.js";
import { getLayerDisplayLabel } from "../shared/layer-display-glossary.js";
import {
  LOCALE_EVENT,
  applyRemoteChromeI18n,
  formatActiveLayerCount,
  getLocale,
  t,
} from "./remote-locale.js";
import { getPackDisplayLabel } from "../shared/legend-copy.js";
import { generateTraceId, recordTraceEvent } from "../shared/otef-trace.js";
import { usesRouteProgressOverlay } from "../shared/maplibre-flow-animation.js";
import {
  MORESHET_AXIS_GROUP_ID,
  PINK_LINE_ROUTE_FULL_LAYER_ID,
  PINK_LINE_ROUTE_LAYER_ID,
} from "../map-utils/curated-pink-axis-state.js";
import { renderLayerWorkspace, renderLegendChoices, renderVisibilityTile } from "./layer-sheet-view.js";

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
  if (groupId === "october_7th") {
    return row.layers
      .filter((layer) => {
        const fullId = `${groupId}.${layer.id}`;
        const cfg =
          typeof layerRegistry !== "undefined" &&
          layerRegistry &&
          typeof layerRegistry.getLayerConfig === "function"
            ? layerRegistry.getLayerConfig(fullId)
            : null;
        if (cfg && cfg.geometryType && cfg.geometryType !== "line") {
          return false;
        }
        return usesRouteProgressOverlay(fullId) || isLayerAnimatable(layer, groupId);
      })
      .map((layer) => `${groupId}.${layer.id}`);
  }
  return row.layers
    .filter((layer) => isLayerAnimatable(layer, groupId))
    .map((layer) => `${groupId}.${layer.id}`);
}

function layerGroupTitle(group) {
  const id = group && group.id;
  const name = group && group.name;
  if (id) {
    const packLabel = getPackDisplayLabel(String(id), getLocale());
    if (typeof packLabel === "string" && packLabel.trim() !== "") {
      return packLabel;
    }
  }
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

function isLegendSummaryEligible(group) {
  return !!(
    group &&
    group.id !== "nli" &&
    group.legend &&
    group.legend.summary &&
    group.legend.summary.label
  );
}

function mergeLegendMetadataFromRegistry(groups = [], registryGroups = []) {
  const registryById = new Map(
    registryGroups.map((group) => [String(group.id), group]),
  );
  return groups.map((group) => {
    const registryGroup = registryById.get(String(group.id));
    if (!registryGroup?.legend) return group;
    return {
      ...group,
      legend: {
        ...registryGroup.legend,
        ...(group.legend || {}),
      },
    };
  });
}

function renderLegendSummaryControl(group, summarizedGroupIds = []) {
  if (!isLegendSummaryEligible(group)) return "";
  const groupId = String(group.id);
  const checked = summarizedGroupIds.map(String).includes(groupId);
  return renderLegendChoices(groupId, checked);
}

function fullLayerIdsForGroup(group) {
  if (!group) return [];
  const ids = [];
  for (const layer of group.layers || []) {
    const fullIds =
      Array.isArray(layer.fullLayerIds) && layer.fullLayerIds.length > 0
        ? layer.fullLayerIds
        : [`${group.id}.${layer.id}`];
    ids.push(...fullIds);
  }
  return ids;
}

function isNliOwnedLayerId(fullId) {
  const id = String(fullId ?? "");
  return id === "nli" || id.startsWith("nli.");
}

function regularGroupsFrom(groups) {
  return (groups || []).filter((group) => group && group.id !== "nli");
}

function allowedRegularLayerIds(groups) {
  const allowed = new Set();
  for (const group of regularGroupsFrom(groups)) {
    for (const id of fullLayerIdsForGroup(group)) {
      if (!isNliOwnedLayerId(id)) allowed.add(String(id));
    }
  }
  return allowed;
}

function isPinkLineRouteSheetRow(row, groupId) {
  if (!row) return false;
  if (groupId && groupId !== MORESHET_AXIS_GROUP_ID) return false;
  if (
    Array.isArray(row.fullLayerIds) &&
    row.fullLayerIds.some((id) => String(id) === PINK_LINE_ROUTE_FULL_LAYER_ID)
  ) {
    return true;
  }
  return (row.layers || []).some(
    (layer) => layer && String(layer.id) === PINK_LINE_ROUTE_LAYER_ID,
  );
}

function orderMoreshetWorkshopSheetRows(rows) {
  if (!Array.isArray(rows) || rows.length === 0) return rows;
  const pink = [];
  const rest = [];
  for (const row of rows) {
    if (isPinkLineRouteSheetRow(row, MORESHET_AXIS_GROUP_ID)) {
      pink.push(row);
    } else {
      rest.push(row);
    }
  }
  return pink.concat(rest);
}

const HEB_RANGE_RE = /[\u0590-\u05FF]/;

function isLatinPrimaryString(s) {
  if (s == null) return false;
  const t = String(s);
  if (t.trim() === "") return false;
  return /[A-Za-z]/.test(t) && !HEB_RANGE_RE.test(t);
}

function pickRawLabelForRow(row, locale) {
  if (locale === "en" && row && Array.isArray(row.layers)) {
    for (const layer of row.layers) {
      if (!layer) continue;
      const candidates = [layer.displayName, layer.name].filter(
        (v) => v != null && String(v).trim() !== "",
      );
      for (const c of candidates) {
        if (isLatinPrimaryString(c)) {
          return String(c);
        }
      }
    }
  }
  return (
    row.displayLabel ??
    row.baseName ??
    row.layers[0]?.name ??
    row.layers[0]?.id ??
    ""
  );
}

function getRowDisplayLabelForSort(row) {
  const loc = getLocale();
  const rawLabel = pickRawLabelForRow(row, loc);
  return getLayerDisplayLabel(
    row.fullLayerIds && row.fullLayerIds[0] != null
      ? String(row.fullLayerIds[0])
      : "",
    loc,
    rawLabel,
    row.fullLayerIds,
  );
}

function layerIdsToPrimaryKey(fullLayerIds) {
  return Array.isArray(fullLayerIds) && fullLayerIds.length
    ? JSON.stringify([...fullLayerIds].map(String).sort()) : null;
}

function renderLayerRow(row, options = {}) {
  const groupId = options.groupId || "";
  const checked =
    row.enabled !== undefined ? row.enabled : row.layers.every((l) => l.enabled);
  const isPinkLineRow = isPinkLineRouteSheetRow(row, groupId);
  const rawLabel = pickRawLabelForRow(row, getLocale());
  const label = isPinkLineRow
    ? t("pinkLineLayerLabel")
    : getLayerDisplayLabel(
        row.fullLayerIds && row.fullLayerIds[0] != null
          ? String(row.fullLayerIds[0])
          : "",
        getLocale(),
        rawLabel,
        row.fullLayerIds,
      );
  const animatableIds = getRowAnimatableFullLayerIds(row, groupId);
  const hasAnimationToggle = groupId !== "nli" && animatableIds.length > 0;
  const animations = options.animations || {};
  const enabledAnimationCount = hasAnimationToggle
    ? animatableIds.filter((id) => !!animations[id]).length
    : 0;
  return renderVisibilityTile({
    label,
    enabled: checked,
    layerIds: row.fullLayerIds || [],
    animationIds: hasAnimationToggle ? animatableIds : [],
    animationVisibilityIds: row.fullLayerIds || [],
    animationEnabled: enabledAnimationCount > 0,
    animationMixed: enabledAnimationCount > 0 && enabledAnimationCount < animatableIds.length,
    pinkLine: isPinkLineRow,
  });
}

class LayerSheetController {
  constructor(options = {}) {
    this.rootId = options.rootId || "layerSheet";
    this.sheet = null;
    this.isOpen = false;
    this.focusedGroupId = null;
    this._subscriptions = [];
    this._remoteLocaleHandler = null;

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
      this._subscribeDataContext("layerGroups", () => this.render());
      this._subscribeDataContext("animations", () => this.render());
      this._subscribeDataContext("legendSettings", () => this.render());
    }

    if (typeof window !== "undefined") {
      this._remoteLocaleHandler = () => this.render();
      window.addEventListener(LOCALE_EVENT, this._remoteLocaleHandler);
    }
  }

  _subscribeDataContext(topic, handler) {
    if (
      typeof OTEFDataContext === "undefined" ||
      typeof OTEFDataContext.subscribe !== "function"
    ) return () => {};
    const unsubscribe = OTEFDataContext.subscribe(topic, handler);
    if (typeof unsubscribe === "function") this._subscriptions.push(unsubscribe);
    return unsubscribe;
  }

  destroy() {
    for (const unsubscribe of this._subscriptions.splice(0)) unsubscribe();
    if (typeof window !== "undefined" && this._remoteLocaleHandler) {
      window.removeEventListener(LOCALE_EVENT, this._remoteLocaleHandler);
    }
  }

  setupEventListeners() {
    const content = this.sheet.querySelector(".sheet-content");
    if (!content) return;

    content.addEventListener("click", (e) => {
      const selectPack = e.target.closest("[data-layers-select-pack]");
      if (selectPack) {
        e.preventDefault();
        e.stopPropagation();
        const enc = selectPack.getAttribute("data-layers-select-pack");
        if (!enc) return;
        try {
          this.focusOnGroup(decodeURIComponent(enc));
        } catch {
          // ignore malformed
        }
        return;
      }

      const bulkButton = e.target.closest("button[data-layers-bulk-visibility]");
      if (bulkButton) {
        const groupId = decodeURIComponent(bulkButton.getAttribute("data-layers-enc-gid") || "");
        bulkButton.disabled = true;
        void this.toggleGroupEnabled(groupId, bulkButton.getAttribute("data-enabled") === "true")
          .finally(() => this.render());
        return;
      }
      const legendButton = e.target.closest("button[data-legend-summary-group]");
      if (legendButton) {
        void this.setLegendGroupSummarized(
          legendButton.getAttribute("data-legend-summary-group"),
          legendButton.getAttribute("data-summary-enabled") === "true",
        ).finally(() => this.render());
        return;
      }

      const animBtn = e.target.closest("[data-animation-toggle]");
      if (animBtn) {
        e.preventDefault();
        e.stopPropagation();
        let ids = [];
        try {
          ids = JSON.parse(animBtn.getAttribute("data-animation-layer-ids") || "[]");
        } catch {
          ids = [];
        }
        if (!Array.isArray(ids) || ids.length === 0) return;
        let visibilityIds = [];
        try {
          visibilityIds = JSON.parse(
            animBtn.getAttribute("data-animation-visibility-ids") || "[]",
          );
        } catch {
          visibilityIds = [];
        }
        if (!Array.isArray(visibilityIds)) visibilityIds = [];
        const nextEnabled = !animBtn.classList.contains("active");
        void this.toggleLayerRowAnimations(ids, visibilityIds, nextEnabled);
        return;
      }

      const layerTile = e.target.closest(".layer-tile");
      if (layerTile) {
        e.preventDefault();
        void this.runLayerTileToggleFromElement(layerTile);
      }
    });

  }

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
    this.render();
  }

  _regularGroups() {
    return regularGroupsFrom(this.getEffectiveGroupsForView());
  }

  _allowedRegularLayerIds() {
    return allowedRegularLayerIds(this.getEffectiveGroupsForView());
  }

  async runLayerTileToggleFromElement(layerTile) {
    if (layerTile.classList.contains("layer-tile--locked")) return;
    const raw = layerTile.getAttribute("data-layer-ids") || "[]";
    let fullLayerIds = [];
    try {
      fullLayerIds = JSON.parse(raw);
    } catch {
      return;
    }
    if (!Array.isArray(fullLayerIds) || fullLayerIds.length === 0) return;
    const isOn = layerTile.classList.contains("is-on");
    const traceId = generateTraceId("layer");
    recordTraceEvent(traceId, "remote.layer_toggle_click", {
      fullLayerIds,
      nextEnabled: !isOn,
    });
    const result = await this.toggleLayerRow(fullLayerIds, !isOn, { traceId });
    if (!result || !result.ok) return;
    this.render();
  }

  async toggleGroupEnabled(groupId, enabled) {
    if (typeof OTEFDataContext === "undefined") return;
    try {
      const groups = this._regularGroups();
      const group = groups.find((g) => g && g.id === groupId);
      if (!group) return;
      const allIds = fullLayerIdsForGroup(group).map(String);
      const allowed = this._allowedRegularLayerIds();
      const unlockedIds = allIds.filter((id) => allowed.has(id));
      if (unlockedIds.length < allIds.length) {
        if (unlockedIds.length === 0) return;
        const result = await OTEFDataContext.setLayersEnabled(unlockedIds, enabled);
        if (!result || !result.ok) {
          console.error(
            `[LayerSheet] Failed to toggle unlocked layers:`,
            result?.error,
          );
        }
        return;
      }
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
        const rawIds = Array.from(new Set(curatedIds.map(String)));
        const deduped = rawIds.filter((id) => !isNliOwnedLayerId(id));
        if (rawIds.length > 0 && deduped.length === 0) return;
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

  async setLegendGroupSummarized(groupId, summarized) {
    if (
      typeof OTEFDataContext === "undefined" ||
      typeof OTEFDataContext.setLegendSettings !== "function"
    ) return;
    const current = OTEFDataContext.getLegendSettings?.()?.summarizedGroupIds || [];
    const ids = new Set(current.map(String));
    if (summarized) ids.add(String(groupId));
    else ids.delete(String(groupId));
    await OTEFDataContext.setLegendSettings({ summarizedGroupIds: [...ids] });
  }

  async toggleLayerRow(fullLayerIds, enabled, options = {}) {
    if (!Array.isArray(fullLayerIds) || fullLayerIds.length === 0) {
      return { ok: false };
    }
    const allowed = this._allowedRegularLayerIds();
    const ids = fullLayerIds.map(String).filter((id) => allowed.has(id));
    if (ids.length === 0) return { ok: false };
    if (typeof OTEFDataContext !== "undefined") {
      return await OTEFDataContext.setLayersEnabled(ids, enabled, options);
    }
    return { ok: false };
  }

  async toggleLayerRowAnimations(animatableFullLayerIds, rowVisibilityFullLayerIds, enabled) {
    const context = typeof OTEFDataContext === "undefined" ? null : OTEFDataContext;
    const scope = context?.captureExperienceScope?.();
    const current = () => context?.isExperienceActive?.() !== false &&
      (!scope || context?.isExperienceScopeCurrent?.(scope) !== false);
    if (!current()) return;
    if (!Array.isArray(animatableFullLayerIds) || animatableFullLayerIds.length === 0) return;
    const allowed = this._allowedRegularLayerIds();
    const animIds = animatableFullLayerIds.map(String).filter((id) => allowed.has(id));
    if (animIds.length === 0) return;
    const visibilitySource =
      Array.isArray(rowVisibilityFullLayerIds) && rowVisibilityFullLayerIds.length > 0
        ? rowVisibilityFullLayerIds
        : animatableFullLayerIds;
    const visibility = visibilitySource.map(String).filter((id) => allowed.has(id));
    if (typeof OTEFDataContext !== "undefined") {
      if (enabled && visibility.length > 0) {
        const vis = await OTEFDataContext.setLayersEnabled(visibility, true);
        if (!vis || vis.ok === false || !current()) return;
      }
      if (!current()) return;
      await OTEFDataContext.setLayerAnimations(animIds, enabled);
      this.render();
    }
  }

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
    const registryGroups =
      typeof layerRegistry !== "undefined" &&
      typeof layerRegistry.getGroups === "function"
        ? layerRegistry.getGroups()
        : [];
    return mergeLegendMetadataFromRegistry(groups, registryGroups);
  }

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
    rows.sort((a, b) => {
      const la = getRowDisplayLabelForSort(a).length;
      const lb = getRowDisplayLabelForSort(b).length;
      if (la !== lb) return la - lb;
      const ka = layerIdsToPrimaryKey(a.fullLayerIds) || "";
      const kb = layerIdsToPrimaryKey(b.fullLayerIds) || "";
      return ka.localeCompare(kb);
    });
    const ordered =
      group.id === MORESHET_AXIS_GROUP_ID
        ? orderMoreshetWorkshopSheetRows(rows)
        : rows;
    return ordered
      .map((row) =>
        renderLayerRow(row, {
          groupId: group.id,
          animations: anims,
        }),
      )
      .join("");
  }

  resolveSelectedPackId(groups) {
    if (!groups || groups.length === 0) return null;
    if (
      this.focusedGroupId &&
      groups.some((g) => g.id === this.focusedGroupId)
    ) {
      return this.focusedGroupId;
    }
    return String(groups[0].id);
  }

  renderLayersTabContent(groups, animations) {
    const selected = groups.find((group) => String(group.id) === this.focusedGroupId);
    if (!selected) return `<div class="sheet-empty">${escapeHtmlSafe(t("layerEmpty"))}</div>`;
    const layers = selected.layers || [];
    const packs = groups.map((group) => ({
      id: String(group.id),
      title: layerGroupTitle(group),
      enabled: (group.layers || []).filter((layer) => layer.enabled).length,
      total: (group.layers || []).length,
    }));
    return renderLayerWorkspace({
      packs,
      selectedId: String(selected.id),
      selectedTitle: layerGroupTitle(selected),
      enabledCount: layers.filter((layer) => layer.enabled).length,
      totalCount: layers.length,
      allLayersOn: layers.length > 0 && layers.every((layer) => layer.enabled),
      rowsHtml: this.buildLayerRowsHtml(selected, animations),
      legendHtml: renderLegendSummaryControl(selected,
        typeof OTEFDataContext !== "undefined" ? OTEFDataContext.getLegendSettings?.()?.summarizedGroupIds || [] : []),
    });
  }

  updatePanelChrome(groups) {
    const totalEnabled = groups.reduce((sum, group) => {
      return sum + (group.layers || []).filter((l) => l.enabled).length;
    }, 0);

    const countEl = document.getElementById("layerPanelCount");
    if (countEl) {
      countEl.setAttribute("data-i18n-n", String(totalEnabled));
      countEl.textContent = formatActiveLayerCount(totalEnabled);
    }
  }

  render() {
    const content = this.sheet && this.sheet.querySelector(".sheet-content");
    if (!content) return;

    const groups = this._regularGroups();
    if (groups.length === 0) {
      this.focusedGroupId = null;
    } else {
      this.focusedGroupId = this.resolveSelectedPackId(groups);
    }

    const animations =
      typeof OTEFDataContext !== "undefined" &&
      typeof OTEFDataContext.getAnimations === "function"
        ? OTEFDataContext.getAnimations() || {}
        : {};

    if (groups.length === 0) {
      content.innerHTML = `
    <div class="layers-variant-c layers-variant-c--empty">
      <div class="layers-active-summary" role="status">
        <span
          class="layer-count"
          data-i18n="layersActiveCount"
          data-i18n-n="0"
          id="layerPanelCount"
        ></span>
      </div>
      <div class="sheet-empty">${escapeHtmlSafe(t("layerEmpty"))}</div>
    </div>`;
    } else {
      content.innerHTML = this.renderLayersTabContent(groups, animations);

    }

    this.updatePanelChrome(groups);
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
  isPinkLineRouteSheetRow,
  orderMoreshetWorkshopSheetRows,
  isLegendSummaryEligible,
  mergeLegendMetadataFromRegistry,
  renderLayerRow,
  renderLegendSummaryControl,
};
