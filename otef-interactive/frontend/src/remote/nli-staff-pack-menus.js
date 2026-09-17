import { getLayerDisplayLabel } from "../shared/layer-display-glossary.js";
import { isNliPlayableLayerLocked } from "./nli-timeline-transport.js";
import { materialIcon } from "./nli-staff-icons.js";
import { getLocale, formatActiveLayerCount } from "./remote-locale.js";

export const STAFF_PACK_IDS = ["nli", "projector_base"];

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function packRowsFromGroup(group) {
  if (!group?.id) return [];
  const rows = [];
  for (const layer of group.layers || []) {
    if (!layer?.id) continue;
    const fullLayerIds =
      Array.isArray(layer.fullLayerIds) && layer.fullLayerIds.length
        ? layer.fullLayerIds.map(String)
        : [`${group.id}.${layer.id}`];
    rows.push({
      id: layer.id,
      enabled: !!layer.enabled,
      fullLayerIds,
      rawLabel: layer.name || layer.id,
    });
  }
  return rows;
}

export function labelForPackRow(row, locale = getLocale()) {
  return getLayerDisplayLabel(
    row?.fullLayerIds?.[0] || "",
    locale,
    row?.rawLabel || row?.id || "",
    row?.fullLayerIds,
  );
}

export function createStaffPackMenus({
  root,
  getGroups,
  getClock,
  setLayersEnabled,
  isConnected,
  titleForPack,
  emptyLabel,
} = {}) {
  let openId = null;

  function groups() {
    return typeof getGroups === "function" ? getGroups() || [] : [];
  }

  function paint() {
    if (!root) return;
    const clock = typeof getClock === "function" ? getClock() : null;
    const locale = getLocale();
    root.innerHTML = STAFF_PACK_IDS.map((id) => {
      const group = groups().find((item) => item?.id === id);
      const rows = packRowsFromGroup(group);
      const onCount = rows.filter((row) => row.enabled).length;
      const open = openId === id;
      const title = titleForPack?.(id) || id;
      const layers = rows
        .map((row) => {
          const locked = isNliPlayableLayerLocked(clock, row.fullLayerIds);
          const ids = escapeHtml(JSON.stringify(row.fullLayerIds));
          return `<button type="button" class="pack-layer${row.enabled ? " is-on" : ""}${
            locked ? " is-locked" : ""
          }" data-layer-ids="${ids}" aria-pressed="${row.enabled ? "true" : "false"}"${
            locked ? " disabled" : ""
          }>${escapeHtml(labelForPackRow(row, locale))}</button>`;
        })
        .join("");
      return `<div class="pack-menu${open ? " is-open" : ""}" data-pack="${escapeHtml(id)}">
        <button type="button" class="pack-trigger" data-pack-trigger="${escapeHtml(id)}" aria-expanded="${
          open ? "true" : "false"
        }" aria-controls="pack-panel-${escapeHtml(id)}" aria-haspopup="true">
          <span class="pack-trigger-copy">
            <span class="pack-trigger-title">${escapeHtml(title)}</span>
            <span class="pack-trigger-meta">${escapeHtml(formatActiveLayerCount(onCount))}</span>
          </span>
          <span class="pack-trigger-chevron" aria-hidden="true">${materialIcon("expandMore", 22)}</span>
        </button>
        <div class="pack-panel" id="pack-panel-${escapeHtml(id)}" ${open ? "" : "hidden"}>
          ${layers || `<p class="pack-empty">${escapeHtml(emptyLabel?.() || "")}</p>`}
        </div>
      </div>`;
    }).join("");
  }

  function setOpen(id) {
    openId = id && STAFF_PACK_IDS.includes(id) ? id : null;
    paint();
  }

  async function toggleRow(button) {
    if (typeof isConnected === "function" && !isConnected()) return;
    if (button.disabled) return;
    let ids;
    try {
      ids = JSON.parse(button.getAttribute("data-layer-ids") || "[]");
    } catch {
      return;
    }
    if (!Array.isArray(ids) || !ids.length) return;
    const next = button.getAttribute("aria-pressed") !== "true";
    try {
      await setLayersEnabled?.(ids, next);
    } catch {
      // Keep the menu even if a single toggle is rejected.
    }
  }

  function onRootClick(event) {
    const trigger = event.target.closest("[data-pack-trigger]");
    if (trigger && root.contains(trigger)) {
      event.stopPropagation?.();
      const id = trigger.getAttribute("data-pack-trigger");
      setOpen(openId === id ? null : id);
      return;
    }
    const layer = event.target.closest("[data-layer-ids]");
    if (layer && root.contains(layer)) {
      event.stopPropagation?.();
      void toggleRow(layer);
    }
  }

  function onDocumentClick(event) {
    if (!openId || root?.contains(event.target)) return;
    setOpen(null);
  }

  function onKeydown(event) {
    if (event.key === "Escape" && openId) setOpen(null);
  }

  root?.addEventListener("click", onRootClick);
  if (typeof document !== "undefined") {
    document.addEventListener("click", onDocumentClick);
    document.addEventListener("keydown", onKeydown);
  }
  paint();

  return {
    render: paint,
    close: () => setOpen(null),
    getOpenId: () => openId,
    destroy() {
      root?.removeEventListener("click", onRootClick);
      if (typeof document !== "undefined") {
        document.removeEventListener("click", onDocumentClick);
        document.removeEventListener("keydown", onKeydown);
      }
    },
  };
}
