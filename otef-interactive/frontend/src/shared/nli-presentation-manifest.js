export const NLI_PRESENTATION_MANIFEST_URL =
  "/otef-interactive/public/presentation/nli-presentation-manifest.json";

function isLocalRelativePath(value) {
  return (
    typeof value === "string" &&
    value.startsWith("local/") &&
    !value.includes("\\") &&
    !value.split("/").some((part) => part === ".." || part === ".")
  );
}

function freeze(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) freeze(child);
  }
  return value;
}

export function validateNliPresentationManifest(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("presentation manifest must be an object");
  }
  if (value.version !== 1) throw new TypeError("unsupported presentation manifest version");
  const deck = value.deck;
  if (!deck || typeof deck !== "object" || Array.isArray(deck)) {
    throw new TypeError("presentation manifest deck must be an object");
  }
  if (!Number.isInteger(deck.slideCount) || deck.slideCount <= 0) {
    throw new TypeError("presentation deck slide count must be a positive integer");
  }
  if (!isLocalRelativePath(deck.slidePathPattern)) {
    throw new TypeError("invalid presentation slide path pattern");
  }
  if (!Array.isArray(value.videos)) throw new TypeError("presentation videos must be an array");
  const videos = value.videos.map((video) => {
    if (!video || typeof video !== "object" || Array.isArray(video)) {
      throw new TypeError("presentation video must be an object");
    }
    if (!isLocalRelativePath(video.path)) throw new TypeError("invalid presentation video path");
    if (
      !Array.isArray(video.rect) ||
      video.rect.length !== 4 ||
      !video.rect.every((coordinate) => typeof coordinate === "number" && Number.isFinite(coordinate))
    ) {
      throw new TypeError("presentation video rectangle must contain four numbers");
    }
    return { ...video, rect: [...video.rect] };
  });
  if (!Array.isArray(value.segments)) throw new TypeError("presentation segments must be an array");
  const segments = value.segments.map((segment) => {
    if (!segment || typeof segment !== "object" || Array.isArray(segment)) {
      throw new TypeError("presentation segment must be an object");
    }
    if (typeof segment.id !== "string" || !segment.id.trim()) {
      throw new TypeError("presentation segment ID must be a nonempty string");
    }
    if (segment.requiredNarrative !== null && typeof segment.requiredNarrative !== "string") {
      throw new TypeError("presentation required narrative must be a string or null");
    }
    if (
      !Array.isArray(segment.range) ||
      segment.range.length !== 2 ||
      !segment.range.every(Number.isInteger)
    ) {
      throw new TypeError("presentation segment range must contain two integers");
    }
    return { ...segment, range: [...segment.range] };
  });

  return freeze({ version: 1, deck: { ...deck }, videos, segments });
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
