import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const validatedCurationProofs = new WeakMap();
export const ROUTE_CURATION_PINS = Object.freeze({
  schemaVersion: 1,
  baseSourceSha256: "18b0e3445c771da9c3e7995270601f7a1187501bd3bfdf6b3e0fa2c6cedc6462",
  baseRuntimeSha256: "934bd4be7a1d6a4f1b6a0f62337384d06624e571a6efe44da366ab6062afa3c1",
  confirmedFeaturesSha256: "c2d3ec3f50f0c016e6665b39ed93ed758020cf0c2a8339153cb1f51326039358",
  borderSha256: "eaa77f9e0e3572487efc3b3d597530c885cbf86baf6ce1ee51b04b378da8e23b",
  roadSha256: "db6a72f9b5361089f75564de8a198cf5df2514023588aacb5d6dbe0a6ed1a8af",
  counts: Object.freeze({ features: 89, confirmed: 68, unconfirmed: 21 }),
  addedObjectIds: Object.freeze([1013, 1014, 1015, 1016, 1017, 1018, 1019, 1020, 1021]),
  editedObjectIds: Object.freeze([1001, 1002, 1005, 1006, 1008, 1009, 1010, 1011, 1012]),
});

function sortedJson(value) {
  if (typeof value === "number" && !Number.isFinite(value)) throw new TypeError("Canonical JSON requires finite numbers");
  if (Array.isArray(value)) return value.map(sortedJson);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, sortedJson(value[key])]));
  }
  return value;
}

export function canonicalSha256(value) {
  return sha256(Buffer.from(JSON.stringify(sortedJson(value)), "utf8"));
}

export function confirmedFeaturesSha256(features) {
  if (!Array.isArray(features)) throw new TypeError("Route features must be an array");
  return canonicalSha256(features.filter((feature) => feature?.properties?.route_confidence !== "unconfirmed"));
}

export function runtimeFeaturesSha256(features) {
  if (!Array.isArray(features)) throw new TypeError("Runtime features must be an array");
  return sha256(Buffer.from(JSON.stringify(features), "utf8"));
}

export function fileDigests(filePath) {
  const bytes = fs.readFileSync(filePath);
  const document = JSON.parse(bytes.toString("utf8"));
  if (!Array.isArray(document?.features)) throw new TypeError(`GeoJSON has no feature array: ${filePath}`);
  return {
    byteSha256: sha256(bytes),
    featureSha256: runtimeFeaturesSha256(document.features),
    confirmedFeaturesSha256: confirmedFeaturesSha256(document.features),
    features: document.features,
  };
}

function deepEqual(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function objectIds(features) {
  return features.map((feature) => Number(feature?.properties?.OBJECTID)).filter(Number.isFinite).sort((a, b) => a - b);
}

function curationErrors(curation, recipeSha256, artifacts) {
  const errors = [];
  if (!curation || curation.schemaVersion !== ROUTE_CURATION_PINS.schemaVersion) errors.push("Route curation schema version is missing or unsupported");
  if (curation?.recipeSha256 !== recipeSha256) errors.push("Route curation recipe hash differs from the exact recipe file bytes");
  for (const key of ["recipeSha256", "derivedSourceSha256", "runtimeByteSha256", "runtimeFeatureSha256"]) {
    if (!/^[a-f0-9]{64}$/.test(String(curation?.[key] || ""))) errors.push(`Route curation ${key} must be a lowercase SHA-256 digest`);
  }
  for (const key of ["baseSourceSha256", "baseRuntimeSha256", "confirmedFeaturesSha256", "borderSha256", "roadSha256"]) {
    if (String(curation?.[key] || "").toLowerCase() !== ROUTE_CURATION_PINS[key]) errors.push(`Route curation ${key} differs from the pinned baseline`);
  }
  if (!deepEqual(curation?.counts, ROUTE_CURATION_PINS.counts)) errors.push("Route curation feature counts differ from the reviewed route set");
  if (!deepEqual(curation?.addedObjectIds, ROUTE_CURATION_PINS.addedObjectIds)) errors.push("Route curation added object IDs differ from the reviewed route set");
  if (!deepEqual(curation?.editedObjectIds, ROUTE_CURATION_PINS.editedObjectIds)) errors.push("Route curation edited object IDs differ from the reviewed route set");
  const route = artifacts?.["nli.lines"];
  if (!route || !Array.isArray(route.features)) errors.push("Current route artifact evidence is missing");
  else {
    if (route.byteSha256?.toLowerCase() !== curation?.runtimeByteSha256) errors.push("Route curation runtime byte hash differs from current artifact");
    const featureHash = route.featureSha256 || runtimeFeaturesSha256(route.features);
    if (featureHash?.toLowerCase() !== curation?.runtimeFeatureSha256) errors.push("Route curation runtime feature hash differs from current artifact");
    if (confirmedFeaturesSha256(route.features) !== ROUTE_CURATION_PINS.confirmedFeaturesSha256) errors.push("Current confirmed route features differ from the independently pinned baseline");
    if (route.features.length !== ROUTE_CURATION_PINS.counts.features) errors.push("Current route feature count differs from the reviewed route set");
    const confirmed = route.features.filter((feature) => feature?.properties?.route_confidence !== "unconfirmed");
    const unconfirmed = route.features.filter((feature) => feature?.properties?.route_confidence === "unconfirmed");
    if (confirmed.length !== ROUTE_CURATION_PINS.counts.confirmed || unconfirmed.length !== ROUTE_CURATION_PINS.counts.unconfirmed) errors.push("Current confirmed and unconfirmed route counts differ from the reviewed route set");
    const expectedUnconfirmedIds = Array.from({ length: 21 }, (_, index) => 1001 + index);
    if (!deepEqual(objectIds(unconfirmed), expectedUnconfirmedIds)) errors.push("Current unconfirmed route IDs differ from the reviewed route set");
  }
  return errors;
}

function readRecipe(recipe) {
  if (typeof recipe === "string") {
    const bytes = fs.readFileSync(recipe);
    return { document: JSON.parse(bytes.toString("utf8")), sha256: sha256(bytes) };
  }
  if (!recipe || typeof recipe !== "object") throw new TypeError("Route curation recipe is missing");
  const { recipeSha256, byteSha256, ...document } = recipe;
  return { document, sha256: String(recipeSha256 || byteSha256 || "").toLowerCase() };
}

export function validateRouteBorderCuration({ recipe, lock, metadata, manifest, artifacts }) {
  const { document, sha256: recipeSha256 } = readRecipe(recipe);
  const lockCuration = lock?.curation;
  const metadataCuration = metadata?.routeBorderCuration;
  const manifestCuration = manifest?.sourceEvidence?.routeBorderCuration;
  const errors = [];
  if (!metadata) errors.push("Release metadata is required for route curation evidence");
  if (!lockCuration) errors.push("Route curation lock evidence is missing");
  if (!metadataCuration) errors.push("Release metadata route curation evidence is missing");
  if (!manifestCuration) errors.push("Presenter manifest route curation evidence is missing");
  const expectedInputs = document.expected_inputs;
  if (!expectedInputs) errors.push("Route recipe expected input identities are missing");
  else {
    if (expectedInputs.source_lines_sha256?.toLowerCase() !== ROUTE_CURATION_PINS.baseSourceSha256) errors.push("Recipe source route input hash differs from the pinned baseline");
    if (expectedInputs.runtime_lines_sha256?.toLowerCase() !== ROUTE_CURATION_PINS.baseRuntimeSha256) errors.push("Recipe runtime route input hash differs from the pinned baseline");
    if (expectedInputs.border_module_sha256_lf?.toLowerCase() !== ROUTE_CURATION_PINS.borderSha256) errors.push("Recipe border module hash differs from the pinned baseline");
    if (expectedInputs.confirmed_features_sha256?.toLowerCase() !== ROUTE_CURATION_PINS.confirmedFeaturesSha256) errors.push("Recipe confirmed route feature digest differs from the independently pinned baseline");
  }
  if (document.base_feature_count !== 80) errors.push("Recipe base route feature count differs from the pinned 80-feature source");
  if (document.road_operation?.sha256?.toLowerCase() !== ROUTE_CURATION_PINS.roadSha256) errors.push("Recipe road input hash differs from the pinned road source");
  const operations = Array.isArray(document.operations) ? document.operations : [];
  const addedIds = operations.filter((operation) => operation.kind === "new_approach").map((operation) => operation.feature_id).sort((a, b) => a - b);
  const editedIds = operations.filter((operation) => operation.kind !== "new_approach").map((operation) => operation.feature_id).sort((a, b) => a - b);
  if (!deepEqual(addedIds, [...ROUTE_CURATION_PINS.addedObjectIds].sort((a, b) => a - b))
    || !deepEqual(editedIds, [...ROUTE_CURATION_PINS.editedObjectIds].sort((a, b) => a - b))) {
    errors.push("Recipe operation IDs differ from the reviewed added and edited route IDs");
  }
  if (!recipeSha256) errors.push("Exact route recipe file hash is unavailable");
  for (const curation of [lockCuration, metadataCuration, manifestCuration]) errors.push(...curationErrors(curation, recipeSha256, artifacts));
  if (!deepEqual(lockCuration, metadataCuration) || !deepEqual(lockCuration, manifestCuration)) errors.push("Route curation evidence differs between lock, metadata, and presenter manifest");
  if (errors.length) throw new Error(errors.join("; "));
  const proof = {
    baselineRouteSha256: ROUTE_CURATION_PINS.baseRuntimeSha256,
    confirmedFeaturesSha256: ROUTE_CURATION_PINS.confirmedFeaturesSha256,
  };
  const route = artifacts["nli.lines"];
  validatedCurationProofs.set(proof, {
    byteSha256: route.byteSha256.toLowerCase(),
    featureSha256: (route.featureSha256 || runtimeFeaturesSha256(route.features)).toLowerCase(),
    confirmedFeaturesSha256: confirmedFeaturesSha256(route.features),
  });
  return proof;
}

export function isValidatedRouteCurationProof(proof, route = null) {
  const validated = proof && typeof proof === "object" ? validatedCurationProofs.get(proof) : null;
  if (!validated) return false;
  if (!route) return true;
  return route.byteSha256?.toLowerCase() === validated.byteSha256
    && (route.featureSha256 || runtimeFeaturesSha256(route.features || [])).toLowerCase() === validated.featureSha256
    && confirmedFeaturesSha256(route.features || []) === validated.confirmedFeaturesSha256;
}

export function refreshPresenterRouteEvidence({ manifest, metadata, provenance, artifacts, curation }) {
  if (!manifest || !metadata || !provenance || !curation) throw new TypeError("Manifest, metadata, provenance, and route curation evidence are required");
  const lines = artifacts?.["nli.lines"];
  if (!lines || !Array.isArray(lines.features)) throw new Error("Current runtime line artifact is required to refresh presenter evidence");
  if (!deepEqual(metadata.routeBorderCuration, curation)
    || !deepEqual(manifest.sourceEvidence?.routeBorderCuration, curation)) {
    throw new Error("Refresh requires matching route curation evidence in metadata and presenter manifest");
  }
  for (const key of ["baseSourceSha256", "baseRuntimeSha256", "confirmedFeaturesSha256", "borderSha256", "roadSha256"]) {
    if (String(curation[key] || "").toLowerCase() !== ROUTE_CURATION_PINS[key]) throw new Error(`Refresh route curation ${key} differs from the pinned baseline`);
  }
  if (curation.schemaVersion !== ROUTE_CURATION_PINS.schemaVersion
    || !deepEqual(curation.counts, ROUTE_CURATION_PINS.counts)
    || !deepEqual(curation.addedObjectIds, ROUTE_CURATION_PINS.addedObjectIds)
    || !deepEqual(curation.editedObjectIds, ROUTE_CURATION_PINS.editedObjectIds)) {
    throw new Error("Refresh route curation counts or object IDs differ from the reviewed route set");
  }
  if (manifest.acceptedSourceSha256 !== metadata.sourceSha256
    || manifest.datasetVersion !== metadata.datasetVersion
    || provenance.acceptedSourceSha256 !== metadata.sourceSha256
    || provenance.datasetVersion !== metadata.datasetVersion
    || manifest.sourceEvidence?.acceptedPackageSha256 !== provenance.packageSha256) {
    throw new Error("Refresh cannot change accepted source or package identity");
  }
  if (lines.byteSha256?.toLowerCase() !== curation.runtimeByteSha256
    || (lines.featureSha256 || runtimeFeaturesSha256(lines.features)).toLowerCase() !== curation.runtimeFeatureSha256
    || confirmedFeaturesSha256(lines.features) !== ROUTE_CURATION_PINS.confirmedFeaturesSha256) {
    throw new Error("Current route artifact does not match validated curation evidence");
  }
  const next = structuredClone(manifest);
  const id = "nli.lines";
  const provenanceArtifact = provenance.artifacts?.[id];
  if (!provenanceArtifact) throw new Error("Accepted packaged route artifact provenance is missing");
  const previousEvidence = manifest.sourceEvidence?.artifacts?.[id];
  if (!previousEvidence) throw new Error("Existing presenter route artifact evidence is missing");
  if (previousEvidence.packagedByteSha256?.toLowerCase() !== provenanceArtifact.packagedByteSha256?.toLowerCase()
    || !deepEqual(previousEvidence.captionFields, provenanceArtifact.captionFields)
    || previousEvidence.acceptedCaptionSha256?.toLowerCase() !== provenanceArtifact.acceptedCaptionSha256?.toLowerCase()) {
    throw new Error("Refresh cannot change packaged route or accepted caption evidence");
  }
  next.requiredArtifacts = { ...next.requiredArtifacts, [id]: lines.featureSha256 || runtimeFeaturesSha256(lines.features) };
  next.sourceEvidence = {
    ...next.sourceEvidence,
    routeBorderCuration: structuredClone(curation),
    artifacts: {
      ...next.sourceEvidence.artifacts,
      [id]: {
        ...previousEvidence,
        runtimeByteSha256: lines.byteSha256,
        runtimeFeatureSha256: lines.featureSha256 || runtimeFeaturesSha256(lines.features),
      },
    },
  };
  return next;
}

export function refreshPresenterRouteEvidenceFromFiles({ manifest, metadata, provenance, artifacts, recipe, lock }) {
  validateRouteBorderCuration({ recipe, lock, metadata, manifest, artifacts });
  const recipeInfo = readRecipe(recipe);
  return refreshPresenterRouteEvidence({ manifest, metadata, provenance, artifacts,
    curation: lock.curation || metadata.routeBorderCuration || manifest.sourceEvidence.routeBorderCuration || recipeInfo.document.routeBorderCuration });
}

function cli(args) {
  const fileIndex = args.indexOf("--file");
  if (fileIndex < 0 || !args[fileIndex + 1]) throw new Error("Pass --file <geojson>");
  const { byteSha256, featureSha256, confirmedFeaturesSha256: confirmed } = fileDigests(path.resolve(args[fileIndex + 1]));
  console.log(JSON.stringify({ byteSha256, featureSha256, confirmedFeaturesSha256: confirmed }));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  try { cli(process.argv.slice(2)); } catch (error) { console.error(error.message); process.exitCode = 1; }
}
