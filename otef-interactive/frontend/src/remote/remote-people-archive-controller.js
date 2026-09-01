import { stopNliClock } from "../shared/nli-investigation-clock.js";
import { getLocale, t } from "./remote-locale.js";

function snapshotFrom(value) {
  return value?.person_selection || value?.personSelection || value || null;
}

function revisionOf(snapshot) {
  const revision = Number(snapshot?.revision);
  return Number.isFinite(revision) && revision >= 0 ? revision : -1;
}

function samePerson(snapshot, person) {
  return !!person && snapshot?.personId === person.pid && snapshot?.datasetVersion === person.datasetVersion;
}

export function createRemotePeopleArchiveController(options = {}) {
  const {
    root,
    input,
    clear,
    list,
    status,
    navigationSection,
    dataContext,
    peopleRuntime,
    getMode,
    setMode,
    renderSuggestions,
    setStatus,
    setRootClass,
    setHidden,
    syncInputDirection,
    onModeUiChange,
    onRefresh,
  } = options;

  const state = {
    destroyed: false,
    person: { acknowledged: null, pending: null, revision: -1, generation: 0, requestToken: 0 },
    archive: { phase: "closed", person: null, requestId: null, generation: 0, timeoutId: null },
  };

  const archiveButton = document.createElement("button");
  archiveButton.type = "button";
  archiveButton.className = "place-search-archive-button";
  archiveButton.hidden = true;
  root.append(archiveButton);

  const missingDialog = document.createElement("dialog");
  missingDialog.className = "nli-record-dialog";
  const missingMessage = document.createElement("p");
  missingMessage.textContent = t("nliRecordMissing");
  missingDialog.append(missingMessage);
  const dialogClose = document.createElement("button");
  dialogClose.type = "button";
  dialogClose.textContent = t("dialogClose");
  dialogClose.addEventListener("click", () => missingDialog.close?.());
  missingDialog.append(dialogClose);
  root.append(missingDialog);

  const isAlive = (generation = null, kind = null) => {
    if (state.destroyed) return false;
    if (generation === null) return true;
    return kind ? generation === state[kind].generation : generation === state.person.generation;
  };
  const transition = (kind, changes = {}) => {
    Object.assign(state[kind], changes);
  };

  function setArchiveOpen(open) {
    transition("archive", { phase: open ? "open" : "closed" });
    navigationSection.classList?.toggle?.("is-archive-open", open);
    syncArchiveButton();
    if (open) archiveButton.focus?.();
  }

  function syncArchiveButton() {
    const { phase, person } = state.archive;
    const open = phase === "open";
    const pending = phase === "opening" || phase === "closing";
    archiveButton.textContent = t(
      phase === "closing" ? "nliArchiveClosing" : pending ? "nliArchiveOpening" : (open ? "backToMap" : "openNliRecord"),
    );
    archiveButton.hidden = open || pending ? false : !(getMode() === "people" && state.person.acknowledged);
    archiveButton.disabled = pending;
    void person;
  }

  function clearArchiveTimeout() {
    if (state.archive.timeoutId !== null) clearTimeout(state.archive.timeoutId);
    transition("archive", { timeoutId: null });
  }

  function cancelArchivePresentation() {
    clearArchiveTimeout();
    transition("archive", {
      phase: "closed",
      person: null,
      requestId: null,
      generation: state.archive.generation + 1,
    });
    if (!state.destroyed) {
      navigationSection.classList?.toggle?.("is-archive-open", false);
      syncArchiveButton();
    }
  }

  function beginArchiveTimeout(generation, person, requestId) {
    clearArchiveTimeout();
    const timeoutMs = Number.isFinite(Number(options.archiveResultTimeoutMs))
      ? Math.max(0, Number(options.archiveResultTimeoutMs))
      : 6000;
    const timeoutId = setTimeout(() => {
      if (!isAlive(generation, "archive") || state.archive.requestId !== requestId) return;
      const cancel = dataContext?.archiveWindowCommand?.("close", person.pid, person.datasetVersion, requestId);
      clearArchiveTimeout();
      transition("archive", {
        phase: "closed",
        person: null,
        requestId: null,
        generation: state.archive.generation + 1,
      });
      setArchiveOpen(false);
      setStatus(t("nliArchiveUnavailable"));
      cancel?.catch?.(() => {});
    }, timeoutMs);
    transition("archive", { timeoutId });
  }

  async function runArchiveCommand(action, person) {
    if (!isAlive() || !person) return;
    const requestId = globalThis.crypto?.randomUUID?.() || `archive-${Date.now()}`;
    const generation = state.archive.generation + 1;
    transition("archive", {
      phase: action === "open" ? "opening" : "closing",
      person,
      requestId,
      generation,
    });
    syncArchiveButton();
    beginArchiveTimeout(generation, person, requestId);
    try {
      const result = await dataContext?.archiveWindowCommand?.(
        action,
        person.pid,
        person.datasetVersion,
        requestId,
      );
      if (!isAlive(generation, "archive")) return;
      if (result?.acknowledged !== true) throw new Error("archive command not acknowledged");
    } catch {
      if (!isAlive(generation, "archive")) return;
      clearArchiveTimeout();
      transition("archive", {
        phase: "closed",
        person: null,
        requestId: null,
        generation: generation + 1,
      });
      syncArchiveButton();
      setStatus(t("nliArchiveUnavailable"));
    }
  }

  archiveButton.addEventListener("click", () => {
    if (!isAlive() || state.archive.phase === "opening" || state.archive.phase === "closing") return;
    if (state.archive.phase === "open") {
      void runArchiveCommand("close", state.archive.person || state.person.acknowledged);
      return;
    }
    const person = state.person.acknowledged;
    if (!person?.hasArchiveRecord) {
      missingDialog.showModal?.();
      return;
    }
    void runArchiveCommand("open", person);
  });

  function handleArchiveResult(result = {}) {
    const archive = state.archive;
    if (!isAlive() || !archive.requestId || result.requestId !== archive.requestId) return;
    if (!samePerson(result, state.person.acknowledged)) return;
    clearArchiveTimeout();
    const generation = archive.generation;
    if (result.outcome === "navigation_attempted") {
      transition("archive", { phase: "open", person: state.person.acknowledged, requestId: null });
      navigationSection.classList?.toggle?.("is-archive-open", true);
      archiveButton.focus?.();
      setStatus("");
    } else {
      transition("archive", { phase: "closed", person: null, requestId: null, generation: generation + 1 });
      navigationSection.classList?.toggle?.("is-archive-open", false);
      setStatus(result.outcome === "closed" ? "" : t("nliArchiveUnavailable"));
    }
    syncArchiveButton();
  }

  async function waitForInvestigationIdle({ forceStop = false, generation } = {}) {
    const current = dataContext?.getInvestigationClock?.();
    if (!forceStop && (!current || current.phase === "idle")) return;
    if (typeof dataContext?.patchInvestigationClock !== "function") throw new Error("investigation clock action unavailable");
    let resolveIdle;
    const idle = new Promise((resolve) => { resolveIdle = resolve; });
    let idleObserved = false;
    const onClock = (next) => {
      if (next?.phase !== "idle" || idleObserved || !isAlive(generation, "person")) return;
      idleObserved = true;
      resolveIdle(next);
    };
    const unsubscribe = dataContext?.subscribe?.("investigationClock", onClock);
    const timeoutMs = Number.isFinite(Number(options.personSelectionClockTimeoutMs))
      ? Math.max(0, Number(options.personSelectionClockTimeoutMs))
      : 3000;
    let timeoutId;
    const timeout = new Promise((_, reject) => {
      timeoutId = setTimeout(() => reject(Object.assign(new Error("timed out waiting for investigation clock to become idle"), { code: "PERSON_SELECTION_CLOCK_TIMEOUT" })), timeoutMs);
    });
    try {
      const stop = Promise.resolve().then(() => dataContext.patchInvestigationClock(stopNliClock(current)));
      stop.catch(() => {});
      const operation = (async () => {
        const result = await stop;
        if (!isAlive(generation, "person")) return;
        onClock(result?.investigation_clock || result?.investigationClock);
        onClock(dataContext?.getInvestigationClock?.());
        if (!idleObserved) await idle;
      })();
      await Promise.race([operation, timeout]);
    } finally {
      clearTimeout(timeoutId);
      unsubscribe?.();
    }
  }

  function isClockActiveConflict(error) {
    return error?.status === 409 && (
      error?.details?.reason === "clock_active" ||
      error?.details?.error === "clock_active" ||
      error?.details?.error === "person selection is unavailable while the investigation clock is active"
    );
  }

  async function selectPerson(person) {
    if (!isAlive()) return;
    const generation = state.person.generation + 1;
    const requestToken = state.person.requestToken + 1;
    transition("person", {
      generation,
      requestToken,
      pending: { generation, pid: person.pid, datasetVersion: person.datasetVersion },
    });
    setRootClass("is-pending", true);
    let stopFailure = false;
    let clockRecoveryAttempted = false;
    const stopAndWaitForIdle = async (forceStop = false) => {
      if (isAlive(generation)) setStatus(t("peopleSearchStopping"));
      try {
        await waitForInvestigationIdle({ forceStop, generation });
      } catch (error) {
        stopFailure = true;
        throw error;
      }
    };
    try {
      const clock = dataContext?.getInvestigationClock?.();
      if (clock && clock.phase !== "idle") await stopAndWaitForIdle();
      for (let attempt = 0; attempt < 2; attempt += 1) {
        if (!isAlive(generation)) return;
        setStatus(t("peopleSearchSelecting"));
        try {
          const result = await dataContext?.selectPerson?.(person.pid, person.datasetVersion);
          if (!isAlive(generation)) return;
          const resultSnapshot = snapshotFrom(result);
          const currentSnapshot = snapshotFrom(dataContext?.getPersonSelection?.());
          const snapshot = [resultSnapshot, currentSnapshot]
            .filter((candidate) => revisionOf(candidate) >= 0)
            .reduce((newest, candidate) => !newest || revisionOf(candidate) > revisionOf(newest) ? candidate : newest, null);
          if (!snapshot || revisionOf(snapshot) <= state.person.revision) throw new Error("selection not acknowledged");
          applySnapshot(snapshot);
          return;
        } catch (error) {
          if (state.destroyed || state.person.requestToken !== requestToken) return;
          if (!isAlive(generation)) {
            setStatus(t("peopleSearchSelectionFailed"));
            return;
          }
          if (attempt === 0 && !clockRecoveryAttempted && isClockActiveConflict(error)) {
            clockRecoveryAttempted = true;
            await stopAndWaitForIdle(true);
            continue;
          }
          throw error;
        }
      }
    } catch {
      if (isAlive(generation)) {
        if (state.person.acknowledged) {
          input.value = state.person.acknowledged.name;
          syncInputDirection(input);
        }
        setStatus(t(stopFailure ? "peopleSearchStopFailed" : "peopleSearchSelectionFailed"));
      }
    } finally {
      if (isAlive(generation) && state.person.pending?.generation === generation) {
        transition("person", { pending: null });
        setRootClass("is-pending", false);
      }
    }
  }

  function applySnapshot(snapshot) {
    if (!isAlive() || revisionOf(snapshot) <= state.person.revision) return;
    const generation = state.person.generation + 1;
    const supersededPending = !!state.person.pending;
    transition("person", { revision: revisionOf(snapshot), generation, pending: null });
    if (supersededPending) setRootClass("is-pending", false);
    if (!snapshot?.personId || !snapshot.datasetVersion) {
      transition("person", { acknowledged: null });
      cancelArchivePresentation();
      if (getMode() === "people") {
        input.value = "";
        syncInputDirection(input);
        setHidden(clear, true);
        renderSuggestions([]);
      }
      syncArchiveButton();
      return;
    }
    void peopleRuntime.load().then(() => {
      if (!isAlive(generation)) return;
      const resolved = peopleRuntime.resolve(snapshot.personId, snapshot.datasetVersion, getLocale());
      if (!resolved || resolved.pid !== snapshot.personId || resolved.datasetVersion !== snapshot.datasetVersion) {
        if (supersededPending) setStatus(t("peopleSearchSelectionFailed"));
        return;
      }
      transition("person", { acknowledged: resolved });
      setRootClass("is-pending", false);
      if (getMode() === "people") {
        input.value = resolved.name;
        syncInputDirection(input);
        setHidden(clear, false);
        renderSuggestions([]);
      }
      setStatus("");
      syncArchiveButton();
    }).catch(() => {});
  }

  function handlePersonSnapshot(snapshot) {
    if (!isAlive() || revisionOf(snapshot) <= state.person.revision) return;
    if (state.archive.person && !samePerson(snapshot, state.archive.person)) cancelArchivePresentation();
    applySnapshot(snapshot);
  }

  async function switchMode(nextMode) {
    const currentMode = getMode();
    if (!isAlive() || nextMode === currentMode || !["people", "settlements"].includes(nextMode)) return;
    if (nextMode === "settlements" && state.person.acknowledged) {
      const generation = state.person.generation + 1;
      const baselineRevision = state.person.revision;
      transition("person", { generation });
      setStatus(t("peopleSearchClearing"));
      try {
        const result = await dataContext?.clearPerson?.();
        const snapshot = snapshotFrom(dataContext?.getPersonSelection?.() || result);
        if (!snapshot || snapshot.personId || revisionOf(snapshot) <= baselineRevision) throw new Error("clear not acknowledged");
        applySnapshot(snapshot);
      } catch {
        if (isAlive(generation)) setStatus(t("peopleSearchClearFailed"));
        return;
      }
    }
    if (!isAlive()) return;
    setMode(nextMode);
    onModeUiChange?.();
    input.value = nextMode === "people" && state.person.acknowledged ? state.person.acknowledged.name : "";
    syncInputDirection(input);
    setHidden(clear, !input.value);
    renderSuggestions([]);
    setStatus("");
    if (input.value) onRefresh?.("input");
    syncArchiveButton();
  }

  function restoreAcknowledgedQuery() {
    if (!state.person.acknowledged || getMode() !== "people") return false;
    input.value = state.person.acknowledged.name;
    syncInputDirection(input);
    setHidden(clear, false);
    renderSuggestions([]);
    setStatus("");
    return true;
  }

  const personSubscription = dataContext?.subscribe?.("personSelection", handlePersonSnapshot);
  const archiveResultSubscription = dataContext?.subscribe?.("archiveWindowResult", handleArchiveResult);

  syncArchiveButton();

  return {
    archiveButton,
    selectPerson,
    switchMode,
    handlePersonSnapshot,
    handleArchiveResult,
    restoreAcknowledgedQuery,
    shouldSuppressFocus() {
      const person = state.person.acknowledged;
      return getMode() === "people" && !!person && input.value.trim() === String(person.name || "").trim();
    },
    handleLocaleChange() {
      missingMessage.textContent = t("nliRecordMissing");
      dialogClose.textContent = t("dialogClose");
      syncArchiveButton();
    },
    destroy() {
      if (state.destroyed) return;
      state.destroyed = true;
      clearArchiveTimeout();
      transition("person", {
        generation: state.person.generation + 1,
        pending: null,
        requestToken: state.person.requestToken + 1,
      });
      transition("archive", { generation: state.archive.generation + 1, requestId: null, person: null });
      personSubscription?.();
      archiveResultSubscription?.();
    },
  };
}
