import { MapProjectionConfig } from "../shared/map-projection-config.js";
import { stopNliClock } from "../shared/nli-investigation-clock.js";
import OTEFDataContext from "../shared/OTEFDataContext.js";
import { getPackDisplayLabel } from "../shared/legend-copy.js";
import { LOCALE_EVENT, applyRemoteChromeI18n, getLocale, t } from "./remote-locale.js";
import { createSlideshowSettingsPersistence } from "./slideshow-settings-persistence.js";

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * @param {unknown} raw
 * @returns {number | null}
 */
function parseOptionalNonNegativeNumber(raw) {
  if (raw == null || String(raw).trim() === "") return null;
  const n = Number(raw);
  if (!Number.isFinite(n)) return null;
  return Math.max(0, n);
}

/**
 * @param {Array<{ id?: string, name?: string }>} groups
 * @returns {{ id: string, label: string }[]}
 */
function toPackList(groups) {
  const out = [];
  for (const group of Array.isArray(groups) ? groups : []) {
    const id = String(group?.id || "").trim();
    if (!id) continue;
    out.push({
      id,
      label: String(group?.name || group?.id || id).trim() || id,
    });
  }
  return out;
}

/**
 * Drops packs that must not appear in the remote reorder list / slideshow UI.
 * @param {Array<{ id: string, label?: string }>} packs
 * @param {string[] | undefined} excludedPresentationPackIds
 * @returns {Array<{ id: string, label: string }>}
 */
function filterExcludedPresentationPacks(packs, excludedPresentationPackIds) {
  const excluded = new Set(
    ["nli", ...(Array.isArray(excludedPresentationPackIds) ? excludedPresentationPackIds : [])]
  );
  return packs.filter((p) => p?.id && !excluded.has(String(p.id)));
}

/**
 * Prefer the Layers-tab Hebrew/English pack title; fall back to registry/API name or id.
 * @param {string} packId
 * @param {string} [fallbackLabel]
 * @returns {string}
 */
function resolveSlideshowPackLabel(packId, fallbackLabel) {
  const translated = getPackDisplayLabel(packId, getLocale());
  if (typeof translated === "string" && translated.trim() !== "") {
    return translated;
  }
  const fallback = String(fallbackLabel || packId).trim();
  return fallback || String(packId);
}

class SlideshowTabController {
  constructor(options = {}) {
    this.rootId = options.rootId || "remoteSlideshowHost";
    this.root = null;
    this.isOpen = false;
    this.running = false;
    this.packOrder = [];
    this.availablePacks = [];
    this.bound = false;
    this.settingsKey = null;
    this.savedTimings = {};
    this.settingsError = false;
    this.settingsPersistence = createSlideshowSettingsPersistence({
      save: (settings, scope) => OTEFDataContext.saveRegularSlideshowSettings(settings, { experienceScope: scope }),
      captureScope: () => OTEFDataContext.captureExperienceScope?.(),
      isCurrent: scope => OTEFDataContext.isExperienceActive?.() !== false && OTEFDataContext.isExperienceScopeCurrent?.(scope) !== false,
      onError: () => { this.settingsError = true; this.renderSettingsStatus(); },
      onSaved: settings => { this.settingsError = false; this.settingsKey = JSON.stringify(settings); this.renderSettingsStatus(); },
    });
    this.keepSettlementNames =
      MapProjectionConfig?.PROJECTION_SLIDESHOW?.keepSettlementNames !== false;
  }

  open() {
    this.isOpen = true;
    this.render();
  }

  onSlideshowTabHidden() {
    this.isOpen = false;
  }

  resolvePackSources() {
    let registryGroups = [];
    if (
      typeof layerRegistry !== "undefined" &&
      layerRegistry &&
      typeof layerRegistry.getGroups === "function"
    ) {
      registryGroups = toPackList(layerRegistry.getGroups());
    }

    let contextGroups = [];
    if (
      typeof OTEFDataContext !== "undefined" &&
      OTEFDataContext &&
      typeof OTEFDataContext.getLayerGroups === "function"
    ) {
      contextGroups = toPackList(OTEFDataContext.getLayerGroups());
    }

    const byId = new Map();
    for (const pack of registryGroups) byId.set(pack.id, pack);
    for (const pack of contextGroups) {
      if (!byId.has(pack.id)) {
        byId.set(pack.id, pack);
        continue;
      }
      const existing = byId.get(pack.id);
      byId.set(pack.id, {
        id: pack.id,
        label: pack.label || existing.label || pack.id,
      });
    }
    const merged = Array.from(byId.values());
    return filterExcludedPresentationPacks(
      merged,
      MapProjectionConfig?.PROJECTION_SLIDESHOW?.excludedPresentationPackIds
    );
  }

  ensurePackOrder() {
    this.availablePacks = filterExcludedPresentationPacks(
      this.resolvePackSources(), MapProjectionConfig?.PROJECTION_SLIDESHOW?.excludedPresentationPackIds,
    );
    const availableIds = this.availablePacks.map((pack) => pack.id);
    const excluded = new Set(
      Array.isArray(MapProjectionConfig?.PROJECTION_SLIDESHOW?.excludedPresentationPackIds)
        ? MapProjectionConfig.PROJECTION_SLIDESHOW.excludedPresentationPackIds.map((id) =>
            String(id)
          )
        : []
    );
    const configured = Array.isArray(MapProjectionConfig?.PROJECTION_SLIDESHOW?.packOrder)
      ? MapProjectionConfig.PROJECTION_SLIDESHOW.packOrder.map((id) => String(id))
      : [];

    const preferred = this.packOrder.length > 0 ? this.packOrder : configured;
    const valid = preferred.filter(
      (id) => availableIds.includes(id) && !excluded.has(id)
    );
    const deduped = Array.from(new Set(valid));
    const remaining = availableIds.filter(
      (id) => !deduped.includes(id) && !excluded.has(id)
    );
    this.packOrder = [...deduped, ...remaining];
  }

  hydrateSettings(snapshot) {
    if (this.settingsPersistence.hasPending()) return;
    const settings = snapshot?.regular_slideshow_settings;
    if (!settings || typeof settings !== "object") return;
    const key = JSON.stringify(settings);
    if (key === this.settingsKey) return;
    this.settingsKey = key;
    if (Array.isArray(settings.packOrder)) this.packOrder = settings.packOrder.map(String);
    for (const name of ["intervalMs", "crossfadeMs", "warmupLeadMs"]) {
      const value = parseOptionalNonNegativeNumber(settings[name]);
      if (value !== null) this.savedTimings[name] = value;
    }
    if (typeof settings.keepSettlementNames === "boolean") this.keepSettlementNames = settings.keepSettlementNames;
    this.ensurePackOrder();
  }

  movePack(fromIndex, direction) {
    const toIndex = fromIndex + direction;
    if (toIndex < 0 || toIndex >= this.packOrder.length) return;
    const next = [...this.packOrder];
    const [item] = next.splice(fromIndex, 1);
    next.splice(toIndex, 0, item);
    this.packOrder = next;
    this.scheduleSettingsSave();
    this.render();
  }

  scheduleSettingsSave() {
    if (!OTEFDataContext.getExperienceState?.()) return;
    this.settingsError = false;
    this.settingsPersistence.schedule(this.buildStartPayload());
    this.renderSettingsStatus();
  }

  flushSettings() { return this.settingsPersistence.flush(); }

  renderSettingsStatus() {
    const status = this.root?.querySelector?.("[data-slideshow-settings-status]");
    if (status) status.hidden = !this.settingsError;
  }

  readKeepSettlementNames() {
    const input = this.root?.querySelector("[data-slideshow-keep-settlement-names]");
    if (input && "checked" in input) {
      this.keepSettlementNames = !!input.checked;
    }
    return this.keepSettlementNames !== false;
  }

  buildStartPayload() {
    const cfg = MapProjectionConfig?.PROJECTION_SLIDESHOW || {};
    const intervalSec = this.readNumberInput(
      "slideshowIntervalSec",
      (this.savedTimings.intervalMs ?? cfg.intervalMs ?? 10000) / 1000,
    );
    const crossfadeSec = this.readNumberInput(
      "slideshowCrossfadeSec",
      (this.savedTimings.crossfadeMs ?? cfg.crossfadeMs ?? 1200) / 1000,
    );
    const warmupSec = this.readNumberInput(
      "slideshowWarmupLeadSec",
      (this.savedTimings.warmupLeadMs ?? cfg.warmupLeadMs ?? 2500) / 1000,
    );
    return {
      packOrder: [...this.packOrder],
      intervalMs: Math.max(1, Math.round(intervalSec * 1000)),
      crossfadeMs: Math.max(0, Math.round(crossfadeSec * 1000)),
      warmupLeadMs: Math.max(0, Math.round(warmupSec * 1000)),
      keepSettlementNames: this.readKeepSettlementNames(),
    };
  }

  readNumberInput(id, fallback) {
    const input = this.root?.querySelector(`#${id}`);
    const parsed = parseOptionalNonNegativeNumber(input?.value);
    return parsed == null ? fallback : parsed;
  }

  isNarrativeActive() {
    return !!OTEFDataContext.getNarrativeState?.()?.id;
  }

  setStatus(messageKey) {
    const status = this.root?.querySelector?.("[data-slideshow-status]");
    if (status) status.textContent = t(messageKey);
  }

  async startSlideshow(payload) {
    if (this.isNarrativeActive()) {
      this.setStatus("slideshowNarrativeDisabled");
      return false;
    }
    try {
      // Legacy servers have no experience activation to clear their NLI transport.
      if (!OTEFDataContext.getExperienceState?.()) {
        await OTEFDataContext.patchInvestigationClock(
          stopNliClock(OTEFDataContext.getInvestigationClock()),
        );
      }
      if (this.isNarrativeActive()) {
        this.setStatus("slideshowNarrativeDisabled");
        return false;
      }
      await OTEFDataContext.patchProjectionSlideshow({ type: "start", payload });
      return true;
    } catch {
      this.setStatus("slideshowStartFailed");
      return false;
    }
  }

  async handleStart() {
    if (this.isNarrativeActive()) {
      this.setStatus("slideshowNarrativeDisabled");
      return;
    }
    this.ensurePackOrder();
    if (this.packOrder.length === 0) {
      const status = this.root?.querySelector("[data-slideshow-status]");
      if (status) {
        status.textContent = t("slideshowNoPacks");
      }
      return;
    }
    try { await this.flushSettings(); } catch { return; }
    const started = await this.startSlideshow(this.buildStartPayload());
    if (!started) return;
    this.running = true;
    this.renderStatusOnly();
  }

  async handleKeepSettlementNamesChange() {
    const keepOn = this.readKeepSettlementNames();
    this.scheduleSettingsSave();
    if (!this.running) {
      return;
    }
    this.ensurePackOrder();
    if (this.packOrder.length === 0) {
      return;
    }
    await this.startSlideshow({ ...this.buildStartPayload(), keepSettlementNames: keepOn });
  }

  async handleStop() {
    await OTEFDataContext.patchProjectionSlideshow({ type: "stop", payload: {} });
    this.running = false;
    this.renderStatusOnly();
  }

  renderStatusOnly() {
    const status = this.root?.querySelector("[data-slideshow-status]");
    if (!status) return;
    status.textContent = this.running
      ? t("slideshowStatusRunning")
      : t("slideshowStatusIdle");
    const action = this.root?.querySelector("[data-slideshow-toggle]");
    if (action) {
      action.removeAttribute(this.running ? "data-slideshow-start" : "data-slideshow-stop");
      action.setAttribute(this.running ? "data-slideshow-stop" : "data-slideshow-start", "");
      action.textContent = t(this.running ? "slideshowStop" : "slideshowStart");
      action.disabled = !this.running && this.isNarrativeActive();
    }
    this.root?.querySelectorAll?.("[data-pack-move]").forEach((button) => {
      const index = Number(button.getAttribute("data-pack-index"));
      button.disabled = this.running || (button.getAttribute("data-pack-move") === "up" ? index === 0 : index === this.packOrder.length - 1);
    });
  }

  bindEvents() {
    if (!this.root || this.bound) return;
    this.bound = true;

    this.root.addEventListener("click", (event) => {
      const target = event.target instanceof Element ? event.target : null;
      if (!target) return;

      const moveBtn = target.closest("[data-pack-move]");
      if (moveBtn) {
        const idx = Number(moveBtn.getAttribute("data-pack-index"));
        const direction = moveBtn.getAttribute("data-pack-move") === "up" ? -1 : 1;
        if (Number.isInteger(idx)) this.movePack(idx, direction);
        return;
      }

      if (target.closest("[data-slideshow-settings-retry]")) {
        void this.settingsPersistence.retry().catch(() => {});
        return;
      }

      if (target.closest("[data-slideshow-start]")) {
        void this.handleStart();
        return;
      }

      if (target.closest("[data-slideshow-stop]")) {
        void this.handleStop();
      }
    });

    this.root.addEventListener("change", (event) => {
      const target = event.target instanceof Element ? event.target : null;
      const timingKey = { slideshowIntervalSec: "intervalMs", slideshowCrossfadeSec: "crossfadeMs", slideshowWarmupLeadSec: "warmupLeadMs" }[target?.id];
      if (timingKey) {
        const value = parseOptionalNonNegativeNumber(target.value);
        if (value !== null) this.savedTimings[timingKey] = Math.round(value * 1000);
        this.scheduleSettingsSave();
        return;
      }
      if (!target?.closest?.("[data-slideshow-keep-settlement-names]")) {
        return;
      }
      void this.handleKeepSettlementNamesChange();
    });

    if (typeof window !== "undefined") {
      window.addEventListener(LOCALE_EVENT, () => {
        if (this.isOpen) this.render();
      });
    }
  }

  render() {
    if (!this.root) return;
    this.ensurePackOrder();

    const packNameById = new Map(this.availablePacks.map((pack) => [pack.id, pack.label]));
    const cfg = MapProjectionConfig?.PROJECTION_SLIDESHOW || {};
    const packListHeadingId = "slideshowPackListHeading";
    const narrativeActive = this.isNarrativeActive();
    const packListMarkup =
      this.packOrder.length === 0
        ? `<div class="sheet-empty slideshow-pack-empty" role="status">${escapeHtml(
            t("layerEmpty"),
          )}</div>`
        : `<ul class="slideshow-pack-list" aria-labelledby="${packListHeadingId}">${this.packOrder
            .map((packId, index) => {
              const label = resolveSlideshowPackLabel(packId, packNameById.get(packId));
              const disableUp = this.running || index === 0 ? "disabled" : "";
              const disableDown = this.running || index === this.packOrder.length - 1 ? "disabled" : "";
              return `<li class="slideshow-pack-row">
                <span class="slideshow-pack-row__number">${index + 1}</span>
                <span class="slideshow-pack-row__label">${escapeHtml(label)}</span>
                <div class="slideshow-pack-row__actions">
                  <button type="button" class="slideshow-pack-row__btn" data-pack-move="up" data-pack-index="${index}" data-i18n-aria="ariaSlideshowMoveUp" aria-label="${escapeHtml(t("ariaSlideshowMoveUp"))}" ${disableUp}>↑</button>
                  <button type="button" class="slideshow-pack-row__btn" data-pack-move="down" data-pack-index="${index}" data-i18n-aria="ariaSlideshowMoveDown" aria-label="${escapeHtml(t("ariaSlideshowMoveDown"))}" ${disableDown}>↓</button>
                </div>
              </li>`;
            })
            .join("")}</ul>`;

    const timingFields = [
      ["slideshowIntervalSec", "slideshowIntervalSecLabel", "slideshowIntervalSecShort", this.savedTimings.intervalMs ?? cfg.intervalMs ?? 10000],
      ["slideshowCrossfadeSec", "slideshowCrossfadeSecLabel", "slideshowCrossfadeSecShort", this.savedTimings.crossfadeMs ?? cfg.crossfadeMs ?? 1200],
      ["slideshowWarmupLeadSec", "slideshowWarmupLeadSecLabel", "slideshowWarmupLeadSecShort", this.savedTimings.warmupLeadMs ?? cfg.warmupLeadMs ?? 2500],
    ];
    this.root.innerHTML = `
      <section class="control-section slideshow-control-section">
        <div class="slideshow-player">
          <div><h2>${escapeHtml(t(this.running ? "slideshowStatusRunning" : "slideshowReady"))}</h2>
          <p class="slideshow-status" data-slideshow-status role="status" aria-live="polite">${escapeHtml(t(narrativeActive ? "slideshowNarrativeDisabled" : this.running ? "slideshowStatusRunning" : "slideshowStatusIdle"))}</p></div>
          <div class="slideshow-actions"><button type="button" class="slideshow-actions__btn" data-slideshow-toggle ${this.running ? "data-slideshow-stop" : "data-slideshow-start"}${narrativeActive && !this.running ? " disabled" : ""}>${escapeHtml(t(this.running ? "slideshowStop" : "slideshowStart"))}</button></div>
        </div>
        <div data-slideshow-settings-status role="alert"${this.settingsError ? "" : " hidden"}>${escapeHtml(t("slideshowSettingsSaveFailed"))} <button type="button" data-slideshow-settings-retry>${escapeHtml(t("slideshowSettingsRetry"))}</button></div>
        <h2 id="${packListHeadingId}">${escapeHtml(t("slideshowOrder"))}</h2>
        ${packListMarkup}
        <details class="slideshow-settings"><summary>${escapeHtml(t("slideshowSettings"))}</summary>
          <div class="slideshow-input-grid">${timingFields.map(([id, label, shortLabel, value]) => `<label class="slideshow-field" title="${escapeHtml(t(label))}"><span class="slideshow-field__label">${escapeHtml(t(shortLabel))}</span><input id="${id}" type="number" min="0" step="0.1" value="${value / 1000}" data-i18n-aria="${label}" data-i18n-title="${label}" /></label>`).join("")}</div>
          <label class="slideshow-keep-names"><input type="checkbox" data-slideshow-keep-settlement-names data-i18n-aria="ariaSlideshowKeepSettlementNames" ${this.keepSettlementNames !== false ? "checked" : ""}><span class="toggle-label">${escapeHtml(t("slideshowKeepSettlementNames"))}</span></label>
        </details>
      </section>`;

    applyRemoteChromeI18n();
  }

  init() {
    this.root = document.getElementById(this.rootId);
    if (!this.root) return;
    this.bindEvents();
    this.hydrateSettings(OTEFDataContext.getExperienceState?.());
    this.running = OTEFDataContext.getProjectionSlideshow?.()?.type === "start";
    OTEFDataContext.subscribe?.("experienceState", (snapshot) => {
      this.hydrateSettings(snapshot);
      this.render();
    });
    OTEFDataContext.subscribe?.("projectionSlideshow", (slideshow) => {
      this.running = slideshow?.type === "start";
      this.render();
    });
    OTEFDataContext.subscribe?.("narrativeState", () => this.render());
    this.render();
  }
}

if (typeof document !== "undefined" && typeof window !== "undefined") {
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => {
      if (!document.getElementById("remoteSlideshowHost")) return;
      window.slideshowTabController = new SlideshowTabController();
      window.slideshowTabController.init();
    });
  } else if (document.getElementById("remoteSlideshowHost")) {
    window.slideshowTabController = new SlideshowTabController();
    window.slideshowTabController.init();
  }
}

export { SlideshowTabController, filterExcludedPresentationPacks, resolveSlideshowPackLabel };
