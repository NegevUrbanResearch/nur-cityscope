import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test, vi } from "vitest";
import { applySettlementOrientationPaint } from "../../frontend/src/shared/nli-settlement-orientation.js";
import { NLI_PLAYABLE_IDS } from "../../frontend/src/shared/nli-investigation-beats.js";
import { isNliPlayableLayerLocked } from "../../frontend/src/remote/nli-timeline-transport.js";
import { nliExplainerShouldPaintOnSpan } from "../../frontend/src/projection/nli-explainer-overlay.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const readSource = (relativePath) => fs.readFileSync(path.resolve(here, relativePath), "utf8");
const FLEEING_STEMS = ["fleeing_route", "fleeing_route_overlapp"];
const extractObjectLiteral = (source, name) => {
  const match = source.match(new RegExp(`${name}\\s*=\\s*\\{`));
  if (!match) return "";
  let depth = 0;
  for (let index = match.index + match[0].length - 1; index < source.length; index += 1) {
    const char = source[index];
    if (char === "{") depth += 1;
    else if (char === "}") {
      depth -= 1;
      if (depth === 0) return source.slice(match.index, index + 1);
    }
  }
  return "";
};

describe("NLI Nova overlay remount contract", () => {
  test("coordinator fetches the exhibit processed prefix", () => {
    const src = readSource("../../frontend/src/shared/nli-nova-escape-coordinator.js");
    expect(src).toMatch(/\/otef-interactive\/public\/processed\/layers\/nli\/fleeing_route\.geojson/);
    expect(src).toMatch(/\/otef-interactive\/public\/processed\/layers\/nli\/fleeing_route_overlapp\.geojson/);
    expect(src).not.toMatch(/["']\/processed\/layers\/nli\/fleeing_route/);
  });

  test("GIS overlay remount is on the narrative onStyleLoad bus, not a raw style.load", () => {
    const coordinator = readSource("../../frontend/src/shared/nli-nova-escape-coordinator.js");
    const gis = readSource("../../frontend/src/map/nli-narrative-controller.js");
    const lifecycle = readSource("../../frontend/src/entries/map-main-style-lifecycle.js");
    const projection = readSource("../../frontend/src/projection/projection-narrative-controller.js");
    const mapEntry = readSource("../../frontend/src/entries/map-main.js");
    const projectionEntry = readSource("../../frontend/src/entries/projection-main.js");
    expect(coordinator).not.toMatch(/["']style\.load["']/);
    expect(gis).toMatch(/onStyleLoad\s*\([^)]*\)\s*\{[\s\S]*onStyleLoadOverlay\?\.\(\)/);
    expect(projection).toMatch(/onStyleLoad\s*\([^)]*\)\s*\{[\s\S]*onStyleLoadOverlay\?\.\(\)/);
    expect(lifecycle).toMatch(/await refreshLayers[\s\S]*narrativeController\?\.onStyleLoad/);
    expect(mapEntry).toMatch(/createNovaEscapeCoordinator/);
    expect(mapEntry).toMatch(/onStyleLoadOverlay:\s*\(\)\s*=>/);
    expect(projectionEntry).toMatch(/createNovaEscapeCoordinator/);
    expect(projectionEntry).toMatch(/onStyleLoadOverlay:\s*\(\)\s*=>/);
  });

  test("projection narrative controller source never names camera movers", () => {
    const src = readSource("../../frontend/src/projection/projection-narrative-controller.js");
    const coordinator = readSource("../../frontend/src/shared/nli-nova-escape-coordinator.js");
    expect(src).not.toMatch(/\bflyTo\b|\bfitBounds\b|\bjumpTo\b|\beaseTo\b|\bsetZoom\b|\bsetCenter\b|\bsetPitch\b|\bsetBearing\b/);
    expect(coordinator).not.toMatch(/\bflyTo\b|\bfitBounds\b|\bjumpTo\b|\beaseTo\b|\bsetZoom\b|\bsetCenter\b|\bsetPitch\b|\bsetBearing\b/);
  });

  test("coordinator source never imports route-progress overlay", () => {
    const src = readSource("../../frontend/src/shared/nli-nova-escape-coordinator.js");
    const shader = readSource("../../frontend/src/shared/maplibre-acrossline-ribbon.js");
    expect(src).not.toMatch(/maplibre-route-progress-overlay|line-gradient|line-progress/);
    expect(shader).not.toMatch(/maplibre-route-progress-overlay|line-gradient|line-progress/);
  });

  test("coordinator file must not import pid/archive", () => {
    const src = readSource("../../frontend/src/shared/nli-nova-escape-coordinator.js");
    expect(src).not.toMatch(/from\s+["'][^"']*(?:pid|archive|person-selection)[^"']*["']/i);
    expect(src).not.toMatch(/\b(?:MILA_PID|PID|PERSON_ID|personId|victimId|archiveId)\b/);
  });

  test("Nova idle narrative dims every yeshuv including Reim", () => {
    const target = { setPaintProperty: vi.fn() };
    const layers = [
      { id: "settlements-fill", property: "fill-opacity", role: "geom" },
      { id: "settlements-line", property: "line-opacity", role: "geom" },
      { id: "settlements-label", property: "text-opacity", role: "label" },
      { id: "Locations_Lines", property: "line-opacity", role: "location-line" },
    ];
    applySettlementOrientationPaint(target, {
      phase: "idle",
      mode: "narrative",
      layers,
    });
    expect(target.setPaintProperty).toHaveBeenCalledWith("settlements-fill", "fill-opacity", 0.28);
    expect(target.setPaintProperty).toHaveBeenCalledWith("settlements-label", "text-opacity", 0.35);
    expect(target.setPaintProperty).toHaveBeenCalledWith("Locations_Lines", "line-opacity", 0.35);
    expect(JSON.stringify(
      target.setPaintProperty.mock.calls.find(([id]) => id === "settlements-fill")?.[2],
    )).not.toMatch(/18/);
  });

  test("Nova contract lights yeshuv 43 and never clones battle polygon 100 as a white site outline", () => {
    const coordinator = readSource("../../frontend/src/shared/nli-nova-escape-coordinator.js");
    const polygons = readSource("../../frontend/src/shared/maplibre-investigation-polygons.js");
    const narratives = readSource("../../frontend/src/shared/nli-narratives.js");
    const mapEntry = readSource("../../frontend/src/entries/map-main.js");
    const projectionEntry = readSource("../../frontend/src/entries/projection-main.js");
    expect(narratives).toMatch(/focusSettlementOutlineId:\s*43/);
    expect(coordinator).not.toMatch(/nli-nova-site-outline/);
    expect(polygons).not.toMatch(/nli-nova-site-outline/);
    expect(polygons).not.toMatch(/nli-investigation-polygon-category-line-battle-nova-site/);
    expect(mapEntry).toMatch(/surface:\s*"gis"/);
    expect(projectionEntry).toMatch(/surface:\s*"projection"/);
    expect(coordinator).toMatch(/surface === "projection"|surface === 'projection'|ribbonsAllowed/);
  });

  test("GIS map-main overlay remount still uses the narrative onStyleLoad bus", () => {
    const mapEntry = readSource("../../frontend/src/entries/map-main.js");
    expect(mapEntry).toMatch(
      /onStyleLoadOverlay:\s*\(\)\s*=>\s*\{\s*novaEscapeCoordinator\?\.onStyleLoad\?\.\(\{\s*styleLoss:\s*true\s*\}\)/,
    );
  });

  test("projection-main wires onParallelImpactIdsChanged; GIS map-main does not", () => {
    const mapEntry = readSource("../../frontend/src/entries/map-main.js");
    const projectionEntry = readSource("../../frontend/src/entries/projection-main.js");
    expect(projectionEntry).toMatch(/onParallelImpactIdsChanged/);
    expect(mapEntry).not.toMatch(/onParallelImpactIdsChanged/);
  });

  test("coordinator consumes the precomputed Nova escape index", () => {
    const coordinatorSource = readSource("../../frontend/src/shared/nli-nova-escape-coordinator.js");
    expect(coordinatorSource).not.toMatch(/buildFleeingCrossingIndex/);
    expect(coordinatorSource).toMatch(/crossingIndex:\s*index\.crossingIndex/);
    expect(coordinatorSource).toMatch(/contacts:\s*index\.settlementContacts/);
  });

  test("GIS and projection keep clock-only captions and right-span suppression", () => {
    const mapEntry = readSource("../../frontend/src/entries/map-main.js");
    const projectionEntry = readSource("../../frontend/src/entries/projection-main.js");
    expect(mapEntry).toMatch(/nliCaptionMode:\s*"clock-only"/);
    expect(projectionEntry).toMatch(/nliCaptionMode:\s*"clock-only"/);
    expect(nliExplainerShouldPaintOnSpan("right")).toBe(false);
  });

  test("projection consumes committed slideshow groups and the shared presentation poll", () => {
    const projectionEntry = readSource("../../frontend/src/entries/projection-main.js");
    expect(projectionEntry).toMatch(/syncSlideshowPresentationPoll/);
    expect(projectionEntry).toMatch(/getCommittedGroups\(\)/);
    expect(projectionEntry).toMatch(
      /incomingGroups:\s*[\s\S]*?getCommittedGroups\(\)/,
    );
    expect(projectionEntry).toMatch(
      /syncSlideshowPresentationPoll\(slideshowRuntime,[\s\S]*?start:\s*startPresentationPoll,[\s\S]*?clear:\s*clearPresentationPoll/,
    );
  });

  test("Nova retains the approved idle and play-start clock", () => {
    const narratives = readSource("../../frontend/src/shared/nli-narratives.js");
    const nova = narratives.slice(narratives.indexOf('id: "nova"'));
    expect(nova).toMatch(/idleClockMinutes:\s*483/);
    expect(nova).toMatch(/playStartMinutes:\s*483/);
  });

  test("fleeing stems stay out of glossary, popup, playable lock, and six pack tiles", () => {
    const glossary = readSource("../../frontend/src/shared/layer-display-glossary.js");
    const playable = readSource("../../frontend/src/shared/nli-investigation-beats.js");
    const lock = readSource("../../frontend/src/remote/nli-timeline-transport.js");
    const prep = readSource("../../scripts/nli_pack_prep.py");
    const popup = extractObjectLiteral(prep, "NLI_POPUP_CONFIG");
    const zipMap = extractObjectLiteral(prep, "ZIP_LAYER_MAP");
    const nliGlossaryKeys = [...glossary.matchAll(/"(nli\.[^"]+)"/g)].map((match) => match[1]);
    for (const stem of FLEEING_STEMS) {
      expect(glossary).not.toMatch(new RegExp(stem));
      expect(playable).not.toMatch(new RegExp(stem));
      expect(lock).not.toMatch(new RegExp(stem));
      expect(popup).not.toMatch(new RegExp(stem));
      expect(zipMap).not.toMatch(new RegExp(stem));
      expect(nliGlossaryKeys.join("\n")).not.toMatch(new RegExp(stem));
    }
    expect(NLI_PLAYABLE_IDS.join("\n")).not.toMatch(/fleeing_route/);
    expect(isNliPlayableLayerLocked(
      { phase: "playing" },
      ["nli.fleeing_route", "nli.fleeing_route_overlapp"],
    )).toBe(false);
  });
});
