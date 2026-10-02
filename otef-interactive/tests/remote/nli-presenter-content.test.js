import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import {
  presenterCopyKey,
  getPresenterCopy,
  validatePresenterCoverage,
  createPresenterDatasetGate,
} from "../../frontend/src/remote/nli-presenter-content.js";
import {
  PINNED_EXPORT_SHA256,
  validateAcceptedEvidence,
  validateSourceReferences,
  validatePresenterEditorialCopy,
  validateCaptionFingerprints,
  validateEditorialEvidence,
  validateSourceReferencesForMembership,
  validateOptionalSourceZip,
  captionFingerprint,
  validateNavigationFixture,
  resolveVerifierInputs,
  writeNavigationFixture,
} from "../../scripts/verify-nli-presenter-content.mjs";
import { assemblePresenterManifest } from "../../scripts/assemble-nli-presenter-manifest.mjs";

const p = "nli.investigation_polygons";
const r = "nli.lines";
const good = (title = "Event", timeLabel = "08:40", extras = {}) => ({
  timeLabel, title, summary: null, details: null, ...extras,
});

describe("presenter copy", () => {
  it("never substitutes combined facts for route-only copy", () => {
    const combined = presenterCopyKey(null, [p, r], 520);
    const manifest = { records: { [combined]: {
      he: good("שגב כלפון נחטף באזור הנובה"),
      en: good("Segev Kalfon is abducted near Nova"), sourceRefs: [],
    } } };
    expect(getPresenterCopy(manifest, presenterCopyKey(null, [r], 520), "he")).toBeNull();
    expect(getPresenterCopy(manifest, combined, "he").details).toBeNull();
    expect(validatePresenterCoverage(manifest, [{ narrativeId: null, membership: [r], minutes: [520] }])).toHaveLength(2);
  });

  it("normalizes optional whitespace and rejects blank or missing required fields", () => {
    const key = presenterCopyKey(null, [p], 420);
    const manifest = { records: { [key]: {
      he: good("Title", " 08:40 ", { summary: "  ", details: " extra " }),
      en: good("  ", "08:40"),
    } } };
    expect(getPresenterCopy(manifest, key, "he")).toEqual({ timeLabel: "08:40", title: "Title", summary: null, details: "extra" });
    expect(getPresenterCopy(manifest, key, "en")).toBeNull();
    manifest.records[key].he.timeLabel = " ";
    expect(getPresenterCopy(manifest, key, "he")).toBeNull();
    manifest.records[key].he.timeLabel = 840;
    expect(getPresenterCopy(manifest, key, "he")).toBeNull();
    manifest.records[key].he.timeLabel = "08:40";
    manifest.records[key].he.title = "A &amp; B";
    expect(getPresenterCopy(manifest, key, "he")).toBeNull();
  });

  it("rejects non-finite minutes and reports both missing locales", () => {
    expect(() => presenterCopyKey(null, [p], NaN)).toThrow("Invalid presenter minute");
    expect(validatePresenterCoverage({ records: {} }, [{ narrativeId: "nova", membership: [p], minutes: [483] }])).toHaveLength(2);
  });
});

describe("presenter dataset gate", () => {
  const manifestFor = (features, overrides = {}) => ({
    datasetVersion: "dataset-v1",
    acceptedSourceSha256: "source-v1",
    requiredArtifacts: { [p]: "hash-p", [r]: "hash-r" },
    ...overrides,
  });
  const hostFor = (polygon, line) => ({
    _nliFeatureCache: { [p]: polygon, [r]: line },
    _nliArmPayload: () => ({ visibleMembership: [p, r] }),
  });

  it("stays unready for version or digest mismatches", async () => {
    const host = hostFor([{ id: 1 }], [{ id: 2 }]);
    const gate = createPresenterDatasetGate({ host, manifest: manifestFor(), hash: async (bytes) => bytes.length === 0 ? "" : "wrong" });
    const state = await gate.refresh();
    expect(state.ready).toBe(false);
    expect(state.error).toMatch(/hash/i);
    gate.dispose();

    const versionedHost = hostFor([{ id: 1 }], []);
    versionedHost._nliArmPayload = () => ({ visibleMembership: [p], datasetVersion: "dataset-v2" });
    const versionGate = createPresenterDatasetGate({ host: versionedHost, manifest: manifestFor(), hash: async () => "hash-p" });
    expect((await versionGate.refresh()).error).toMatch(/version mismatch/i);
    versionGate.dispose();
  });

  it("allows only the latest asynchronous verification to publish readiness", async () => {
    let finishOld;
    const first = [{ old: true }];
    const next = [{ newer: true }];
    const host = hostFor(first, []);
    host._nliArmPayload = () => ({ visibleMembership: [p] });
    const gate = createPresenterDatasetGate({
      host, manifest: manifestFor(),
      hash: (bytes) => new TextDecoder().decode(bytes).includes("old")
        ? new Promise((resolve) => { finishOld = resolve; })
        : Promise.resolve("hash-p"),
    });
    const pending = gate.refresh();
    host._nliFeatureCache[p] = next;
    const latest = await gate.refresh();
    finishOld("hash-p");
    await pending;
    expect(latest.ready).toBe(true);
    expect(gate.getState().ready).toBe(true);
    gate.dispose();
  });

  it("stays unready until every required artifact has verified", async () => {
    let releaseLine;
    const host = hostFor([{ polygon: true }], [{ line: true }]);
    const gate = createPresenterDatasetGate({
      host,
      manifest: manifestFor(),
      hash: async (bytes) => new TextDecoder().decode(bytes).includes("polygon")
        ? "hash-p"
        : new Promise((resolve) => { releaseLine = resolve; }),
    });
    const pending = gate.refresh();
    await Promise.resolve();
    expect(gate.getState().ready).toBe(false);
    releaseLine("hash-r");
    expect((await pending).ready).toBe(true);
    gate.dispose();
  });

  it("does not publish a pending digest after disposal", async () => {
    let finish;
    const host = hostFor([{ value: 1 }], []);
    host._nliArmPayload = () => ({ visibleMembership: [p] });
    const gate = createPresenterDatasetGate({ host, manifest: manifestFor(), hash: () => new Promise((resolve) => { finish = resolve; }) });
    const pending = gate.refresh();
    gate.dispose();
    finish("hash-p");
    await pending;
    expect(gate.getState().ready).toBe(false);
  });
});

describe("presenter release verifier", () => {
  it("assembles bilingual copies for generic, alarm-only, and Nova memberships", () => {
    const base = fs.mkdtempSync(path.join(os.tmpdir(), "nli-assembly-"));
    const inputDir = path.join(base, "input");
    const runtimeDir = path.join(base, "runtime");
    fs.mkdirSync(inputDir);
    fs.mkdirSync(runtimeDir);
    const ref = (artifact, recordId, field, value) => ({ artifact, artifactSha256: "byte", recordId, recordIdField: "OBJECTID", field, value });
    const group = (id, minute, membership) => {
      const sourceArtifact = membership.length === 1 && membership[0] === r ? r : p;
      return { id, minute, memberships: [membership], sources: [{
      artifact: sourceArtifact, id: 7, sourceRefs: [ref(sourceArtifact, "7", "Name", "Event")],
      }] };
    };
    const copy = (id, usedSourceIds = [`${p}:7`]) => ({
      id, he: good("אירוע", "06:30"), en: good("Event", "06:30"), usedSourceIds,
    });
    const provenance = { acceptedSourceSha256: "source", datasetVersion: "dataset", packageSha256: "package",
      existingReview: { decisionIds: ["decision"] }, visualRouteAugmentation: {},
      artifacts: Object.fromEntries([p, r, "nli.alarms"].map((id) => [id, { captionFields: [], acceptedCaptionSha256: "empty", packagedByteSha256: "package-byte" }])) };
    const entries = {
      "provenance.json": provenance,
      "index.json": { requests: [
        { narrativeId: null, membership: [p], minutes: [390] },
        { narrativeId: null, membership: [r], minutes: [400] },
        { narrativeId: null, membership: ["nli.alarms"], minutes: [405] },
        { narrativeId: "nova", membership: [p, r], minutes: [492] },
        { narrativeId: "nova", membership: [p, r, "nli.alarms"], minutes: [492] },
      ] },
      "early-source.json": [group("early-1", 390, [p])], "early-copy.json": [copy("early-1")],
      "later-source.json": [group("later-1", 400, [r])], "later-copy.json": [copy("later-1", [`${r}:7`])],
      "alarms-source.json": [{ id: "alarm-405", minute: 405, sources: [{ city: "עיר", sourceRef: { artifact: "nli.alarms", artifactSha256: "alarm-byte", recordId: "עיר", recordIdField: "city", interval: { field: "alarm_minutes", start: 405, end: 409 } } }] }],
      "alarms-copy.json": [{ ...copy("alarm-405", []), usedCities: ["עיר"] }],
      "nova-source.json": [group("nova-1", 492, [p, r, "nli.alarms"])], "nova-copy.json": [copy("nova-1")],
    };
    for (const [name, value] of Object.entries(entries)) fs.writeFileSync(path.join(inputDir, name), JSON.stringify(value));
    for (const [id, name] of [[p, "investigation_polygons.geojson"], [r, "lines.geojson"], ["nli.alarms", "alarms.geojson"]]) {
      fs.writeFileSync(path.join(runtimeDir, name), JSON.stringify({ features: [] }));
    }
    const manifest = assemblePresenterManifest({ inputDir, runtimeDir, provenance });
    expect(Object.keys(manifest.records)).toHaveLength(5);
    expect(manifest.records[presenterCopyKey(null, [p], 390)].he.title).toBe("אירוע");
    expect(manifest.records[presenterCopyKey(null, [r], 400)].sourceRefs[0].artifact).toBe(r);
    expect(manifest.records[presenterCopyKey(null, ["nli.alarms"], 405)].sourceRefs[0].artifact).toBe("nli.alarms");
    expect(manifest.records[presenterCopyKey("nova", [p, r], 492)].sourceRefs).toHaveLength(1);
    expect(manifest.records[presenterCopyKey("nova", [p, r, "nli.alarms"], 492)].he)
      .toEqual(manifest.records[presenterCopyKey("nova", [p, r], 492)].he);
    expect(manifest.records[presenterCopyKey("nova", [p, r, "nli.alarms"], 492)].sourceRefs)
      .toEqual(manifest.records[presenterCopyKey("nova", [p, r], 492)].sourceRefs);
    expect(manifest.editorialEvidence.status).toBe("pending-editorial-recheck");
    fs.rmSync(base, { recursive: true, force: true });
  });
  it("accepts approved packaged caption fields while excluding unconfirmed visual routes", () => {
    const features = [
      { properties: { OBJECTID: 1, Name: "Accepted", timeline_minutes: 390 } },
      { properties: { OBJECTID: 1001, Name: "Visual only", timeline_minutes: 390, route_confidence: "unconfirmed" } },
    ];
    const artifacts = { [r]: { features } };
    const fields = ["OBJECTID", "Name", "timeline_minutes"];
    const evidence = { artifacts: Object.fromEntries([p, r, "nli.alarms"].map((id) => [id, {
      captionFields: id === r ? fields : [],
      acceptedCaptionSha256: id === r ? captionFingerprint(features, fields, r) : captionFingerprint([], [], id),
    }])) };
    expect(validateCaptionFingerprints({ sourceEvidence: evidence }, { ...artifacts, [p]: { features: [] }, "nli.alarms": { features: [] } }, evidence)).toEqual([]);
  });

  it("rejects changed accepted caption fields", () => {
    const artifacts = { [r]: { features: [{ properties: { OBJECTID: 1, Name: "Changed" } }] } };
    const manifest = { sourceEvidence: { artifacts: { [r]: {
      captionFields: ["OBJECTID", "Name"], acceptedCaptionSha256: "wrong",
    } } } };
    const provenance = { artifacts: { [p]: { captionFields: [], acceptedCaptionSha256: captionFingerprint([], [], p) },
      [r]: { captionFields: ["OBJECTID", "Name"], acceptedCaptionSha256: "different" },
      "nli.alarms": { captionFields: [], acceptedCaptionSha256: captionFingerprint([], [], "nli.alarms") } } };
    expect(validateCaptionFingerprints(manifest, artifacts, provenance)).toContain(`${r} caption fields differ from accepted source`);
  });

  it("rejects source references outside the exact presenter membership", () => {
    const record = { sourceRefs: [{ artifact: p, artifactSha256: "polygon-byte", recordId: 1, recordIdField: "OBJECTID", field: "Name", value: "A" }] };
    const artifacts = { [p]: { byteSha256: "polygon-byte", features: [{ properties: { OBJECTID: 1, Name: "A" } }] } };
    expect(validateSourceReferencesForMembership(record, artifacts, [r])).toContain("Source reference artifact is outside presenter membership");
  });

  it("rejects source references to unconfirmed visual routes", () => {
    const record = { sourceRefs: [{ artifact: r, artifactSha256: "route-byte", recordId: 1001, recordIdField: "OBJECTID", field: "Name", value: "Visual only" }] };
    const artifacts = { [r]: { byteSha256: "route-byte", features: [{ properties: { OBJECTID: 1001, Name: "Visual only", route_confidence: "unconfirmed" } }] } };
    expect(validateSourceReferences(record, artifacts)).toContain("Source reference uses an excluded visual route");
  });

  it("invalidates editorial checks when reviewed record bytes change", () => {
    const manifest = { records: { [presenterCopyKey(null, [p], 390)]: { he: good("A"), en: good("B") } },
      editorialEvidence: { status: "source-checked", recordsSha256: "wrong", checkedBy: "Sol" } };
    expect(validateEditorialEvidence(manifest)).toContain("Editorial source-check evidence does not match presenter records");
  });

  it("does not require the mutable root ZIP unless explicitly supplied", () => {
    expect(validateOptionalSourceZip({ sourceZip: null, explicit: false, metadata: null })).toEqual([]);
  });

  it("verifies the tracked navigation fixture without a mockup export path", () => {
    const fixture = JSON.parse(fs.readFileSync(new URL("../fixtures/nli-presenter-navigation.json", import.meta.url), "utf8"));
    expect(validateNavigationFixture({ fixture, computedMinutes: fixture.minutes })).toEqual([]);
    expect(validateNavigationFixture({ fixture, computedMinutes: fixture.minutes.slice(1) })).toContain("Beat minutes differ from the tracked navigation fixture");
  });

  it("defaults verifier inputs to tracked provenance and fixture without SDD or mockup paths", () => {
    const here = path.resolve("scripts");
    const repo = path.resolve("..");
    const inputs = resolveVerifierInputs({ args: [], here, repo });
    expect(inputs.exportPath).toBeNull();
    expect(inputs.sourceZip).toBeNull();
    expect(inputs.provenancePath).toBe(path.join(here, "nli-presenter-provenance.json"));
    expect(inputs.fixturePath).toBe(path.join(repo, "otef-interactive/tests/fixtures/nli-presenter-navigation.json"));
  });
  it("allows evidenced title reuse across exact memberships but rejects repeated fields", () => {
    const first = presenterCopyKey(null, [p], 520);
    const variant = presenterCopyKey(null, [p, "nli.alarms"], 520);
    const sourceRef = { artifact: p, artifactSha256: "polygon-byte", recordId: "106", recordIdField: "OBJECTID", field: "event", value: "Shared event" };
    const records = {
      [first]: { en: good("Shared event"), he: good("אירוע משותף"), sourceRefs: [sourceRef] },
      [variant]: { en: good("Shared event"), he: good("אירוע משותף"), sourceRefs: [sourceRef] },
    };
    expect(validatePresenterEditorialCopy(records)).toEqual([]);
    const artifacts = { [p]: { byteSha256: "polygon-byte", features: [{ properties: { OBJECTID: 106, event: "Shared event" } }] } };
    expect(validateSourceReferences(records[first], artifacts)).toEqual([]);
    expect(validateSourceReferences(records[variant], artifacts)).toEqual([]);
    records[variant].en.summary = "Shared event";
    expect(validatePresenterEditorialCopy(records)).toContain(`Repeated presenter copy in ${variant}:en`);
    records[variant].en.summary = "Additional context";
    records[variant].en.details = "Additional context";
    expect(validatePresenterEditorialCopy(records)).toContain(`Repeated presenter copy in ${variant}:en`);
  });
  const current = {
    "nli.investigation_polygons": { byteSha256: "polygon-byte", featureSha256: "polygon-features" },
    "nli.lines": { byteSha256: "route-byte", featureSha256: "route-features" },
    "nli.alarms": { byteSha256: "alarm-byte", featureSha256: "alarm-features" },
  };
  const metadata = {
    sourceSha256: "source-accepted", datasetVersion: "dataset-accepted",
    review: { status: "approved", decisionIds: ["import-1", "owner-1"] },
  };
  const emptyCaption = createHash("sha256").update("[]").digest("hex");
  const manifest = {
    acceptedSourceSha256: "source-accepted", datasetVersion: "dataset-accepted",
    requiredArtifacts: {
      "nli.investigation_polygons": "polygon-features",
      "nli.lines": "route-features",
      "nli.alarms": "alarm-features",
    },
    sourceEvidence: {
      acceptedSourceSha256: "source-accepted", datasetVersion: "dataset-accepted",
      packageSha256: "package", acceptedPackageSha256: "package", existingDecisionIds: ["import-1", "owner-1"],
      artifacts: Object.fromEntries(Object.keys(current).map((id) => [id, { captionFields: [], acceptedCaptionSha256: emptyCaption,
        packagedByteSha256: `packaged-${id}`, runtimeByteSha256: current[id].byteSha256, runtimeFeatureSha256: current[id].featureSha256 }])),
    },
  };
  const provenance = {
    acceptedSourceSha256: "source-accepted", datasetVersion: "dataset-accepted", packageSha256: "package",
    existingReview: { decisionIds: ["import-1", "owner-1"] },
    artifacts: Object.fromEntries(Object.keys(current).map((id) => [id, { captionFields: [], acceptedCaptionSha256: emptyCaption,
      packagedByteSha256: `packaged-${id}` }])),
  };

  it("uses existing accepted release decisions without inventing route override approval", () => {
    expect(validateAcceptedEvidence({ manifest, metadata, provenance, artifacts: current })).toEqual([]);
  });

  it("requires each artifact's recorded runtime byte hash and runtime feature hash", () => {
    const wrong = { ...current, "nli.alarms": { ...current["nli.alarms"], byteSha256: "unaccepted" } };
    const errors = validateAcceptedEvidence({ manifest, metadata, provenance, artifacts: wrong });
    expect(errors).toContain("nli.alarms runtime byte hash does not match presenter source evidence");
    const noRouteRuntimeHash = { ...manifest, requiredArtifacts: { ...manifest.requiredArtifacts, "nli.lines": undefined } };
    expect(validateAcceptedEvidence({ manifest: noRouteRuntimeHash, metadata, provenance, artifacts: current })).toContain("Presenter manifest feature hash missing for nli.lines");
  });

  it("rejects tampered packaged-byte evidence", () => {
    const id = "nli.lines";
    const badManifest = { ...manifest, sourceEvidence: { ...manifest.sourceEvidence,
      artifacts: { ...manifest.sourceEvidence.artifacts, [id]: { ...manifest.sourceEvidence.artifacts[id], packagedByteSha256: "tampered-package-bytes" } } } };
    expect(validateAcceptedEvidence({ manifest: badManifest, metadata, provenance, artifacts: current }))
      .toContain(`${id} packaged byte hash differs from accepted package provenance`);
  });

  it("rejects tampered runtime-feature evidence", () => {
    const id = "nli.lines";
    const badManifest = { ...manifest, sourceEvidence: { ...manifest.sourceEvidence,
      artifacts: { ...manifest.sourceEvidence.artifacts, [id]: { ...manifest.sourceEvidence.artifacts[id], runtimeFeatureSha256: "tampered-runtime-features" } } } };
    expect(validateAcceptedEvidence({ manifest: badManifest, metadata, provenance, artifacts: current }))
      .toContain(`${id} runtime feature hash does not match loaded artifact`);
  });

  it("checks source reference hashes, IDs, fields, values, and uncertainty against loaded features", () => {
    const feature = { properties: { OBJECTID: 106, timeline: "local 12:00–13:00 approx", timeline_minutes: 720 } };
    const artifacts = { "nli.investigation_polygons": { ...current["nli.investigation_polygons"], features: [feature] } };
    const valid = { sourceRefs: [{ artifact: "nli.investigation_polygons", artifactSha256: "polygon-byte", recordId: "106", recordIdField: "OBJECTID", field: "timeline", value: "local 12:00–13:00 approx", uncertainty: "approx" }] };
    expect(validateSourceReferences(valid, artifacts)).toEqual([]);
    expect(validateSourceReferences({ sourceRefs: [{ ...valid.sourceRefs[0], artifactSha256: "wrong" }] }, artifacts)).toContain("Source reference artifact hash mismatch");
    expect(validateSourceReferences({ sourceRefs: [{ ...valid.sourceRefs[0], recordId: "999" }] }, artifacts)).toContain("Source reference record ID not found");
    expect(validateSourceReferences({ sourceRefs: [{ ...valid.sourceRefs[0], value: "exact 12:00" }] }, artifacts)).toContain("Source reference field value mismatch");
    expect(validateSourceReferences({ sourceRefs: [{ ...valid.sourceRefs[0], uncertainty: "confirmed exact time" }] }, artifacts)).toContain("Source reference uncertainty is not supported by the cited source field");
  });

  it("rejects an export digest mismatch and beat mismatch before writing a fixture", () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "nli-fixture-"));
    const target = path.join(directory, "navigation.json");
    const exportBytes = Buffer.from(JSON.stringify({ beats: [{ minute: 10 }] }));
    expect(() => writeNavigationFixture({ exportBytes, computedMinutes: [10], fixturePath: target })).toThrow(/pinned export SHA-256 mismatch/i);
    expect(fs.existsSync(target)).toBe(false);
    const pinnedBytes = Buffer.from(JSON.stringify({ beats: [{ minute: 10 }] }));
    const testDigest = createHash("sha256").update(pinnedBytes).digest("hex");
    expect(() => writeNavigationFixture({ exportBytes: pinnedBytes, expectedSha256: testDigest, computedMinutes: [11], fixturePath: target })).toThrow(/beat minutes differ/i);
    expect(fs.existsSync(target)).toBe(false);
    fs.rmSync(directory, { recursive: true, force: true });
  });
});
