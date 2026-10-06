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

    expect(manifest.deck).toMatchObject({
      slideCount: 37,
      pdfSha256: "cadc48656462a3d968a0ded6616dd5c380be6588399c68b9f3dbf637dc7b5114",
      pptxSha256: "edf994532d8e190ea45f5c7f5f7c26ebe27d2ef87cb574b65cb1ac1a0a31847c",
      slidePathPattern: "local/presentations/nli/slides/slide-{slide}.png",
    });
    expect(manifest.videos).toEqual([
      { slide: 2, path: "local/presentations/nli/normalized-audio/slide-02.mp4", rect: [0.159896, 0.288272, 0.67934, 0.682716] },
      { slide: 9, path: "local/presentations/nli/supplements/gelem-first-9s-fade.mp4", rect: [0.16, 0.285, 0.68, 0.68], fit: "contain", title: "תיעוד תלת־ממדי של בארי, 17 באוקטובר 2023", credit: "רשות העתיקות", photographer: "ברק ברינקר" },
      { slide: 11, path: "local/presentations/nli/normalized-audio/slide-10.mp4", rect: [0.1625, 0.286529, 0.674132, 0.682716] },
      { slide: 13, path: "local/presentations/nli/supplements/nova-first-12s-fade.mp4", rect: [0.16, 0.28, 0.68, 0.685], fit: "contain", title: "תיעוד תלת־ממדי של הנובה, 10 באוקטובר 2023", credit: "רשות העתיקות" },
      { slide: 20, path: "local/presentations/nli/normalized-audio/slide-18.mp4", rect: [0.128646, 0.285185, 0.719271, 0.682716] },
      { slide: 23, path: "local/presentations/nli/normalized-audio/slide-21.mp4", rect: [0.148611, 0.269278, 0.702244, 0.700285] },
      { slide: 25, path: "local/presentations/nli/normalized-audio/slide-23.mp4", rect: [0.155556, 0.282099, 0.688889, 0.682716] },
      { slide: 26, path: "local/presentations/nli/normalized-audio/slide-24.mp4", rect: [0.1625, 0.283642, 0.675, 0.682716] },
      { slide: 31, path: "local/presentations/nli/supplements/reim-first-10s-fade.mp4", rect: [0.16, 0.285, 0.68, 0.68], fit: "contain", title: "המיגונית ברעים, 1 בפברואר 2024", credit: "רשות העתיקות", photographer: "יוסי סודרי" },
    ]);
    expect(manifest.segments).toEqual([
      { id: "segev", requiredNarrative: "segev", range: [1, 9] },
      { id: "nova_mor", requiredNarrative: "nova", range: [10, 12] },
      { id: "nova_memorial", requiredNarrative: "nova", range: [13, 18] },
      { id: "sderot", requiredNarrative: "sderot", range: [19, 23] },
      { id: "shura", requiredNarrative: null, range: [24, 31] },
      { id: "hostages", requiredNarrative: "hostages", range: [32, 36] },
      { id: "credits", requiredNarrative: null, range: [37, 37] },
      { id: "names_wall", requiredNarrative: null, kind: "blackout", range: [0, 0] },
    ]);
    expect(Object.isFrozen(manifest)).toBe(true);
    expect(Object.isFrozen(manifest.segments[0].range)).toBe(true);
    expect(getNliPresentationSegment(manifest, "nova_mor")).toEqual(manifest.segments[1]);
    expect(getNliPresentationSegment(manifest, "missing")).toBeNull();
  });

  it("preserves all 34 original images in order and adds only the three requested video slides", () => {
    const { deck, segments } = validateNliPresentationManifest(approvedManifest);
    const background = "local/presentations/nli/supplements/slide-background.png";
    const originals = Array.from({ length: 34 }, (_, index) =>
      `local/presentations/nli/slides/slide-${String(index + 1).padStart(2, "0")}.png`);
    expect(deck.slidePaths).toHaveLength(37);
    expect(deck.slidePaths.filter((path) => path !== background)).toEqual(originals);
    expect(deck.slidePaths[8]).toBe(background);
    expect(deck.slidePaths[12]).toBe(background);
    expect(deck.slidePaths[13]).toBe(originals[11]);
    expect(deck.slidePaths[30]).toBe(background);
    expect(segments.filter((segment) => segment.kind !== "blackout").flatMap(({ range: [start, end] }) =>
      Array.from({ length: end - start + 1 }, (_, index) => start + index)))
      .toEqual(Array.from({ length: 37 }, (_, index) => index + 1));
    expect(Object.isFrozen(deck.slidePaths)).toBe(true);
  });

  it.each([
    ["wrong length", (paths) => paths.slice(1)],
    ["absolute path", (paths) => paths.with(0, "/external/slide.png")],
    ["traversal", (paths) => paths.with(0, "local/../slide.png")],
  ])("rejects ordered slide paths with %s", (_label, mutate) => {
    const value = structuredClone(approvedManifest);
    const paths = Array.from({ length: value.deck.slideCount }, () => "local/slide.png");
    value.deck.slidePaths = mutate(paths);
    expect(() => validateNliPresentationManifest(value)).toThrow(/slide paths/);
  });

  it("still accepts a legacy deck using only its image path pattern", () => {
    const value = structuredClone(approvedManifest);
    delete value.deck.slidePaths;
    expect(validateNliPresentationManifest(value).deck.slidePaths).toBeUndefined();
  });

  it.each([
    ["nonpositive slide count", (value) => { value.deck.slideCount = 0; }],
    ["absolute slide path", (value) => { value.deck.slidePathPattern = "/local/slides/{slide}.png"; }],
    ["absolute video path", (value) => { value.videos[0].path = "/video.mp4"; }],
    ["invalid video rectangle", (value) => { value.videos[0].rect = [1, 2, 3]; }],
    ["invalid video credit", (value) => { value.videos[1].credit = {}; }],
    ["empty photographer", (value) => { value.videos[1].photographer = " "; }],
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
