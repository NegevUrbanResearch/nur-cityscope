const SEGEV_CENTER = Object.freeze([34.48647925700004, 31.422958191000077]);

const SEGEV_NARRATIVE = Object.freeze({
  id: "segev",
  label: "משפחת שגב",
  center: SEGEV_CENTER,
  zoom: 18,
  basemap: "satellite_bw",
  focusSettlement: "בארי",
  focusSettlementOutlineId: 19,
  presentationUrl:
    "https://www.canva.com/design/DAHUaRcI6lI/Of1TuYlj0yaPV-r3UDQOKw/view?embed",
});

export const NLI_NARRATIVES = Object.freeze({
  segev: SEGEV_NARRATIVE,
});

export const NLI_NARRATIVE_EXIT_SCENE = Object.freeze({
  center: "configured OTEF bounds center",
  zoom: 10,
  basemap: "dark",
});

const EMPTY_NARRATIVE_STATE = Object.freeze({
  id: null,
  transition: "initial",
  revision: 0,
});

export function getNliNarrative(id) {
  return typeof id === "string" && Object.prototype.hasOwnProperty.call(NLI_NARRATIVES, id)
    ? NLI_NARRATIVES[id]
    : null;
}

export function normalizeNarrativeState(value) {
  if (!value || typeof value !== "object") return { ...EMPTY_NARRATIVE_STATE };
  const { id, transition, revision } = value;
  if (!Number.isInteger(revision) || revision < 0 || revision === 0) {
    return { ...EMPTY_NARRATIVE_STATE };
  }
  if (id === null && transition === "exit") {
    return { id: null, transition: "exit", revision };
  }
  if (getNliNarrative(id) && (transition === "enter" || transition === "replace")) {
    return { id, transition, revision };
  }
  return { ...EMPTY_NARRATIVE_STATE };
}
