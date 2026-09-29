import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { prepareProjectionSideMesh } from "../../frontend/src/projection/projection-candidate-validation.js";

const HASH = /^[0-9a-f]{64}$/i;
const SIDES = ["left", "right"];
const DIAGNOSTIC_COUNT_KEYS = ["expected", "placed", "missing", "extra", "duplicate"];
const CAMERA_FIELDS = ["center", "zoom", "bearing", "pitch"];
const GENERATION_FIELDS = ["requestedRevision", "installedRevision", "serverRevision", "requestGeneration", "installedGeneration"];

function has(object, key) {
  return !!object && typeof object === "object" && Object.hasOwn(object, key);
}

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object") {
    return Object.keys(value).sort().reduce((acc, key) => {
      acc[key] = stable(value[key]);
      return acc;
    }, {});
  }
  return value;
}

function same(left, right) {
  return JSON.stringify(stable(left)) === JSON.stringify(stable(right));
}

function push(errors, message) {
  if (!errors.includes(message)) errors.push(message);
}

function requireHash(errors, fieldPath, value) {
  if (typeof value !== "string" || !HASH.test(value)) push(errors, fieldPath);
}

function requireBoundHash(errors, fieldPath, declared, bytes) {
  requireHash(errors, fieldPath, declared);
  if (bytes === undefined) {
    if (typeof declared === "string" && HASH.test(declared)) push(errors, `${fieldPath} unverifiable`);
    return;
  }
  if (sha256Hex(bytes) !== declared) push(errors, fieldPath);
}

function finiteNumber(value) {
  return typeof value === "number" && Number.isFinite(value);
}

function citycodesOf(source) {
  if (!source || source.type !== "FeatureCollection" || !Array.isArray(source.features)) return null;
  return source.features.map((feature) => feature?.properties?.citycode);
}

function multiset(values) {
  return [...values].sort().join("\0");
}

function requireSize(errors, fieldPath, value) {
  if (!value || typeof value !== "object" || !finiteNumber(value.width) || !finiteNumber(value.height) || value.width <= 0 || value.height <= 0) {
    push(errors, fieldPath);
  }
}

function requireCamera(errors, fieldPath, camera) {
  if (!camera || typeof camera !== "object") {
    for (const field of CAMERA_FIELDS) push(errors, `${fieldPath}.${field}`);
    return;
  }
  if (!Array.isArray(camera.center) || camera.center.length !== 2 || !camera.center.every(finiteNumber)) push(errors, `${fieldPath}.center`);
  for (const field of ["zoom", "bearing", "pitch"]) {
    if (!has(camera, field) || !finiteNumber(camera[field])) push(errors, `${fieldPath}.${field}`);
  }
}

function requireMatrix(errors, fieldPath, matrix) {
  if (!Array.isArray(matrix) || matrix.length !== 9 || !matrix.every(finiteNumber)) push(errors, fieldPath);
}

function requireClip(errors, fieldPath, clip) {
  if (!Array.isArray(clip) || clip.length !== 4 || !clip.every(finiteNumber) || !(clip[2] > clip[0]) || !(clip[3] > clip[1])) {
    push(errors, fieldPath);
  }
}

function positiveNumber(value) {
  return finiteNumber(value) && value > 0;
}

function placementGeometry(item) {
  return finiteNumber(item?.x) && finiteNumber(item?.y)
    && finiteNumber(item?.width) && finiteNumber(item?.height)
    && item.width > 0 && item.height > 0;
}

function safeCount(value) {
  return Number.isSafeInteger(value) && value >= 0;
}

function pageGeometry(page) {
  if (!page || typeof page !== "object" || Array.isArray(page)) return false;
  return finiteNumber(page.left) && finiteNumber(page.right) && finiteNumber(page.y0) && finiteNumber(page.y1)
    && page.right > page.left && page.y1 > page.y0;
}

function requireDiagnostics(errors, fieldPath, diagnostics) {
  if (!diagnostics || typeof diagnostics !== "object" || Array.isArray(diagnostics) || Object.keys(diagnostics).length === 0) {
    push(errors, fieldPath);
    return;
  }
  if (diagnostics.state !== "valid") push(errors, fieldPath);
  for (const key of DIAGNOSTIC_COUNT_KEYS) {
    if (!safeCount(diagnostics[key])) push(errors, fieldPath);
  }
  if (diagnostics.expected === 0) push(errors, fieldPath);
  if (safeCount(diagnostics.expected) && safeCount(diagnostics.placed) && diagnostics.expected !== diagnostics.placed) {
    push(errors, fieldPath);
  }
  for (const key of ["missing", "extra", "duplicate"]) {
    if (safeCount(diagnostics[key]) && diagnostics[key] !== 0) push(errors, fieldPath);
  }
}

function peoplePlacement(item) {
  return item && typeof item === "object" && !Array.isArray(item)
    && typeof item.id === "string" && item.id
    && typeof item.name === "string" && item.name
    && (item.output === "left" || item.output === "right")
    && placementGeometry(item);
}

function requireCoverageIdentity(errors, fieldPath, value) {
  const shaped = value && typeof value === "object" && !Array.isArray(value)
    && SIDES.every((side) => typeof value[side] === "string" && value[side].trim());
  if (!shaped) push(errors, fieldPath);
}

function requireWallPages(errors, fieldPath, pages, requirePages) {
  if (requirePages) {
    if (!pages || typeof pages !== "object" || Array.isArray(pages) || SIDES.some((side) => !pageGeometry(pages[side]))) {
      push(errors, fieldPath);
    }
    return;
  }
  if (pages !== undefined) push(errors, fieldPath);
}

function requireWall(errors, fieldPath, wall, requirePages) {
  const source = wall && typeof wall === "object" && !Array.isArray(wall) ? wall : null;
  if (!source) push(errors, fieldPath);
  const placements = source?.placements;
  const placementsShaped = Array.isArray(placements)
    && placements.length > 0
    && placements.every((item) => peoplePlacement(item));
  if (!placementsShaped) push(errors, `${fieldPath}.placements`);
  const plane = source?.logicalPlane;
  if (!plane || typeof plane !== "object" || Array.isArray(plane) || !finiteNumber(plane.heading) || !positiveNumber(plane.planeScale)) {
    push(errors, `${fieldPath}.logicalPlane`);
  }
  requireCoverageIdentity(errors, `${fieldPath}.coverageIdentity`, source?.coverageIdentity);
  if (!has(source, "effectiveFont") || !positiveNumber(source?.effectiveFont)) push(errors, `${fieldPath}.effectiveFont`);
  requireHash(errors, `${fieldPath}.digest`, source?.digest);
  if (typeof source?.datasetVersion !== "string" || !source.datasetVersion.trim()) push(errors, `${fieldPath}.datasetVersion`);
  requireDiagnostics(errors, `${fieldPath}.diagnostics`, source?.diagnostics);
  requireWallPages(errors, `${fieldPath}.pages`, source?.pages, requirePages);
}

function requireGenerations(errors, fieldPath, output, calibrationRevision) {
  if (output?.settled !== true) push(errors, `${fieldPath}.settled`);
  if (output?.ready !== true) push(errors, `${fieldPath}.ready`);
  if (output?.rebuildState !== "idle") push(errors, `${fieldPath}.rebuildState`);
  for (const field of GENERATION_FIELDS) {
    if (!has(output, field) || !finiteNumber(output[field])) push(errors, `${fieldPath}.${field}`);
  }
  const revisionFields = ["requestedRevision", "installedRevision", "serverRevision"];
  const revisions = revisionFields.map((field) => output?.[field]);
  if (revisions.every(finiteNumber) && new Set(revisions).size !== 1) push(errors, `${fieldPath}.requestedRevision`);
  if (finiteNumber(calibrationRevision)) {
    for (const field of revisionFields) {
      if (finiteNumber(output?.[field]) && output[field] !== calibrationRevision) push(errors, `${fieldPath}.${field}`);
    }
  }
  if (finiteNumber(output?.requestGeneration) && finiteNumber(output?.installedGeneration) && output.requestGeneration !== output.installedGeneration) {
    push(errors, `${fieldPath}.requestGeneration`);
  }
}

function requireSource(errors, fieldPath, source, catalog) {
  const codes = citycodesOf(source);
  if (!codes) {
    push(errors, fieldPath);
    return [];
  }
  const seen = new Set();
  source.features.forEach((feature, index) => {
    const code = feature?.properties?.citycode;
    const coordinates = feature?.geometry?.type === "Point" ? feature.geometry.coordinates : null;
    if (typeof code !== "string" || !code) push(errors, `${fieldPath}.features[${index}].properties.citycode`);
    else if (seen.has(code)) push(errors, `${fieldPath}.features[${index}].properties.citycode`);
    else seen.add(code);
    if (!Array.isArray(coordinates) || coordinates.length < 2 || !coordinates.slice(0, 2).every(finiteNumber)) {
      push(errors, `${fieldPath}.features[${index}].geometry`);
    }
  });
  if (Array.isArray(catalog) && multiset(codes) !== multiset(catalog)) push(errors, `${fieldPath}.citycodes`);
  return codes;
}

function requireRoute(errors, fieldPath, output, side) {
  if (output?.output !== side) push(errors, `${fieldPath}.output`);
  if (typeof output?.instanceId !== "string" || !output.instanceId.trim()) push(errors, `${fieldPath}.instanceId`);
  let params = null;
  try {
    const url = new URL(output?.url);
    params = url.searchParams;
  } catch {
    params = null;
  }
  if (!params || params.get("span") !== side || params.get("outputMode") !== "browser") push(errors, `${fieldPath}.url`);
}

function artifactBytes(artifacts, filePath) {
  if (!artifacts || typeof artifacts !== "object" || typeof filePath !== "string" || !Object.hasOwn(artifacts, filePath)) return undefined;
  return artifacts[filePath];
}

function parseArtifact(bytes) {
  try {
    const text = typeof bytes === "string" ? bytes : Buffer.isBuffer(bytes) ? bytes.toString("utf8") : null;
    if (text == null) return null;
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function requireMesh(errors, fieldPath, output, side, artifacts) {
  const warp = output?.effectiveConfig?.outputs?.[side]?.warp;
  const baseline = warp?.baseline;
  const identity = output?.baselineIdentity;
  if (!baseline || baseline.type !== "tdMesh" || identity?.type !== baseline.type || identity?.assetId !== baseline.assetId || identity?.sha256 !== baseline.sha256) {
    push(errors, `${fieldPath}.baselineIdentity`);
  }
  requireHash(errors, `${fieldPath}.baselineIdentity.sha256`, identity?.sha256);
  if (!output?.baselineAsset || output.baselineAsset.sha256 !== identity?.sha256 || typeof output.baselineAsset.path !== "string" || !output.baselineAsset.path) {
    push(errors, `${fieldPath}.baselineAsset`);
  }
  const meshBytes = artifactBytes(artifacts, output?.baselineAsset?.path);
  let logicalMesh = output?.logicalMesh;
  if (meshBytes !== undefined) {
    if (sha256Hex(meshBytes) !== output?.baselineAsset?.sha256) push(errors, `${fieldPath}.baselineAsset.sha256`);
    const parsed = parseArtifact(meshBytes);
    if (!parsed || !same(parsed, output?.logicalMesh)) push(errors, `${fieldPath}.logicalMesh`);
    if (parsed) logicalMesh = parsed;
  } else if (logicalMesh && typeof logicalMesh === "object") {
    if (sha256Hex(JSON.stringify(logicalMesh)) !== output?.baselineAsset?.sha256) push(errors, `${fieldPath}.baselineAsset.sha256`);
  }
  if (!has(output, "mesh") || output.mesh == null) {
    push(errors, `${fieldPath}.mesh`);
    return;
  }
  if (!logicalMesh || !output.baselineManifest) {
    push(errors, `${fieldPath}.logicalMesh`);
    return;
  }
  let expected = null;
  try {
    expected = prepareProjectionSideMesh(output.effectiveConfig, side, {
      mesh: logicalMesh,
      manifest: output.baselineManifest,
    }).mesh;
  } catch (error) {
    push(errors, `${fieldPath}.mesh ${error.message}`);
    return;
  }
  if (!same(output.mesh, expected)) push(errors, `${fieldPath}.mesh`);
}

function bindLiveSource(errors, fieldPath, output, artifacts) {
  const bytes = artifactBytes(artifacts, output?.liveSource?.path);
  if (bytes !== undefined) {
    if (sha256Hex(bytes) !== output?.liveSource?.sha256) push(errors, `${fieldPath}.liveSource.sha256`);
    const parsed = parseArtifact(bytes);
    if (!parsed || !same(parsed, output?.source)) push(errors, `${fieldPath}.liveSource`);
    return;
  }
  if (!output?.source || typeof output.source !== "object") return;
  if (sha256Hex(JSON.stringify(output.source)) !== output?.liveSource?.sha256) push(errors, `${fieldPath}.liveSource.sha256`);
}

function requireOutput(errors, capture, side, catalog, artifacts) {
  const fieldPath = `outputs.${side}`;
  const output = capture?.outputs?.[side];
  if (!output || typeof output !== "object") {
    push(errors, fieldPath);
    return;
  }
  requireRoute(errors, fieldPath, output, side);
  requireCamera(errors, `${fieldPath}.camera`, output.camera);
  requireSize(errors, `${fieldPath}.cssSize`, output.cssSize);
  requireSize(errors, `${fieldPath}.canvasSize`, output.canvasSize);
  if (!has(output, "pixelRatio") || !finiteNumber(output.pixelRatio) || output.pixelRatio <= 0) push(errors, `${fieldPath}.pixelRatio`);
  const codes = requireSource(errors, `${fieldPath}.source`, output.source, catalog);
  if (!output.liveSource || typeof output.liveSource.path !== "string" || !output.liveSource.path) push(errors, `${fieldPath}.liveSource`);
  requireHash(errors, `${fieldPath}.liveSource.sha256`, output.liveSource?.sha256);
  bindLiveSource(errors, fieldPath, output, artifacts);
  requireMatrix(errors, `${fieldPath}.mapDescriptor.matrix`, output.mapDescriptor?.matrix);
  requireClip(errors, `${fieldPath}.mapDescriptor.clip`, output.mapDescriptor?.clip);
  if (!same(output.effectiveConfig, capture?.calibration?.config)) push(errors, `${fieldPath}.effectiveConfig`);
  requireMesh(errors, fieldPath, output, side, artifacts);
  if (!output.appliedTextLayout || typeof output.appliedTextLayout !== "object") push(errors, `${fieldPath}.appliedTextLayout`);
  if (!output.appliedTextPaint || typeof output.appliedTextPaint !== "object") push(errors, `${fieldPath}.appliedTextPaint`);
  if (!has(output, "glyphsUrl") || !(output.glyphsUrl === null || (typeof output.glyphsUrl === "string" && output.glyphsUrl))) {
    push(errors, `${fieldPath}.glyphsUrl`);
  }
  if (typeof output.localFontBehavior !== "string" || !output.localFontBehavior.trim()) push(errors, `${fieldPath}.localFontBehavior`);
  if (typeof output.sceneId !== "string" || !output.sceneId.trim()) push(errors, `${fieldPath}.sceneId`);
  if (!output.visibilityByCitycode || typeof output.visibilityByCitycode !== "object") push(errors, `${fieldPath}.visibilityByCitycode`);
  else {
    for (const code of codes) {
      if (typeof code !== "string") continue;
      if (!has(output.visibilityByCitycode, code) || typeof output.visibilityByCitycode[code] !== "boolean") {
        push(errors, `${fieldPath}.visibilityByCitycode.${code}`);
      }
    }
  }
  requireGenerations(errors, fieldPath, output, capture?.calibration?.revision);
  const wallMode = capture?.calibration?.config?.namesWall?.activeMode;
  requireWall(errors, `${fieldPath}.wall`, output.wall, wallMode === "wall");
}

function catalogueFromArtifacts(errors, capture, artifacts) {
  const declared = Array.isArray(capture?.processedSource?.citycodes) ? capture.processedSource.citycodes : null;
  const bytes = artifactBytes(artifacts, capture?.processedSource?.path);
  if (bytes === undefined) return declared;
  const fileCodes = citycodesOf(parseArtifact(bytes));
  if (!fileCodes || !declared || multiset(fileCodes) !== multiset(declared)) push(errors, "processedSource.citycodes");
  return fileCodes || declared;
}

function compareOutputGeometry(errors, capture) {
  const leftFeatures = capture?.outputs?.left?.source?.features;
  const rightFeatures = capture?.outputs?.right?.source?.features;
  if (!Array.isArray(leftFeatures) || !Array.isArray(rightFeatures)) return;
  const rightByCode = new Map();
  for (const feature of rightFeatures) {
    const code = feature?.properties?.citycode;
    if (typeof code === "string" && code) rightByCode.set(code, feature);
  }
  for (const feature of leftFeatures) {
    const code = feature?.properties?.citycode;
    if (typeof code !== "string" || !code) continue;
    const other = rightByCode.get(code);
    if (!other) continue;
    if (!same(feature.geometry?.coordinates, other.geometry?.coordinates)) push(errors, "outputs.geometry");
    if (!same(feature.properties, other.properties)) push(errors, "outputs.featureProperties");
  }
}

export function validateCapture(capture, options = {}) {
  const errors = [];
  const artifacts = options?.artifacts;
  if (!capture || typeof capture !== "object") {
    push(errors, "capture");
    return errors;
  }
  if (typeof capture.captureId !== "string" || !capture.captureId.trim()) push(errors, "captureId");
  if (typeof capture.capturedAt !== "string" || !capture.capturedAt.trim()) push(errors, "capturedAt");
  if (!Array.isArray(capture.fontAssets) || capture.fontAssets.length === 0) push(errors, "fontAssets");
  else {
    capture.fontAssets.forEach((asset, index) => {
      if (typeof asset?.family !== "string" || !asset.family.trim() || typeof asset.path !== "string" || !asset.path) {
        push(errors, `fontAssets[${index}]`);
      }
      requireBoundHash(errors, `fontAssets[${index}].sha256`, asset?.sha256, artifactBytes(artifacts, asset?.path));
    });
  }
  if (!finiteNumber(capture.calibration?.revision)) push(errors, "calibration.revision");
  if (!capture.calibration?.config || typeof capture.calibration.config !== "object") push(errors, "calibration.config");
  if (!Array.isArray(capture.calibration?.presets)) push(errors, "calibration.presets");
  else if (!capture.calibration.presets.some((preset) => preset?.id === capture.calibration.selectedPresetId)) {
    push(errors, "calibration.selectedPresetId");
  }
  if (typeof capture.processedSource?.path !== "string" || !capture.processedSource.path) push(errors, "processedSource.path");
  requireBoundHash(
    errors,
    "processedSource.sha256",
    capture.processedSource?.sha256,
    artifactBytes(artifacts, capture.processedSource?.path),
  );
  if (!Array.isArray(capture.processedSource?.citycodes) || capture.processedSource.citycodes.some((code) => typeof code !== "string" || !code)) {
    push(errors, "processedSource.citycodes");
  }
  if (!capture.outputs || typeof capture.outputs !== "object") push(errors, "outputs");
  const catalog = catalogueFromArtifacts(errors, capture, artifacts);
  for (const side of SIDES) requireOutput(errors, capture, side, catalog, artifacts);
  const leftCodes = citycodesOf(capture.outputs?.left?.source);
  const rightCodes = citycodesOf(capture.outputs?.right?.source);
  if (leftCodes && rightCodes && multiset(leftCodes) !== multiset(rightCodes)) push(errors, "outputs.citycodes");
  compareOutputGeometry(errors, capture);
  return errors;
}

export function sha256Hex(bytes) {
  const buffer = typeof bytes === "string" ? Buffer.from(bytes) : Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
  if (!Buffer.isBuffer(buffer)) throw new Error("SHA-256 input must be bytes");
  return createHash("sha256").update(buffer).digest("hex");
}

export async function sha256File(filePath) {
  return sha256Hex(await readFile(filePath));
}

function referencedArtifacts(capture) {
  const items = [];
  if (capture?.processedSource?.path) items.push({ role: "processed-source", path: capture.processedSource.path, sha256: capture.processedSource.sha256 });
  for (const asset of capture?.fontAssets || []) items.push({ role: "font", path: asset.path, sha256: asset.sha256 });
  for (const side of SIDES) {
    const output = capture?.outputs?.[side];
    if (output?.liveSource?.path) items.push({ role: `${side}-live-source`, path: output.liveSource.path, sha256: output.liveSource.sha256 });
    if (output?.baselineAsset?.path) items.push({ role: `${side}-baseline-mesh`, path: output.baselineAsset.path, sha256: output.baselineAsset.sha256 });
  }
  return items;
}

function membership(capture, artifacts) {
  const parsed = parseArtifact(artifactBytes(artifacts, capture?.processedSource?.path));
  const fromFile = citycodesOf(parsed);
  const processed = fromFile || (Array.isArray(capture?.processedSource?.citycodes) ? capture.processedSource.citycodes : []);
  const outputs = {};
  for (const side of SIDES) outputs[side] = citycodesOf(capture?.outputs?.[side]?.source) || [];
  const equal = SIDES.every((side) => multiset(outputs[side]) === multiset(processed));
  return { processed, outputs, equal };
}

async function checkArtifacts(capture) {
  const checked = [];
  const errors = [];
  const artifacts = {};
  for (const artifact of referencedArtifacts(capture)) {
    try {
      const bytes = await readFile(artifact.path);
      artifacts[artifact.path] = bytes;
      const sha256 = sha256Hex(bytes);
      const ok = sha256 === artifact.sha256;
      checked.push({ ...artifact, actualSha256: sha256, ok });
      if (!ok) errors.push(`${artifact.role} hash mismatch ${artifact.path}`);
    } catch (error) {
      checked.push({ ...artifact, ok: false, error: error.message });
      errors.push(`${artifact.role} unreadable ${artifact.path}`);
    }
  }
  return { checked, errors, artifacts };
}

async function main() {
  const captureFlag = process.argv.indexOf("--capture");
  const capturePath = captureFlag >= 0 ? process.argv[captureFlag + 1] : "";
  if (!capturePath) {
    console.error("Usage: node validate-capture.mjs --capture <capture.json>");
    process.exitCode = 2;
    return;
  }
  const captureBytes = await readFile(capturePath);
  const capture = JSON.parse(captureBytes.toString("utf8"));
  const artifacts = await checkArtifacts(capture);
  const structural = validateCapture(capture, { artifacts: artifacts.artifacts });
  const errors = [...structural, ...artifacts.errors];
  const validation = {
    captureSha256: sha256Hex(captureBytes),
    artifacts: artifacts.checked,
    membership: membership(capture, artifacts.artifacts),
    errors,
  };
  const validationPath = path.join(path.dirname(capturePath), "capture-validation.json");
  await writeFile(validationPath, `${JSON.stringify(validation, null, 2)}\n`);
  if (errors.length) {
    console.error(errors.join("\n"));
    process.exitCode = 1;
    return;
  }
  console.log(`capture validated ${validation.captureSha256}`);
}

const invokedDirectly = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
