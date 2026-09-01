import { getLocale } from "./remote-locale.js";
export const PEOPLE_INDEX_URL = "/otef-interactive/public/processed/layers/nli/people-search-index.json";
export const PEOPLE_RELEASE_METADATA_URL = "/otef-interactive/public/processed/layers/nli/release-metadata.json";
const UNKNOWN_NAME = "לא ידוע";
const clean = (value) => typeof value === "string" && value.trim() ? value.trim() : "";
const normalize = (value) => clean(value).toLocaleLowerCase("he").replace(/[\u0591-\u05c7]/g, "");
const isHebrew = (value) => /[\u0590-\u05ff]/.test(value);
const unpack = (value) => value && Object.prototype.hasOwnProperty.call(value, "data") ? value : { data: value, bytes: null };
async function fetchJson(url) {
  if (typeof fetch !== "function") throw new Error("People search fetch unavailable");
  const response = await fetch(url);
  if (!response.ok) throw new Error(`People search request failed: ${response.status}`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  return { data: JSON.parse(new TextDecoder().decode(bytes)), bytes };
}
async function hashBytes(bytes) {
  if (!(bytes instanceof Uint8Array) || !globalThis.crypto?.subtle) throw new Error("People search byte hashing unavailable");
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, "0")).join("");
}
function displayName(row, locale = getLocale()) {
  const names = (Array.isArray(row?.nameForms) ? row.nameForms : []).map(clean).filter(Boolean);
  const real = names.filter((name) => name !== UNKNOWN_NAME);
  const preferred = locale === "en" ? real.find((name) => !isHebrew(name)) : real.find(isHebrew);
  return preferred || real[0] || UNKNOWN_NAME;
}
function toRow(row, datasetVersion, locale) {
  const location = clean(row?.location) || clean(row?.sublocation);
  return { pid: clean(row?.pid), name: displayName(row, locale), location, hasArchiveRecord: row?.hasArchiveRecord === true, datasetVersion };
}
function scoreRow(row, query) {
  if (!query) return Infinity;
  const fields = [...(row.nameForms || []), row.location, row.sublocation].map(normalize).filter(Boolean);
  if (fields.some((field) => field === query)) return 0;
  if (fields.some((field) => field.startsWith(query))) return 1;
  if (fields.some((field) => field.includes(query))) return 2;
  return Infinity;
}
const promotedHash = (metadata) => clean(metadata?.runtimeArtifactHashes?.["people-search-index.json"])
  .toLowerCase().replace(/^sha256:/, "");
export function createPeopleSearchRuntime(options = {}) {
  const fetcher = options.fetchJson || fetchJson;
  const hasher = options.hashBytes || hashBytes;
  let loadPromise = null;
  let rows = [];
  let version = "";
  async function load() {
    if (loadPromise) return loadPromise;
    loadPromise = Promise.all([fetcher(options.indexUrl || PEOPLE_INDEX_URL), fetcher(options.metadataUrl || PEOPLE_RELEASE_METADATA_URL)])
      .then(async ([rawIndex, rawMetadata]) => {
        const index = unpack(rawIndex).data;
        const metadata = unpack(rawMetadata).data;
        version = clean(index?.datasetVersion);
        if (!version || version !== clean(metadata?.datasetVersion)) throw new Error("People search dataset version mismatch");
        const expected = promotedHash(metadata);
        const bytes = unpack(rawIndex).bytes;
        if (!expected || !(bytes instanceof Uint8Array)) throw new Error("People search promoted hash proof unavailable");
        const actual = String(await hasher(bytes)).toLowerCase().replace(/^sha256:/, "");
        if (actual !== expected) throw new Error("People search index hash mismatch");
        if (!Array.isArray(index?.people)) throw new Error("Malformed people search index");
        const seen = new Set();
        rows = index.people.map((row) => {
          const normalized = { pid: clean(row?.pid), nameForms: Array.isArray(row?.nameForms) ? row.nameForms.map(clean).filter(Boolean) : [], location: clean(row?.location), sublocation: clean(row?.sublocation), hasArchiveRecord: row?.hasArchiveRecord === true };
          if (!normalized.pid || seen.has(normalized.pid)) throw new Error("Invalid people search PID");
          seen.add(normalized.pid);
          return normalized;
        });
        return api;
      }).catch((error) => {
        loadPromise = null;
        throw error;
      });
    return loadPromise;
  }
  const api = {
    load,
    datasetVersion: () => version,
    search(query, locale = getLocale(), limit = 8) {
      const normalizedQuery = normalize(query);
      if (!normalizedQuery) return [];
      return rows.map((row) => ({ row, score: scoreRow(row, normalizedQuery) }))
        .filter((entry) => entry.score !== Infinity)
        .sort((a, b) => a.score - b.score || a.row.pid.localeCompare(b.row.pid, "en", { numeric: true }))
        .slice(0, Math.min(8, Math.max(0, Number(limit) || 8)))
        .map(({ row }) => toRow(row, version, locale));
    },
    resolve(pid, datasetVersion, locale = getLocale()) {
      if (clean(datasetVersion) !== version) return null;
      const row = rows.find((candidate) => candidate.pid === clean(pid));
      return row ? toRow(row, version, locale) : null;
    },
  };
  return api;
}
export { displayName as bestPersonDisplayName };
