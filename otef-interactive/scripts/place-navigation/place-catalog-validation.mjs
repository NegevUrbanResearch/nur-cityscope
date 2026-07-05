import { validateViewportTarget } from "../../frontend/src/shared/place-navigation/viewport-target.js";

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isFiniteNumber(value) {
  return typeof value === "number" && Number.isFinite(value);
}

function assertString(value, label) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`${label} must be a non-empty string`);
  }
}

function assertOptionalString(value, label) {
  if (value !== undefined && (typeof value !== "string" || value.trim() === "")) {
    throw new Error(`${label} must be a non-empty string when present`);
  }
}

function assertStringArray(value, label) {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string" || item.trim() === "")) {
    throw new Error(`${label} must be an array of non-empty strings`);
  }
}

function assertFinitePoint(point, label, keys) {
  if (!isPlainObject(point)) {
    throw new Error(`${label} must be an object`);
  }
  for (const key of keys) {
    if (!isFiniteNumber(point[key])) {
      throw new Error(`${label}.${key} must be finite`);
    }
  }
}

function validateBoundsPolicy(policy, id) {
  if (policy === undefined) return;
  if (!isPlainObject(policy)) {
    throw new Error(`${id}.boundsPolicy must be an object`);
  }
  if (policy.mode !== "requireWithinOtefBounds") {
    throw new Error(`${id}.boundsPolicy.mode is unsupported`);
  }
  if (policy.reasonKey !== "placeOutOfBounds") {
    throw new Error(`${id}.boundsPolicy.reasonKey is unsupported`);
  }
}

function validateSource(source, id) {
  if (!isPlainObject(source)) {
    throw new Error(`${id}.source must be an object`);
  }
  if ("layer" in source || "citycode" in source) {
    throw new Error(`${id}.source must use kind, file, and optional featureId`);
  }
  if (source.kind !== "geojson" && source.kind !== "manual") {
    throw new Error(`${id}.source.kind must be geojson or manual`);
  }
  assertString(source.file, `${id}.source.file`);
  assertOptionalString(source.featureId, `${id}.source.featureId`);
}

function validatePlaceEntry(entry) {
  if (!isPlainObject(entry)) {
    throw new Error("Catalog entry must be an object");
  }
  assertString(entry.id, "entry.id");
  if (entry.type !== "yeshuv" && entry.type !== "custom") {
    throw new Error(`${entry.id}.type must be yeshuv or custom`);
  }
  validateSource(entry.source, entry.id);
  if (entry.type === "yeshuv" && entry.source.featureId === undefined) {
    throw new Error(`${entry.id}.source.featureId is required for yeshuv entries`);
  }
  if (!isPlainObject(entry.name)) {
    throw new Error(`${entry.id}.name must be an object`);
  }
  assertString(entry.name.he, `${entry.id}.name.he`);
  assertOptionalString(entry.name.en, `${entry.id}.name.en`);
  if (!isPlainObject(entry.aliases)) {
    throw new Error(`${entry.id}.aliases must be an object`);
  }
  assertStringArray(entry.aliases.he, `${entry.id}.aliases.he`);
  assertStringArray(entry.aliases.en, `${entry.id}.aliases.en`);
  if (typeof entry.priority !== "number" || !Number.isFinite(entry.priority)) {
    throw new Error(`${entry.id}.priority must be finite`);
  }
  if (typeof entry.selectable !== "boolean") {
    throw new Error(`${entry.id}.selectable must be boolean`);
  }
  if ("outOfBounds" in entry || "outOfBoundsReason" in entry) {
    throw new Error(`${entry.id} must not store runtime bounds state`);
  }
  assertFinitePoint(entry.wgs84, `${entry.id}.wgs84`, ["lng", "lat"]);
  assertFinitePoint(entry.itmCenter, `${entry.id}.itmCenter`, ["x", "y"]);
  validateBoundsPolicy(entry.boundsPolicy, entry.id);
  validateViewportTarget(entry.target);
  return true;
}

function validatePlaceCatalog(catalog) {
  if (!isPlainObject(catalog)) {
    throw new Error("Place catalog must be an object");
  }
  if (catalog.schemaVersion !== 1) {
    throw new Error("Place catalog schemaVersion must be 1");
  }
  if (!Array.isArray(catalog.entries) || catalog.entries.length === 0) {
    throw new Error("Place catalog entries must be a non-empty array");
  }
  const ids = new Set();
  for (const entry of catalog.entries) {
    validatePlaceEntry(entry);
    if (ids.has(entry.id)) {
      throw new Error(`Duplicate place id ${entry.id}`);
    }
    ids.add(entry.id);
  }
  return true;
}

export { validatePlaceCatalog, validatePlaceEntry, validateViewportTarget };
