import { expect, it } from "vitest";
import { LayerRegistry } from "../../frontend/src/shared/layer-registry.js";

const PREFIX = "/otef-interactive/public/processed/layers";
const NLI_MANIFEST = `${PREFIX}/nli/manifest.json`;
const shelterResource = {
  file: "shelters_232.geojson",
  format: "geojson",
  schemaVersion: 1,
  sha256: "a".repeat(64),
  shelterVersion: "current-shelters",
};

function cacheScenario() {
  const requests = [];
  // The old pack manifest remains fresh in the browser cache after publication.
  // Revalidation gets the current declaration from the server instead.
  const fetchImpl = async (url, options) => {
    requests.push([url, options]);
    let body;
    if (url === `${PREFIX}/layers-manifest.json`) body = { packs: ["nli", "projector_base"] };
    else if (url === NLI_MANIFEST) body = {
      id: "nli",
      layers: [{
        id: "ציר_232", geometryType: "line", file: "ציר_232.geojson",
        ...(options?.cache === "no-cache" ? { resources: { shelters232: shelterResource } } : {}),
      }],
    };
    else if (url === `${PREFIX}/projector_base/manifest.json`) body = {
      id: "projector_base", layers: [{ id: "roads", geometryType: "line" }],
    };
    else if (url.endsWith("/styles.json")) body = {};
    else throw new Error(`Unexpected registry URL: ${url}`);
    return { ok: true, json: async () => body };
  };
  return { registry: new LayerRegistry({ fetchImpl }), requests };
}

it("revalidates the NLI startup manifest so a cached old pack cannot hide declared shelters", async () => {
  const { registry } = cacheScenario();
  await registry.init();
  expect(registry.getLayerConfig("nli.ציר_232").resources?.shelters232).toEqual(shelterResource);
});

it("leaves other registry requests cacheable and fetches NLI only once per startup", async () => {
  const { registry, requests } = cacheScenario();
  await Promise.all([registry.init(), registry.init()]);
  await registry.init();
  expect(requests.filter(([url]) => url === NLI_MANIFEST)).toHaveLength(1);
  expect(requests.filter(([url]) => url !== NLI_MANIFEST).every(([, options]) => options === undefined)).toBe(true);
  expect(registry.getLayerConfig("projector_base.roads").geometryType).toBe("line");
});
