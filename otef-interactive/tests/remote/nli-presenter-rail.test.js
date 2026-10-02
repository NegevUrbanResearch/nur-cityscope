import { describe, expect, it } from "vitest";
import { buildPresenterRail, presenterRailKeyAtY, presenterRailY } from "../../frontend/src/remote/nli-presenter-rail.js";
import navigationFixture from "../fixtures/nli-presenter-navigation.json";

const beatsFor = (minutes) => minutes.map((minute) => ({ key: String(minute), minute }));
const intersects = (a, b) => a.y - a.height / 2 < b.y + b.height / 2 && b.y - b.height / 2 < a.y + a.height / 2;
const nearestPointKey = (points, y) => points.reduce((best, point) =>
  Math.abs(point.y - y) < Math.abs(best.y - y) - 1e-9 ? point : best).key;

function expectValidRail(rail, beats, height, labelHeight = 16) {
  expect(rail.height).toBe(height);
  expect(rail.points.map((point) => point.minute)).toEqual(beats.map((beat) => beat.minute));
  expect(rail.points.every((point) => Number.isFinite(point.y) && point.y >= 0 && point.y <= height)).toBe(true);
  expect(rail.points.every((point, index) => index === 0 || point.y >= rail.points[index - 1].y)).toBe(true);
  if (height > 0) {
    for (const beat of beats) expect(presenterRailKeyAtY(rail, presenterRailY(rail, beat.key))).toBe(beat.key);
  }
  expect(rail.marks.filter((mark) => mark.kind === "hour")).toHaveLength(rail.segments.length);
  for (const mark of rail.marks) expect(Number.isFinite(mark.y) && mark.y >= 0 && mark.y <= height).toBe(true);
  expect(rail.segments.at(-1)?.end ?? 0).toBeLessThanOrEqual(height);
  const labels = rail.marks.filter((mark) => mark.label).map((mark) => ({
    y: mark.labelY ?? mark.y, height: labelHeight, lane: mark.lane ?? "static",
  }));
  for (let i = 0; i < labels.length; i += 1) for (let j = i + 1; j < labels.length; j += 1) {
    if (labels[i].lane === labels[j].lane) {
      expect(intersects(labels[i], labels[j])).toBe(false);
      expect(Math.abs(labels[i].y - labels[j].y)).toBeGreaterThanOrEqual(labelHeight + 4);
    }
  }
}

describe("weighted occupied-hour presenter rail", () => {
  it("round-trips every real beat and compresses empty hours", () => {
    const beats = beatsFor([389, 403, 453, 454, 480, 481, 782, 1197]);
    const rail = buildPresenterRail(beats, { height: 360 });
    for (const beat of beats) expect(presenterRailKeyAtY(rail, presenterRailY(rail, beat.key))).toBe(beat.key);
    expect(rail.segments.map((segment) => segment.hour)).toEqual([6, 7, 8, 13, 19]);
    expect(rail.segments.find((segment) => segment.hour === 7).end - rail.segments.find((segment) => segment.hour === 7).start)
      .toBeGreaterThan(rail.segments.find((segment) => segment.hour === 19).end - rail.segments.find((segment) => segment.hour === 19).start);
    expect(rail.breaks).toHaveLength(2);
    expectValidRail(rail, beats, 360);
  });

  it("lays out the full 116 minute fixture with all marks in bounds", () => {
    const beats = beatsFor(navigationFixture.minutes);
    expect(beats).toHaveLength(116);
    expectValidRail(buildPresenterRail(beats, { height: 720 }), beats, 720);
  });

  it("maps beats and quarter marks across the actual occupied-minute span", () => {
    const beats = beatsFor([389, 390, 395, 400]); // 06:29–06:40
    const rail = buildPresenterRail(beats, { height: 180 });
    const [first, , , last] = rail.points;
    const segment = rail.segments[0];
    expect(first.y).toBeCloseTo(segment.start + (segment.end - segment.start) * 0.01);
    expect(rail.points[2].y).toBeCloseTo(segment.start + (segment.end - segment.start) * (0.01 + 0.98 * 6 / 11));
    expect(last.y).toBeCloseTo(segment.start + (segment.end - segment.start) * 0.99);
    expect(rail.marks.filter((mark) => mark.kind === "endpoint").map((mark) => mark.label))
      .toEqual(["06:29", "06:40"]);
    const quarterMarks = rail.marks.filter((mark) => mark.kind === "quarter");
    expect(quarterMarks.map((mark) => mark.minute)).toEqual([390]);
    expect(quarterMarks[0].y).toBeCloseTo(segment.start + (segment.end - segment.start) * (0.01 + 0.98 / 11));
    const withQuarterSpan = buildPresenterRail(beatsFor([389, 406, 419]), { height: 180 });
    expect(withQuarterSpan.marks.filter((mark) => mark.kind === "quarter").map((mark) => mark.label)).toEqual([null]);
    expect(withQuarterSpan.marks.find((mark) => mark.kind === "quarter")?.y)
      .toBeGreaterThan(withQuarterSpan.points[0].y);
  });

  it("suppresses quarter ticks that are too close to span endpoints or each other", () => {
    const short = buildPresenterRail(beatsFor([360, 419]), { height: 28 });
    expect(short.marks.filter((mark) => mark.kind === "quarter")).toEqual([]);

    const fixture = buildPresenterRail(beatsFor(navigationFixture.minutes), { height: 180 });
    const quarters = fixture.marks.filter((mark) => mark.kind === "quarter");
    const points = fixture.points;
    for (const quarter of quarters) {
      const nearestEndpoint = Math.min(Math.abs(quarter.y - points[0].y), Math.abs(quarter.y - points.at(-1).y));
      expect(nearestEndpoint).toBeGreaterThanOrEqual(8);
    }
    for (let index = 1; index < quarters.length; index += 1) {
      expect(quarters[index].y - quarters[index - 1].y).toBeGreaterThanOrEqual(8);
    }
  });

  it("reserves visible omitted-hour breaks when space permits and reports their range", () => {
    const rail = buildPresenterRail(beatsFor([782, 1141, 1197]), { height: 240 });
    expect(rail.breaks[0]).toMatchObject({ omittedStartHour: 14, omittedEndHour: 18 });
    expect(rail.breaks[0].end - rail.breaks[0].start).toBeGreaterThanOrEqual(18);
    const compressed = buildPresenterRail(beatsFor([782, 1141]), { height: 2, padding: 8, gap: 18 });
    expect(compressed.breaks[0].end - compressed.breaks[0].start).toBeGreaterThanOrEqual(0);
    expect(compressed.breaks[0].end - compressed.breaks[0].start).toBeLessThan(18);
  });

  it("keeps points chronological under altered density, exact ties, and break snapping", () => {
    const minutes = [361, 362, 363, 364, 365, 366, 367, 368, 369, 370, 371, 372, 373, 374, 375, 379, 782, 1141, 1197];
    const beats = beatsFor(minutes);
    const rail = buildPresenterRail(beats, { height: 400 });
    expectValidRail(rail, beats, 400);
    expect(rail.segments.find((segment) => segment.hour === 6).end - rail.segments.find((segment) => segment.hour === 6).start)
      .toBeGreaterThan(rail.segments.find((segment) => segment.hour === 19).end - rail.segments.find((segment) => segment.hour === 19).start);
    const pair = rail.points.slice(-2);
    const tie = (pair[0].y + pair[1].y) / 2;
    expect(presenterRailKeyAtY(rail, tie)).toBe(pair[0].key);
    const gap = rail.breaks.find((item) => item.beforeKey === "782" && item.afterKey === "1141");
    expect(gap).toBeTruthy();
    for (const y of [gap.start + 0.01, gap.end - 0.01]) {
      expect(presenterRailKeyAtY(rail, y)).toBe(nearestPointKey(rail.points, y));
    }
    const beforeGap = rail.points.find((point) => point.key === "782");
    const afterGap = rail.points.find((point) => point.key === "1141");
    const neighborMidpoint = (beforeGap.y + afterGap.y) / 2;
    expect(presenterRailKeyAtY(rail, neighborMidpoint)).toBe("782");
    expect(presenterRailKeyAtY(rail, neighborMidpoint - 1e-6)).toBe("782");
    expect(presenterRailKeyAtY(rail, neighborMidpoint + 1e-6)).toBe("1141");
    expect(presenterRailKeyAtY(rail, rail.points.find((point) => point.key === "782").y)).toBe("782");
    expect(presenterRailKeyAtY(rail, rail.points.find((point) => point.key === "1141").y)).toBe("1141");
    const middle = (gap.start + gap.end) / 2;
    const nearest = Math.abs(rail.points.find((point) => point.key === "782").y - middle)
      <= Math.abs(rail.points.find((point) => point.key === "1141").y - middle) ? "782" : "1141";
    expect(presenterRailKeyAtY(rail, middle)).toBe(nearest);
    expect(presenterRailKeyAtY(rail, gap.end)).toBe("1141");
  });

  it("handles empty, single, one-hour, and sparse-minute rails", () => {
    expect(buildPresenterRail([], { height: 100 })).toMatchObject({ points: [], segments: [], breaks: [], marks: [] });
    const collapsed = buildPresenterRail(beatsFor([0, 59, 60]), { height: 0 });
    expectValidRail(collapsed, beatsFor([0, 59, 60]), 0);
    expect(collapsed.points.map((point) => point.y)).toEqual([0, 0, 0]);
    const single = beatsFor([389]);
    const one = buildPresenterRail(single, { height: 100 });
    expect(one.points[0].y).toBe(50);
    expectValidRail(one, single, 100);
    const sameHour = beatsFor([361, 389]);
    expectValidRail(buildPresenterRail(sameHour, { height: 100 }), sameHour, 100);
    const sparse = beatsFor([0, 59, 60, 119]);
    expectValidRail(buildPresenterRail(sparse, { height: 200 }), sparse, 200);
  });

  it("keeps all hour ticks in a short landscape rail with twenty occupied hours", () => {
    const beats = beatsFor(Array.from({ length: 20 }, (_, hour) => hour * 60 + 30));
    const rail = buildPresenterRail(beats, { height: 80, minSegment: 22, gap: 8, padding: 8 });
    expectValidRail(rail, beats, 80);
    expect(rail.segments).toHaveLength(20);
    expect(rail.marks.filter((mark) => mark.kind === "hour")).toHaveLength(20);
  });

  it("weights a busy 19:00 hour more than a sparse 06:00 hour", () => {
    const minutes = [361, 1141, 1142, 1143, 1144, 1145, 1146, 1147, 1148, 1149, 1150, 1151];
    const beats = beatsFor(minutes);
    const rail = buildPresenterRail(beats, { height: 300 });
    const early = rail.segments.find((segment) => segment.hour === 6);
    const late = rail.segments.find((segment) => segment.hour === 19);
    expect(late.end - late.start).toBeGreaterThan(early.end - early.start);
    expectValidRail(rail, beats, 300);
  });

  it("retains first, last, and browse-hour labels in measured separate lanes", () => {
    const beats = beatsFor([361, 421, 481, 541, 601, 661, 721]);
    const rail = buildPresenterRail(beats, { height: 100, labelHeight: 18, browseKey: "601" });
    const hourMarks = rail.marks.filter((mark) => mark.kind === "hour");
    expect(hourMarks[0].label).toBe("06");
    expect(hourMarks.at(-1).label).toBe("12");
    expect(hourMarks.find((mark) => mark.hour === 10)).toMatchObject({ label: "10", lane: "browse" });
    expectValidRail(rail, beats, 100, 18);
  });

  it("keeps essential labels separated when the rail is too short for one label lane", () => {
    const beats = beatsFor([361, 421]);
    const rail = buildPresenterRail(beats, { height: 35, labelHeight: 18 });
    const labels = rail.marks.filter((mark) => mark.label);
    expect(labels.map((mark) => mark.label)).toEqual(["06", "07"]);
    expect(labels[0].lane).not.toBe(labels[1].lane);
    expectValidRail(rail, beats, 35, 18);
  });
});
