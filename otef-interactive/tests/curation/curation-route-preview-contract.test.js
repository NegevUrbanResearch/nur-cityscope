import fs from "fs";
import path from "path";
import { describe, expect, test, vi } from "vitest";
import { computeDashedWithFallback } from "../../frontend/src/curation/curation-map-preview.js";

const CURATION_SRC_DIR = path.resolve(__dirname, "../../frontend/src/curation");

describe("curation route preview integration contract", () => {
  test("uses backend computeRoute output when valid response is returned", async () => {
    const computeRoute = vi.fn().mockResolvedValue({
      current_dashed: [[[31.41, 34.84]]],
      history_dashed: [[[31.42, 34.85]]],
    });
    const buildRoute = vi.fn(() => ({ dashed: [["local"]] }));

    const out = await computeDashedWithFallback({
      basePaths: [[[31.4, 34.8], [31.41, 34.81]]],
      currentUserPoints: [[31.42, 34.82]],
      historyUserPoints: [[31.43, 34.83]],
      computeRoute,
      buildRoute,
    });

    expect(computeRoute).toHaveBeenCalledTimes(1);
    expect(buildRoute).not.toHaveBeenCalled();
    expect(out).toEqual({
      currentDashed: [[[31.41, 34.84]]],
      historyDashed: [[[31.42, 34.85]]],
    });
  });

  test("falls back to local buildIntegratedRoute when backend computeRoute throws", async () => {
    const computeRoute = vi.fn().mockRejectedValue(new Error("proxy unavailable"));
    const buildRoute = vi
      .fn()
      .mockReturnValueOnce({ dashed: [["current-local"]] })
      .mockReturnValueOnce({ dashed: [["history-local"]] });

    const out = await computeDashedWithFallback({
      basePaths: [[[31.4, 34.8], [31.41, 34.81]]],
      currentUserPoints: [[31.42, 34.82]],
      historyUserPoints: [[31.43, 34.83]],
      computeRoute,
      buildRoute,
    });

    expect(computeRoute).toHaveBeenCalledTimes(1);
    expect(buildRoute).toHaveBeenCalledTimes(2);
    expect(out).toEqual({
      currentDashed: [["current-local"]],
      historyDashed: [["history-local"]],
    });
  });

  test("falls back to local buildIntegratedRoute when backend output is invalid", async () => {
    const computeRoute = vi.fn().mockResolvedValue({ current_dashed: {} });
    const buildRoute = vi
      .fn()
      .mockReturnValueOnce({ dashed: [["current-invalid-fallback"]] })
      .mockReturnValueOnce({ dashed: [["history-invalid-fallback"]] });

    const out = await computeDashedWithFallback({
      basePaths: [[[31.4, 34.8], [31.41, 34.81]]],
      currentUserPoints: [[31.42, 34.82]],
      historyUserPoints: [[31.43, 34.83]],
      computeRoute,
      buildRoute,
    });

    expect(computeRoute).toHaveBeenCalledTimes(1);
    expect(buildRoute).toHaveBeenCalledTimes(2);
    expect(out).toEqual({
      currentDashed: [["current-invalid-fallback"]],
      historyDashed: [["history-invalid-fallback"]],
    });
  });

  test("falls back to local buildIntegratedRoute when backend dashed structure is malformed", async () => {
    const computeRoute = vi.fn().mockResolvedValue({
      current_dashed: [[[31.41]]],
      history_dashed: [[[31.42, 34.85]]],
    });
    const buildRoute = vi
      .fn()
      .mockReturnValueOnce({ dashed: [["current-malformed-fallback"]] })
      .mockReturnValueOnce({ dashed: [["history-malformed-fallback"]] });

    const out = await computeDashedWithFallback({
      basePaths: [[[31.4, 34.8], [31.41, 34.81]]],
      currentUserPoints: [[31.42, 34.82]],
      historyUserPoints: [[31.43, 34.83]],
      computeRoute,
      buildRoute,
    });

    expect(computeRoute).toHaveBeenCalledTimes(1);
    expect(buildRoute).toHaveBeenCalledTimes(2);
    expect(out).toEqual({
      currentDashed: [["current-malformed-fallback"]],
      historyDashed: [["history-malformed-fallback"]],
    });
  });

  test("curation wiring injects API computeRoute into createCurationMapPreview", () => {
    const src = fs.readFileSync(path.join(CURATION_SRC_DIR, "curation.js"), "utf8");
    expect(src.includes("createCurationMapPreview({")).toBe(true);
    expect(src.includes("computeRoute: (payload) => API.computeRoute(payload)")).toBe(true);
  });

  test("map preview guards against stale sequence after async dashed compute", () => {
    const src = fs.readFileSync(path.join(CURATION_SRC_DIR, "curation-map-preview.js"), "utf8");
    const awaitIndex = src.indexOf(
      "const { currentDashed, historyDashed } = await computeDashedWithFallback({",
    );
    const staleGuardIndex = src.indexOf("if (mySeq !== showPreviewSeq) return;", awaitIndex);

    expect(awaitIndex).toBeGreaterThanOrEqual(0);
    expect(staleGuardIndex).toBeGreaterThan(awaitIndex);
  });
});
