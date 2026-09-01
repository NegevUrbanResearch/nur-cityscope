const ARCHIVE_WINDOW_NAME = "otef-nli-archive";

/** Best-effort controller for the named NLI archive window. */
export function createNliArchiveWindowController({
  windowOpen = (url, name) => window.open(url, name),
  focus = () => window.focus?.(),
  onStateChange = () => {},
} = {}) {
  let handle = null;
  function navigate(url) {
    if (typeof url !== "string" || !url.trim()) return { ok: false, reason: "missing_url" };
    try {
      const parsed = new URL(url);
      if (parsed.protocol !== "https:" || parsed.hostname !== "www.nli.org.il") return { ok: false, reason: "invalid_url" };
    } catch (_error) {
      return { ok: false, reason: "invalid_url" };
    }
    try {
      if (handle?.closed) {
        handle = null;
      }
      if (!handle) {
        handle = windowOpen(url, ARCHIVE_WINDOW_NAME) || null;
        if (!handle || handle.closed) {
          handle = null;
          onStateChange({ armed: false, reason: "unavailable" });
          return { ok: false, reason: "unavailable" };
        }
      } else {
        handle.location.href = url;
      }
      try { handle.focus?.(); } catch (_error) {}
      onStateChange({ armed: true });
      return { ok: true };
    } catch (_error) {
      handle = null;
      onStateChange({ armed: false, reason: "unavailable" });
      return { ok: false, reason: "unavailable" };
    }
  }
  function close() {
    let result = { ok: true };
    try { handle?.close?.(); } catch (_error) { result = { ok: false, reason: "unavailable" }; }
    handle = null;
    try { focus(); } catch (_error) {}
    onStateChange({ armed: false, reason: result.reason });
    return result;
  }
  return { navigate, open: navigate, close, getHandle: () => handle };
}

const samePerson = (left, right) => Boolean(
  left && right && left.personId === right.personId && left.datasetVersion === right.datasetVersion,
);

/** Coordinate ephemeral archive commands with the authoritative person selection. */
export function createNliArchiveCommandBridge({ windowController, resolvePerson, getPersonSelection, emitResult = () => {} }) {
  let token = 0;
  let activePerson = null;
  let pendingPerson = null;
  const completedRequestIds = [];
  const canceledRequestIds = [];
  const resultFlights = new Map();
  const rememberCanceled = (requestId) => {
    if (!requestId || canceledRequestIds.includes(requestId)) return;
    canceledRequestIds.push(requestId);
    if (canceledRequestIds.length > 32) canceledRequestIds.splice(0, canceledRequestIds.length - 32);
  };

  const report = async (command, outcome) => {
    const requestId = typeof command?.requestId === "string" ? command.requestId : "";
    if (!requestId || completedRequestIds.includes(requestId)) return true;
    if (resultFlights.has(requestId)) return resultFlights.get(requestId);
    const flight = (async () => {
      try {
        await emitResult({
          requestId,
          sourceId: command.sourceId || null,
          personId: command.personId || null,
          datasetVersion: command.datasetVersion || null,
          outcome,
        });
        completedRequestIds.push(requestId);
        if (completedRequestIds.length > 32) completedRequestIds.splice(0, completedRequestIds.length - 32);
        return true;
      } catch (_error) {
        return false;
      } finally {
        resultFlights.delete(requestId);
      }
    })();
    resultFlights.set(requestId, flight);
    return flight;
  };

  async function handleCommand(command = {}) {
    if (command.action === "close") {
      const current = activePerson || pendingPerson;
      if (current && !samePerson(command, current)) return false;
      rememberCanceled(command.requestId);
      token += 1;
      activePerson = null;
      pendingPerson = null;
      const closeResult = windowController.close();
      await report(command, closeResult?.ok === false ? "unavailable" : "closed");
      return true;
    }
    if (command.action !== "open") return false;
    if (typeof command.requestId === "string" && canceledRequestIds.includes(command.requestId)) return false;
    const requestToken = ++token;
    pendingPerson = { personId: command.personId, datasetVersion: command.datasetVersion, requestId: command.requestId, sourceId: command.sourceId };
    let person;
    try { person = await resolvePerson(command.personId, command.datasetVersion); } catch (_error) { person = null; }
    if (requestToken !== token || !samePerson(getPersonSelection?.(), pendingPerson)) {
      await report(command, "unavailable");
      return false;
    }
    const result = person?.nliUrl ? windowController.navigate(person.nliUrl) : { ok: false, reason: "unavailable" };
    pendingPerson = null;
    const outcome = result?.ok === true ? "navigation_attempted" : result?.reason === "closed" ? "closed" : "unavailable";
    await report(command, outcome);
    if (outcome !== "navigation_attempted") return false;
    if (requestToken !== token || !samePerson(getPersonSelection?.(), command)) return false;
    activePerson = { personId: command.personId, datasetVersion: command.datasetVersion, requestId: command.requestId };
    return true;
  }

  function handlePersonSelection(selection) {
    const current = activePerson || pendingPerson;
    if (!current || samePerson(selection, current)) return false;
    token += 1;
    if (pendingPerson) void report(pendingPerson, "unavailable");
    activePerson = null;
    pendingPerson = null;
    windowController.close();
    return true;
  }

  return { handleCommand, handlePersonSelection };
}
