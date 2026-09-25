import { NLI_NOVA_STORY } from "./nli-nova-story.js";

const SEGEV_CENTER = Object.freeze([34.48647925700004, 31.422958191000077]);

const SEGEV_NARRATIVE = Object.freeze({
  id: "segev",
  label: "בית משפחת שגב",
  center: SEGEV_CENTER,
  zoom: 18,
  idleClockMinutes: 401,
  basemap: "satellite_bw",
  focusSettlement: "בארי",
  focusSettlementOutlineId: 19,
  presentationUrl:
    "https://www.canva.com/design/DAHUaRcI6lI/Of1TuYlj0yaPV-r3UDQOKw/view?embed",
});

const NOVA_CENTER = Object.freeze([34.46975, 31.39851]);

const NOVA_NARRATIVE = Object.freeze({
  id: "nova",
  label: "נובה",
  center: NOVA_CENTER,
  zoom: 15,
  beat4Zoom: 13.2,
  idleClockMinutes: NLI_NOVA_STORY.startMinutes,
  basemap: "satellite_bw",
  focusInvestigationPolygonObjectId: 100,
  focusSettlement: "נובה",
  focusSettlementOutlineId: 43,
  hasEscapeOverlay: true,
  keepFocusLabelWithAchieved: true,
});

const SDEROT_CENTER = Object.freeze([34.59744, 31.529518]);
const SDEROT_MARKER = Object.freeze([34.59205662207849, 31.52320675782405]);

const SDEROT_NARRATIVE = Object.freeze({
  id: "sderot",
  label: "תחנת המשטרה",
  center: SDEROT_CENTER,
  zoom: 15,
  marker: SDEROT_MARKER,
  basemap: "satellite_bw",
  focusSettlement: "שדרות",
  focusSettlementOutlineId: 32,
});

const HOSTAGES_CENTER = Object.freeze([34.40244, 31.312639]);
const HOSTAGES_MARKER = Object.freeze([34.40026099200003, 31.31130147400006]);

const HOSTAGES_NARRATIVE = Object.freeze({
  id: "hostages",
  label: "בית משפחת פרי",
  center: HOSTAGES_CENTER,
  zoom: 15,
  marker: HOSTAGES_MARKER,
  basemap: "satellite_bw",
  focusSettlement: "ניר עוז",
  focusSettlementOutlineId: 14,
});

const HOSTAGES_ALL_NARRATIVE = Object.freeze({
  id: "hostages_all",
  center: Object.freeze([34.5, 31.4]),
  zoom: 10,
  basemap: "satellite_bw",
});

export const NLI_NARRATIVES = Object.freeze({
  segev: SEGEV_NARRATIVE,
  nova: NOVA_NARRATIVE,
  sderot: SDEROT_NARRATIVE,
  hostages: HOSTAGES_NARRATIVE,
  hostages_all: HOSTAGES_ALL_NARRATIVE,
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
