import { scrollButtonContent } from "./nli-staff-icons.js";

export const ARCHIVE_PAGE_HOLD_MS = 500;

export function createArchivePageHold({
  page,
  isOpen = () => true,
  intervalMs = ARCHIVE_PAGE_HOLD_MS,
  documentRef = globalThis.document,
} = {}) {
  let intervalId = null;
  let listening = false;

  function onPointerEnd() {
    clear();
  }

  function onVisibilityChange() {
    if (documentRef?.hidden || documentRef?.visibilityState === "hidden") clear();
  }

  function attach() {
    if (listening) return;
    listening = true;
    documentRef?.addEventListener?.("pointerup", onPointerEnd);
    documentRef?.addEventListener?.("pointercancel", onPointerEnd);
    documentRef?.addEventListener?.("lostpointercapture", onPointerEnd);
    globalThis.addEventListener?.("blur", onPointerEnd);
    documentRef?.addEventListener?.("visibilitychange", onVisibilityChange);
  }

  function detach() {
    if (!listening) return;
    listening = false;
    documentRef?.removeEventListener?.("pointerup", onPointerEnd);
    documentRef?.removeEventListener?.("pointercancel", onPointerEnd);
    documentRef?.removeEventListener?.("lostpointercapture", onPointerEnd);
    globalThis.removeEventListener?.("blur", onPointerEnd);
    documentRef?.removeEventListener?.("visibilitychange", onVisibilityChange);
  }

  function clear() {
    if (intervalId != null) {
      clearInterval(intervalId);
      intervalId = null;
    }
    detach();
  }

  function start(event) {
    const button = event?.target?.closest?.("[data-archive-action]");
    const action = button?.getAttribute?.("data-archive-action") || button?.dataset?.archiveAction;
    if (action !== "page_up" && action !== "page_down") return;
    if (button?.disabled || !isOpen()) return;
    clear();
    const direction = action === "page_up" ? "up" : "down";
    try {
      button.setPointerCapture?.(event.pointerId);
    } catch {
      /* capture is best-effort */
    }
    attach();
    void page?.(direction);
    intervalId = setInterval(() => {
      if (!isOpen()) {
        clear();
        return;
      }
      void page?.(direction);
    }, intervalMs);
  }

  function destroy() {
    clear();
  }

  return { start, clear, destroy };
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function openRecordControls(labels, personName, disabledAttr) {
  return `<section class="presentation-controls archive-controls" aria-label="${escapeHtml(personName || labels.nliArchiveRecord)}">
    <div class="presentation-slide-actions">
      <button type="button" class="btn btn--outline nav-button" data-archive-action="page_up"${disabledAttr}>${scrollButtonContent(labels.nliArchiveScrollUp, "up")}</button>
      <button type="button" class="btn nav-button" data-archive-action="page_down"${disabledAttr}>${scrollButtonContent(labels.nliArchiveScrollDown, "down")}</button>
    </div>
    <button type="button" class="btn btn--outline presentation-close" data-archive-action="close"${disabledAttr}>${escapeHtml(labels.backToMap)}</button>
  </section>`;
}

export function archiveControlsHtml({ phase, localeLabels = {}, personName = "", disabled = false } = {}) {
  const disabledAttr = disabled || phase === "opening" || phase === "closing" ? " disabled" : "";
  if (phase === "open" || phase === "closing") return openRecordControls(localeLabels, personName, disabledAttr);
  return `<div class="presentation-controls archive-controls"><button type="button" class="btn" data-archive-action="open"${disabledAttr}>${escapeHtml(localeLabels.openNliRecord)}</button></div>`;
}
