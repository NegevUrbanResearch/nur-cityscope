export const NLI_PRESENTATION_MANIFEST_URL =
  "/otef-interactive/public/presentation/nli-presentation-manifest.json";

const EXPECTED_DECK_PATH = "processed/presentations/nli/nur-model.pptx";
const NARRATIVE_IDS = new Set(["segev", "nova", "sderot", "hostages"]);

export function validateNliPresentationManifest(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("presentation manifest must be an object");
  }
  if (value.version !== 1) throw new TypeError("unsupported presentation manifest version");
  const deck = value.deck;
  if (!deck || typeof deck !== "object" || Array.isArray(deck)) {
    throw new TypeError("presentation manifest deck must be an object");
  }
  if (
    typeof deck.path !== "string" ||
    deck.path !== EXPECTED_DECK_PATH ||
    deck.path.includes("..") ||
    deck.path.startsWith("/")
  ) {
    throw new TypeError("invalid presentation deck path");
  }
  if (deck.slideCount !== 33) throw new TypeError("presentation deck must contain 33 slides");
  if (deck.sha256 !== null && (typeof deck.sha256 !== "string" || !/^[0-9a-f]{64}$/.test(deck.sha256))) {
    throw new TypeError("invalid presentation deck SHA-256");
  }
  if (!Array.isArray(value.segments)) throw new TypeError("presentation segments must be an array");

  const ids = new Set();
  let previousEnd = 0;
  const segments = value.segments.map((segment) => {
    if (!segment || typeof segment !== "object" || Array.isArray(segment)) {
      throw new TypeError("presentation segment must be an object");
    }
    if (typeof segment.id !== "string" || !segment.id || ids.has(segment.id)) {
      throw new TypeError("presentation segment IDs must be unique nonempty strings");
    }
    ids.add(segment.id);
    if (segment.requiredNarrative !== null && !NARRATIVE_IDS.has(segment.requiredNarrative)) {
      throw new TypeError("unsupported required presentation narrative");
    }
    if (
      !Array.isArray(segment.range) ||
      segment.range.length !== 2 ||
      !segment.range.every(Number.isInteger) ||
      segment.range[0] < 1 ||
      segment.range[1] > 33 ||
      segment.range[0] > segment.range[1] ||
      segment.range[0] <= previousEnd
    ) {
      throw new TypeError("presentation segment ranges must be ordered, valid, and non-overlapping");
    }
    previousEnd = segment.range[1];
    return Object.freeze({
      id: segment.id,
      requiredNarrative: segment.requiredNarrative,
      range: Object.freeze([...segment.range]),
    });
  });

  return Object.freeze({
    version: 1,
    deck: Object.freeze({ path: deck.path, sha256: deck.sha256, slideCount: 33 }),
    segments: Object.freeze(segments),
  });
}

export async function loadNliPresentationManifest(fetchImpl = globalThis.fetch) {
  if (typeof fetchImpl !== "function") throw new TypeError("fetch implementation is required");
  const response = await fetchImpl(NLI_PRESENTATION_MANIFEST_URL);
  if (!response || !response.ok) throw new Error("failed to load NLI presentation manifest");
  return validateNliPresentationManifest(await response.json());
}

export function getNliPresentationSegment(manifest, segmentId) {
  return manifest?.segments?.find((segment) => segment.id === segmentId) ?? null;
}
