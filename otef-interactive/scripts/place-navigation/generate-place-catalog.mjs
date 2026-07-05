import { readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import proj4 from "proj4";
import {
  DEFAULT_CUSTOM_RADIUS_METERS,
  DEFAULT_YESHUV_RADIUS_METERS,
  deriveViewportTarget,
} from "../../frontend/src/shared/place-navigation/viewport-target.js";
import { validatePlaceCatalog } from "./place-catalog-validation.mjs";

const WGS84 = "EPSG:4326";
const ISRAEL_TM_GRID =
  "+proj=tmerc +lat_0=31.73439361111111 +lon_0=35.20451694444445 +k=1.0000067 +x_0=219529.584 +y_0=626907.39 +ellps=GRS80 +towgs84=-48,55,52,0,0,0,0 +units=m +no_defs";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const packageRoot = path.resolve(scriptDir, "../..");
const sourceDir = path.join(packageRoot, "public", "processed", "layers", "projector_base");
const settlementNamesLayerName = "שמות_יישובים.geojson";
const settlementNamesPath = path.join(sourceDir, settlementNamesLayerName);
const locationLinesPath = path.join(sourceDir, "Locations_Lines.geojson");
const settlementOutlineMapPath = path.join(sourceDir, "yeshuv-outline-map.json");
const manualPath = path.join(scriptDir, "manual-place-aliases.json");
const pairingContractPath = path.join(
  scriptDir,
  "place-catalog-pairing-contract.json",
);
const moduleOutputPath = path.join(
  packageRoot,
  "frontend",
  "src",
  "shared",
  "place-navigation",
  "place-catalog.generated.js",
);

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function dedupeStrings(values) {
  const seen = new Set();
  const out = [];
  for (const value of values) {
    if (typeof value !== "string") continue;
    const trimmed = value.trim();
    if (!trimmed) continue;
    const key = trimmed.toLocaleLowerCase("he");
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(trimmed);
  }
  return out;
}

function isFiniteNumber(value) {
  return typeof value === "number" && Number.isFinite(value);
}

function assertFinitePoint(point, label, keys) {
  if (!point || typeof point !== "object") {
    throw new Error(`${label} point is required`);
  }
  for (const key of keys) {
    if (!isFiniteNumber(point[key])) {
      throw new Error(`${label}.${key} must be finite`);
    }
  }
}

function roundNumber(value) {
  return Number(value.toFixed(6));
}

function roundPoint(point, keys) {
  return Object.fromEntries(keys.map((key) => [key, roundNumber(point[key])]));
}

function roundTarget(target) {
  const bbox = target.bbox.map(roundNumber);
  return {
    bbox,
    corners: {
      sw: { x: bbox[0], y: bbox[1] },
      se: { x: bbox[2], y: bbox[1] },
      nw: { x: bbox[0], y: bbox[3] },
      ne: { x: bbox[2], y: bbox[3] },
    },
    zoom: target.zoom,
  };
}

function wgs84ToItm(centerWgs84) {
  assertFinitePoint(centerWgs84, "center.wgs84", ["lng", "lat"]);
  const [x, y] = proj4(WGS84, ISRAEL_TM_GRID, [centerWgs84.lng, centerWgs84.lat]);
  return { x, y };
}

function lineEndpointWgs84(feature, label) {
  const coordinates = feature?.geometry?.coordinates;
  if (feature?.geometry?.type !== "LineString" || !Array.isArray(coordinates) || coordinates.length < 2) {
    throw new Error(`${label} must be a LineString with at least two coordinates`);
  }
  const endpoint = coordinates[coordinates.length - 1];
  if (!Array.isArray(endpoint) || endpoint.length < 2 || !isFiniteNumber(endpoint[0]) || !isFiniteNumber(endpoint[1])) {
    throw new Error(`${label} endpoint must contain finite lng/lat coordinates`);
  }
  return { lng: endpoint[0], lat: endpoint[1] };
}

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, "utf8"));
}

async function readSettlementNamesGeojson() {
  const geojson = await readJson(settlementNamesPath);
  return { name: settlementNamesLayerName, geojson };
}

function getYeshuvLabelFeatures(layerName, geojson) {
  const features = asArray(geojson.features);
  features.forEach((feature, index) => {
    const props = feature?.properties || {};
    if (
      feature?.geometry?.type !== "Point" ||
      typeof props.cityname !== "string" ||
      typeof props.citycode !== "string"
    ) {
      throw new Error(
        `${layerName} feature ${index} must be a Point with string cityname/citycode properties`,
      );
    }
  });
  return features;
}

function collectGeometryPoints(coordinates, out = []) {
  if (!Array.isArray(coordinates)) return out;
  if (typeof coordinates[0] === "number") {
    out.push(coordinates);
    return out;
  }
  for (const value of coordinates) collectGeometryPoints(value, out);
  return out;
}

function featureBbox(feature, label) {
  const points = collectGeometryPoints(feature?.geometry?.coordinates);
  if (points.length === 0) {
    throw new Error(`${label} must include geometry coordinates`);
  }
  return points.reduce(
    (bbox, point) => [
      Math.min(bbox[0], point[0]),
      Math.min(bbox[1], point[1]),
      Math.max(bbox[2], point[0]),
      Math.max(bbox[3], point[1]),
    ],
    [Infinity, Infinity, -Infinity, -Infinity],
  );
}

function featureBboxCenterWgs84(feature, label) {
  const bbox = featureBbox(feature, label);
  return {
    lng: (bbox[0] + bbox[2]) / 2,
    lat: (bbox[1] + bbox[3]) / 2,
  };
}

async function readSettlementOutlineFeatures() {
  const fileNames = await readdir(sourceDir);
  for (const fileName of fileNames) {
    if (!fileName.endsWith(".geojson")) continue;
    const geojson = await readJson(path.join(sourceDir, fileName));
    const firstFeature = asArray(geojson.features)[0];
    if (firstFeature?.properties?.Shape_Area === undefined) continue;
    const features = asArray(geojson.features);
    features.forEach((feature, index) => {
      if (!["Polygon", "MultiPolygon"].includes(feature?.geometry?.type)) {
        throw new Error(`${fileName} feature ${index} must be a Polygon or MultiPolygon`);
      }
      getFeatureObjectId(feature, `${fileName} feature ${index}`);
    });
    return { name: fileName, features };
  }
  throw new Error("Could not find settlement outline GeoJSON with Shape_Area properties");
}

function buildReviewedOutlineTargetByCitycode(
  outlineMap,
  labelFeatures,
  outlineFeatures,
) {
  if (!outlineMap || typeof outlineMap !== "object") {
    throw new Error("Reviewed yeshuv outline map is required");
  }
  if (outlineMap.schemaVersion !== 1) {
    throw new Error(
      `Reviewed yeshuv outline map schemaVersion must be 1, got ${outlineMap.schemaVersion ?? "(missing)"}`,
    );
  }

  const labelCitycodes = new Set(
    labelFeatures
      .map((feature) => feature?.properties?.citycode)
      .filter((citycode) => typeof citycode === "string"),
  );
  const outlineByObjectId = buildObjectIdIndex(outlineFeatures, "settlement outlines");
  const byCitycode = new Map();

  for (const [index, match] of asArray(outlineMap.matches).entries()) {
    const citycode = typeof match?.citycode === "string" ? match.citycode : null;
    const outlineObjectId = normalizeObjectId(match?.outlineObjectId);
    if (!citycode || !outlineObjectId) {
      throw new Error(`Reviewed yeshuv outline map match ${index} must include citycode and outlineObjectId`);
    }
    if (!labelCitycodes.has(citycode)) {
      throw new Error(`Reviewed yeshuv outline map references unknown citycode ${citycode}`);
    }
    if (byCitycode.has(citycode)) {
      throw new Error(`Reviewed yeshuv outline map has duplicate citycode ${citycode}`);
    }
    const outlineFeature = outlineByObjectId.get(outlineObjectId);
    if (!outlineFeature) {
      throw new Error(`Reviewed yeshuv outline map references missing outline OBJECTID ${outlineObjectId}`);
    }
    byCitycode.set(
      citycode,
      featureBboxCenterWgs84(
        outlineFeature,
        `settlement outline OBJECTID ${outlineObjectId}`,
      ),
    );
  }

  return byCitycode;
}

async function readLocationLineFeatures(expectedCount) {
  const geojson = await readJson(locationLinesPath);
  const features = asArray(geojson.features);
  if (features.length !== expectedCount) {
    throw new Error(
      `Locations_Lines.geojson feature count ${features.length} must match settlement label count ${expectedCount}`,
    );
  }
  return features;
}

function normalizeObjectId(value) {
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value === "string" && value.trim()) return value.trim();
  return null;
}

function compareNormalizedObjectIds(a, b) {
  const aNumber = Number(a);
  const bNumber = Number(b);
  if (Number.isFinite(aNumber) && Number.isFinite(bNumber)) {
    return aNumber - bNumber;
  }
  return String(a).localeCompare(String(b), "he");
}

function normalizeObjectIdList(values) {
  return asArray(values)
    .map((value) => normalizeObjectId(value))
    .filter((value) => value !== null)
    .sort(compareNormalizedObjectIds);
}

function haveSameObjectIds(left, right) {
  return (
    left.length === right.length &&
    left.every((value, index) => value === right[index])
  );
}

function getFeatureObjectId(feature, label) {
  const objectId = normalizeObjectId(feature?.properties?.OBJECTID);
  if (!objectId) {
    throw new Error(`${label} must include a finite OBJECTID`);
  }
  return objectId;
}

function buildObjectIdIndex(features, layerLabel) {
  const byObjectId = new Map();
  for (const [index, feature] of features.entries()) {
    const objectId = getFeatureObjectId(feature, `${layerLabel} feature ${index}`);
    if (byObjectId.has(objectId)) {
      throw new Error(`${layerLabel} duplicate OBJECTID ${objectId}`);
    }
    byObjectId.set(objectId, feature);
  }
  return byObjectId;
}

function createObjectIdMismatchError(layerName, missingLineObjectIds, unexpectedLineObjectIds) {
  return new Error(
    `OBJECTID mismatch between ${layerName} and Locations_Lines.geojson; missing line OBJECTIDs: ${missingLineObjectIds.join(", ") || "(none)"}; unexpected line OBJECTIDs: ${unexpectedLineObjectIds.join(", ") || "(none)"}`,
  );
}

function validateReviewedPairingContract(
  pairingContract,
  layerName,
  missingLineObjectIds,
  unexpectedLineObjectIds,
  labelByObjectId,
  lineByObjectId,
) {
  if (!pairingContract || typeof pairingContract !== "object") {
    throw new Error("Reviewed pairing contract is required for OBJECTID mismatches");
  }
  if (pairingContract.schemaVersion !== 1) {
    throw new Error(
      `Reviewed pairing contract schemaVersion must be 1, got ${pairingContract.schemaVersion ?? "(missing)"}`,
    );
  }
  if (pairingContract.labelLayer !== layerName) {
    throw new Error(
      `Reviewed pairing contract labelLayer ${pairingContract.labelLayer || "(missing)"} does not match ${layerName}`,
    );
  }
  if (pairingContract.policy !== "exact-match-outside-reviewed-ordinal-ranges") {
    throw new Error(
      `Reviewed pairing contract policy must be exact-match-outside-reviewed-ordinal-ranges, got ${pairingContract.policy || "(missing)"}`,
    );
  }
  if (pairingContract.lineLayer !== "Locations_Lines.geojson") {
    throw new Error(
      `Reviewed pairing contract lineLayer ${pairingContract.lineLayer || "(missing)"} does not match Locations_Lines.geojson`,
    );
  }

  const expectedMissingLineObjectIds = normalizeObjectIdList(
    pairingContract.reviewedMissingLineObjectIds,
  );
  const expectedUnexpectedLineObjectIds = normalizeObjectIdList(
    pairingContract.reviewedUnexpectedLineObjectIds,
  );

  if (
    !haveSameObjectIds(missingLineObjectIds, expectedMissingLineObjectIds) ||
    !haveSameObjectIds(unexpectedLineObjectIds, expectedUnexpectedLineObjectIds)
  ) {
    throw new Error(
      `Reviewed pairing contract drift for ${layerName}: expected missing line OBJECTIDs ${expectedMissingLineObjectIds.join(", ") || "(none)"} and unexpected line OBJECTIDs ${expectedUnexpectedLineObjectIds.join(", ") || "(none)"}, got missing ${missingLineObjectIds.join(", ") || "(none)"} and unexpected ${unexpectedLineObjectIds.join(", ") || "(none)"}`,
    );
  }

  const ordinalFallbackLabelObjectIds = normalizeObjectIdList(
    pairingContract.ordinalFallbackLabelObjectIds,
  );
  const ordinalFallbackLineObjectIds = normalizeObjectIdList(
    pairingContract.ordinalFallbackLineObjectIds,
  );
  if (
    ordinalFallbackLabelObjectIds.length === 0 ||
    ordinalFallbackLineObjectIds.length === 0
  ) {
    throw new Error("Reviewed pairing contract must declare ordinal fallback OBJECTID ranges");
  }
  if (ordinalFallbackLabelObjectIds.length !== ordinalFallbackLineObjectIds.length) {
    throw new Error("Reviewed pairing contract ordinal fallback ranges must be the same length");
  }

  for (const objectId of ordinalFallbackLabelObjectIds) {
    if (!labelByObjectId.has(objectId)) {
      throw new Error(
        `Reviewed pairing contract references missing label OBJECTID ${objectId}`,
      );
    }
  }
  for (const objectId of ordinalFallbackLineObjectIds) {
    if (!lineByObjectId.has(objectId)) {
      throw new Error(
        `Reviewed pairing contract references missing line OBJECTID ${objectId}`,
      );
    }
  }

  return {
    ordinalFallbackLabelObjectIds,
    ordinalFallbackLineObjectIds,
  };
}

function pairLabelFeaturesWithLocationLines(
  labelFeatures,
  locationLineFeatures,
  layerName,
  options = {},
) {
  const pairingContract = options.pairingContract || null;
  if (locationLineFeatures.length !== labelFeatures.length) {
    throw new Error(
      `Locations_Lines.geojson feature count ${locationLineFeatures.length} must match settlement label count ${labelFeatures.length}`,
    );
  }

  const labelByObjectId = buildObjectIdIndex(labelFeatures, layerName);
  const lineByObjectId = buildObjectIdIndex(locationLineFeatures, "Locations_Lines.geojson");
  const missingLineObjectIds = normalizeObjectIdList(
    [...labelByObjectId.keys()].filter((objectId) => !lineByObjectId.has(objectId)),
  );
  const unexpectedLineObjectIds = normalizeObjectIdList(
    [...lineByObjectId.keys()].filter((objectId) => !labelByObjectId.has(objectId)),
  );

  const hasMismatch =
    missingLineObjectIds.length > 0 || unexpectedLineObjectIds.length > 0;

  if (!hasMismatch) {
    if (pairingContract) {
      validateReviewedPairingContract(
        pairingContract,
        layerName,
        missingLineObjectIds,
        unexpectedLineObjectIds,
        labelByObjectId,
        lineByObjectId,
      );
    }
    return labelFeatures.map((labelFeature, index) => ({
      labelFeature,
      locationLineFeature: lineByObjectId.get(
        getFeatureObjectId(labelFeature, `${layerName} feature ${index}`),
      ),
    }));
  }

  if (pairingContract) {
    const {
      ordinalFallbackLabelObjectIds,
      ordinalFallbackLineObjectIds,
    } = validateReviewedPairingContract(
      pairingContract,
      layerName,
      missingLineObjectIds,
      unexpectedLineObjectIds,
      labelByObjectId,
      lineByObjectId,
    );
    const fallbackLabelObjectIdSet = new Set(ordinalFallbackLabelObjectIds);
    const pairedLineByLabelObjectId = new Map();

    for (const objectId of labelByObjectId.keys()) {
      if (fallbackLabelObjectIdSet.has(objectId)) continue;
      const exactLineFeature = lineByObjectId.get(objectId);
      if (!exactLineFeature) {
        throw new Error(
          `Reviewed pairing contract must explicitly cover non-exact label OBJECTID ${objectId}`,
        );
      }
      pairedLineByLabelObjectId.set(objectId, exactLineFeature);
    }

    for (const [index, labelObjectId] of ordinalFallbackLabelObjectIds.entries()) {
      pairedLineByLabelObjectId.set(
        labelObjectId,
        lineByObjectId.get(ordinalFallbackLineObjectIds[index]),
      );
    }

    return labelFeatures.map((labelFeature, index) => {
      const objectId = getFeatureObjectId(labelFeature, `${layerName} feature ${index}`);
      const locationLineFeature = pairedLineByLabelObjectId.get(objectId);
      if (!locationLineFeature) {
        throw new Error(
          `Reviewed pairing contract did not produce a line feature for label OBJECTID ${objectId}`,
        );
      }
      return { labelFeature, locationLineFeature };
    });
  }

  throw createObjectIdMismatchError(
    layerName,
    missingLineObjectIds,
    unexpectedLineObjectIds,
  );
}

function validateManualSourceContract(manualEntries, sourceCitycodes) {
  const seenCitycodes = new Set();
  for (const entry of asArray(manualEntries)) {
    if (entry.type === "yeshuv") {
      if (typeof entry.citycode !== "string" || entry.citycode.trim() === "") {
        throw new Error(`Manual yeshuv entry ${entry.id || "(missing id)"} must include citycode`);
      }
      if (!sourceCitycodes.has(entry.citycode)) {
        throw new Error(`Unmatched manual yeshuv entry ${entry.id || "(missing id)"} citycode ${entry.citycode}`);
      }
      if (entry.id !== `yeshuv-${entry.citycode}`) {
        throw new Error(`Manual yeshuv entry ${entry.id || "(missing id)"} must match citycode ${entry.citycode}`);
      }
      if (seenCitycodes.has(entry.citycode)) {
        throw new Error(`Duplicate manual yeshuv entry for citycode ${entry.citycode}`);
      }
      seenCitycodes.add(entry.citycode);
      continue;
    }
    if (entry.type !== "custom") {
      throw new Error(`Manual place entry ${entry.id || "(missing id)"} has unsupported type ${entry.type}`);
    }
  }
  return true;
}

function indexManualEntries(manual, sourceCitycodes) {
  validateManualSourceContract(manual.entries, sourceCitycodes);
  const byCitycode = new Map();
  const custom = [];
  for (const entry of asArray(manual.entries)) {
    if (entry.type === "custom") {
      custom.push(entry);
      continue;
    }
    byCitycode.set(entry.citycode, entry);
  }
  return { byCitycode, custom };
}

function makeBoundsPolicy(selectable) {
  return selectable
    ? { mode: "requireWithinOtefBounds", reasonKey: "placeOutOfBounds" }
    : undefined;
}

function makeNavigationFields(centerWgs84, targetOverrides, defaultRadiusMeters) {
  const centerItm = wgs84ToItm(centerWgs84);
  return {
    wgs84: roundPoint(centerWgs84, ["lng", "lat"]),
    itmCenter: roundPoint(centerItm, ["x", "y"]),
    target: roundTarget(
      deriveViewportTarget({
        centerItm,
        radiusMeters: targetOverrides.radiusMeters,
        defaultRadiusMeters,
        bbox: targetOverrides.bbox,
        zoom: targetOverrides.zoom,
      }),
    ),
  };
}

function makeYeshuvEntry(feature, layerName, manualEntry, navigationWgs84) {
  const props = feature.properties || {};
  const targetOverrides = manualEntry?.target || {};
  const aliases = manualEntry?.aliases || {};
  const name = { he: props.cityname };
  const selectable = manualEntry?.selectable === undefined ? true : !!manualEntry.selectable;
  if (manualEntry?.name?.en) name.en = manualEntry.name.en;

  return {
    id: `yeshuv-${props.citycode}`,
    type: "yeshuv",
    source: {
      kind: "geojson",
      file: `projector_base/${layerName}`,
      featureId: props.citycode,
    },
    name,
    aliases: {
      he: dedupeStrings([props.cityname, props.citylabel, ...asArray(aliases.he)]),
      en: dedupeStrings([manualEntry?.name?.en, ...asArray(aliases.en)]),
    },
    priority: Number.isFinite(manualEntry?.priority) ? manualEntry.priority : 0,
    selectable,
    boundsPolicy: makeBoundsPolicy(selectable),
    ...makeNavigationFields(navigationWgs84, targetOverrides, DEFAULT_YESHUV_RADIUS_METERS),
  };
}

function makeCustomEntry(manualEntry) {
  const centerWgs84 = manualEntry.center?.wgs84;
  const targetOverrides = manualEntry.target || {};
  const selectable = manualEntry.selectable === undefined ? true : !!manualEntry.selectable;
  return {
    id: manualEntry.id,
    type: "custom",
    source: {
      kind: "manual",
      file: "manual-place-aliases.json",
    },
    name: {
      he: manualEntry.name.he,
      en: manualEntry.name.en,
    },
    aliases: {
      he: dedupeStrings([manualEntry.name.he, ...asArray(manualEntry.aliases?.he)]),
      en: dedupeStrings([manualEntry.name.en, ...asArray(manualEntry.aliases?.en)]),
    },
    priority: Number.isFinite(manualEntry.priority) ? manualEntry.priority : 0,
    selectable,
    boundsPolicy: makeBoundsPolicy(selectable),
    ...makeNavigationFields(centerWgs84, targetOverrides, DEFAULT_CUSTOM_RADIUS_METERS),
  };
}

async function buildPlaceCatalog() {
  const [
    { name: layerName, geojson },
    { features: outlineFeatures },
    manual,
    outlineMap,
  ] = await Promise.all([
    readSettlementNamesGeojson(),
    readSettlementOutlineFeatures(),
    readJson(manualPath),
    readJson(settlementOutlineMapPath),
  ]);
  const labelFeatures = getYeshuvLabelFeatures(layerName, geojson);
  const outlineTargetByCitycode = buildReviewedOutlineTargetByCitycode(
    outlineMap,
    labelFeatures,
    outlineFeatures,
  );
  const sourceCitycodes = new Set(
    labelFeatures
      .map((feature) => feature?.properties?.citycode)
      .filter((citycode) => typeof citycode === "string"),
  );
  const manualIndex = indexManualEntries(manual, sourceCitycodes);
  const entries = [];

  for (const feature of labelFeatures) {
    const props = feature.properties || {};
    const manualEntry = manualIndex.byCitycode.get(props.citycode);
    const navigationWgs84 =
      manualEntry?.center?.wgs84 || outlineTargetByCitycode.get(props.citycode);
    if (!navigationWgs84) continue;
    entries.push(
      makeYeshuvEntry(
        feature,
        layerName,
        manualEntry,
        navigationWgs84,
      ),
    );
  }

  for (const manualEntry of manualIndex.custom) {
    entries.push(makeCustomEntry(manualEntry));
  }

  entries.sort((a, b) => a.id.localeCompare(b.id, "he"));
  const catalog = {
    schemaVersion: 1,
    entries,
  };
  validatePlaceCatalog(catalog);
  return catalog;
}

function formatCatalog(catalog) {
  return `${JSON.stringify(catalog, null, 2)}\n`;
}

async function generatePlaceCatalog(options = {}) {
  const check = options.check === true;
  const catalog = await buildPlaceCatalog();
  const nextJsonContent = formatCatalog(catalog);
  const nextModuleContent = `const catalog = ${nextJsonContent};\n\nexport default catalog;\n`;
  const relativeModuleOutputPath = path.relative(packageRoot, moduleOutputPath);

  if (check) {
    const currentModuleContent = await readFile(moduleOutputPath, "utf8");
    if (currentModuleContent !== nextModuleContent) {
      throw new Error(
        `Place catalog is stale. Run npm run generate:place-catalog to update ${relativeModuleOutputPath}`,
      );
    }
    console.log(`Place catalog is fresh at ${relativeModuleOutputPath}`);
    return catalog;
  }

  const reviewedEnglishCount = catalog.entries.filter((entry) => entry.name.en || entry.aliases.en.length > 0).length;
  await writeFile(moduleOutputPath, nextModuleContent, "utf8");
  console.log(
    `Generated ${catalog.entries.length} place entries (${reviewedEnglishCount} with reviewed English) at ${relativeModuleOutputPath}`,
  );
  return catalog;
}

function parseCliOptions(argv) {
  return {
    check: argv.includes("--check"),
  };
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  generatePlaceCatalog(parseCliOptions(process.argv.slice(2))).catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}

export {
  buildPlaceCatalog,
  generatePlaceCatalog,
  pairLabelFeaturesWithLocationLines,
  validateManualSourceContract,
};
