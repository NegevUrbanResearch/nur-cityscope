import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { beatsForMembership } from "../frontend/src/shared/nli-investigation-clock.js";
import { NLI_NOVA_STORY } from "../frontend/src/shared/nli-nova-story.js";
import { novaVirtualMembership } from "../frontend/src/shared/nli-nova-virtual-membership.js";
import { nliFeatureBagsFromCache } from "../frontend/src/remote/nli-timeline-transport.js";
import { validatePresenterCoverage } from "../frontend/src/remote/nli-presenter-content.js";
import { confirmedFeaturesSha256, isValidatedRouteCurationProof, ROUTE_CURATION_PINS, validateRouteBorderCuration } from "./nli-route-curation-digests.mjs";
export { validateRouteBorderCuration };

export const PINNED_EXPORT_SHA256 = "ec806708e478426efa1b0b793784dac3257ca78fd742f49ca382130475400fcf";
const FIRE_ONLY_EXCLUSIONS = [572, 636, 724, 1197];
const FIRE_ONLY_EXCLUSION_EVIDENCE = FIRE_ONLY_EXCLUSIONS.map((minute) => ({ minute, reason: "fire-only" }));
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const ids = ["nli.investigation_polygons", "nli.lines", "nli.alarms"];
const names = ["investigation_polygons.geojson", "lines.geojson", "alarms.geojson"];
const pinnedByteHashes = {
  "investigation_polygons.geojson": "1ea19c33ffc98d094df295ce4a7bae3851381b07b0f65b79ab2d78bc15daa49e",
  "lines.geojson": "934bd4be7a1d6a4f1b6a0f62337384d06624e571a6efe44da366ab6062afa3c1",
  "alarms.geojson": "850ffd4cb89b62fef0a85b1c0562969bf0d829e2172f61ccc7bb2e54297b4189",
};

function sameValue(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

export function validateAcceptedEvidence({ manifest, metadata, provenance, artifacts, curationProof = null }) {
  const errors = [];
  if (!metadata?.sourceSha256 || manifest?.acceptedSourceSha256?.toLowerCase() !== metadata.sourceSha256.toLowerCase()) {
    errors.push("Presenter manifest source identity does not match accepted release metadata");
  }
  if (!metadata?.datasetVersion || manifest?.datasetVersion?.toLowerCase() !== metadata.datasetVersion.toLowerCase()) {
    errors.push("Presenter manifest dataset version does not match accepted release metadata");
  }
  const evidence = manifest?.sourceEvidence;
  if (evidence?.routeBorderCuration && !curationProof) errors.push("Derived route runtime evidence requires validated route curation proof");
  if (curationProof) {
    const routeEvidence = evidence?.routeBorderCuration;
    const route = artifacts?.["nli.lines"];
    if (!isValidatedRouteCurationProof(curationProof, route)) errors.push("Route curation proof was not produced for the current route artifact");
    if (!routeEvidence || routeEvidence.runtimeByteSha256?.toLowerCase() !== route?.byteSha256?.toLowerCase()
      || routeEvidence.runtimeFeatureSha256?.toLowerCase() !== route?.featureSha256?.toLowerCase()
      || confirmedFeaturesSha256(route?.features || []) !== ROUTE_CURATION_PINS.confirmedFeaturesSha256
      || curationProof.confirmedFeaturesSha256 !== ROUTE_CURATION_PINS.confirmedFeaturesSha256) {
      errors.push("Derived route runtime pin does not match validated curation proof");
    }
  }
  if (!evidence || evidence.packageSha256 !== evidence.acceptedPackageSha256
    || evidence.acceptedSourceSha256?.toLowerCase() !== metadata?.sourceSha256?.toLowerCase()
    || evidence.datasetVersion?.toLowerCase() !== metadata?.datasetVersion?.toLowerCase()
    || metadata?.review?.status !== "approved"
    || evidence.existingDecisionIds?.some((id) => !metadata?.review?.decisionIds?.includes(id))) {
    errors.push("Presenter source evidence does not match the accepted release identity");
  }
  if (!provenance || evidence?.acceptedSourceSha256?.toLowerCase() !== provenance?.acceptedSourceSha256?.toLowerCase()
    || evidence?.datasetVersion?.toLowerCase() !== provenance?.datasetVersion?.toLowerCase()
    || evidence?.acceptedPackageSha256?.toLowerCase() !== provenance?.packageSha256?.toLowerCase()
    || !sameValue(evidence?.existingDecisionIds, provenance?.existingReview?.decisionIds)) {
    errors.push("Presenter provenance differs from the accepted package provenance record");
  }
  for (let index = 0; index < ids.length; index += 1) {
    const id = ids[index];
    const name = names[index];
    const artifact = artifacts?.[id];
    const acceptedByteHash = evidence?.artifacts?.[id]?.runtimeByteSha256?.toLowerCase();
    if (!acceptedByteHash || artifact?.byteSha256?.toLowerCase() !== acceptedByteHash) {
      errors.push(`${id} runtime byte hash does not match presenter source evidence`);
    }
    const packagedByteHash = evidence?.artifacts?.[id]?.packagedByteSha256?.toLowerCase();
    if (!packagedByteHash || packagedByteHash !== provenance?.artifacts?.[id]?.packagedByteSha256?.toLowerCase()) {
      errors.push(`${id} packaged byte hash differs from accepted package provenance`);
    }
    const runtimeFeatureHash = evidence?.artifacts?.[id]?.runtimeFeatureSha256?.toLowerCase();
    if (!runtimeFeatureHash || runtimeFeatureHash !== artifact?.featureSha256?.toLowerCase()) {
      errors.push(`${id} runtime feature hash does not match loaded artifact`);
    }
    if (!sameValue(evidence?.artifacts?.[id]?.captionFields, provenance?.artifacts?.[id]?.captionFields)
      || evidence?.artifacts?.[id]?.acceptedCaptionSha256?.toLowerCase()
      !== provenance?.artifacts?.[id]?.acceptedCaptionSha256?.toLowerCase()) {
      errors.push(`${id} accepted caption field contract differs from package provenance`);
    }
    if (!manifest?.requiredArtifacts?.[id]) {
      errors.push(`Presenter manifest feature hash missing for ${id}`);
    } else if (manifest.requiredArtifacts[id] !== artifact?.featureSha256) {
      errors.push(`Presenter manifest feature hash mismatch for ${id}`);
    }
  }
  errors.push(...validateCaptionFingerprints(manifest, artifacts, provenance));
  return errors;
}

function sortedJson(value) {
  if (Array.isArray(value)) return value.map(sortedJson);
  if (value && typeof value === "object") return Object.fromEntries(Object.keys(value).sort().map((key) => [key, sortedJson(value[key])]));
  return value;
}

export function captionFingerprint(features, fields, artifactId) {
  const selected = (features || []).filter((feature) => !(artifactId === "nli.lines" && feature?.properties?.route_confidence === "unconfirmed"))
    .map((feature) => feature?.properties || {})
    .sort((a, b) => {
      const left = String(a.OBJECTID ?? a.city);
      const right = String(b.OBJECTID ?? b.city);
      return left < right ? -1 : left > right ? 1 : 0;
    })
    .map((properties) => Object.fromEntries(fields.filter((field) => Object.hasOwn(properties, field)).map((field) => [field, properties[field]])));
  return hash(Buffer.from(JSON.stringify(sortedJson(selected)), "utf8"));
}

export function validateCaptionFingerprints(manifest, artifacts, provenance) {
  const errors = [];
  for (const id of ids) {
    const expected = manifest?.sourceEvidence?.artifacts?.[id];
    const accepted = provenance?.artifacts?.[id];
    if (!accepted?.captionFields || !accepted?.acceptedCaptionSha256) {
      errors.push(`${id} accepted caption fingerprint is missing`);
      continue;
    }
    if (!sameValue(expected?.captionFields, accepted.captionFields)
      || expected?.acceptedCaptionSha256?.toLowerCase() !== accepted.acceptedCaptionSha256.toLowerCase()) {
      errors.push(`${id} accepted caption field contract differs from package provenance`);
    }
    const actual = captionFingerprint(artifacts?.[id]?.features, accepted.captionFields, id);
    if (actual !== accepted.acceptedCaptionSha256) errors.push(`${id} caption fields differ from accepted source`);
  }
  return errors;
}

export function recordsSha256(records) {
  return hash(Buffer.from(JSON.stringify(records || {}), "utf8"));
}

export function validateEditorialEvidence(manifest) {
  const evidence = manifest?.editorialEvidence;
  if (!evidence || evidence.status !== "source-checked" || evidence.checkedBy !== "Sol"
    || evidence.recordsSha256 !== recordsSha256(manifest?.records)) {
    return ["Editorial source-check evidence does not match presenter records"];
  }
  return [];
}

export function validateOptionalSourceZip({ sourceZip, explicit = false, metadata }) {
  if (!explicit) return [];
  if (!sourceZip || !fs.existsSync(sourceZip)) return [`Source ZIP not found: ${sourceZip || "(unspecified)"}`];
  if (!metadata?.sourceSha256 || hash(fs.readFileSync(sourceZip)) !== metadata.sourceSha256.toLowerCase()) {
    return ["Provided source ZIP hash differs from release-metadata.json source identity"];
  }
  return [];
}

export function validateSourceReferences(record, artifacts, curationProof = null) {
  const errors = [];
  if (!Array.isArray(record?.sourceRefs) || record.sourceRefs.length === 0) return ["Source references are missing"];
  const stableIdFields = ["OBJECTID", "objectid", "objectId", "id", "ID", "record_id"];
  for (const ref of record.sourceRefs) {
    const artifact = artifacts?.[ref?.artifact];
    const currentArtifactHashMatches = ref.artifactSha256?.toLowerCase() === artifact?.byteSha256?.toLowerCase();
    const validatedBaselineRouteHashMatches = ref.artifact === "nli.lines" && isValidatedRouteCurationProof(curationProof, artifact)
      && curationProof.baselineRouteSha256?.toLowerCase() === ref.artifactSha256?.toLowerCase();
    if (!artifact || (!currentArtifactHashMatches && !validatedBaselineRouteHashMatches)) {
      errors.push("Source reference artifact hash mismatch");
      continue;
    }
    const features = artifact.features || [];
    const idField = ref.recordIdField || stableIdFields.find((field) => features.some((feature) => Object.hasOwn(feature?.properties || {}, field)));
    const feature = features.find((candidate) => Object.hasOwn(candidate?.properties || {}, idField)
      && String(candidate.properties[idField]) === String(ref.recordId));
    if (!feature) {
      errors.push("Source reference record ID not found");
      continue;
    }
    const properties = feature.properties || {};
    if (ref.artifact === "nli.lines" && properties.route_confidence === "unconfirmed") {
      errors.push("Source reference uses an excluded visual route");
      continue;
    }
    let citedValue;
    if (ref.field) {
      if (!Object.hasOwn(properties, ref.field)) {
        errors.push("Source reference field not found");
        continue;
      }
      citedValue = properties[ref.field];
      if (Object.hasOwn(ref, "value") && !sameValue(citedValue, ref.value)) errors.push("Source reference field value mismatch");
    } else if (ref.interval?.field) {
      const { field, start, end } = ref.interval;
      if (!Object.hasOwn(properties, field)) {
        errors.push("Source reference interval field not found");
        continue;
      }
      citedValue = properties[field];
      const values = Array.isArray(citedValue) ? citedValue : [citedValue];
      if (!Number.isFinite(start) || !Number.isFinite(end) || !values.some((value) => Number(value) >= start && Number(value) <= end)) {
        errors.push("Source reference interval does not match cited source");
      }
    } else {
      errors.push("Source reference must identify a source field or interval");
      continue;
    }
    const citedText = typeof citedValue === "string" ? citedValue : JSON.stringify(citedValue);
    const sourceHasUncertainty = /approx|uncertain|unknown|circa|משוער|בערך|לא ידוע|לא ידועה/i.test(citedText);
    if (sourceHasUncertainty && !ref.uncertainty) errors.push("Source reference omits uncertainty present in the cited source");
    if (ref.uncertainty && (typeof ref.uncertainty !== "string" || !citedText.toLowerCase().includes(ref.uncertainty.toLowerCase()))) {
      errors.push("Source reference uncertainty is not supported by the cited source field");
    }
  }
  return errors;
}

export function validateSourceReferencesForMembership(record, artifacts, membership, { minute, narrativeId, curationProof = null } = {}) {
  const errors = [];
  for (const ref of record?.sourceRefs || []) {
    if (!membership?.includes(ref.artifact)) errors.push("Source reference artifact is outside presenter membership");
    if (ref.artifact === "nli.alarms" && Array.isArray(membership) && membership.length === 1 && membership[0] === "nli.alarms"
      && (ref.interval?.start !== minute || Math.abs(ref.interval?.end - (minute + 4.999)) > 0.001)) {
      errors.push("Alarm source reference interval differs from the five-minute presenter window");
    }
    if (narrativeId !== "nova" && ref.artifact !== "nli.alarms" && Number.isFinite(minute)) {
      const feature = artifacts?.[ref.artifact]?.features?.find((candidate) => String(candidate?.properties?.[ref.recordIdField || "OBJECTID"]) === String(ref.recordId));
      if (feature && Number(feature.properties?.timeline_minutes) !== minute) errors.push("Source reference record is outside the presenter minute");
    }
  }
  return [...errors, ...validateSourceReferences(record, artifacts, curationProof)];
}

export function buildNavigationFixture({ exportBytes, computedMinutes, expectedSha256 = PINNED_EXPORT_SHA256 }) {
  const exportSha256 = hash(exportBytes);
  if (exportSha256 !== expectedSha256) throw new Error(`Pinned export SHA-256 mismatch: ${exportSha256}`);
  const pinned = JSON.parse(Buffer.from(exportBytes).toString("utf8"));
  const exportMinutes = pinned.beats?.map((beat) => beat.minute);
  if (!Array.isArray(exportMinutes)) {
    throw new Error("Beat minutes differ from the pinned export");
  }
  const sourceOpening = exportMinutes.filter((minute) => minute <= 401);
  const sourceRemaining = exportMinutes.filter((minute) => minute >= 402);
  if (exportMinutes.length !== 116 || sourceOpening.length !== 7 || sourceRemaining.length !== 109
    || ![453, 454, 1197].every((minute) => exportMinutes.includes(minute))) {
    throw new Error("Pinned source navigation snapshot does not match expected fixture evidence");
  }
  const expectedMinutes = exportMinutes.filter((minute) => !FIRE_ONLY_EXCLUSIONS.includes(minute));
  if (!sameValue(computedMinutes, expectedMinutes)) {
    throw new Error("Current beat minutes differ from the pinned export after the documented fire-only exclusions");
  }
  const fixture = {
    exportSha256,
    sourceMinutes: exportMinutes,
    excludedBeats: FIRE_ONLY_EXCLUSION_EVIDENCE,
    minutes: expectedMinutes,
    occupiedHours: [...new Set(expectedMinutes.map((minute) => Math.floor(minute / 60)))],
  };
  const opening = fixture.minutes.filter((minute) => minute <= 401);
  const remaining = fixture.minutes.filter((minute) => minute >= 402);
  if (fixture.minutes.length !== 112 || opening.length !== 7 || remaining.length !== 105
    || ![453, 454].every((minute) => fixture.minutes.includes(minute))) {
    throw new Error("Pinned navigation snapshot does not match expected fixture evidence");
  }
  return fixture;
}

export function writeNavigationFixture({ exportBytes, computedMinutes, fixturePath, expectedSha256 = PINNED_EXPORT_SHA256 }) {
  const fixture = buildNavigationFixture({ exportBytes, computedMinutes, expectedSha256 });
  fs.writeFileSync(fixturePath, `${JSON.stringify(fixture, null, 2)}\n`);
  return fixture;
}

export function validateNavigationFixture({ fixture, computedMinutes, expectedSha256 = PINNED_EXPORT_SHA256 }) {
  if (fixture?.exportSha256 !== expectedSha256) return ["Navigation fixture export digest differs from the pinned digest"];
  if (!Array.isArray(fixture?.sourceMinutes) || !sameValue(fixture.excludedBeats, FIRE_ONLY_EXCLUSION_EVIDENCE)) {
    return ["Tracked navigation fixture does not preserve the pinned source minutes and exact fire-only exclusions"];
  }
  const derivedMinutes = fixture.sourceMinutes.filter((minute) => !FIRE_ONLY_EXCLUSIONS.includes(minute));
  if (!sameValue(derivedMinutes, fixture.minutes)) {
    return ["Tracked navigation fixture omits minutes beyond the exact fire-only exclusions"];
  }
  if (!Array.isArray(fixture?.minutes) || !sameValue(computedMinutes, fixture.minutes)) {
    return ["Beat minutes differ from the tracked navigation fixture"];
  }
  const opening = fixture.minutes.filter((minute) => minute <= 401);
  const remaining = fixture.minutes.filter((minute) => minute >= 402);
  if (fixture.sourceMinutes.length !== 116 || fixture.minutes.length !== 112 || opening.length !== 7 || remaining.length !== 105
    || ![453, 454].every((minute) => fixture.minutes.includes(minute))
    || ![453, 454, 1197].every((minute) => fixture.sourceMinutes.includes(minute))) {
    return ["Tracked navigation fixture does not match expected pinned evidence"];
  }
  return [];
}

function readArtifact(file) {
  const bytes = fs.readFileSync(file);
  const data = JSON.parse(bytes.toString("utf8"));
  return { features: data.features, byteSha256: hash(bytes), featureSha256: hash(Buffer.from(JSON.stringify(data.features))) };
}

export function resolveVerifierInputs({ args = [], here, repo }) {
  const arg = (name, fallback) => {
    const index = args.indexOf(name);
    return index < 0 ? fallback : args[index + 1];
  };
  const dataRoot = path.resolve(arg("--data-root", path.join(here, "../public/processed/layers/nli")));
  const manifestPath = path.resolve(arg("--manifest", path.join(here, "../frontend/src/remote/nli-presenter-content.json")));
  const provenancePath = path.resolve(arg("--provenance", path.join(here, "nli-presenter-provenance.json")));
  const fixturePath = path.join(repo, "otef-interactive/tests/fixtures/nli-presenter-navigation.json");
  const exportPath = args.includes("--export") ? path.resolve(arg("--export", "")) : null;
  const sourceZip = args.includes("--source-zip") ? path.resolve(arg("--source-zip", "")) : null;
  const curationRecipePath = path.resolve(arg("--curation-recipe", path.join(here, "nli-border-route-curation.json")));
  const curationLockPath = path.resolve(arg("--curation-lock", path.join(here, "nli-border-route-curation.lock.json")));
  return { dataRoot, manifestPath, provenancePath, fixturePath, exportPath, sourceZip, curationRecipePath, curationLockPath };
}

export function runVerifier(args = process.argv.slice(2)) {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const repo = path.resolve(here, "../..");
  const { dataRoot, manifestPath, provenancePath, fixturePath, exportPath, sourceZip, curationRecipePath, curationLockPath } = resolveVerifierInputs({ args, here, repo });
  const errors = [];
  const metadataPath = path.join(dataRoot, "release-metadata.json");
  const metadata = fs.existsSync(metadataPath) ? JSON.parse(fs.readFileSync(metadataPath, "utf8")) : null;
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  const curationLock = fs.existsSync(curationLockPath) ? JSON.parse(fs.readFileSync(curationLockPath, "utf8")) : null;
  const hasRouteCuration = Boolean(curationLock?.curation || metadata?.routeBorderCuration || manifest?.sourceEvidence?.routeBorderCuration);
  const loaded = Object.fromEntries(names.map((name, index) => {
    const artifact = readArtifact(path.join(dataRoot, name));
    console.log(`${name}: bytes=${artifact.byteSha256} features=${artifact.featureSha256} count=${artifact.features.length}`);
    return [ids[index], artifact];
  }));
  const provenance = fs.existsSync(provenancePath) ? JSON.parse(fs.readFileSync(provenancePath, "utf8")) : null;
  if (!provenance) errors.push(`Accepted package provenance not found: ${provenancePath}`);
  errors.push(...validateOptionalSourceZip({ sourceZip, explicit: args.includes("--source-zip"), metadata }));
  if (!metadata) errors.push("release-metadata.json not found");
  else console.log(`release source=${metadata.sourceSha256}; dataset=${metadata.datasetVersion}; routeCount=${metadata.counts?.lines}; runtimeRouteHash=${metadata.runtimeArtifactHashes?.["lines.geojson"]}`);

  const cache = Object.fromEntries(ids.map((id) => [id, loaded[id].features]));
  const bags = nliFeatureBagsFromCache(cache);
  const allMinutes = beatsForMembership(ids, bags);
  let fixture = null;
  if (exportPath && fs.existsSync(exportPath)) {
    const exportBytes = fs.readFileSync(exportPath);
    try {
      fixture = buildNavigationFixture({ exportBytes, computedMinutes: allMinutes });
      if (args.includes("--write-fixture")) fs.writeFileSync(fixturePath, `${JSON.stringify(fixture, null, 2)}\n`);
      else if (fs.existsSync(fixturePath) && !sameValue(JSON.parse(fs.readFileSync(fixturePath, "utf8")), fixture)) errors.push("Navigation fixture differs from pinned export");
      else if (!fs.existsSync(fixturePath)) errors.push("Navigation fixture missing; run with --write-fixture after reviewing the pinned source");
      const opening = fixture.minutes.filter((minute) => minute <= 401);
      const remaining = fixture.minutes.filter((minute) => minute >= 402);
      console.log(`pinned export=${fixture.exportSha256}; beats=${fixture.minutes.length}; opening=${opening.length}; remaining=${remaining.length}`);
    } catch (error) {
      errors.push(error.message);
    }
  } else if (exportPath) {
    errors.push(`Pinned export not found: ${exportPath}`);
  } else if (args.includes("--write-fixture")) {
    errors.push("--write-fixture requires an explicit --export path");
  } else if (!fs.existsSync(fixturePath)) {
    errors.push("Navigation fixture missing");
  } else {
    fixture = JSON.parse(fs.readFileSync(fixturePath, "utf8"));
    errors.push(...validateNavigationFixture({ fixture, computedMinutes: allMinutes }));
    const opening = fixture.minutes.filter((minute) => minute <= 401);
    const remaining = fixture.minutes.filter((minute) => minute >= 402);
    console.log(`tracked navigation fixture=${fixture.exportSha256}; beats=${fixture.minutes.length}; opening=${opening.length}; remaining=${remaining.length}`);
  }

  const requests = [];
  for (let mask = 1; mask < 8; mask += 1) {
    const membership = ids.filter((_, index) => mask & (1 << index));
    requests.push({ narrativeId: null, membership, minutes: beatsForMembership(membership, bags) });
  }
  const novaMinutes = [...NLI_NOVA_STORY.representativeMinutes];
  requests.push({ narrativeId: "nova", membership: novaVirtualMembership([], "nova", { phase: "paused" }), minutes: novaMinutes });
  requests.push({ narrativeId: "nova", membership: novaVirtualMembership(["nli.alarms"], "nova", { phase: "paused" }), minutes: novaMinutes });
  const missing = validatePresenterCoverage(manifest, requests);
  if (missing.length) errors.push(`Missing localized title/timeLabel coverage: ${missing.length} locale records`);
  if (!metadata) errors.push("release-metadata.json not found");
  let curationProof = null;
  if (hasRouteCuration) {
    try {
      curationProof = validateRouteBorderCuration({ recipe: curationRecipePath, lock: curationLock, metadata, manifest, artifacts: loaded });
    } catch (error) { errors.push(error.message); }
  }
  else if (args.includes("--curation-lock")) errors.push("Explicit route curation lock contains no curation evidence");
  for (let index = 0; index < names.length; index += 1) {
    const name = names[index];
    if (loaded[ids[index]].byteSha256 !== pinnedByteHashes[name] && !(name === "lines.geojson" && curationProof)) {
      errors.push(`${name} byte hash differs from the pinned snapshot`);
    }
  }
  if (!metadata) errors.push("release-metadata.json not found");
  else errors.push(...validateAcceptedEvidence({ manifest, metadata, provenance, artifacts: loaded, curationProof }));
  errors.push(...validateEditorialEvidence(manifest));
  errors.push(...validatePresenterEditorialCopy(manifest.records || {}));
  for (const [key, record] of Object.entries(manifest.records || {})) {
    let [narrativeId, membership, minute] = [];
    try { [narrativeId, membership, minute] = JSON.parse(key); } catch {}
    for (const issue of validateSourceReferencesForMembership(record, loaded, membership, { minute, narrativeId, curationProof })) {
      errors.push(`${issue}: ${key}`);
    }
  }
  if (errors.length) {
    for (const error of errors) console.error(`ERROR: ${error}`);
    process.exitCode = 1;
    return errors;
  }
  console.log(`Presenter coverage verified: ${requests.length} membership/narrative requests.`);
  return [];
}

export function validatePresenterEditorialCopy(records) {
  const errors = [];
  for (const [key, record] of Object.entries(records || {})) for (const locale of ["he", "en"]) {
    const copy = record?.[locale];
    if (!copy) continue;
    const normalized = [copy.title, copy.summary, copy.details]
      .filter((value) => typeof value === "string" && value.trim())
      .map((value) => value.trim().replace(/\s+/g, " ").toLocaleLowerCase());
    if (new Set(normalized).size !== normalized.length) errors.push(`Repeated presenter copy in ${key}:${locale}`);
    for (const value of [copy.title, copy.summary, copy.details]) {
      if (typeof value === "string" && /&(?:amp|lt|gt|quot|#\d+|#x[\da-f]+);/i.test(value)) errors.push(`Encoded entity in ${key}:${locale}`);
      if (typeof value === "string" && /\b(?:polygon|line|object\s*id|OBJECTID|timeline_minutes|geometry)\b/i.test(value)) errors.push(`Raw metadata term in ${key}:${locale}`);
    }
  }
  return errors;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) runVerifier();
