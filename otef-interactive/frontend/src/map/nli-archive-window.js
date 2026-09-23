export const NLI_ARCHIVE_CHANNEL_NAME = "otef-nli-archive";
const ARCHIVE_WINDOW_NAME = NLI_ARCHIVE_CHANNEL_NAME;

/** Best-effort controller for the named NLI archive window. */
export function createNliArchiveWindowController({
  windowOpen = (url, name) => window.open(url, name),
  focus = () => window.focus?.(),
  onStateChange = () => {},
  broadcastChannel,
} = {}) {
  const channel = broadcastChannel ?? (typeof BroadcastChannel !== "undefined"
    ? new BroadcastChannel(NLI_ARCHIVE_CHANNEL_NAME)
    : null);
  let handle = null;
  let closedLiveHandle = false;
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
      if (handle && handle.closed === false) {
        try { handle.focus?.(); } catch (_focusError) {}
        onStateChange({ armed: true });
        return { ok: true };
      }
      handle = null;
      onStateChange({ armed: false, reason: "unavailable" });
      return { ok: false, reason: "unavailable" };
    }
  }
  function postClose() {
    try { channel?.postMessage?.({ type: "close" }); } catch (_error) {}
  }

  function closeLocal() {
    const unavailable = { ok: false, reason: "unavailable" };
    const finish = (result) => {
      try { focus(); } catch (_error) {}
      onStateChange({ armed: false, reason: result.reason });
      return result;
    };
    if (!handle) return { ok: false, reason: "silent" };
    try { handle.close(); } catch (_error) {}
    if (!handle.closed) {
      try { handle.location.replace("about:blank"); } catch (_error) {}
      try { handle.close(); } catch (_error) {}
    }
    if (!handle.closed) return finish(unavailable);
    handle = null;
    closedLiveHandle = true;
    return finish({ ok: true });
  }

  function close() {
    if (!handle) {
      postClose();
      if (closedLiveHandle) {
        closedLiveHandle = false;
        return { ok: true };
      }
      return { ok: false, reason: "silent" };
    }
    const result = closeLocal();
    postClose();
    if (result.ok === true) closedLiveHandle = false;
    return result;
  }

  channel?.addEventListener?.("message", (event) => {
    if (event?.data?.type !== "close") return;
    closeLocal();
  });

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
      if (closeResult?.reason === "silent") return true;
      if (closeResult?.ok === true) await report(command, "closed");
      else if (closeResult?.ok === false && closeResult.reason === "unavailable") await report(command, "unavailable");
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

  function openSelected(person) {
    const selection = getPersonSelection?.();
    if (!person?.nliUrl || !selection?.personId || String(person.pid) !== String(selection.personId)) return false;
    token += 1;
    pendingPerson = null;
    if (windowController.navigate(person.nliUrl)?.ok !== true) return false;
    activePerson = { personId: selection.personId, datasetVersion: selection.datasetVersion };
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

  return { handleCommand, handlePersonSelection, openSelected };
}
