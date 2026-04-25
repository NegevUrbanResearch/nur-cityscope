/**
 * Layer list controller (Layers tab)
 *
 * **Sharpened Variant C:** pack chip strip (single selection) + per-pack count on each chip +
 * one bulk-visibility control for the selected pack + tile grid (per-layer on/off, animation
 * icon button on tile only). Syncs with OTEFDataContext.
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
import { getPackDisplayLabel } from "./layer-pack-display-names.js";
import { sanitizeCssColor } from "../curation/curation-color-utils.js";
import { createCurationApi } from "../curation/curation-api.js";
import { buildCurationColorSwatchHtml } from "../curation/curation-submissions.js";
import { generateTraceId, recordTraceEvent } from "../shared/otef-trace.js";

const workshopSubmissionColorById = new Map();
const workshopSubmissionColorByName = new Map();
let workshopSubmissionColorsLoaded = false;
let workshopSubmissionColorsLoading = null;

function normSubmissionKey(v) {
  return String(v ?? "").trim().toLowerCase();
}

async function ensureWorkshopSubmissionColorsLoaded() {
  if (workshopSubmissionColorsLoaded) return;
  if (workshopSubmissionColorsLoading) {
    await workshopSubmissionColorsLoading;
    return;
  }
  workshopSubmissionColorsLoading = (async () => {
    try {
      const API = createCurationApi();
      const list = await API.submissionsAll();
      workshopSubmissionColorById.clear();
      workshopSubmissionColorByName.clear();
      for (const item of Array.isArray(list) ? list : []) {
        if (!item || typeof item !== "object") continue;
        const idKey = normSubmissionKey(item.id ?? item.submission_id);
        const nameKey = normSubmissionKey(item.name);
        const rawColor =
          item.submission_color ??
          item.submissionColor ??
          item.display_color ??
          item.displayColor ??
          item.color;
        const css = sanitizeCssColor(rawColor);
        if (!css) continue;
        if (idKey) workshopSubmissionColorById.set(idKey, css);
        if (nameKey) workshopSubmissionColorByName.set(nameKey, css);
      }
      workshopSubmissionColorsLoaded = true;
    } catch {
      // Keep empty maps on failure; layer tiles will still use direct metadata colors.
    } finally {
      workshopSubmissionColorsLoading = null;
    }
  })();
  await workshopSubmissionColorsLoading;
}

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

const HEB_RANGE_RE = /[\u0590-\u05FF]/;

/**
 * @param {unknown} s
 * @returns {boolean}
 */
function isLatinPrimaryString(s) {
  if (s == null) return false;
  const t = String(s);
  if (t.trim() === "") return false;
  return /[A-Za-z]/.test(t) && !HEB_RANGE_RE.test(t);
}

/**
 * Raw label for glossary resolution: English UI prefers a Latin-primary name from
 * `row.layers` when the row-level label is Hebrew-only; Hebrew UI keeps row-level
 * precedence for Hebrew-friendly copy.
 *
 * @param {object} row
 * @param {"he" | "en"} locale
 * @returns {string}
 */
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

/**
 * Label string used for `renderLayerRow` (sorting tile order by length).
 * @param {object} row
 * @returns {string}
 */
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

/**
 * Stable key for comparing tile identity (order-independent).
 * @param {string[] | undefined} fullLayerIds
 * @returns {string | null}
 */
function layerIdsToPrimaryKey(fullLayerIds) {
  if (!Array.isArray(fullLayerIds) || fullLayerIds.length === 0) return null;
  return JSON.stringify([...fullLayerIds].map(String).sort());
}

/**
 * Decorative workshop tile swatch: first sanitized color on the row's layers.
 * Tries explicit API fields, then registry/Leaflet-style hints, then nested metadata.
 * If still missing, attempts lookup from submissions API cache (same source used by workshop page).
 *
 * @param {object} row
 * @param {string} [groupId]
 * @returns {string | null}
 */
function pickWorkshopRowSwatchCssColor(row, groupId) {
  if (!row || !Array.isArray(row.layers)) return null;
  const tryValue = (v) => {
    const css = sanitizeCssColor(v);
    return css || null;
  };
  for (const layer of row.layers) {
    if (!layer || typeof layer !== "object") continue;
    const direct =
      layer.submissionColor ??
      layer.displayColor ??
      layer.submission_color ??
      layer.display_color ??
      layer.color ??
      layer.fillColor ??
      layer.strokeColor;
    const fromDirect = tryValue(direct);
    if (fromDirect) return fromDirect;

    const style = layer.style;
    if (style && typeof style === "object") {
      for (const sk of ["fillColor", "color", "fill", "stroke"]) {
        const v = style[sk];
        if (typeof v !== "string") continue;
        const css = tryValue(v);
        if (css) return css;
      }
    }

    const meta = layer.metadata;
    if (meta && typeof meta === "object") {
      for (const mk of [
        "display_color",
        "submissionColor",
        "displayColor",
        "color",
        "primaryColor",
      ]) {
        const css = tryValue(meta[mk]);
        if (css) return css;
      }
    }

    const props = layer.properties;
    if (props && typeof props === "object") {
      const css = tryValue(props.display_color ?? props.displayColor);
      if (css) return css;
    }
  }

  const gid = String(groupId || "");
  if (gid !== "curated_moresht_axis") return null;
  for (const layer of row.layers) {
    if (!layer || typeof layer !== "object") continue;
    const idKey = normSubmissionKey(layer.submissionId ?? layer.submission_id ?? layer.id);
    if (idKey && workshopSubmissionColorById.has(idKey)) {
      return workshopSubmissionColorById.get(idKey) || null;
    }
    const nameCandidates = [layer.displayName, layer.name, row.displayLabel];
    for (const candidate of nameCandidates) {
      const nk = normSubmissionKey(candidate);
      if (!nk) continue;
      if (workshopSubmissionColorByName.has(nk)) {
        return workshopSubmissionColorByName.get(nk) || null;
      }
    }
  }
  return null;
}

function renderLayerRow(row, options = {}) {
  const groupId = options.groupId || "";
  const checked =
    row.enabled !== undefined ? row.enabled : row.layers.every((l) => l.enabled);
  const layerIdsAttr = JSON.stringify(row.fullLayerIds || []).replace(
    /"/g,
    "&quot;",
  );
  const rawLabel = pickRawLabelForRow(row, getLocale());
  const label = getLayerDisplayLabel(
    row.fullLayerIds && row.fullLayerIds[0] != null
      ? String(row.fullLayerIds[0])
      : "",
    getLocale(),
    rawLabel,
    row.fullLayerIds,
  );
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

  const stateClass = checked ? "is-on" : "is-off";
  const rowKey = layerIdsToPrimaryKey(row.fullLayerIds);
  const isPrimary =
    checked &&
    options.primaryTileIdsJson != null &&
    rowKey === options.primaryTileIdsJson;
  const primaryClass = isPrimary ? " layer-tile--primary" : "";
  const visibleClass =
    checked && !isPrimary ? " is-visible" : "";
  const animTileClass = hasAnimationToggle ? " layer-tile--anim" : "";
  const animStateClass = `${animationEnabled ? "active" : ""} ${
    animationMixed ? "mixed" : ""
  }`.trim();
  const playIcon = `<svg class="anim-btn__glyph" width="18" height="18" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path fill="currentColor" d="M8 5v14l11-7z"/></svg>`;
  const animControl = hasAnimationToggle
    ? `<button
        type="button"
        class="anim-btn ${animStateClass}"
        data-animation-toggle
        data-animation-layer-ids="${animIdsAttr}"
        data-i18n-aria="ariaLayerAnimationToggle"
      >${playIcon}</button>`
    : "";
  let workshopSwatch = "";
  if (groupId === "curated_moresht_axis") {
    const swatchCss = pickWorkshopRowSwatchCssColor(row, groupId);
    if (swatchCss) {
      workshopSwatch = buildCurationColorSwatchHtml(
        swatchCss,
        "layer-tile__swatch curation-published-layer-swatch",
      );
    }
  }
  return `
    <div
      class="layer-tile ${stateClass}${visibleClass}${primaryClass}${animTileClass}"
      role="button"
      tabindex="0"
      aria-pressed="${checked ? "true" : "false"}"
      aria-label="${escapeHtmlSafe(label)}"
      data-layer-ids="${layerIdsAttr}"
    >
      ${workshopSwatch}<span class="layer-tile__label">${escapeHtmlSafe(label)}</span>
      ${animControl}
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
    /** @type {string | null} last-focused tile in focused pack (sorted `fullLayerIds` JSON) */
    this.primaryTileIdsJson = null;

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
    void ensureWorkshopSubmissionColorsLoaded().then(() => {
      this.render();
    });

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
    const content = this.sheet.querySelector(".sheet-content");
    if (!content) return;

    content.addEventListener("keydown", (e) => {
      if (e.key !== "Enter" && e.key !== " ") return;
      if (!(e.target instanceof Element) || !e.target.matches(".layer-tile")) {
        return;
      }
      e.preventDefault();
      void this.runLayerTileToggleFromElement(e.target);
    });

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
        const nextEnabled = !animBtn.classList.contains("active");
        this.toggleLayerRowAnimations(ids, nextEnabled);
        return;
      }

      const layerTile = e.target.closest(".layer-tile");
      if (layerTile) {
        e.preventDefault();
        void this.runLayerTileToggleFromElement(layerTile);
      }
    });

    content.addEventListener("change", (e) => {
      const t = e.target;
      if (!(t instanceof HTMLInputElement)) return;
      if (t.matches("input[data-layers-bulk-visibility]")) {
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
   * Leaving Layers tab: mark sheet not open. Selected pack (`focusedGroupId`) is kept
   * so returning to Layers restores the same strip + grid state.
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
    this.primaryTileIdsJson = null;
    this.focusedGroupId = String(groupId);
    this.render();
  }

  /**
   * Drop primary-tile highlight (`primaryTileIdsJson`). Does not change the selected
   * pack; `render()` keeps a valid pack via `resolveSelectedPackId`.
   * (Previously wired to #layerPanelBack; that control was removed — kept for API use.)
   */
  clearLayerFocus() {
    this.primaryTileIdsJson = null;
    this.render();
  }

  /**
   * @param {Element} layerTile
   */
  async runLayerTileToggleFromElement(layerTile) {
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
    const key = layerIdsToPrimaryKey(fullLayerIds);
    if (!isOn) {
      this.primaryTileIdsJson = key;
    } else if (this.primaryTileIdsJson === key) {
      this.primaryTileIdsJson = null;
    }
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

  async toggleLayerRow(fullLayerIds, enabled, options = {}) {
    if (!Array.isArray(fullLayerIds) || fullLayerIds.length === 0) {
      return { ok: false };
    }
    if (typeof OTEFDataContext !== "undefined") {
      return await OTEFDataContext.setLayersEnabled(fullLayerIds, enabled, options);
    }
    return { ok: false };
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
    rows.sort((a, b) => {
      const la = getRowDisplayLabelForSort(a).length;
      const lb = getRowDisplayLabelForSort(b).length;
      if (la !== lb) return la - lb;
      const ka = layerIdsToPrimaryKey(a.fullLayerIds) || "";
      const kb = layerIdsToPrimaryKey(b.fullLayerIds) || "";
      return ka.localeCompare(kb);
    });
    return rows
      .map((row) =>
        renderLayerRow(row, {
          groupId: group.id,
          animations: anims,
          primaryTileIdsJson: this.primaryTileIdsJson,
        }),
      )
      .join("");
  }

  /**
   * @param {Array} groups
   * @returns {string | null}
   */
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

  /**
   * @param {Array} groups
   * @param {Record<string, boolean>} animations
   * @returns {string}
   */
  renderLayersTabContent(groups, animations) {
    const selectedId = this.focusedGroupId;
    const selected = groups.find((g) => g.id === selectedId);
    if (!selected) {
      return `<div class="sheet-empty">${escapeHtmlSafe(t("layerEmpty"))}</div>`;
    }
    const encGid = encAttrId(selected.id);
    const allLayersOn =
      (selected.layers || []).length > 0 &&
      (selected.layers || []).every((l) => l.enabled);

    const chipForGroup = (g) => {
      const enc = encAttrId(g.id);
      const isSel = g.id === selectedId;
      const currentAttr = isSel ? ' aria-current="true"' : "";
      const en = (g.layers || []).filter((l) => l.enabled).length;
      const to = (g.layers || []).length;
      const countStr = t("layersPackActiveCount", { e: en, t: to });
      const title = layerGroupTitle(g);
      return `<button
          type="button"
          class="pack-chip${isSel ? " pack-chip--selected" : ""}"
          data-layers-select-pack="${enc}"${currentAttr}
        >${escapeHtmlSafe(title)}<span class="group-count">${escapeHtmlSafe(countStr)}</span></button>`;
    };
    const mid = Math.ceil(groups.length / 2);
    const row1 = groups.slice(0, mid).map(chipForGroup).join("");
    const row2 = groups.slice(mid).map(chipForGroup).join("");

    return `
    <div class="layers-variant-c">
      <div
        class="layers-pack-strip-wrap"
        role="region"
      >
        <div class="layers-pack-strip">
          <div class="layers-pack-strip__viewport">
            <div class="layers-pack-strip__edge layers-pack-strip__edge--start" aria-hidden="true"></div>
            <div class="layers-pack-strip__edge layers-pack-strip__edge--end" aria-hidden="true"></div>
            <div class="layers-pack-strip__scroller">
              <div class="layers-pack-strip__band">
                <div class="layers-pack-strip__row">${row1}</div>
                <div class="layers-pack-strip__row">${row2}</div>
              </div>
            </div>
          </div>
        </div>
      </div>
      <div class="layers-active-summary" role="status">
        <span
          class="layer-count"
          data-i18n="layersActiveCount"
          data-i18n-n="0"
          id="layerPanelCount"
        ></span>
      </div>
      <div class="focused-pack-toolbar">
        <span class="focused-pack-toolbar__label" data-i18n="layersBulkVisibility">${escapeHtmlSafe(t("layersBulkVisibility"))}</span>
        <label class="group-toggle layer-bulk-visibility">
          <input
            type="checkbox"
            data-layers-bulk-visibility
            data-layers-enc-gid="${encGid}"
            data-i18n-aria="ariaLayersBulkVisibility"
            ${allLayersOn ? "checked" : ""}
          />
          <span class="toggle-indicator"></span>
        </label>
      </div>
      <div class="group-layers group-layers--expanded group-layers--tiles">
        <div class="layer-tile-grid">
        ${this.buildLayerRowsHtml(selected, animations)}
        </div>
      </div>
    </div>
  `;
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

    const groups = this.getEffectiveGroupsForView();
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
      const selectedId = this.focusedGroupId;
      const selected = groups.find((g) => g.id === selectedId);
      if (selected) {
        const layers = selected.layers || [];
        const anyOn = layers.some((l) => l.enabled);
        const anyOff = layers.some((l) => !l.enabled);
        const bulkInput = content.querySelector("input[data-layers-bulk-visibility]");
        if (bulkInput instanceof HTMLInputElement) {
          bulkInput.indeterminate = anyOn && anyOff;
        }
      }
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
  renderLayerRow,
};
