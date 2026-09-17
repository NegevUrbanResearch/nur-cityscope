import { getLayerDisplayLabel } from "../shared/layer-display-glossary.js";
import { isNliPlayableLayerLocked } from "./nli-timeline-transport.js";
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

const CLOSE_ICON = `<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="square" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg>`;

export function createStaffPackMenus({
  root,
  getGroups,
  getClock,
  setLayersEnabled,
  isConnected,
  titleForPack,
  emptyLabel,
  sheetTitle,
  sheetLede,
  closeLabel,
  onClose,
} = {}) {
  let open = false;

  function groups() {
    return typeof getGroups === "function" ? getGroups() || [] : [];
  }

  function packHtml(id) {
    const group = groups().find((item) => item?.id === id);
    const rows = packRowsFromGroup(group);
    const onCount = rows.filter((row) => row.enabled).length;
    const title = titleForPack?.(id) || id;
    const locale = getLocale();
    const layers = rows
      .map((row) => {
        const locked = isNliPlayableLayerLocked(clock(), row.fullLayerIds);
        const ids = escapeHtml(JSON.stringify(row.fullLayerIds));
        return `<button type="button" class="layer-sheet-row${row.enabled ? " is-on" : ""}${
          locked ? " is-locked" : ""
        }" data-layer-ids="${ids}" aria-pressed="${row.enabled ? "true" : "false"}"${
          locked ? " disabled" : ""
        }>
            <span class="layer-sheet-label">${escapeHtml(labelForPackRow(row, locale))}</span>
            <span class="layer-sheet-switch" aria-hidden="true"></span>
          </button>`;
      })
      .join("");
    return `<section class="layer-sheet-pack" data-pack="${escapeHtml(id)}">
        <div class="layer-sheet-pack-head">
          <h3 class="layer-sheet-pack-title">${escapeHtml(title)}</h3>
          <span class="layer-sheet-pack-meta">${escapeHtml(formatActiveLayerCount(onCount))}</span>
        </div>
        <div class="layer-sheet-rows">
          ${layers || `<p class="layer-sheet-empty">${escapeHtml(emptyLabel?.() || "")}</p>`}
        </div>
      </section>`;
  }

  function clock() {
    return typeof getClock === "function" ? getClock() : null;
  }

  function paint() {
    if (!root) return;
    const body = root.querySelector(".layer-sheet-body");
    const scroll = body?.scrollTop || 0;
    const alreadyOpen = open && root.classList.contains("is-open") && !root.hidden;
    root.hidden = !open;
    root.classList.toggle("is-open", open);
    if (!open) {
      root.innerHTML = "";
      return;
    }
    const title = sheetTitle?.() || "";
    const lede = sheetLede?.() || "";
    const close = closeLabel?.() || "";
    root.innerHTML = `
      <div class="layer-sheet-backdrop" data-layer-sheet-dismiss="1"></div>
      <div class="layer-sheet-dialog" role="dialog" aria-modal="true" aria-labelledby="layerSheetTitle">
        <header class="layer-sheet-head">
          <div class="layer-sheet-heading">
            <h2 class="page-title" id="layerSheetTitle">${escapeHtml(title)}</h2>
            <p class="lede">${escapeHtml(lede)}</p>
          </div>
          <button type="button" class="layer-sheet-close" data-layer-sheet-dismiss="1" aria-label="${escapeHtml(close)}">
            ${CLOSE_ICON}
          </button>
        </header>
        <div class="layer-sheet-body">
          ${STAFF_PACK_IDS.map(packHtml).join("")}
        </div>
      </div>`;
    if (alreadyOpen) {
      const nextBody = root.querySelector(".layer-sheet-body");
      if (nextBody) nextBody.scrollTop = scroll;
    } else {
      root.querySelector(".layer-sheet-close")?.focus();
    }
  }

  function setOpen(next, { silent } = {}) {
    const was = open;
    open = !!next;
    paint();
    if (was && !open && !silent) onClose?.();
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
      // Keep the sheet even if a single toggle is rejected.
    }
  }

  function onRootClick(event) {
    if (event.target.closest("[data-layer-sheet-dismiss]")) {
      event.stopPropagation?.();
      setOpen(false);
      return;
    }
    const layer = event.target.closest("[data-layer-ids]");
    if (layer && root.contains(layer)) {
      event.stopPropagation?.();
      void toggleRow(layer);
    }
  }

  function onKeydown(event) {
    if (event.key === "Escape" && open) setOpen(false);
  }

  root?.addEventListener("click", onRootClick);
  if (typeof document !== "undefined") {
    document.addEventListener("keydown", onKeydown);
  }
  paint();

  return {
    render: paint,
    open: () => setOpen(true),
    close: (opts) => setOpen(false, opts),
    isOpen: () => open,
    destroy() {
      root?.removeEventListener("click", onRootClick);
      if (typeof document !== "undefined") {
        document.removeEventListener("keydown", onKeydown);
      }
    },
  };
}
