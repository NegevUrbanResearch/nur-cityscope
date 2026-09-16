import { readFile, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import {
  buildEscapeImpactContacts,
  buildFleeingCrossingIndex,
} from "../frontend/src/shared/nli-nova-escape-impact.js";
import { encodeNovaEscapeIndex } from "../frontend/src/shared/nli-nova-escape-index.js";

function requireFeatureCollection(value, label) {
  if (value?.type !== "FeatureCollection" || !Array.isArray(value.features)) {
    throw new TypeError(`${label} must be a GeoJSON FeatureCollection`);
  }
  return value.features;
}

function routeObjectId(feature) {
  const value = feature?.properties?.OBJECTID ?? feature?.id;
  return value;
}

export function buildNovaEscapeIndex({ routes, polygons, lines, settlements } = {}) {
  const routeFeatures = requireFeatureCollection(routes, "routes");
  const polygonFeatures = requireFeatureCollection(polygons, "polygons");
  const lineFeatures = requireFeatureCollection(lines, "lines");
  const settlementFeatures = requireFeatureCollection(settlements, "settlements");
  return encodeNovaEscapeIndex({
    routeIds: routeFeatures.map(routeObjectId),
    parallelCrossingIndex: buildFleeingCrossingIndex(
      routeFeatures,
      [...polygonFeatures, ...lineFeatures],
    ),
    settlementContacts: buildEscapeImpactContacts(routeFeatures, settlementFeatures),
  });
}

async function readGeoJson(file, label) {
  const text = await readFile(file, "utf8");
  let value;
  try {
    value = JSON.parse(text);
  } catch (error) {
    throw new TypeError(`${label} is not valid JSON`, { cause: error });
  }
  requireFeatureCollection(value, label);
  return value;
}

async function main(args = process.argv.slice(2)) {
  if (args.length !== 5) {
    throw new Error("usage: node generate-nova-escape-index.mjs <routes> <polygons> <lines> <settlements> <output>");
  }
  const [routes, polygons, lines, settlements] = await Promise.all([
    readGeoJson(args[0], "routes"),
    readGeoJson(args[1], "polygons"),
    readGeoJson(args[2], "lines"),
    readGeoJson(args[3], "settlements"),
  ]);
  const index = buildNovaEscapeIndex({ routes, polygons, lines, settlements });
  await writeFile(args[4], `${JSON.stringify(index)}\n`, "utf8");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error?.stack || error?.message || error);
    process.exitCode = 1;
  });
}
