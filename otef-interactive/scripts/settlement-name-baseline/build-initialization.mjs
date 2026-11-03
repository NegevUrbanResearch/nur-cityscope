import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildSettlementNameCatalog } from "../../frontend/src/shared/settlement-name-catalog.js";
import { sharedCapturedStyle } from "../../frontend/src/shared/settlement-name-settings.js";
import { sha256Hex, validateCapture } from "./validate-capture.mjs";

const UNREAD_LIVE_FIELD = /(?:^|\.)(?:instanceId|camera(?:\.|$)|visibilityByCitycode|settled|ready|rebuildState|requestedRevision|installedRevision|serverRevision|requestGeneration|installedGeneration|wall(?:\.|$))/;
const SIDES = ["left", "right"];

function sha256Buffer(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function utf8(value) {
  const text = `${JSON.stringify(value)}\n`;
  return { text, sha256: sha256Buffer(Buffer.from(text)) };
}

function artifactPlan(capture) {
  return [
    { key: "processedSource", path: capture.processedSource?.path, sha256: capture.processedSource?.sha256, file: "artifacts/processed.geojson" },
    { key: "font", path: capture.fontAssets?.[0]?.path, sha256: capture.fontAssets?.[0]?.sha256, file: "artifacts/font.ttf" },
    { key: "leftLive", path: capture.outputs?.left?.liveSource?.path, sha256: capture.outputs?.left?.liveSource?.sha256, file: "artifacts/left-live.geojson" },
    { key: "rightLive", path: capture.outputs?.right?.liveSource?.path, sha256: capture.outputs?.right?.liveSource?.sha256, file: "artifacts/right-live.geojson" },
    { key: "leftMesh", path: capture.outputs?.left?.baselineAsset?.path, sha256: capture.outputs?.left?.baselineAsset?.sha256, file: "artifacts/left-mesh.json" },
    { key: "rightMesh", path: capture.outputs?.right?.baselineAsset?.path, sha256: capture.outputs?.right?.baselineAsset?.sha256, file: "artifacts/right-mesh.json" },
  ];
}

function bytesOf(artifacts, filePath) {
  const value = artifacts?.[filePath];
  if (value == null) return null;
  return Buffer.isBuffer(value) ? value : Buffer.from(value);
}

function assertArtifacts(capture, artifacts) {
  for (const item of artifactPlan(capture)) {
    if (!item.path || !item.sha256) throw new Error(`artifact missing ${item.key}`);
    const bytes = bytesOf(artifacts, item.path);
    if (!bytes) throw new Error(`artifact missing ${item.path}`);
    if (sha256Buffer(bytes) !== item.sha256) throw new Error(`artifact hash mismatch ${item.path}`);
  }
}

function assertMeshes(capture) {
  for (const side of SIDES) {
    if (!capture.outputs?.[side]?.mesh) throw new Error(`missing mesh outputs.${side}.mesh`);
  }
}

function blockingCaptureErrors(capture, artifacts) {
  return validateCapture(capture, { artifacts }).filter((error) => !UNREAD_LIVE_FIELD.test(error));
}

function outputRecord(output) {
  return {
    output: output.output,
    url: output.url,
    cssSize: output.cssSize,
    canvasSize: output.canvasSize,
    pixelRatio: output.pixelRatio,
    source: output.source,
    mapDescriptor: output.mapDescriptor,
    mesh: output.mesh,
    baselineIdentity: output.baselineIdentity,
    effectiveConfig: output.effectiveConfig,
    appliedTextLayout: output.appliedTextLayout,
    appliedTextPaint: output.appliedTextPaint,
    glyphsUrl: output.glyphsUrl ?? null,
    localFontBehavior: output.localFontBehavior ?? null,
    headingDeg: output.headingDeg ?? output.wall?.headingDeg ?? null,
    wall: output.wall ?? null,
  };
}

function replayInput(capture, validation) {
  const artifacts = {};
  for (const item of artifactPlan(capture)) artifacts[item.key] = { path: item.file, sha256: item.sha256, sourcePath: item.path };
  return {
    captureId: capture.captureId,
    captureDigest: validation.captureSha256,
    capturedAt: capture.capturedAt ?? null,
    fontAssets: capture.fontAssets,
    calibration: capture.calibration,
    processedSource: capture.processedSource,
    artifacts,
    outputs: { left: outputRecord(capture.outputs.left), right: outputRecord(capture.outputs.right) },
  };
}

export async function stageReplay(capture, validation, artifacts, options = {}) {
  assertMeshes(capture);
  assertArtifacts(capture, artifacts);
  const captureBytes = options.captureBytes ?? Buffer.from(JSON.stringify(capture));
  if (sha256Hex(captureBytes) !== validation?.captureSha256) throw new Error("capture digest mismatch");
  const blocking = blockingCaptureErrors(capture, artifacts);
  if (blocking.length) throw new Error(blocking.join("\n"));
  const input = replayInput(capture, validation);
  if (!options.replayOut) return input;
  await mkdir(path.join(options.replayOut, "artifacts"), { recursive: true });
  for (const item of artifactPlan(capture)) {
    await writeFile(path.join(options.replayOut, item.file), bytesOf(artifacts, item.path));
  }
  await writeFile(path.join(options.replayOut, "input.json"), utf8(input).text);
  return input;
}

function sameKeys(left, right) {
  const a = Object.keys(left || {}).sort();
  const b = Object.keys(right || {}).sort();
  return a.length === b.length && a.every((key, index) => key === b[index]);
}

function assertPositions(positions, citycodes) {
  if (!sameKeys(positions, Object.fromEntries(citycodes.map((code) => [code, true])))) {
    throw new Error("baseline positions do not match the catalog");
  }
  for (const [citycode, position] of Object.entries(positions)) {
    if (typeof citycode !== "string" || !citycode) throw new Error("baseline citycode");
    if (typeof position?.x !== "number" || typeof position?.y !== "number" || !Number.isFinite(position.x) || !Number.isFinite(position.y)) {
      throw new Error(`baseline position ${citycode}`);
    }
  }
}

export function buildInitialization(capture, validation, convertedBaseline, parity, artifacts = {}, options = {}) {
  const captureBytes = options.captureBytes ?? Buffer.from(JSON.stringify(capture));
  if (sha256Hex(captureBytes) !== validation?.captureSha256) throw new Error("capture digest mismatch");
  assertMeshes(capture);
  assertArtifacts(capture, artifacts);
  const blocking = blockingCaptureErrors(capture, artifacts);
  if (blocking.length) throw new Error(blocking.join("\n"));
  if (!options.convertedBytes || sha256Hex(options.convertedBytes) !== parity?.convertedBaselineSha256) {
    throw new Error("converted baseline identity");
  }
  const payload = { ...parity };
  delete payload.payloadSha256;
  if (!parity?.payloadSha256 || sha256Hex(Buffer.from(`${JSON.stringify(payload)}\n`)) !== parity.payloadSha256) {
    throw new Error("parity identity");
  }
  if (parity.passed !== true || !(typeof parity.maxCenterErrorPx === "number" && parity.maxCenterErrorPx <= 1)) {
    throw new Error("parity failed");
  }
  if (convertedBaseline.captureId !== capture.captureId || convertedBaseline.captureDigest !== validation.captureSha256) {
    throw new Error("converted baseline capture identity");
  }
  const capturedStyle = sharedCapturedStyle(capture.outputs.left.appliedTextLayout, capture.outputs.right.appliedTextLayout);
  const style = convertedBaseline.style;
  if (style?.fontFamily !== capturedStyle.fontFamily || style?.fontPx !== capturedStyle.fontPx) {
    throw new Error("converted style does not match the capture");
  }
  if (typeof style.rotateDeg !== "number" || !Number.isFinite(style.rotateDeg)) throw new Error("converted style rotation");
  const wallRotateDeg = convertedBaseline.wallRotateDeg;
  if (typeof wallRotateDeg !== "number" || !Number.isFinite(wallRotateDeg)) throw new Error("wall angle");
  const processed = JSON.parse(bytesOf(artifacts, capture.processedSource.path).toString("utf8"));
  const catalog = buildSettlementNameCatalog(processed);
  const citycodes = catalog.entries.map((entry) => entry.citycode);
  assertPositions(convertedBaseline.outputs?.left, citycodes);
  assertPositions(convertedBaseline.outputs?.right, citycodes);
  const catalogJson = JSON.stringify({ entries: catalog.entries });
  const calibrationConfigJson = JSON.stringify(capture.calibration.config);
  const command = {
    action: "initialize_projection_name_settings",
    sourceId: options.sourceId || crypto.randomUUID(),
    captureId: capture.captureId,
    captureDigest: validation.captureSha256,
    baseRevision: 0,
    calibrationRevision: capture.calibration.revision,
    calibrationConfigDigest: sha256Hex(calibrationConfigJson),
    calibrationConfigJson,
    processedSourceDigest: capture.processedSource.sha256,
    catalogDigest: sha256Hex(catalogJson),
    catalogJson,
    wallRotateDeg,
    baselinePositions: {
      left: convertedBaseline.outputs.left,
      right: convertedBaseline.outputs.right,
    },
    style,
  };
  const projection = structuredClone(capture.calibration.config);
  projection.schemaVersion = 6;
  projection.namesWall = { ...(projection.namesWall || {}), rotateDeg: wallRotateDeg };
  const viewport = {
    settlement_name_revision: 1,
    settlement_name_settings: {
      baseline: {
        captureId: command.captureId,
        captureDigest: command.captureDigest,
        sourceDigest: command.processedSourceDigest,
        catalogDigest: command.catalogDigest,
        predecessor: { revision: capture.calibration.revision, configDigest: command.calibrationConfigDigest },
        successor: { revision: capture.calibration.revision + 1, configDigest: command.calibrationConfigDigest },
        outputs: command.baselinePositions,
      },
      style: command.style,
      outputs: { left: {}, right: {} },
    },
    fixture: "read-only prospective snapshot, not an initialization acknowledgement",
  };
  return { command, viewport, projection };
}

function parseArgs(argv) {
  const args = {};
  for (let index = 2; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) continue;
    args[token.slice(2)] = argv[index + 1];
    index += 1;
  }
  return args;
}

async function loadArtifacts(validation) {
  const artifacts = {};
  for (const item of validation.artifacts || []) {
    artifacts[item.path] = await readFile(item.path);
  }
  return artifacts;
}

async function main() {
  const args = parseArgs(process.argv);
  if (!args.capture || !args.validation || !args["replay-out"]) {
    console.error("Usage: node build-initialization.mjs --capture <capture.json> --validation <capture-validation.json> --replay-out <dir> [--converted <converted-baseline.json> --parity <parity.json> --out <initialize.json>]");
    process.exitCode = 2;
    return;
  }
  const finalizing = Boolean(args.converted || args.parity || args.out);
  if (finalizing && !(args.converted && args.parity && args.out)) {
    console.error("finalization requires --converted, --parity, and --out");
    process.exitCode = 1;
    return;
  }
  const captureBytes = await readFile(args.capture);
  const capture = JSON.parse(captureBytes.toString("utf8"));
  const validation = JSON.parse(await readFile(args.validation, "utf8"));
  const artifacts = await loadArtifacts(validation);
  await stageReplay(capture, validation, artifacts, { captureBytes, replayOut: args["replay-out"] });
  if (!finalizing) {
    console.log(JSON.stringify({ ok: true, staged: args["replay-out"] }));
    return;
  }
  const convertedBytes = await readFile(args.converted);
  const parityBytes = await readFile(args.parity);
  const convertedBaseline = JSON.parse(convertedBytes.toString("utf8"));
  const parity = JSON.parse(parityBytes.toString("utf8"));
  const built = buildInitialization(capture, validation, convertedBaseline, parity, artifacts, { captureBytes, convertedBytes });
  const initialize = utf8(built.command);
  const viewport = utf8(built.viewport);
  const projection = utf8(built.projection);
  const directory = path.dirname(args.out);
  await mkdir(directory, { recursive: true });
  await writeFile(path.join(directory, "viewport.json"), viewport.text);
  await writeFile(path.join(directory, "projection.json"), projection.text);
  await writeFile(args.out, initialize.text);
  await writeFile(path.join(args["replay-out"], "viewport.json"), viewport.text);
  await writeFile(path.join(args["replay-out"], "projection.json"), projection.text);
  console.log(JSON.stringify({ ok: true, hashes: { initialize: initialize.sha256, viewport: viewport.sha256, projection: projection.sha256 } }));
}

const invokedDirectly = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  main().catch((error) => {
    console.error(error.message || error);
    process.exitCode = 1;
  });
}
