import { getNliNarrative } from "../shared/nli-narratives.js";

function trustedDefinition(definition) {
  const registered = getNliNarrative(definition?.id);
  const url = registered?.presentationUrl;
  if (typeof url !== "string" || url.length === 0) return null;
  if (definition?.presentationUrl !== url) return null;
  return registered;
}

/** Bridge a validated remote command to the local iframe without touching durable scene state. */
export function handleNarrativePresentationCommand({ command, definition, presentation, emitUnavailable = () => {} } = {}) {
  if (!definition || command?.narrativeId !== definition.id) {
    emitUnavailable(command);
    return false;
  }
  if (command.presentationAction === "open" && presentation?.open?.(definition, command)) return true;
  if (command.presentationAction === "close" && presentation?.close?.({ emitResult: true, command })) return true;
  if (command.presentationAction === "open" || command.presentationAction === "close") emitUnavailable(command);
  return false;
}

/** Mount the trusted, local NLI presentation command surface above the GIS shell. */
export function createNarrativePresentation(container, { onResult = () => {}, onOpenChange } = {}) {
  let overlay = null;
  let command = null;
  let disposed = false;

  const emit = (outcome) => {
    if (!command?.requestId) return;
    onResult({
      outcome,
      narrativeId: command.narrativeId,
      requestId: command.requestId,
      sourceId: command.sourceId || null,
    });
  };
  const notifyOpenChange = (open) => {
    if (typeof onOpenChange === "function") onOpenChange(open);
  };
  const remove = () => {
    if (!overlay) return false;
    if (typeof overlay.remove === "function") overlay.remove();
    else overlay.parentNode?.removeChild?.(overlay);
    overlay = null;
    notifyOpenChange(false);
    return true;
  };
  const onKeyDown = (event) => {
    if (event?.key !== "Escape" || !overlay) return;
    event.preventDefault?.();
    if (remove()) emit("closed");
    command = null;
  };
  document?.addEventListener?.("keydown", onKeyDown);

  return {
    open(definition, nextCommand = null) {
      const trusted = trustedDefinition(definition);
      if (disposed || !container?.appendChild || !trusted) return false;
      if (overlay) {
        command = nextCommand?.requestId ? {
          narrativeId: trusted.id,
          requestId: nextCommand.requestId,
          sourceId: nextCommand.sourceId || null,
        } : command;
        if (nextCommand?.requestId) emit("opened");
        return true;
      }
      const nextOverlay = document?.createElement?.("div");
      const iframe = document?.createElement?.("iframe");
      if (!nextOverlay || !iframe) return false;
      nextOverlay.className = "nli-narrative-presentation";
      iframe.src = trusted.presentationUrl;
      iframe.title = "סיפורה של משפחת שגב – קיבוץ בארי";
      iframe.setAttribute?.("allow", "fullscreen");
      iframe.setAttribute?.("allowfullscreen", "");
      iframe.setAttribute?.("referrerpolicy", "no-referrer");
      iframe.allowFullscreen = true;
      nextOverlay.appendChild(iframe);
      container.appendChild(nextOverlay);
      overlay = nextOverlay;
      command = nextCommand?.requestId ? {
        narrativeId: trusted.id,
        requestId: nextCommand.requestId,
        sourceId: nextCommand.sourceId || null,
      } : null;
      notifyOpenChange(true);
      if (command) emit("opened");
      return true;
    },
    close({ emitResult = false, command: nextCommand = null } = {}) {
      if (nextCommand?.requestId) {
        command = {
          narrativeId: nextCommand.narrativeId,
          requestId: nextCommand.requestId,
          sourceId: nextCommand.sourceId || null,
        };
      }
      const closed = remove();
      if (emitResult) emit("closed");
      command = null;
      return closed || !overlay;
    },
    isOpen: () => !!overlay,
    dispose() {
      if (disposed) return;
      disposed = true;
      remove();
      command = null;
      document?.removeEventListener?.("keydown", onKeyDown);
    },
  };
}
