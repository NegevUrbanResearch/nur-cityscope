const EMPTY_PERSON_SELECTION = { personId: null, datasetVersion: null, revision: 0 };

export function normalizePersonSelection(raw) {
  const revision = Number.isInteger(raw?.revision) && raw.revision >= 0 ? raw.revision : 0;
  const personId = raw?.personId;
  const datasetVersion = raw?.datasetVersion;
  if (typeof personId !== "string" || typeof datasetVersion !== "string" || !personId.trim() || !datasetVersion.trim()) {
    return { ...EMPTY_PERSON_SELECTION, revision };
  }
  return { personId: personId.trim(), datasetVersion: datasetVersion.trim(), revision };
}

export const emptyPersonSelection = () => ({ ...EMPTY_PERSON_SELECTION });
