import { describe, expect, it } from "vitest";
import {
  getNliPresentationSegment,
  loadNliPresentationManifest,
  validateNliPresentationManifest,
} from "../../frontend/src/shared/nli-presentation-manifest.js";

const validManifest = () => ({
  version: 1,
  deck: {
    path: "processed/presentations/nli/nur-model.pptx",
    sha256: null,
    slideCount: 33,
  },
  segments: [
    { id: "segev", requiredNarrative: "segev", range: [1, 8] },
    { id: "nova_mor", requiredNarrative: "nova", range: [9, 11] },
    { id: "nova_memorial", requiredNarrative: "nova", range: [12, 16] },
    { id: "sderot", requiredNarrative: "sderot", range: [17, 20] },
    { id: "shura", requiredNarrative: null, range: [21, 27] },
    { id: "hostages", requiredNarrative: "hostages", range: [28, 33] },
  ],
});

describe("NLI presentation manifest", () => {
  it("validates the pre-release manifest and exposes exact segment lookup", () => {
    const manifest = validateNliPresentationManifest(validManifest());

    expect(manifest.segments).toEqual([
      { id: "segev", requiredNarrative: "segev", range: [1, 8] },
      { id: "nova_mor", requiredNarrative: "nova", range: [9, 11] },
      { id: "nova_memorial", requiredNarrative: "nova", range: [12, 16] },
      { id: "sderot", requiredNarrative: "sderot", range: [17, 20] },
      { id: "shura", requiredNarrative: null, range: [21, 27] },
      { id: "hostages", requiredNarrative: "hostages", range: [28, 33] },
    ]);
    expect(Object.isFrozen(manifest)).toBe(true);
    expect(Object.isFrozen(manifest.segments[0].range)).toBe(true);
    expect(getNliPresentationSegment(manifest, "nova_mor")).toEqual(manifest.segments[1]);
    expect(getNliPresentationSegment(manifest, "missing")).toBeNull();
  });

  it.each([
    ["duplicate segment IDs", (value) => { value.segments[1].id = "segev"; }],
    ["overlapping ranges", (value) => { value.segments[1].range = [8, 11]; }],
    ["out-of-bounds ranges", (value) => { value.segments[5].range = [28, 34]; }],
    ["non-relative deck path", (value) => { value.deck.path = "/processed/presentations/nli/nur-model.pptx"; }],
    ["a slide count other than 33", (value) => { value.deck.slideCount = 32; }],
    ["a non-hexadecimal deck hash", (value) => { value.deck.sha256 = "G".repeat(64); }],
  ])("rejects %s", (_label, mutate) => {
    const value = validManifest();
    mutate(value);
    expect(() => validateNliPresentationManifest(value)).toThrow();
  });

  it("loads and validates JSON fetched from the shared manifest URL", async () => {
    const fetchImpl = async () => ({ ok: true, json: async () => validManifest() });
    await expect(loadNliPresentationManifest(fetchImpl)).resolves.toMatchObject({ version: 1 });
  });
});
