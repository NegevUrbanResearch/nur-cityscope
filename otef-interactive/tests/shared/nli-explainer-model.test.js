import { describe, expect, it } from "vitest";
import {
  NLI_EXPLAINER_KIND_LABELS,
  NLI_EXPLAINER_SAMPLE_MODEL,
  buildNliExplainerModel,
  nliExplainerInnerHtml,
  normalizeExplainerChip,
} from "../../frontend/src/shared/nli-explainer-model.js";

describe("normalizeExplainerChip", () => {
  it("keeps interior newlines and collapses spaces per line", () => {
    expect(normalizeExplainerChip("  א\nב  ")).toBe("א\nב");
    expect(normalizeExplainerChip("גן הדר\nהמשך   סיפור")).toBe("גן הדר\nהמשך סיפור");
    expect(normalizeExplainerChip("שדרות   גדולה")).toBe("שדרות גדולה");
    expect(normalizeExplainerChip(" \n ")).toBe(null);
  });
});

describe("buildNliExplainerModel", () => {
  const polys = [
    { properties: { Name: "גן הדר\nהמשך סיפור", timeline_minutes: 420 } },
    { properties: { Name: "גן הדר", timeline_minutes: 420 } },
    { properties: { Name: "אחר", timeline_minutes: 400 } },
  ];
  const lines = [{ properties: { Name: "ציר כיסופים", timeline_minutes: 420 } }];
  const alarms = [
    { properties: { city: "שדרות", alarm_minutes: [420] } },
    { properties: { city: "נתיבות", alarm_minutes: [420] } },
  ];

  it("always has clock; omits idle kinds; separates three rows; dedupes", () => {
    const model = buildNliExplainerModel({
      polygonOn: true,
      lineOn: true,
      alarmPlay: true,
      polygonFeatures: polys,
      lineFeatures: lines,
      alarmFeatures: alarms,
      clock: 420,
      previousClock: null,
      locale: "he",
    });
    expect(model.clockLabel).toBe("07:00");
    expect(model.rows.map((r) => r.kind)).toEqual(["polygons", "lines", "alarms"]);
    expect(model.rows[0].label).toBe("שטחים");
    expect(model.rows[0].items).toEqual(["גן הדר\nהמשך סיפור", "גן הדר"]);
    expect(model.rows[1].items).toEqual(["ציר כיסופים"]);
    expect(model.rows[2].items).toEqual(["נתיבות", "שדרות"]);
  });

  it("alarms follow flashingCityNames order (window count desc, then name)", () => {
    const model = buildNliExplainerModel({
      polygonOn: false,
      lineOn: false,
      alarmPlay: true,
      polygonFeatures: [],
      lineFeatures: [],
      alarmFeatures: [
        { properties: { city: "א", alarm_minutes: [400] } },
        { properties: { city: "ב", alarm_minutes: [400, 400] } },
      ],
      clock: 400,
      previousClock: null,
    });
    expect(model.rows[0].items).toEqual(["ב", "א"]);
  });

  it("shows clock with empty rows when kinds are off", () => {
    const model = buildNliExplainerModel({
      polygonOn: false,
      lineOn: false,
      alarmPlay: false,
      polygonFeatures: polys,
      lineFeatures: lines,
      alarmFeatures: alarms,
      clock: 420,
      previousClock: null,
    });
    expect(model.clockLabel).toBe("07:00");
    expect(model.rows).toEqual([]);
  });

  it("caps alarms at 12 and sets overflowCount", () => {
    const many = Array.from({ length: 15 }, (_, i) => ({
      properties: { city: `עיר-${String(i).padStart(2, "0")}`, alarm_minutes: [400] },
    }));
    const model = buildNliExplainerModel({
      polygonOn: false,
      lineOn: false,
      alarmPlay: true,
      polygonFeatures: [],
      lineFeatures: [],
      alarmFeatures: many,
      clock: 400,
      previousClock: null,
    });
    expect(model.rows).toHaveLength(1);
    expect(model.rows[0].items).toHaveLength(12);
    expect(model.rows[0].overflowCount).toBe(3);
  });

  it("html has typed rows, ltr clock, no joined soup class as the only names node", () => {
    const model = buildNliExplainerModel({
      polygonOn: true,
      lineOn: false,
      alarmPlay: false,
      polygonFeatures: [{ properties: { Name: "א", timeline_minutes: 400 } }],
      lineFeatures: [],
      alarmFeatures: [],
      clock: 400,
      previousClock: null,
    });
    const html = nliExplainerInnerHtml(model);
    expect(html).toMatch(/dir="ltr"/);
    expect(html).toMatch(/nli-tl-row--polygons/);
    expect(html).toMatch(/nli-tl-chip/);
    expect(html).toMatch(/nli-tl-chips/);
    expect(html).not.toMatch(/nli-tl-names/);
    expect(html).toContain("שטחים");
    expect(html).toContain("06:40");
  });

  it("sample model is worst-case (12 alarms + overflow)", () => {
    const polys = NLI_EXPLAINER_SAMPLE_MODEL.rows.find((r) => r.kind === "polygons");
    const lines = NLI_EXPLAINER_SAMPLE_MODEL.rows.find((r) => r.kind === "lines");
    const alarms = NLI_EXPLAINER_SAMPLE_MODEL.rows.find((r) => r.kind === "alarms");
    expect(polys.items.length).toBeGreaterThanOrEqual(3);
    expect(polys.items.some((t) => t.includes("\n"))).toBe(true);
    expect(lines.items.length).toBeGreaterThanOrEqual(3);
    expect(alarms.items.length).toBe(12);
    expect(alarms.overflowCount).toBeGreaterThan(0);
  });

  it("uses previousClock window; includes (P, C] and skips the skipped range", () => {
    const model = buildNliExplainerModel({
      polygonOn: false,
      lineOn: false,
      alarmPlay: true,
      polygonFeatures: [],
      lineFeatures: [],
      alarmFeatures: [
        { properties: { city: "ישן", alarm_minutes: [390] } },
        { properties: { city: "חדש", alarm_minutes: [400] } },
      ],
      clock: 400,
      previousClock: 395,
    });
    expect(model.clockLabel).toBe("06:40");
    expect(model.rows[0].items).toEqual(["חדש"]);
  });

  it("keeps multi-line Name in html; normalizes city newlines; HTML-escapes; ועוד is its own chip", () => {
    const model = buildNliExplainerModel({
      polygonOn: true,
      lineOn: false,
      alarmPlay: true,
      polygonFeatures: [{ properties: { Name: "<x>\nשורה", timeline_minutes: 400 } }],
      lineFeatures: [],
      alarmFeatures: Array.from({ length: 15 }, (_, i) => ({
        properties: {
          city: i === 0 ? "שדרות\nnote" : `עיר-${String(i).padStart(2, "0")}`,
          alarm_minutes: i === 0 ? [400, 400] : [400],
        },
      })),
      clock: 400,
      previousClock: null,
    });
    expect(model.rows.find((r) => r.kind === "polygons").items).toEqual(["<x>\nשורה"]);
    expect(model.rows.find((r) => r.kind === "alarms").items[0]).toBe("שדרות\nnote");
    const html = nliExplainerInnerHtml(model);
    expect(html).toContain("&lt;x&gt;\nשורה");
    expect(html).not.toMatch(/<x>/);
    expect(html).toMatch(/nli-tl-chip[^>]*>ועוד 3</);
  });

  it("long unspaced token stays one chip", () => {
    const token = "א".repeat(80);
    const model = buildNliExplainerModel({
      polygonOn: true,
      lineOn: false,
      alarmPlay: false,
      polygonFeatures: [{ properties: { Name: token, timeline_minutes: 400 } }],
      lineFeatures: [],
      alarmFeatures: [],
      clock: 400,
      previousClock: null,
    });
    expect(model.rows[0].items).toEqual([token]);
    const html = nliExplainerInnerHtml(model);
    expect(html).toContain(`nli-tl-chip">${token}</span>`);
    expect(html.match(/class="nli-tl-chip"/g).length).toBe(1);
  });

  it("two-word Name stays one chip", () => {
    const model = buildNliExplainerModel({
      polygonOn: true,
      lineOn: false,
      alarmPlay: false,
      polygonFeatures: [{ properties: { Name: "ניר עם", timeline_minutes: 400 } }],
      lineFeatures: [],
      alarmFeatures: [],
      clock: 400,
      previousClock: null,
    });
    expect(model.rows[0].items).toEqual(["ניר עם"]);
    const html = nliExplainerInnerHtml(model);
    expect(html).toMatch(/nli-tl-chip">ניר עם<\/span>/);
    expect(html.match(/class="nli-tl-chip"/g).length).toBe(1);
  });
});

describe("labels", () => {
  it("keeps short he/en kind words", () => {
    expect(NLI_EXPLAINER_KIND_LABELS.polygons.he).toBe("שטחים");
    expect(NLI_EXPLAINER_KIND_LABELS.lines.he).toBe("צירים");
    expect(NLI_EXPLAINER_KIND_LABELS.alarms.he).toBe("אזעקות");
  });
});
