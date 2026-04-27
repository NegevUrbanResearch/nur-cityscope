import { MapProjectionConfig } from "../shared/map-projection-config.js";
import OTEFDataContext from "../shared/OTEFDataContext.js";
import { LOCALE_EVENT, applyRemoteChromeI18n, t } from "./remote-locale.js";

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
    Array.isArray(excludedPresentationPackIds) ? excludedPresentationPackIds : []
  );
  return packs.filter((p) => p?.id && !excluded.has(String(p.id)));
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
    this.availablePacks = this.resolvePackSources();
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

  movePack(fromIndex, direction) {
    const toIndex = fromIndex + direction;
    if (toIndex < 0 || toIndex >= this.packOrder.length) return;
    const next = [...this.packOrder];
    const [item] = next.splice(fromIndex, 1);
    next.splice(toIndex, 0, item);
    this.packOrder = next;
    this.render();
  }

  readNumberInput(id, fallback) {
    const input = this.root?.querySelector(`#${id}`);
    const parsed = parseOptionalNonNegativeNumber(input?.value);
    return parsed == null ? fallback : parsed;
  }

  async handleStart() {
    this.ensurePackOrder();
    if (this.packOrder.length === 0) {
      const status = this.root?.querySelector("[data-slideshow-status]");
      if (status) {
        status.textContent = t("slideshowNoPacks");
      }
      return;
    }
    const cfg = MapProjectionConfig?.PROJECTION_SLIDESHOW || {};
    const intervalSec = this.readNumberInput(
      "slideshowIntervalSec",
      (cfg.intervalMs ?? 10000) / 1000,
    );
    const crossfadeSec = this.readNumberInput(
      "slideshowCrossfadeSec",
      (cfg.crossfadeMs ?? 1200) / 1000,
    );
    const warmupSec = this.readNumberInput(
      "slideshowWarmupLeadSec",
      (cfg.warmupLeadMs ?? 2500) / 1000,
    );
    await OTEFDataContext.patchProjectionSlideshow({
      type: "start",
      payload: {
        packOrder: [...this.packOrder],
        intervalMs: Math.max(1, Math.round(intervalSec * 1000)),
        crossfadeMs: Math.max(0, Math.round(crossfadeSec * 1000)),
        warmupLeadMs: Math.max(0, Math.round(warmupSec * 1000)),
      },
    });
    this.running = true;
    this.renderStatusOnly();
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

      if (target.closest("[data-slideshow-start]")) {
        void this.handleStart();
        return;
      }

      if (target.closest("[data-slideshow-stop]")) {
        void this.handleStop();
      }
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
    const packListMarkup =
      this.packOrder.length === 0
        ? `<div class="sheet-empty slideshow-pack-empty" role="status">${escapeHtml(
            t("layerEmpty"),
          )}</div>`
        : `<ul class="slideshow-pack-list" aria-labelledby="${packListHeadingId}">${this.packOrder
            .map((packId, index) => {
              const label = packNameById.get(packId) || packId;
              const disableUp = index === 0 ? "disabled" : "";
              const disableDown = index === this.packOrder.length - 1 ? "disabled" : "";
              return `<li class="slideshow-pack-row">
                <span class="slideshow-pack-row__label">${escapeHtml(label)}</span>
                <div class="slideshow-pack-row__actions">
                  <button type="button" class="slideshow-pack-row__btn" data-pack-move="up" data-pack-index="${index}" data-i18n-aria="ariaSlideshowMoveUp" ${disableUp}>${escapeHtml(t("slideshowMoveUp"))}</button>
                  <button type="button" class="slideshow-pack-row__btn" data-pack-move="down" data-pack-index="${index}" data-i18n-aria="ariaSlideshowMoveDown" ${disableDown}>${escapeHtml(t("slideshowMoveDown"))}</button>
                </div>
              </li>`;
            })
            .join("")}</ul>`;

    this.root.innerHTML = `
      <section class="control-section slideshow-control-section">
        <h2 class="section-title" id="${packListHeadingId}">${escapeHtml(t("slideshowTitle"))}</h2>
        <p class="slideshow-hint">${escapeHtml(t("slideshowPackOrderHint"))}</p>
        <p class="slideshow-status" data-slideshow-status role="status" aria-live="polite">${
          this.running
            ? escapeHtml(t("slideshowStatusRunning"))
            : escapeHtml(t("slideshowStatusIdle"))
        }</p>
        ${packListMarkup}

        <div class="slideshow-input-grid">
          <label class="slideshow-field">
            <span>${escapeHtml(t("slideshowIntervalSecLabel"))}</span>
            <input id="slideshowIntervalSec" type="number" min="0" step="0.1" placeholder="${(cfg.intervalMs ?? 10000) / 1000}" />
          </label>
          <label class="slideshow-field">
            <span>${escapeHtml(t("slideshowCrossfadeSecLabel"))}</span>
            <input id="slideshowCrossfadeSec" type="number" min="0" step="0.1" placeholder="${(cfg.crossfadeMs ?? 1200) / 1000}" />
          </label>
          <label class="slideshow-field">
            <span>${escapeHtml(t("slideshowWarmupLeadSecLabel"))}</span>
            <input id="slideshowWarmupLeadSec" type="number" min="0" step="0.1" placeholder="${(cfg.warmupLeadMs ?? 2500) / 1000}" />
          </label>
        </div>

        <div class="slideshow-actions">
          <button type="button" class="slideshow-actions__btn" data-slideshow-start>${escapeHtml(t("slideshowStart"))}</button>
          <button type="button" class="slideshow-actions__btn" data-slideshow-stop>${escapeHtml(t("slideshowStop"))}</button>
        </div>
      </section>
    `;

    applyRemoteChromeI18n();
  }

  init() {
    this.root = document.getElementById(this.rootId);
    if (!this.root) return;
    this.bindEvents();
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

export { SlideshowTabController, filterExcludedPresentationPacks };
