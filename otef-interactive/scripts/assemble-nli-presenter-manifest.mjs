import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { presenterCopyKey } from "../frontend/src/remote/nli-presenter-content.js";
import { fileDigests, refreshPresenterRouteEvidenceFromFiles } from "./nli-route-curation-digests.mjs";
export { refreshPresenterRouteEvidence } from "./nli-route-curation-digests.mjs";

const hash = (value) => createHash("sha256").update(value).digest("hex");
const json = (value) => `${JSON.stringify(value, null, 2)}\n`;
const artifactNames = {
  "nli.investigation_polygons": "investigation_polygons.geojson",
  "nli.lines": "lines.geojson",
  "nli.alarms": "alarms.geojson",
};

function refsForGroup(source, usedIds, artifactFilter = null) {
  const selected = new Set(usedIds || []);
  return source.sources.flatMap((item) => {
    const key = `${item.artifact}:${item.id}`;
    if (!selected.has(key) || (artifactFilter && item.artifact !== artifactFilter)) return [];
    return item.sourceRefs || [];
  });
}

function copyBody(copy) {
  return {
    he: { timeLabel: copy.he.timeLabel, title: copy.he.title, summary: copy.he.summary ?? null, details: copy.he.details ?? null },
    en: { timeLabel: copy.en.timeLabel, title: copy.en.title, summary: copy.en.summary ?? null, details: copy.en.details ?? null },
  };
}

function addRecord(records, key, copy, sourceRefs) {
  if (records[key]) throw new Error(`Duplicate presenter record key: ${key}`);
  records[key] = { ...copyBody(copy), sourceRefs };
}

export function assemblePresenterManifest({ inputDir, runtimeDir, provenance, editorialEvidence = null }) {
  const read = (name) => JSON.parse(fs.readFileSync(path.join(inputDir, name), "utf8"));
  if (!provenance) throw new Error("Accepted provenance record is required");
  const index = read("index.json");
  const runtime = Object.fromEntries(Object.entries(artifactNames).map(([id, name]) => {
    const bytes = fs.readFileSync(path.join(runtimeDir, name));
    const artifact = JSON.parse(bytes.toString("utf8"));
    return [id, { byteSha256: hash(bytes), featureSha256: hash(Buffer.from(JSON.stringify(artifact.features))), features: artifact.features }];
  }));
  const records = {};
  for (const partition of ["early", "later"]) {
    const sourceGroups = new Map(read(`${partition}-source.json`).map((row) => [row.id, row]));
    for (const copy of read(`${partition}-copy.json`)) {
      const group = sourceGroups.get(copy.id);
      if (!group) throw new Error(`Missing source group for ${copy.id}`);
      const refs = refsForGroup(group, copy.usedSourceIds);
      for (const membership of group.memberships) {
        addRecord(records, presenterCopyKey(null, membership, group.minute), copy, refs);
      }
    }
  }
  const alarmGroups = new Map(read("alarms-source.json").map((row) => [row.id, row]));
  for (const copy of read("alarms-copy.json")) {
    const group = alarmGroups.get(copy.id);
    if (!group) throw new Error(`Missing source group for ${copy.id}`);
    const sources = new Set(copy.usedCities || []);
    const refs = group.sources.filter((item) => sources.has(item.city)).map((item) => item.sourceRef);
    addRecord(records, presenterCopyKey(null, ["nli.alarms"], group.minute), copy, refs);
  }
  const novaGroups = new Map(read("nova-source.json").map((row) => [row.id, row]));
  const novaRequests = index.requests.filter((request) => request.narrativeId === "nova");
  for (const copy of read("nova-copy.json")) {
    const group = novaGroups.get(copy.id);
    if (!group) throw new Error(`Missing source group for ${copy.id}`);
    const refs = refsForGroup(group, copy.usedSourceIds, "nli.investigation_polygons");
    for (const request of novaRequests) {
      if (request.minutes.includes(group.minute)) {
        addRecord(records, presenterCopyKey("nova", request.membership, group.minute), copy, refs);
      }
    }
  }
  const artifacts = Object.fromEntries(Object.entries(provenance.artifacts).map(([id, source]) => [id, {
    captionFields: source.captionFields,
    acceptedCaptionSha256: source.acceptedCaptionSha256,
    packagedByteSha256: source.packagedByteSha256,
    runtimeByteSha256: runtime[id].byteSha256,
    runtimeFeatureSha256: runtime[id].featureSha256,
  }]));
  const manifest = {
    schemaVersion: 1,
    acceptedSourceSha256: provenance.acceptedSourceSha256,
    datasetVersion: provenance.datasetVersion,
    requiredArtifacts: Object.fromEntries(Object.entries(runtime).map(([id, artifact]) => [id, artifact.featureSha256])),
    records,
    sourceEvidence: {
      acceptedSourceSha256: provenance.acceptedSourceSha256,
      datasetVersion: provenance.datasetVersion,
      acceptedPackageSha256: provenance.packageSha256,
      packageSha256: provenance.packageSha256,
      existingDecisionIds: provenance.existingReview.decisionIds,
      existingReview: provenance.existingReview,
      artifacts,
      excludedVisualAugmentation: provenance.visualRouteAugmentation,
      membershipRequests: index.requests.length,
      expectedRecordKeys: index.requests.reduce((sum, request) => sum + request.minutes.length, 0),
    },
    editorialEvidence: editorialEvidence || { status: "pending-editorial-recheck", recordsSha256: hash(Buffer.from(JSON.stringify(records))) },
  };
  if (editorialEvidence && (editorialEvidence.status !== "source-checked" || editorialEvidence.checkedBy !== "Sol"
    || editorialEvidence.recordsSha256 !== hash(Buffer.from(JSON.stringify(records))))) {
    throw new Error("Editorial source-check evidence does not match the assembled presenter records");
  }
  return manifest;
}

function cli(args) {
  const arg = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : null; };
  const here = path.dirname(fileURLToPath(import.meta.url));
  if (args.includes("--refresh-route-evidence")) {
    const required = ["--manifest", "--metadata", "--provenance", "--recipe", "--lock", "--runtime-dir", "--output"];
    const missing = required.filter((name) => !arg(name));
    if (missing.length) throw new Error(`Route evidence refresh requires ${missing.join(", ")}`);
    const readJson = (file) => JSON.parse(fs.readFileSync(path.resolve(file), "utf8"));
    const manifest = readJson(arg("--manifest"));
    const metadata = readJson(arg("--metadata"));
    const provenance = readJson(arg("--provenance"));
    const recipe = path.resolve(arg("--recipe"));
    const lock = readJson(arg("--lock"));
    const routeFile = path.join(path.resolve(arg("--runtime-dir")), "lines.geojson");
    const route = fileDigests(routeFile);
    const refreshed = refreshPresenterRouteEvidenceFromFiles({ manifest, metadata, provenance,
      artifacts: { "nli.lines": route }, recipe, lock });
    fs.writeFileSync(path.resolve(arg("--output")), json(refreshed));
    console.log(`Refreshed route evidence for ${Object.keys(refreshed.records || {}).length} existing presenter records.`);
    return;
  }
  const inputDirArg = arg("--input-dir");
  if (!inputDirArg) throw new Error("Pass --input-dir for the reviewed copy/source batch");
  const inputDir = path.resolve(inputDirArg);
  const runtimeDir = path.resolve(arg("--runtime-dir") || path.join(here, "../public/processed/layers/nli"));
  const provenancePath = path.resolve(arg("--provenance") || path.join(here, "nli-presenter-provenance.json"));
  const provenance = JSON.parse(fs.readFileSync(provenancePath, "utf8"));
  const output = arg("--output");
  if (!output) throw new Error("Pass --output explicitly; assembly never writes the production manifest by default");
  const evidencePath = arg("--editorial-evidence");
  const editorialEvidence = evidencePath ? JSON.parse(fs.readFileSync(path.resolve(evidencePath), "utf8")) : null;
  const manifest = assemblePresenterManifest({ inputDir, runtimeDir, provenance, editorialEvidence });
  fs.writeFileSync(path.resolve(output), json(manifest));
  console.log(`Assembled ${Object.keys(manifest.records).length} presenter records (${manifest.editorialEvidence.status}).`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  try { cli(process.argv.slice(2)); } catch (error) { console.error(error.message); process.exitCode = 1; }
}
