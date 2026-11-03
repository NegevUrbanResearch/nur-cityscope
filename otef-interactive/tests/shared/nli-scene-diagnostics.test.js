import { afterEach, expect, test, vi } from "vitest";
import { reportNliSceneFailure } from "../../frontend/src/shared/nli-scene-diagnostics.js";

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

test("failure history survives reporter reuse, is bounded, and separates projector outputs", () => {
  const entries = new Map();
  vi.stubGlobal("window", { localStorage: {
    getItem: key => entries.get(key) ?? null,
    setItem: (key, value) => entries.set(key, value),
  } });
  vi.spyOn(console, "warn").mockImplementation(() => {});
  for (let index = 0; index < 23; index++) {
    reportNliSceneFailure({ displayProfile: "projection", output: "left", displaySide: "right", phase: "entry", reason: `failure-${index}` });
  }
  reportNliSceneFailure({ displayProfile: "projection", output: "right", displaySide: "left", phase: "preparation", reason: "candidate unavailable" });
  const left = JSON.parse(entries.get("otef.nli.sceneFailures.projection.left") ?? "[]");
  expect(left).toHaveLength(20);
  expect(left[0].reason).toBe("failure-3");
  expect(left.at(-1)).toMatchObject({ displaySide: "right", phase: "entry", reason: "failure-22" });
  expect(left.at(-1).timestamp).toEqual(expect.any(String));
  const right = JSON.parse(entries.get("otef.nli.sceneFailures.projection.right"));
  expect(right).toHaveLength(1);
  expect(right[0].reason).toBe("candidate unavailable");
});

test.each(["corrupt", "unavailable"])("failure reporting cannot break recovery when storage is %s", mode => {
  vi.stubGlobal("window", { localStorage: {
    getItem: () => { if (mode === "unavailable") throw new Error("Storage denied"); return "broken JSON"; },
    setItem: () => { if (mode === "unavailable") throw new Error("Storage full"); },
  } });
  const warnings = [];
  vi.spyOn(console, "warn").mockImplementation((...args) => warnings.push(args));
  expect(() => reportNliSceneFailure({ phase: "entry", reason: "readiness-timeout" })).not.toThrow();
  expect(warnings).toHaveLength(1);
  expect(warnings.at(-1)[1]).toMatchObject({ phase: "entry", reason: "readiness-timeout" });
});
