import { afterEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  canonicalSha256,
  confirmedFeaturesSha256,
  fileDigests,
  refreshPresenterRouteEvidenceFromFiles,
  ROUTE_CURATION_PINS,
  runtimeFeaturesSha256,
  validateRouteBorderCuration,
} from "../../scripts/nli-route-curation-digests.mjs";
import { captionFingerprint, recordsSha256, runVerifier, validateAcceptedEvidence, validateSourceReferences } from "../../scripts/verify-nli-presenter-content.mjs";

const temporaryDirectories = [];
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const baselinePath = new URL("../fixtures/nli-route-curation-runtime-baseline.geojson", import.meta.url);

function fixture() {
  const baselineBytes = fs.readFileSync(baselinePath);
  expect(hash(baselineBytes)).toBe(ROUTE_CURATION_PINS.baseRuntimeSha256);
  const baseFeatures = JSON.parse(baselineBytes.toString("utf8")).features;
  expect(baseFeatures).toHaveLength(80);
  expect(confirmedFeaturesSha256(baseFeatures)).toBe("c2d3ec3f50f0c016e6665b39ed93ed758020cf0c2a8339153cb1f51326039358");
  expect(confirmedFeaturesSha256(baseFeatures)).toBe(ROUTE_CURATION_PINS.confirmedFeaturesSha256);
  const features = [...baseFeatures, ...ROUTE_CURATION_PINS.addedObjectIds.map((id) => ({
    type: "Feature",
    properties: { OBJECTID: id, Name: `Unconfirmed approach ${id}`, route_confidence: "unconfirmed", parent_objectid: id === 1013 ? 23 : 1, timeline_minutes: 400 },
    geometry: { type: "LineString", coordinates: [[34.0, 31.0], [34.01, 31.01]] },
  }))];
  const runtimeBytes = Buffer.from(`${JSON.stringify({ type: "FeatureCollection", features })}\n`, "utf8");
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "nli-route-evidence-"));
  temporaryDirectories.push(directory);
  const runtimePath = path.join(directory, "lines.geojson");
  fs.writeFileSync(runtimePath, runtimeBytes);
  const recipeBytesFromWorktree = fs.readFileSync(new URL("../../scripts/nli-border-route-curation.json", import.meta.url));
  const recipeDocument = JSON.parse(recipeBytesFromWorktree.toString("utf8"));
  const recipePath = path.join(directory, "recipe.json");
  const recipeBytes = recipeBytesFromWorktree;
  fs.writeFileSync(recipePath, recipeBytes);
  const route = fileDigests(runtimePath);
  const curation = {
    schemaVersion: 1,
    recipeSha256: hash(recipeBytes),
    baseSourceSha256: ROUTE_CURATION_PINS.baseSourceSha256,
    baseRuntimeSha256: ROUTE_CURATION_PINS.baseRuntimeSha256,
    confirmedFeaturesSha256: ROUTE_CURATION_PINS.confirmedFeaturesSha256,
    borderSha256: ROUTE_CURATION_PINS.borderSha256,
    roadSha256: ROUTE_CURATION_PINS.roadSha256,
    derivedSourceSha256: "a".repeat(64),
    runtimeByteSha256: route.byteSha256,
    runtimeFeatureSha256: route.featureSha256,
    counts: { ...ROUTE_CURATION_PINS.counts },
    addedObjectIds: [...ROUTE_CURATION_PINS.addedObjectIds],
    editedObjectIds: [...ROUTE_CURATION_PINS.editedObjectIds],
  };
  const routeEvidence = { captionFields: ["OBJECTID", "Name"], acceptedCaptionSha256: "c".repeat(64),
    packagedByteSha256: "d".repeat(64), runtimeByteSha256: ROUTE_CURATION_PINS.baseRuntimeSha256,
    runtimeFeatureSha256: "e".repeat(64) };
  const otherEvidence = { captionFields: ["city"], acceptedCaptionSha256: "f".repeat(64),
    packagedByteSha256: "1".repeat(64), runtimeByteSha256: "2".repeat(64), runtimeFeatureSha256: "3".repeat(64) };
  const sourceRef = { artifact: "nli.lines", artifactSha256: ROUTE_CURATION_PINS.baseRuntimeSha256,
    recordId: 1, recordIdField: "OBJECTID", field: "OBJECTID", value: 1 };
  const manifest = {
    schemaVersion: 1,
    acceptedSourceSha256: "source-identity",
    datasetVersion: "dataset-identity",
    requiredArtifacts: { "nli.lines": "old-route-pin", "nli.alarms": "alarm-pin" },
    records: { entry: { he: { title: "אות", timeLabel: "08:00" }, en: { title: "Entry", timeLabel: "08:00" }, sourceRefs: [sourceRef] } },
    sourceEvidence: { acceptedSourceSha256: "source-identity", datasetVersion: "dataset-identity",
      acceptedPackageSha256: "package-identity", packageSha256: "package-identity",
      routeBorderCuration: structuredClone(curation),
      artifacts: { "nli.lines": structuredClone(routeEvidence), "nli.alarms": structuredClone(otherEvidence) } },
    editorialEvidence: { status: "source-checked", checkedBy: "Sol", recordsSha256: "editorial-record-fingerprint" },
  };
  const metadata = { sourceSha256: "source-identity", datasetVersion: "dataset-identity", routeBorderCuration: structuredClone(curation) };
  const lock = { curation: structuredClone(curation) };
  const provenance = { packageSha256: "package-identity", acceptedSourceSha256: "source-identity", datasetVersion: "dataset-identity",
    artifacts: { "nli.lines": { packagedByteSha256: routeEvidence.packagedByteSha256,
      captionFields: [...routeEvidence.captionFields], acceptedCaptionSha256: routeEvidence.acceptedCaptionSha256 } } };
  return { directory, recipePath, recipeDocument, route, features, curation, metadata, lock, manifest, provenance, sourceRef };
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) fs.rmSync(directory, { recursive: true, force: true });
});

describe("canonical route digests", () => {
  it("sorts nested keys, preserves array order, and supports Unicode, decimals, and null", () => {
    const first = { z: [null, { ב: 1.25, a: "עזה" }], a: 0.1 };
    const same = { a: 0.1, z: [null, { a: "עזה", ב: 1.25 }] };
    expect(canonicalSha256(first)).toBe(canonicalSha256(same));
    expect(canonicalSha256({ ...first, z: [...first.z].reverse() })).not.toBe(canonicalSha256(first));
    expect(() => canonicalSha256({ invalid: Number.POSITIVE_INFINITY })).toThrow(/finite/i);
  });

  it("keeps runtime order hashing separate from confirmed feature hashing", () => {
    const features = [{ properties: { OBJECTID: 1, route_confidence: "confirmed" } },
      { properties: { OBJECTID: 2, route_confidence: "unconfirmed" } }];
    expect(confirmedFeaturesSha256(features)).toBe(confirmedFeaturesSha256([features[0]]));
    expect(runtimeFeaturesSha256(features)).not.toBe(runtimeFeaturesSha256([features[0]]));
  });

  it("reads byte, runtime feature, and confirmed feature digests from the supplied GeoJSON", () => {
    const f = fixture();
    const actual = fileDigests(path.join(f.directory, "lines.geojson"));
    expect(actual.byteSha256).toBe(f.route.byteSha256);
    expect(actual.featureSha256).toBe(f.route.featureSha256);
    expect(actual.confirmedFeaturesSha256).toBe(ROUTE_CURATION_PINS.confirmedFeaturesSha256);
  });
});

describe("route curation proof and presenter refresh", () => {
  it("accepts the derived runtime pin and an old baseline citation only with matching proof", () => {
    const f = fixture();
    const proof = validateRouteBorderCuration({ recipe: f.recipePath, lock: f.lock, metadata: f.metadata,
      manifest: f.manifest, artifacts: { "nli.lines": f.route } });
    expect(proof).toEqual({ baselineRouteSha256: ROUTE_CURATION_PINS.baseRuntimeSha256,
      confirmedFeaturesSha256: ROUTE_CURATION_PINS.confirmedFeaturesSha256 });
    const record = { sourceRefs: [f.sourceRef] };
    expect(validateSourceReferences(record, { "nli.lines": f.route })).toContain("Source reference artifact hash mismatch");
    expect(validateSourceReferences(record, { "nli.lines": f.route }, { baselineRouteSha256: proof.baselineRouteSha256,
      confirmedFeaturesSha256: proof.confirmedFeaturesSha256 })).toContain("Source reference artifact hash mismatch");
    expect(validateSourceReferences(record, { "nli.lines": f.route }, proof)).toEqual([]);
    expect(validateSourceReferences({ sourceRefs: [{ ...f.sourceRef, artifactSha256: f.route.byteSha256 }] },
      { "nli.lines": f.route })).toEqual([]);

    const artifactIds = ["nli.investigation_polygons", "nli.lines", "nli.alarms"];
    const empty = { byteSha256: "b".repeat(64), featureSha256: "a".repeat(64), features: [] };
    const artifacts = { "nli.investigation_polygons": empty, "nli.lines": f.route, "nli.alarms": empty };
    const provenance = { acceptedSourceSha256: "source-identity", datasetVersion: "dataset-identity", packageSha256: "package-identity",
      existingReview: { decisionIds: ["review-1"] }, artifacts: Object.fromEntries(artifactIds.map((id) => [id, {
        captionFields: id === "nli.lines" ? ["OBJECTID"] : [],
        acceptedCaptionSha256: captionFingerprint(artifacts[id].features, id === "nli.lines" ? ["OBJECTID"] : [], id),
        packagedByteSha256: `${id}-package`,
      }])) };
    const metadata = { sourceSha256: "source-identity", datasetVersion: "dataset-identity",
      review: { status: "approved", decisionIds: ["review-1"] }, routeBorderCuration: structuredClone(f.curation) };
    const manifest = structuredClone(f.manifest);
    manifest.sourceEvidence.artifacts = Object.fromEntries(artifactIds.map((id) => [id, {
      captionFields: provenance.artifacts[id].captionFields,
      acceptedCaptionSha256: provenance.artifacts[id].acceptedCaptionSha256,
      packagedByteSha256: provenance.artifacts[id].packagedByteSha256,
      runtimeByteSha256: artifacts[id].byteSha256,
      runtimeFeatureSha256: artifacts[id].featureSha256,
    }]));
    manifest.sourceEvidence.existingDecisionIds = ["review-1"];
    manifest.sourceEvidence.acceptedSourceSha256 = "source-identity";
    manifest.sourceEvidence.datasetVersion = "dataset-identity";
    manifest.sourceEvidence.acceptedPackageSha256 = "package-identity";
    manifest.sourceEvidence.packageSha256 = "package-identity";
    manifest.requiredArtifacts = Object.fromEntries(artifactIds.map((id) => [id, artifacts[id].featureSha256]));
    manifest.acceptedSourceSha256 = "source-identity";
    manifest.datasetVersion = "dataset-identity";
    expect(validateAcceptedEvidence({ manifest, metadata, provenance, artifacts })).toContain("Derived route runtime evidence requires validated route curation proof");
    expect(validateAcceptedEvidence({ manifest, metadata, provenance, artifacts, curationProof: proof })).toEqual([]);
    const alteredPin = structuredClone(manifest);
    alteredPin.sourceEvidence.routeBorderCuration.runtimeByteSha256 = "unknown-runtime";
    expect(validateAcceptedEvidence({ manifest: alteredPin, metadata, provenance, artifacts, curationProof: proof }))
      .toContain("Derived route runtime pin does not match validated curation proof");
  });

  it("rejects altered cited fields, uncited confirmed geometry, unknown old hashes, and unconfirmed references", () => {
    const f = fixture();
    const baselineFeatures = JSON.parse(fs.readFileSync(baselinePath, "utf8")).features;
    const captionFields = ["OBJECTID", "Name"];
    const confirmedCaptionBefore = captionFingerprint(baselineFeatures, captionFields, "nli.lines");
    expect(f.features.find((feature) => feature.properties?.OBJECTID === 1013).properties.Name).toBe("Unconfirmed approach 1013");
    const confirmedCaptionAfter = captionFingerprint(f.features, captionFields, "nli.lines");
    expect(confirmedCaptionAfter).toBe(confirmedCaptionBefore);
    const valid = () => validateRouteBorderCuration({ recipe: f.recipePath, lock: f.lock, metadata: f.metadata,
      manifest: f.manifest, artifacts: { "nli.lines": f.route } });
    const alteredField = structuredClone(f);
    alteredField.features.find((feature) => feature.properties?.OBJECTID === 1).properties.OBJECTID = 7;
    const alteredRoute = { ...f.route, features: alteredField.features };
    expect(() => validateRouteBorderCuration({ recipe: f.recipePath, lock: f.lock, metadata: f.metadata,
      manifest: f.manifest, artifacts: { "nli.lines": alteredRoute } })).toThrow(/confirmed route features/i);
    expect(validateSourceReferences({ sourceRefs: [{ ...f.sourceRef, value: 7 }] }, { "nli.lines": f.route }, valid())).toContain("Source reference field value mismatch");

    const changedGeometry = structuredClone(f.route);
    changedGeometry.features[0].geometry.coordinates[0][0] += 0.0001;
    expect(() => validateRouteBorderCuration({ recipe: f.recipePath, lock: f.lock, metadata: f.metadata,
      manifest: f.manifest, artifacts: { "nli.lines": changedGeometry } })).toThrow(/confirmed route features/i);
    const proofBeforeMutation = valid();
    expect(validateSourceReferences({ sourceRefs: [f.sourceRef] }, { "nli.lines": changedGeometry }, proofBeforeMutation))
      .toContain("Source reference artifact hash mismatch");

    const proof = valid();
    expect(validateSourceReferences({ sourceRefs: [{ ...f.sourceRef, artifactSha256: "unknown-old-hash" }] }, { "nli.lines": f.route }, proof))
      .toContain("Source reference artifact hash mismatch");
    const unconfirmed = f.route.features.find((feature) => feature.properties?.OBJECTID === 1001);
    const unconfirmedRef = { ...f.sourceRef, recordId: 1001, value: 1001 };
    expect(unconfirmed).toBeDefined();
    expect(validateSourceReferences({ sourceRefs: [unconfirmedRef] }, { "nli.lines": f.route }, proof))
      .toContain("Source reference uses an excluded visual route");
    const addedChild = f.route.features.find((feature) => feature.properties?.OBJECTID === 1013);
    const addedChildRef = { ...f.sourceRef, recordId: 1013, value: 1013 };
    expect(addedChild.properties.parent_objectid).toBe(23);
    expect(validateSourceReferences({ sourceRefs: [addedChildRef] }, { "nli.lines": f.route }, proof))
      .toContain("Source reference uses an excluded visual route");
  });

  it("rejects missing metadata, recipe, lock, or manifest evidence", () => {
    const f = fixture();
    const args = { recipe: f.recipePath, lock: f.lock, metadata: f.metadata, manifest: f.manifest,
      artifacts: { "nli.lines": f.route } };
    for (const incomplete of [
      { ...args, metadata: null },
      { ...args, recipe: null },
      { ...args, lock: null },
      { ...args, manifest: { ...f.manifest, sourceEvidence: {} } },
    ]) expect(() => validateRouteBorderCuration(incomplete)).toThrow();
  });

  it("refreshes only derived route pins while preserving records and immutable evidence", () => {
    const f = fixture();
    const proof = validateRouteBorderCuration({ recipe: f.recipePath, lock: f.lock, metadata: f.metadata,
      manifest: f.manifest, artifacts: { "nli.lines": f.route } });
    expect(proof).toBeTruthy();
    const refreshed = refreshPresenterRouteEvidenceFromFiles({ manifest: f.manifest, metadata: f.metadata,
      provenance: f.provenance, artifacts: { "nli.lines": f.route }, recipe: f.recipePath, lock: f.lock });
    expect(refreshed.records).toEqual(f.manifest.records);
    expect(refreshed.editorialEvidence).toEqual(f.manifest.editorialEvidence);
    expect(refreshed.acceptedSourceSha256).toBe(f.manifest.acceptedSourceSha256);
    expect(refreshed.datasetVersion).toBe(f.manifest.datasetVersion);
    expect(refreshed.sourceEvidence.acceptedPackageSha256).toBe(f.manifest.sourceEvidence.acceptedPackageSha256);
    expect(refreshed.sourceEvidence.artifacts["nli.lines"].packagedByteSha256)
      .toBe(f.manifest.sourceEvidence.artifacts["nli.lines"].packagedByteSha256);
    expect(refreshed.sourceEvidence.artifacts["nli.lines"].acceptedCaptionSha256)
      .toBe(f.manifest.sourceEvidence.artifacts["nli.lines"].acceptedCaptionSha256);
    expect(refreshed.sourceEvidence.artifacts["nli.alarms"]).toEqual(f.manifest.sourceEvidence.artifacts["nli.alarms"]);
    expect(refreshed.requiredArtifacts["nli.lines"]).toBe(f.route.featureSha256);
    expect(refreshed.sourceEvidence.artifacts["nli.lines"].runtimeByteSha256).toBe(f.route.byteSha256);
    expect(f.manifest.requiredArtifacts["nli.lines"]).toBe("old-route-pin");
  });

  it("refreshes through the explicit assembler mode from existing evidence files", () => {
    const f = fixture();
    const files = {
      manifest: path.join(f.directory, "manifest.json"),
      metadata: path.join(f.directory, "metadata.json"),
      provenance: path.join(f.directory, "provenance.json"),
      lock: path.join(f.directory, "lock.json"),
      output: path.join(f.directory, "refreshed-manifest.json"),
    };
    for (const [key, value] of [["manifest", f.manifest], ["metadata", f.metadata], ["provenance", f.provenance], ["lock", f.lock]]) {
      fs.writeFileSync(files[key], `${JSON.stringify(value)}\n`);
    }
    const assemblerPath = fileURLToPath(new URL("../../scripts/assemble-nli-presenter-manifest.mjs", import.meta.url));
    execFileSync(process.execPath, [assemblerPath, "--refresh-route-evidence",
      "--manifest", files.manifest,
      "--metadata", files.metadata,
      "--provenance", files.provenance,
      "--recipe", f.recipePath,
      "--lock", files.lock,
      "--runtime-dir", f.directory,
      "--output", files.output,
    ], { stdio: "pipe" });
    const refreshed = JSON.parse(fs.readFileSync(files.output, "utf8"));
    expect(refreshed.records).toEqual(f.manifest.records);
    expect(refreshed.editorialEvidence).toEqual(f.manifest.editorialEvidence);
    expect(refreshed.requiredArtifacts["nli.lines"]).toBe(f.route.featureSha256);
  });

  it("allows a derived route byte pin in the verifier CLI only after curation proof succeeds", () => {
    const f = fixture();
    const dataRoot = path.join(f.directory, "runtime");
    fs.mkdirSync(dataRoot);
    const ids = ["nli.investigation_polygons", "nli.lines", "nli.alarms"];
    const names = ["investigation_polygons.geojson", "lines.geojson", "alarms.geojson"];
    const emptyBytes = Buffer.from('{"type":"FeatureCollection","features":[]}\n', "utf8");
    const emptyPath = path.join(dataRoot, names[0]);
    fs.writeFileSync(emptyPath, emptyBytes);
    fs.writeFileSync(path.join(dataRoot, names[1]), fs.readFileSync(path.join(f.directory, "lines.geojson")));
    fs.writeFileSync(path.join(dataRoot, names[2]), emptyBytes);
    const otherDigests = {
      byteSha256: hash(emptyBytes), featureSha256: runtimeFeaturesSha256([]), features: [],
    };
    const artifacts = { [ids[0]]: otherDigests, [ids[1]]: f.route, [ids[2]]: otherDigests };
    const provenance = {
      acceptedSourceSha256: "source-identity", datasetVersion: "dataset-identity", packageSha256: "package-identity",
      existingReview: { decisionIds: ["review-1"] },
      artifacts: Object.fromEntries(ids.map((id) => [id, {
        captionFields: [], acceptedCaptionSha256: captionFingerprint(artifacts[id].features, [], id), packagedByteSha256: `${id}-package`,
      }])),
    };
    const metadata = { sourceSha256: "source-identity", datasetVersion: "dataset-identity",
      review: { status: "approved", decisionIds: ["review-1"] }, routeBorderCuration: structuredClone(f.curation) };
    const manifest = {
      acceptedSourceSha256: metadata.sourceSha256,
      datasetVersion: metadata.datasetVersion,
      requiredArtifacts: Object.fromEntries(ids.map((id) => [id, artifacts[id].featureSha256])),
      records: {}, editorialEvidence: { status: "source-checked", checkedBy: "Sol", recordsSha256: recordsSha256({}) },
      sourceEvidence: {
        acceptedSourceSha256: metadata.sourceSha256, datasetVersion: metadata.datasetVersion,
        acceptedPackageSha256: provenance.packageSha256, packageSha256: provenance.packageSha256,
        existingDecisionIds: ["review-1"], routeBorderCuration: structuredClone(f.curation),
        artifacts: Object.fromEntries(ids.map((id) => [id, {
          captionFields: provenance.artifacts[id].captionFields,
          acceptedCaptionSha256: provenance.artifacts[id].acceptedCaptionSha256,
          packagedByteSha256: provenance.artifacts[id].packagedByteSha256,
          runtimeByteSha256: artifacts[id].byteSha256,
          runtimeFeatureSha256: artifacts[id].featureSha256,
        }])),
      },
    };
    const paths = {
      manifest: path.join(f.directory, "cli-manifest.json"),
      metadata: path.join(dataRoot, "release-metadata.json"),
      provenance: path.join(f.directory, "cli-provenance.json"),
      lock: path.join(f.directory, "cli-lock.json"),
    };
    fs.writeFileSync(paths.manifest, JSON.stringify(manifest));
    fs.writeFileSync(paths.metadata, JSON.stringify(metadata));
    fs.writeFileSync(paths.provenance, JSON.stringify(provenance));
    fs.writeFileSync(paths.lock, JSON.stringify(f.lock));
    const run = () => {
      const previousExitCode = process.exitCode;
      try {
        return runVerifier(["--data-root", dataRoot, "--manifest", paths.manifest,
          "--provenance", paths.provenance, "--curation-lock", paths.lock]);
      } finally { process.exitCode = previousExitCode; }
    };
    const errors = run();
    expect(errors).not.toContain("lines.geojson byte hash differs from the pinned snapshot");
    expect(errors).not.toContain("Derived route runtime evidence requires validated route curation proof");
    expect(errors.some((error) => error.includes("Route curation"))).toBe(false);
    expect(errors).toContain("investigation_polygons.geojson byte hash differs from the pinned snapshot");

    const invalidLock = structuredClone(f.lock);
    invalidLock.curation.runtimeByteSha256 = "0".repeat(64);
    fs.writeFileSync(paths.lock, JSON.stringify(invalidLock));
    const invalidErrors = run();
    expect(invalidErrors).toContain("lines.geojson byte hash differs from the pinned snapshot");
    expect(invalidErrors.some((error) => error.includes("Route curation"))).toBe(true);
  });
});
