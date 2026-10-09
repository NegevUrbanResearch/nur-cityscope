import { it, expect, vi } from "vitest";
import { createHash, webcrypto } from "node:crypto";
import fixture from "../../scripts/fixtures/nli-shelters-232.json";
import { createShelterDataLoader } from "../../frontend/src/shared/nli-shelter-data.js";
const doc = (v = "a") => ({
  type: "FeatureCollection",
  schemaVersion: 1,
  shelterVersion: v,
  features: fixture.shelters.map((s) => ({
    id: s.id,
    geometry: { type: "Point", coordinates: s.coordinates },
    properties: { personPids: s.personPids },
  })),
});
const bytes = (d) => new TextEncoder().encode(JSON.stringify(d));
const resource = (d, file = "shelters_232.geojson") => ({
  file,
  schemaVersion: 1,
  shelterVersion: d.shelterVersion,
  sha256: createHash("sha256").update(bytes(d)).digest("hex"),
});
const deps = (r) => ({
  dataVersion: "same-people",
  getLayerConfig: () => ({ resources: r ? { shelters232: r } : {} }),
  crypto: webcrypto,
});

it("verifies fetched bytes and never accepts malformed/hash/version mismatched sidecars", async () => {
  const a = doc();
  const loader = createShelterDataLoader();
  const d = { ...deps(resource(a)), fetchShelterBytes: async () => bytes(a) };
  loader.configure(d, true);
  expect((await loader.load(d)).features).toHaveLength(9);
  for (const bad of [
    { ...a, schemaVersion: 2 },
    { ...a, shelterVersion: "wrong" },
    { ...a, features: [...a.features.slice(1), a.features[1]] },
    {
      ...a,
      features: a.features.map((f, i) =>
        i ? f : { ...f, geometry: { type: "Point", coordinates: [null, 31] } },
      ),
    },
  ]) {
    const r = resource(bad);
    r.shelterVersion = "a";
    r.schemaVersion = 1;
    const b = { ...deps(r), fetchShelterBytes: async () => bytes(bad) };
    loader.configure(b, true);
    await loader.load(b);
    expect(loader.features).toEqual([]);
  }
  const wrong = { ...d, fetchShelterBytes: async () => bytes(doc("other")) };
  loader.configure(wrong, false);
  loader.configure(wrong, true);
  await loader.load(wrong);
  expect(loader.features).toEqual([]);
});
it("rejects old A resolving after B while people version is unchanged", async () => {
  const loader = createShelterDataLoader(),
    a = doc(),
    b = doc("b");
  let resolveA;
  const da = {
    ...deps(resource(a)),
    fetchShelterBytes: () => new Promise((resolve) => (resolveA = resolve)),
  };
  loader.configure(da, true);
  const old = loader.load(da);
  const db = { ...deps(resource(b)), fetchShelterBytes: async () => bytes(b) };
  loader.configure(db, true);
  await loader.load(db);
  resolveA(bytes(a));
  await old;
  expect(loader.version).toBe("b");
  expect(loader.features).toHaveLength(9);
});
it("does not fetch an undeclared orphan and cannot adopt an off/on stale request", async () => {
  const loader = createShelterDataLoader(),
    fetchShelterBytes = vi.fn();
  const absent = { ...deps(null), fetchShelterBytes };
  loader.configure(absent, true);
  await loader.load(absent);
  expect(fetchShelterBytes).not.toHaveBeenCalled();
  expect(loader.features).toEqual([]);
  let resolveA;
  const a = doc(),
    d = {
      ...deps(resource(a)),
      fetchShelterBytes: () => new Promise((resolve) => (resolveA = resolve)),
    };
  loader.configure(d, true);
  const old = loader.load(d);
  loader.configure(d, false);
  loader.configure(d, true);
  resolveA(bytes(a));
  await old;
  expect(loader.features).toEqual([]);
});
it("shares an immutable pending byte request but only a current caller adopts it", async () => {
  const loader = createShelterDataLoader(),
    a = doc();
  let done,
    current = 1;
  const fetchShelterBytes = vi.fn(
      () => new Promise((resolve) => (done = resolve)),
    ),
    d = { ...deps(resource(a)), fetchShelterBytes };
  loader.configure(d, true);
  const first = loader.load(d, () => current === 1);
  current = 2;
  const second = loader.load(d, () => current === 2);
  done(bytes(a));
  await Promise.all([first, second]);
  expect(loader.features).toHaveLength(9);
  expect(fetchShelterBytes).toHaveBeenCalledTimes(1);
});
