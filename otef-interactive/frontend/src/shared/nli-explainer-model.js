/**
 * Pure NLI timeline explainer model + inner HTML (no DOM, no MapLibre).
 * GIS and projection both paint nliExplainerInnerHtml(model) for the same beat.
 */

import { flashingCityNames } from "./maplibre-investigation-alarms.js";
import { formatMinutesAsLocalClock } from "./nli-investigation-beats.js";

const ALARM_CHIP_CAP = 12;

export const NLI_EXPLAINER_KIND_LABELS = Object.freeze({
  polygons: Object.freeze({ he: "שטחים", en: "Areas" }),
  lines: Object.freeze({ he: "צירים", en: "Routes" }),
  alarms: Object.freeze({ he: "אזעקות", en: "Alarms" }),
});

export function normalizeExplainerChip(raw) {
  if (raw == null) return null;
  const unified = String(raw).replace(/\r\n|\r/g, "\n").trim();
  if (!unified) return null;
  const lines = unified.split("\n").map((line) => line.replace(/[ \t]+/g, " ").trim());
  if (lines.every((line) => line === "")) return null;
  return lines.join("\n");
}

function chipsAtClock(features, clock) {
  const items = [];
  const seen = new Set();
  for (const feature of features || []) {
    if (Number(feature?.properties?.timeline_minutes) !== clock) continue;
    const chip = normalizeExplainerChip(feature?.properties?.Name);
    if (!chip || seen.has(chip)) continue;
    seen.add(chip);
    items.push(chip);
  }
  return items;
}

function alarmRowItems(alarmFeatures, clock, previousClock) {
  const { rows, totalFlashing } = flashingCityNames(alarmFeatures, clock, previousClock);
  const items = [];
  const seen = new Set();
  for (const row of rows) {
    const chip = normalizeExplainerChip(row.city);
    if (!chip || seen.has(chip)) continue;
    seen.add(chip);
    items.push(chip);
  }
  const overflowCount = totalFlashing > ALARM_CHIP_CAP ? totalFlashing - ALARM_CHIP_CAP : 0;
  return { items, overflowCount };
}

function kindLabel(kind, locale) {
  const loc = locale === "en" ? "en" : "he";
  return NLI_EXPLAINER_KIND_LABELS[kind][loc];
}

function pushRow(rows, kind, locale, items, overflowCount) {
  if (!items.length) return;
  rows.push({
    kind,
    label: kindLabel(kind, locale),
    items,
    overflowCount,
  });
}

export function buildNliExplainerModel({
  polygonOn,
  lineOn,
  alarmPlay,
  polygonFeatures,
  lineFeatures,
  alarmFeatures,
  clock,
  previousClock,
  locale,
} = {}) {
  const rows = [];
  if (polygonOn) {
    pushRow(rows, "polygons", locale, chipsAtClock(polygonFeatures, clock), 0);
  }
  if (lineOn) {
    pushRow(rows, "lines", locale, chipsAtClock(lineFeatures, clock), 0);
  }
  if (alarmPlay) {
    const { items, overflowCount } = alarmRowItems(alarmFeatures, clock, previousClock);
    pushRow(rows, "alarms", locale, items, overflowCount);
  }
  return {
    clockLabel: formatMinutesAsLocalClock(clock),
    rows,
  };
}

function escapeCaption(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function chipsInnerHtml(items, overflowCount) {
  const chips = items.map((item) => `<span class="nli-tl-chip">${escapeCaption(item)}</span>`);
  if (overflowCount > 0) {
    chips.push(`<span class="nli-tl-chip">ועוד ${overflowCount}</span>`);
  }
  return chips.join('<span class="nli-tl-sep"> · </span>');
}

export function nliExplainerInnerHtml(model) {
  if (!model) return "";
  const clock = `<div class="nli-tl-clock" dir="ltr">${escapeCaption(model.clockLabel || "")}</div>`;
  const rows = (model.rows || [])
    .map(
      (row) =>
        `<div class="nli-tl-row nli-tl-row--${row.kind}"><span class="nli-tl-kind">${escapeCaption(row.label)}</span><span class="nli-tl-chips">${chipsInnerHtml(row.items || [], row.overflowCount || 0)}</span></div>`,
    )
    .join("");
  return `${clock}${rows}`;
}

export const NLI_EXPLAINER_SAMPLE_MODEL = Object.freeze({
  clockLabel: "07:00",
  rows: Object.freeze([
    Object.freeze({
      kind: "polygons",
      label: "שטחים",
      items: Object.freeze([
        "גן הדר\nהמשך סיפור",
        "מרחב כניסה לקיבוץ",
        "השכונה הצפונית",
      ]),
      overflowCount: 0,
    }),
    Object.freeze({
      kind: "lines",
      label: "צירים",
      items: Object.freeze(["ציר כיסופים", "כפר עזה - רחפנים", "עלומים - ציר חדירה ראשון"]),
      overflowCount: 0,
    }),
    Object.freeze({
      kind: "alarms",
      label: "אזעקות",
      items: Object.freeze([
        "שדרות",
        "נתיבות",
        "אופקים",
        "אשקלון",
        "באר שבע",
        "קריית גת",
        "אשדוד",
        "יד מרדכי",
        "ניר עם",
        "נחל עוז",
        "כפר עזה",
        "מפלסים",
      ]),
      overflowCount: 3,
    }),
  ]),
});
