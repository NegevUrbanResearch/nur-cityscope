/** Cleanup is performed by the GIS that owns the actual ephemeral browser resources. */
export function installNliExperienceCleanup({
  dataContext, archiveWindow, getPresentationViewer, ownsArchiveCommands,
  cancelPendingArchive = () => {}, hasPresentation = () => false, onClosed = () => {},
  warn = (...args) => console.warn(...args),
}) {
  const completed = new Set();
  const inFlight = new Set();
  let disposed = false;
  const isCurrent = requestId => !disposed && dataContext.getExperienceState?.()?.pending_transition?.request_id === requestId;
  const clean = async experience => {
    const pending = experience?.pending_transition;
    if (!pending || pending.from_experience !== "nli" || pending.target !== "regular") return;
    const key = `${experience.revision}:${pending.request_id}`;
    if (completed.has(key) || inFlight.has(key) || disposed) return;
    inFlight.add(key);
    let success = false;
    let error = null;
    try {
      cancelPendingArchive();
      const viewer = getPresentationViewer?.();
      viewer?.closeForScene?.();
      const presentationClosed = await viewer?.close?.();
      if (presentationClosed === false || presentationClosed?.ok === false || hasPresentation()) {
        throw new Error("NLI presentation did not finish closing");
      }
      const handle = archiveWindow.getHandle?.();
      const archiveClosed = await archiveWindow.close();
      if ((handle && !handle.closed) || archiveClosed?.reason === "unavailable") {
        throw new Error("NLI archive window could not be closed");
      }
      onClosed();
      success = true;
    } catch (failure) {
      error = failure?.message || "NLI display cleanup failed";
    }
    try {
      if (isCurrent(pending.request_id) && ownsArchiveCommands) {
        await dataContext.reportExperienceCleanup({ requestId: pending.request_id, success, ...(error ? { error } : {}) });
      }
      completed.add(key);
    } catch (failure) {
      warn("[map-main] NLI experience cleanup receipt was not acknowledged", failure);
    } finally { inFlight.delete(key); }
  };
  const offState = dataContext.subscribe("experienceState", state => { void clean(state); });
  const offConnection = dataContext.subscribe("connection", connected => {
    if (connected) void clean(dataContext.getExperienceState?.());
  });
  void clean(dataContext.getExperienceState?.());
  return () => { disposed = true; offState?.(); offConnection?.(); };
}
