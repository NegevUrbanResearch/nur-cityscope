import { NLI_LABEL_HEADING_STORAGE_KEY } from '../shared/nli-label-heading.js';

/** A saved heading changes the prepared wall's geometry in every browser output. */
export function bindProjectionHeadingStorage({ win, browserMode, previewMode, applyHeading,
  disposePreparation, controller, reapplyRuntime, repreparePreview, onError } = {}) {
  let previewAbort = null;
  const onStorage = (event) => {
    if (event.key !== NLI_LABEL_HEADING_STORAGE_KEY) return;
    applyHeading?.();
    if (browserMode) disposePreparation?.();
    controller?.reload?.();
    if (!browserMode) return;
    if (!previewMode) { reapplyRuntime?.(); return; }
    previewAbort?.abort();
    previewAbort = new AbortController();
    const signal = previewAbort.signal;
    try {
      Promise.resolve(repreparePreview?.(signal)).catch((error) => {
        if (!signal.aborted) onError?.(error);
      });
    } catch (error) {
      if (!signal.aborted) onError?.(error);
    }
  };
  win.addEventListener('storage', onStorage);
  return () => { previewAbort?.abort(); win.removeEventListener('storage', onStorage); };
}
