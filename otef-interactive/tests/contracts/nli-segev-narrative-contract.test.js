import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";
import {
  getNliNarrative,
  NLI_NARRATIVE_EXIT_SCENE,
} from "../../frontend/src/shared/nli-narratives.js";
import { GIS_BASEMAP_IDS } from "../../frontend/src/shared/gis-basemap.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const frontendRoot = path.resolve(here, "../../frontend/src");
const readSource = (relativePath) => fs.readFileSync(path.resolve(here, relativePath), "utf8");
const stripComments = (source) => source
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .replace(/^\s*\/\/.*$/gm, "");
const importDeclarations = (source) => [...stripComments(source).matchAll(
  /^\s*import(?:[\s\S]*?\sfrom\s*)?["']([^"']+)["'];?\s*$/gm,
)].map((match) => match[1]);
const importStatements = (source) => [...stripComments(source).matchAll(
  /^\s*import[\s\S]*?;\s*$/gm,
)].map((match) => match[0]);
const forbiddenNarrativeSpecifier = /(?:^|[\/-])(person(?:-|_|$)|pid(?:-|_|$)|mila(?:-|_|$)|victim(?:-|_|$)|archive(?:-|_|$))/i;
const forbiddenNarrativeBinding = /\b(?:MILA_PID|PID|PERSON_ID|personId|victimId|archiveId)\b/;
const forbiddenNarrativeAssignment = /\b(?:MILA_PID|PID|personId|victimId|archiveId)\s*[:=]/;

function assertNarrativeModuleIsDependencyFree(name, source) {
  const imports = importDeclarations(source);
  const statements = importStatements(source);
  const code = stripComments(source);
  expect(imports, `${name} import specifiers`).not.toEqual(
    expect.arrayContaining([expect.stringMatching(forbiddenNarrativeSpecifier)]),
  );
  expect(statements, `${name} imported bindings`).not.toEqual(
    expect.arrayContaining([expect.stringMatching(forbiddenNarrativeBinding)]),
  );
  expect(code, `${name} scoped numeric literals`).not.toMatch(/\b60\b/);
  expect(code, `${name} person/PID/archive assignments`).not.toMatch(forbiddenNarrativeAssignment);
}

function collectImportGraph(entryRelativePath) {
  const visited = new Map();
  const visit = (absolutePath) => {
    if (visited.has(absolutePath)) return;
    const source = fs.readFileSync(absolutePath, "utf8");
    visited.set(absolutePath, source);
    for (const specifier of importDeclarations(source)) {
      if (!specifier.startsWith(".")) continue;
      const resolved = path.resolve(path.dirname(absolutePath), specifier);
      const filePath = fs.existsSync(resolved) ? resolved : `${resolved}.js`;
      if (fs.existsSync(filePath)) visit(filePath);
    }
  };
  visit(path.resolve(frontendRoot, entryRelativePath));
  return visited;
}

const mapEntry = readSource("../../frontend/src/entries/map-main.js");
const projectionEntry = readSource("../../frontend/src/entries/projection-main.js");
const registry = readSource("../../frontend/src/shared/nli-narratives.js");
const gisNarrativeController = readSource("../../frontend/src/map/nli-narrative-controller.js");
const projectionNarrativeController = readSource("../../frontend/src/projection/projection-narrative-controller.js");
const focusRenderer = readSource("../../frontend/src/shared/maplibre-narrative-focus.js");
const presentation = readSource("../../frontend/src/map/nli-narrative-presentation.js");
const layerSheet = readSource("../../frontend/src/remote/layer-sheet-controller.js");
const narrativeControls = readSource("../../frontend/src/remote/nli-narrative-controls.js");
const projectionImportGraph = collectImportGraph("entries/projection-main.js");
const narrativeModules = {
  registry,
  gisNarrativeController,
  projectionNarrativeController,
  focusRenderer,
  presentation,
  narrativeControls,
};

describe("NLI Segev narrative cross-surface contract", () => {
  test("uses the approved house scene, exact Canva embed, and dark configured exit", () => {
    const segev = getNliNarrative("segev");

    expect(segev).toMatchObject({
      id: "segev",
      label: "משפחת שגב",
      center: [34.48647925700004, 31.422958191000077],
      zoom: 18,
      basemap: "satellite_bw",
      focusSettlement: "בארי",
      focusSettlementOutlineId: 19,
      presentationUrl: "https://www.canva.com/design/DAHUaRcI6lI/Of1TuYlj0yaPV-r3UDQOKw/view?embed",
    });
    expect(GIS_BASEMAP_IDS).toContain("satellite_bw");
    expect(NLI_NARRATIVE_EXIT_SCENE).toMatchObject({
      center: "configured OTEF bounds center",
      zoom: 10,
      basemap: "dark",
    });
    expect(stripComments(gisNarrativeController)).toMatch(/flyTo\?\.\(\{ center: definition\.center, zoom: definition\.zoom/);
    expect(stripComments(gisNarrativeController)).toMatch(/flyTo\?\.\(\{ center: exitCenter\(\), zoom: 10/);
    expect(stripComments(gisNarrativeController)).not.toMatch(/zoom:\s*19\b/);
  });

  test("renders the same Hebrew focus label from both live controllers without person/PID/archive dependencies", () => {
    expect(focusRenderer).toContain("properties: { label }");
    expect(stripComments(gisNarrativeController)).toMatch(/focus\.show\(definition\)/);
    expect(stripComments(projectionNarrativeController)).toMatch(/focus\.show\(definition\)/);
    expect(stripComments(gisNarrativeController)).toContain('profile: "gis"');
    expect(stripComments(projectionNarrativeController)).toContain('profile: "projection"');
    for (const [name, source] of Object.entries(narrativeModules)) {
      assertNarrativeModuleIsDependencyFree(name, source);
    }
  });

  test("rejects PID, person, and archive import mutations in the narrative-only module boundary", () => {
    expect(() => assertNarrativeModuleIsDependencyFree("pid mutation", "const MILA_PID = 60;"))
      .toThrow();
    expect(() => assertNarrativeModuleIsDependencyFree("person mutation", "const personId = 60;"))
      .toThrow();
    expect(() => assertNarrativeModuleIsDependencyFree(
      "archive import mutation",
      'import { createArchiveController as presentation } from "../remote/remote-people-archive-controller.js";',
    )).toThrow();
  });

  test("keeps the trusted Canva iframe and its command wiring GIS-only", () => {
    const mapImports = importDeclarations(mapEntry);
    expect(mapImports).toContain("../map/nli-narrative-presentation.js");
    expect(stripComments(mapEntry)).toMatch(/createNarrativePresentation\(mapContainer/);
    expect(stripComments(mapEntry)).toMatch(/subscribe\("narrativePresentation",\s*\(command\)\s*=>\s*\{/);
    expect(stripComments(mapEntry)).toMatch(/handleNarrativePresentationCommand\(\{/);
    expect([...projectionImportGraph.entries()].some(([filePath]) =>
      filePath.endsWith(`${path.sep}nli-narrative-presentation.js`),
    )).toBe(false);
    expect(narrativeControls).not.toContain("createElement");
    expect(stripComments(presentation)).toContain('document?.createElement?.("iframe")');
    expect(stripComments(presentation)).toContain('iframe.setAttribute?.("referrerpolicy", "no-referrer")');
    expect(stripComments(presentation)).toContain('if (event?.key !== "Escape" || !overlay) return;');
  });

  test("subscribes both surfaces to durable state while keeping NLI-sheet commands remote-owned", () => {
    const cleanMapEntry = stripComments(mapEntry);
    const cleanProjectionEntry = stripComments(projectionEntry);
    expect(cleanMapEntry).toMatch(/subscribe\("narrativeState",\s*\(state\)\s*=>\s*narrativeController\?\.apply\(state\)\)/);
    expect(cleanMapEntry).toContain("narrativeController.apply(OTEFDataContext.getNarrativeState?.())");
    expect(cleanProjectionEntry).toMatch(/subscribe\("narrativeState",\s*\(state\)\s*=>\s*\{[\s\S]{0,200}?projectionNarrativeController\?\.apply\(state\);/);
    expect(cleanProjectionEntry).toContain("projectionNarrativeController.apply(OTEFDataContext.getNarrativeState())");
    expect(layerSheet).toContain("nliNarrativeControlsHtml(");
    expect(layerSheet).toContain("consumeNliNarrativeButtonClick(e, this)");
    expect(layerSheet).toContain("runNarrativePresentation(action, id)");
    expect(narrativeControls).toContain("host?.runNarrativePresentation?.(action, id)");
    expect(cleanMapEntry).not.toMatch(/\b(runNarrativePresentation)\s*\(/);
    expect(cleanProjectionEntry).not.toMatch(/\b(runNarrativePresentation)\s*\(/);
  });

  test("investigation clock updates do not apply narrative camera scenes", () => {
    const cleanMapEntry = stripComments(mapEntry);
    expect(cleanMapEntry).toMatch(/subscribe\("investigationClock",\s*syncContextInvestigation\)/);
    expect(cleanMapEntry).not.toMatch(/subscribe\("investigationClock"[\s\S]{0,200}narrativeController\?\.apply/);
    expect(stripComments(gisNarrativeController)).not.toMatch(/subscribe\(["']investigationClock["']/);
  });
});
