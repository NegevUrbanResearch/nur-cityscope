import { describe, expect, it } from "vitest";
import approvedManifest from "../../public/presentation/nli-presentation-manifest.json" with { type: "json" };
import {
  getNliPresentationSegment,
  loadNliPresentationManifest,
  validateNliPresentationManifest,
} from "../../frontend/src/shared/nli-presentation-manifest.js";

describe("NLI presentation manifest", () => {
  it("validates the approved local manifest and exposes exact segment lookup", () => {
    const manifest = validateNliPresentationManifest(approvedManifest);

    expect(manifest).toEqual({
      version: 1,
      deck: {
        slideCount: 34,
        pdfSha256: "1ce060dd9bb53d155c95f70f95b86e9ae36d013d3b4535fbb27c5fa8e4054b8c",
        pptxSha256: "6ed3d98badcaf8d48dc17334a599783349e008dfd04ea1c59e4b420e33a86837",
        slidePathPattern: "local/presentations/nli/slides/slide-{slide}.png",
      },
      videos: [
        { slide: 2, path: "local/presentations/nli/videos/slide-02.mp4", rect: [0.159896, 0.288272, 0.67934, 0.682716] },
        { slide: 10, path: "local/presentations/nli/videos/slide-10.mp4", rect: [0.1625, 0.283642, 0.674132, 0.682716] },
        { slide: 18, path: "local/presentations/nli/videos/slide-18.mp4", rect: [0.128646, 0.285185, 0.719271, 0.682716] },
        { slide: 23, path: "local/presentations/nli/videos/slide-23.mp4", rect: [0.155556, 0.282099, 0.688889, 0.682716] },
        { slide: 24, path: "local/presentations/nli/videos/slide-24.mp4", rect: [0.1625, 0.283642, 0.675, 0.682716] },
      ],
      segments: [
        { id: "segev", requiredNarrative: "segev", range: [1, 8] },
        { id: "nova_mor", requiredNarrative: "nova", range: [9, 11] },
        { id: "nova_memorial", requiredNarrative: "nova", range: [12, 16] },
        { id: "sderot", requiredNarrative: "sderot", range: [17, 21] },
        { id: "shura", requiredNarrative: null, range: [22, 28] },
        { id: "hostages", requiredNarrative: "hostages", range: [29, 34] },
      ],
    });
    expect(Object.isFrozen(manifest)).toBe(true);
    expect(Object.isFrozen(manifest.segments[0].range)).toBe(true);
    expect(getNliPresentationSegment(manifest, "nova_mor")).toEqual(manifest.segments[1]);
    expect(getNliPresentationSegment(manifest, "missing")).toBeNull();
  });

  it.each([
    ["nonpositive slide count", (value) => { value.deck.slideCount = 0; }],
    ["absolute slide path", (value) => { value.deck.slidePathPattern = "/local/slides/{slide}.png"; }],
    ["absolute video path", (value) => { value.videos[0].path = "/video.mp4"; }],
    ["invalid video rectangle", (value) => { value.videos[0].rect = [1, 2, 3]; }],
    ["invalid segment ID", (value) => { value.segments[0].id = ""; }],
    ["invalid segment range", (value) => { value.segments[0].range = [1, "8"]; }],
  ])("rejects %s", (_label, mutate) => {
    const value = structuredClone(approvedManifest);
    mutate(value);
    expect(() => validateNliPresentationManifest(value)).toThrow();
  });

  it("loads and validates JSON fetched from the shared manifest URL", async () => {
    const fetchImpl = async () => ({ ok: true, json: async () => approvedManifest });
    await expect(loadNliPresentationManifest(fetchImpl)).resolves.toMatchObject({ version: 1 });
  });
});
