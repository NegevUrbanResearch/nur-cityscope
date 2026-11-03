export const NOVA_ESCAPE_INDEX_SCHEMA_VERSION = 1;

const PARALLEL_KINDS = new Set(["polygon", "line"]);

function canonicalId(value) {
  if (typeof value === "string") return value.trim().length > 0 ? value : null;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return null;
}

function strictSortedIds(values) {
  if (!Array.isArray(values)) return null;
  const ids = [];
  const seen = new Set();
  for (const value of values) {
    const id = canonicalId(value);
    if (id == null || seen.has(id)) return null;
    seen.add(id);
    ids.push(id);
  }
  return ids.sort();
}

function sameIds(left, right) {
  return left.length === right.length && left.every((id, index) => id === right[index]);
}

function validProgress(value) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1;
}

function parseCrossingKey(key) {
  if (typeof key !== "string") return null;
  const first = key.indexOf(":");
  const second = first < 0 ? -1 : key.indexOf(":", first + 1);
  if (first <= 0 || second <= first + 1 || second >= key.length - 1) return null;
  return {
    routeId: key.slice(0, first),
    kind: key.slice(first + 1, second),
    featureId: key.slice(second + 1),
  };
}

function compareRows(left, right) {
  for (let index = 0; index < left.length - 1; index += 1) {
    const leftValue = String(left[index]);
    const rightValue = String(right[index]);
    if (leftValue < rightValue) return -1;
    if (leftValue > rightValue) return 1;
  }
  return left[left.length - 1] - right[right.length - 1];
}

function normalizeRouteIds(routeIds) {
  const ids = strictSortedIds(routeIds);
  if (!ids) throw new TypeError("routeIds must contain unique, non-empty string or finite numeric IDs");
  return ids;
}

function normalizeParallelRows(parallelCrossingIndex, routeIdSet) {
  if (!(parallelCrossingIndex instanceof Map)) {
    throw new TypeError("parallelCrossingIndex must be a Map");
  }
  const rows = [];
  const seen = new Set();
  for (const [key, progress] of parallelCrossingIndex) {
    const parsed = parseCrossingKey(key);
    const featureId = canonicalId(parsed?.featureId);
    if (!parsed || !routeIdSet.has(parsed.routeId) || !PARALLEL_KINDS.has(parsed.kind) || featureId == null || !validProgress(progress)) {
      throw new TypeError("parallel crossing index contains an invalid row");
    }
    rows.push([parsed.routeId, parsed.kind, featureId, progress]);
  }
  return rows.sort(compareRows);
}

function normalizeSettlementRows(settlementContacts, routeIdSet) {
  if (!Array.isArray(settlementContacts)) throw new TypeError("settlementContacts must be an array");
  const rows = [];
  const seen = new Set();
  for (const contact of settlementContacts) {
    const routeId = canonicalId(contact?.routeId);
    const outlineObjectId = canonicalId(contact?.outlineObjectId);
    if (routeId == null || outlineObjectId == null || !routeIdSet.has(routeId) || !validProgress(contact?.u)) {
      throw new TypeError("settlement contacts contain an invalid row");
    }
    const key = `${routeId}:${outlineObjectId}`;
    if (seen.has(key)) throw new TypeError("settlement contacts contain duplicate rows");
    seen.add(key);
    rows.push([routeId, outlineObjectId, contact.u]);
  }
  return rows.sort(compareRows);
}

export function encodeNovaEscapeIndex({
  routeIds,
  parallelCrossingIndex,
  settlementContacts,
} = {}) {
  const ids = normalizeRouteIds(routeIds);
  const routeIdSet = new Set(ids);
  return {
    schemaVersion: NOVA_ESCAPE_INDEX_SCHEMA_VERSION,
    routeIds: ids,
    parallelCrossings: normalizeParallelRows(parallelCrossingIndex, routeIdSet),
    settlementCrossings: normalizeSettlementRows(settlementContacts, routeIdSet),
  };
}

function parseParallelRows(rows, routeIdSet) {
  if (!Array.isArray(rows)) return null;
  const index = new Map();
  for (const row of rows) {
    if (!Array.isArray(row) || row.length !== 4) return null;
    const routeId = canonicalId(row[0]);
    const kind = row[1];
    const featureId = canonicalId(row[2]);
    if (routeId == null || !routeIdSet.has(routeId) || !PARALLEL_KINDS.has(kind) || featureId == null || !validProgress(row[3])) return null;
    const key = `${routeId}:${kind}:${featureId}`;
    if (index.has(key)) return null;
    index.set(key, row[3]);
  }
  return index;
}

function parseSettlementRows(rows, routeIdSet) {
  if (!Array.isArray(rows)) return null;
  const contacts = [];
  const seen = new Set();
  for (const row of rows) {
    if (!Array.isArray(row) || row.length !== 3) return null;
    const routeId = canonicalId(row[0]);
    const outlineObjectId = canonicalId(row[1]);
    if (routeId == null || outlineObjectId == null || !routeIdSet.has(routeId) || !validProgress(row[2])) return null;
    const key = `${routeId}:${outlineObjectId}`;
    if (seen.has(key)) return null;
    seen.add(key);
    contacts.push({ routeId, outlineObjectId, u: row[2] });
  }
  return contacts;
}

export function parseNovaEscapeIndex(raw, expectedRouteIds = []) {
  if (raw?.schemaVersion !== NOVA_ESCAPE_INDEX_SCHEMA_VERSION) return null;
  const actualIds = strictSortedIds(raw.routeIds);
  const expectedIds = strictSortedIds(expectedRouteIds);
  if (!actualIds || !expectedIds || !sameIds(actualIds, expectedIds)) return null;
  const routeIdSet = new Set(actualIds);
  const crossingIndex = parseParallelRows(raw.parallelCrossings, routeIdSet);
  const settlementContacts = parseSettlementRows(raw.settlementCrossings, routeIdSet);
  if (!crossingIndex || !settlementContacts) return null;
  return { crossingIndex, settlementContacts };
}
