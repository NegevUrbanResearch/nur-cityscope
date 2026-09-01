import { OTEF_API } from "../api-client.js";
import { normalizePersonSelection } from "../person-selection.js";

function validPersonSelectionSnapshot(raw) {
  if (!raw || typeof raw !== "object" || !Number.isInteger(raw.revision) || raw.revision < 0) {
    return null;
  }
  const hasPerson = raw.personId != null || raw.datasetVersion != null;
  if (hasPerson && (
    typeof raw.personId !== "string" || !raw.personId.trim() ||
    typeof raw.datasetVersion !== "string" || !raw.datasetVersion.trim()
  )) {
    return null;
  }
  return normalizePersonSelection(raw);
}

async function personSelectionCommand(ctx, action, args) {
  if (!ctx._tableName) return { ok: false, reason: "missing_table" };
  const requestRevision = ctx._personSelection?.revision || 0;
  let expectedRevision = requestRevision;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const result = await OTEF_API[action](...args, expectedRevision, {
        tableName: ctx._tableName, sourceId: ctx._clientId, timestamp: Date.now(),
      });
      const snapshot = result?.person_selection || result?.personSelection;
      const acknowledged = snapshot && normalizePersonSelection(snapshot);
      if (acknowledged && acknowledged.revision >= (ctx._personSelection?.revision || 0)) {
        ctx._setPersonSelection(acknowledged);
      }
      return result;
    } catch (error) {
      const authoritative = error?.details?.person_selection;
      const stale = error?.status === 409 &&
        (error?.details?.reason === "stale" ||
          (!error?.details?.reason && error?.details?.error === "stale person selection revision"));
      const hydrated = validPersonSelectionSnapshot(authoritative);
      const current = validPersonSelectionSnapshot(ctx._personSelection);
      const safest = current && hydrated && current.revision >= hydrated.revision
        ? current
        : hydrated;
      if (attempt === 0 && stale && safest && safest.revision > requestRevision) {
        ctx._setPersonSelection(safest);
        expectedRevision = safest.revision;
        continue;
      }
      throw error;
    }
  }
}

function selectPerson(ctx, personId, datasetVersion) {
  return personSelectionCommand(ctx, "selectPerson", [personId, datasetVersion]);
}

function clearPerson(ctx) {
  return personSelectionCommand(ctx, "clearPerson", []);
}

async function archiveWindowCommand(ctx, action, personId, datasetVersion, requestId) {
  if (!ctx._tableName || !action || !personId || !datasetVersion || !requestId) {
    return { ok: false, reason: "invalid_archive_command" };
  }
  return OTEF_API.archiveWindowCommand(ctx._tableName, {
    action, personId, datasetVersion, requestId, sourceId: ctx._clientId,
  });
}

async function archiveWindowResult(ctx, outcome, personId, datasetVersion, requestId, sourceId = ctx._clientId) {
  if (!ctx._tableName || !outcome || !personId || !datasetVersion || !requestId) {
    return { ok: false, reason: "invalid_archive_result" };
  }
  return OTEF_API.archiveWindowResult(ctx._tableName, {
    outcome, personId, datasetVersion, requestId, sourceId,
  });
}

export {
  selectPerson,
  clearPerson,
  archiveWindowCommand,
  archiveWindowResult,
};
