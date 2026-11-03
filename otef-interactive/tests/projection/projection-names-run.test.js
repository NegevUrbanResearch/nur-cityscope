import { expect, test } from "vitest";
import { DEFAULT_PROJECTION_CONFIG } from "../../frontend/src/shared/projection-config-schema.js";
import { projectionPlacementInputIdentity } from "../../frontend/src/projection/projection-names-run.js";

test("placement identity changes for geometry or names inputs and ignores unrelated settings", async () => {
  const base = structuredClone(DEFAULT_PROJECTION_CONFIG);
  const identity = await projectionPlacementInputIdentity(base);
  const geometry = structuredClone(base); geometry.pre.scale += 0.01;
  const names = structuredClone(base); names.namesWall.rotateDeg += 1;
  expect(identity).toMatch(/^[a-f0-9]{64}$/);
  expect(await projectionPlacementInputIdentity(geometry)).not.toBe(identity);
  expect(await projectionPlacementInputIdentity(names)).not.toBe(identity);
});
