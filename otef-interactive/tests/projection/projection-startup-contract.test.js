import { expect, test } from "vitest";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("../../frontend/src/entries/projection-main.js", import.meta.url), "utf8");

test("browser output hydrates the single config client before using accepted calibration", () => {
  const init = source.indexOf('await OTEFDataContext.init("otef")');
  const clientStart = source.indexOf("projectionConfigHydrationPromise = waitForProjectionConfigStartup(projectionConfigClient", init);
  const registryInit = source.indexOf("const layerRegistryPromise = layerRegistry.init()", clientStart);
  const registryReady = source.indexOf("await layerRegistryPromise", registryInit);
  const acceptedConfig = source.indexOf("effectiveProjectionConfig = structuredClone(acceptedConfig)", registryReady);
  const mapCreate = source.indexOf('createProjectionMap("projectionMap"', acceptedConfig);
  const runtimeStart = source.indexOf("await projectionRuntime.start()", mapCreate);
  expect(init).toBeGreaterThanOrEqual(0);
  expect(clientStart).toBeGreaterThan(init);
  expect(registryInit).toBeGreaterThan(clientStart);
  expect(registryReady).toBeGreaterThan(registryInit);
  expect(acceptedConfig).toBeGreaterThan(registryReady);
  expect(source).toContain("waitForProjectionConfigStartup(projectionConfigClient, { signal: projectionLifecycle.signal })");
  expect(mapCreate).toBeGreaterThan(acceptedConfig);
  expect(runtimeStart).toBeGreaterThan(mapCreate);
  expect(source.match(/createProjectionConfigClient\(/g)).toHaveLength(1);
});

test("font readiness is awaited for names placement, after calibrated preview geometry", () => {
  const preview = source.slice(source.indexOf("const rebuildPreviewNames"), source.indexOf("const startPreviewNames"));
  expect(preview.indexOf("await projectionFontReady")).toBeGreaterThanOrEqual(0);
  expect(preview.indexOf("await projectionFontReady")).toBeLessThan(preview.indexOf("prepareProjectionNameWall"));
  const geometry = source.slice(source.indexOf("applyPreviewProjectionConfig = async"), source.indexOf("if (previewMode) registerDisposer(installProjectionPreviewBridge"));
  expect(geometry.indexOf("drawAfterMapRender(map, () => browserSurface.draw()")).toBeGreaterThanOrEqual(0);
  expect(geometry.indexOf("if (!drawn) throw new Error('Projection preview draw failed')")).toBeGreaterThanOrEqual(0);
  expect(geometry.indexOf("browserStartupGate?.ready()")).toBeGreaterThanOrEqual(0);
  const namesStart = source.slice(source.indexOf("const startPreviewNames"), source.indexOf("applyPreviewProjectionConfig = async"));
  expect(namesStart).toContain("settleProjectionPreviewTaskOnAbort(rebuildPreviewNames(config, localSignal, generation), localSignal)");
  expect(namesStart).toContain("cancelPreviewNames()");
  expect(geometry).toContain("await cancelPreviewNames()");
});

test("browser startup opts out of the legacy name worker before its canvas adapter is installed", () => {
  expect(source).toContain('manualProjectionPreparation: browserMode');
  const controller = source.indexOf('const nameFieldController = createNliNameFieldController');
  const adapter = source.indexOf('nameFieldController.installProjectionCanvas(browserSurface.getNameAdapter())', controller);
  expect(controller).toBeGreaterThanOrEqual(0);
  expect(adapter).toBeGreaterThan(controller);
});

test("projection names use the accepted people release identity independently of selected person", () => {
  const identityInit = source.slice(source.indexOf("const peopleRuntimePromise = loadPeopleRuntime();"), source.indexOf("const raiseProjectionHighlightAndGlow"));
  expect(identityInit).toContain("void readProjectionCandidateInputs().then(({ datasetVersion })");
  expect(identityInit).toContain("acceptedDatasetVersion = datasetVersion");
  expect(identityInit).toContain("projectionRuntime?.datasetChanged?.()");
  expect(source).toContain("getDatasetVersion: () => acceptedDatasetVersion");
  const runtime = source.slice(source.indexOf("projectionRuntime = createProjectionConfigRuntime"), source.indexOf("await projectionRuntime.start()"));
  expect(runtime).not.toContain("getPersonSelection?.()?.datasetVersion");
  expect(runtime).toContain("getDatasetIdentityError: () => acceptedDatasetIdentityError");
  expect(source.match(/datasetVersion: acceptedDatasetVersion \|\| undefined/g)).toHaveLength(3);
});
