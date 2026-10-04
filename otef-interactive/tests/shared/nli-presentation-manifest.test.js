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
        pdfSha256: "adaba7ccf6b094789c7bdad252c91f6dd4660780a1b3b07592f3d2f89be2a842",
        pptxSha256: "9582cf0321c8d658dbe6c649ad59a24dc1f8caa40fab5d98fec4b752c7b5471e",
        slidePathPattern: "local/presentations/nli/slides/slide-{slide}.png",
      },
      videos: [
        { slide: 2, path: "local/presentations/nli/videos/slide-02.mp4", rect: [0.159896, 0.288272, 0.67934, 0.682716] },
        { slide: 10, path: "local/presentations/nli/videos/slide-10.mp4", rect: [0.1625, 0.283642, 0.674132, 0.682716] },
        { slide: 18, path: "local/presentations/nli/videos/slide-18.mp4", rect: [0.128646, 0.285185, 0.719271, 0.682716] },
        { slide: 21, path: "local/presentations/nli/videos/slide-21.mp4", rect: [0.148611, 0.269278, 0.702244, 0.700285] },
        { slide: 23, path: "local/presentations/nli/videos/slide-23.mp4", rect: [0.155556, 0.282099, 0.688889, 0.682716] },
        { slide: 24, path: "local/presentations/nli/videos/slide-24.mp4", rect: [0.1625, 0.283642, 0.675, 0.682716] },
      ],
      segments: [
        { id: "segev", requiredNarrative: "segev", range: [1, 8] },
        { id: "nova_mor", requiredNarrative: "nova", range: [9, 11] },
        { id: "nova_memorial", requiredNarrative: "nova", range: [12, 16] },
        { id: "sderot", requiredNarrative: "sderot", range: [17, 21] },
        { id: "shura", requiredNarrative: null, range: [22, 28] },
        { id: "hostages", requiredNarrative: "hostages", range: [29, 33] },
        { id: "credits", requiredNarrative: null, range: [34, 34] },
        { id: "names_wall", requiredNarrative: null, kind: "blackout", range: [0, 0] },
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

  it("defaults a blackout segment range to [0, 0] and keeps kind", () => {
    const value = structuredClone(approvedManifest);
    value.segments = value.segments.filter((segment) => segment.id !== "names_wall");
    value.segments.push({ id: "names_wall", requiredNarrative: null, kind: "blackout" });
    const manifest = validateNliPresentationManifest(value);
    expect(getNliPresentationSegment(manifest, "names_wall")).toEqual({
      id: "names_wall",
      requiredNarrative: null,
      kind: "blackout",
      range: [0, 0],
    });
    expect(manifest.segments).toHaveLength(8);
  });

  it("loads and validates JSON fetched from the shared manifest URL", async () => {
    const requests = [];
    const fetchImpl = async (...args) => {
      requests.push(args);
      return { ok: true, json: async () => approvedManifest };
    };
    await expect(loadNliPresentationManifest(fetchImpl)).resolves.toMatchObject({ version: 1 });
    expect(requests).toEqual([["/otef-interactive/public/presentation/nli-presentation-manifest.json", { cache: "no-store" }]]);
  });
});
