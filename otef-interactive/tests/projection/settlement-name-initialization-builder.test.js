import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "vitest";
import { completeCaptureArtifacts, completeCaptureFixture } from "../fixtures/settlement-name-capture.js";
import { sha256Hex } from "../../scripts/settlement-name-baseline/validate-capture.mjs";
import { buildInitialization, stageReplay } from "../../scripts/settlement-name-baseline/build-initialization.mjs";

const scriptPath = fileURLToPath(new URL("../../scripts/settlement-name-baseline/build-initialization.mjs", import.meta.url));

function artifactFiles(capture) {
  const files = { ...completeCaptureArtifacts(capture) };
  for (const side of ["left", "right"]) {
    const output = capture.outputs[side];
    files[output.liveSource.path] = JSON.stringify(output.source);
    files[output.baselineAsset.path] = JSON.stringify(output.logicalMesh);
  }
  return files;
}

async function writeTree(root, files) {
  await mkdir(root, { recursive: true });
  for (const [relative, bytes] of Object.entries(files)) {
    const target = path.join(root, relative);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, bytes);
  }
}

function convertedBaseline(capture) {
  const positions = (side) => Object.fromEntries(capture.processedSource.citycodes.map((citycode, index) => [
    citycode,
    { x: citycode === "0424" ? -40 : 100 + index, y: citycode === "0424" ? 1400 : 200 + index },
  ]));
  return {
    captureId: capture.captureId,
    captureDigest: "pending",
    wallRotateDeg: 35,
    style: { fontFamily: "Guttman Hatzvi", fontPx: 14, rotateDeg: 35 },
    outputs: { left: positions("left"), right: positions("right") },
  };
}

async function runCli(args, cwd) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [scriptPath, ...args], { cwd, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("close", (code) => resolve({ code, stdout, stderr }));
  });
}

test("stage-only copies inputs and does not emit initialization", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "settlement-stage-"));
  try {
    const capture = completeCaptureFixture();
    const files = artifactFiles(capture);
    await writeTree(root, files);
    const captureBytes = Buffer.from(JSON.stringify(capture));
    await writeFile(path.join(root, "capture.json"), captureBytes);
    const validation = {
      captureSha256: sha256Hex(captureBytes),
      artifacts: Object.keys(files).map((filePath) => ({ path: filePath, sha256: sha256Hex(files[filePath]), ok: true })),
      errors: [],
    };
    await writeFile(path.join(root, "capture-validation.json"), JSON.stringify(validation));
    const replayOut = path.join(root, "replay");
    const result = await runCli([
      "--capture", "capture.json",
      "--validation", "capture-validation.json",
      "--replay-out", "replay",
    ], root);
    expect(result.code).toBe(0);
    expect(await readFile(path.join(replayOut, "initialize.json")).then(() => true, () => false)).toBe(false);
    const input = JSON.parse(await readFile(path.join(replayOut, "input.json"), "utf8"));
    expect(input.outputs.left.mapDescriptor.clip).toEqual([0, 0, 1, 1]);
    expect(input.outputs.right.baselineIdentity.sha256).toBe(capture.outputs.right.baselineIdentity.sha256);
    expect(input.artifacts.font.sha256).toBe(capture.fontAssets[0].sha256);
    const stagedFont = await readFile(path.join(replayOut, input.artifacts.font.path));
    expect(sha256Hex(stagedFont)).toBe(capture.fontAssets[0].sha256);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("finalization requires matching parity bytes and keeps leading zeroes and offscreen positions", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "settlement-final-"));
  try {
    const capture = completeCaptureFixture();
    const files = artifactFiles(capture);
    await writeTree(root, files);
    const captureBytes = Buffer.from(JSON.stringify(capture));
    const captureDigest = sha256Hex(captureBytes);
    await writeFile(path.join(root, "capture.json"), captureBytes);
    const validation = {
      captureSha256: captureDigest,
      artifacts: Object.keys(files).map((filePath) => ({ path: filePath, sha256: sha256Hex(files[filePath]), ok: true })),
      errors: [],
    };
    await writeFile(path.join(root, "capture-validation.json"), JSON.stringify(validation));
    const converted = convertedBaseline(capture);
    converted.captureDigest = captureDigest;
    const convertedBytes = Buffer.from(`${JSON.stringify(converted)}\n`);
    await writeFile(path.join(root, "converted-baseline.json"), convertedBytes);
    const parity = {
      passed: true,
      captureId: capture.captureId,
      captureDigest,
      convertedBaselineSha256: sha256Hex(convertedBytes),
      maxCenterErrorPx: 0.25,
      labels: [],
    };
    const payload = Buffer.from(`${JSON.stringify(parity)}\n`);
    const parityFile = { ...parity, payloadSha256: sha256Hex(payload) };
    const parityBytes = Buffer.from(`${JSON.stringify(parityFile)}\n`);
    await writeFile(path.join(root, "parity.json"), parityBytes);

    const missing = await runCli([
      "--capture", "capture.json",
      "--validation", "capture-validation.json",
      "--converted", "converted-baseline.json",
      "--out", "initialize.json",
      "--replay-out", "replay",
    ], root);
    expect(missing.code).toBe(1);
    expect(await readFile(path.join(root, "initialize.json")).then(() => true, () => false)).toBe(false);

    parityFile.payloadSha256 = "0".repeat(64);
    await writeFile(path.join(root, "parity.json"), Buffer.from(`${JSON.stringify(parityFile)}\n`));
    const mismatched = await runCli([
      "--capture", "capture.json",
      "--validation", "capture-validation.json",
      "--converted", "converted-baseline.json",
      "--parity", "parity.json",
      "--out", "initialize.json",
      "--replay-out", "replay",
    ], root);
    expect(mismatched.code).toBe(1);
    expect(await readFile(path.join(root, "initialize.json")).then(() => true, () => false)).toBe(false);

    await writeFile(path.join(root, "parity.json"), parityBytes);
    const finalized = await runCli([
      "--capture", "capture.json",
      "--validation", "capture-validation.json",
      "--converted", "converted-baseline.json",
      "--parity", "parity.json",
      "--out", "initialize.json",
      "--replay-out", "replay",
    ], root);
    expect(finalized.code).toBe(0);
    const command = JSON.parse(await readFile(path.join(root, "initialize.json"), "utf8"));
    expect(command.action).toBe("initialize_projection_name_settings");
    expect(command.baselinePositions.left["0067"].x).toBe(converted.outputs.left["0067"].x);
    expect(command.baselinePositions.left["0424"]).toEqual({ x: -40, y: 1400 });
    expect(Object.keys(command.baselinePositions.left)).toEqual(Object.keys(command.baselinePositions.right));
    expect(command.style).toEqual(converted.style);
    expect(command.wallRotateDeg).toBe(35);
    expect(JSON.parse(command.catalogJson).entries[0].citycode).toBe("0067");
    const report = JSON.parse(finalized.stdout);
    expect(report.hashes.initialize).toBe(sha256Hex(await readFile(path.join(root, "initialize.json"))));
    expect(await readFile(path.join(root, "viewport.json"), "utf8")).toMatch(/settlement_name_revision/);
    expect(JSON.parse(await readFile(path.join(root, "projection.json"), "utf8")).schemaVersion).toBe(6);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("rejects a missing mesh and a mismatched artifact without writing replay output", async () => {
  const capture = completeCaptureFixture();
  const files = artifactFiles(capture);
  const captureBytes = Buffer.from(JSON.stringify(capture));
  const validation = {
    captureSha256: sha256Hex(captureBytes),
    artifacts: Object.keys(files).map((filePath) => ({ path: filePath, sha256: sha256Hex(files[filePath]), ok: true })),
    errors: [],
  };
  delete capture.outputs.right.mesh;
  await expect(stageReplay(capture, validation, files)).rejects.toThrow(/mesh/i);

  capture.outputs.right.mesh = completeCaptureFixture().outputs.right.mesh;
  files[capture.processedSource.path] = "{\"type\":\"FeatureCollection\",\"features\":[]}";
  await expect(stageReplay(capture, validation, files)).rejects.toThrow(/hash|artifact/i);
  expect(buildInitialization).toBeTypeOf("function");
});
