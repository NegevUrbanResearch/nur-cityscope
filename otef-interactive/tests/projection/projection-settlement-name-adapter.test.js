import { expect, test } from "vitest";
import { createProjectionSettlementNameAdapter } from "../../frontend/src/projection/projection-settlement-name-adapter.js";

function catalogFixture() {
  return {
    entries: [
      { citycode: "0067", text: "נירים", lng: 34.4, lat: 31.3 },
      { citycode: "0424", text: "מחוץ", lng: 34.2, lat: 31.2 },
    ],
  };
}

function initializedSettingsFixture() {
  return {
    baseline: {
      captureId: "fixture-settlement-name",
      captureDigest: "a".repeat(64),
      sourceDigest: "b".repeat(64),
      catalogDigest: "c".repeat(64),
      predecessor: { revision: 1, configDigest: "d".repeat(64) },
      successor: { revision: 2, configDigest: "e".repeat(64) },
      outputs: {
        left: { "0067": { x: 500, y: 340 }, "0424": { x: -40, y: 1400 } },
        right: { "0067": { x: 1400, y: 360 }, "0424": { x: 1800, y: 400 } },
      },
    },
    style: { fontFamily: "Guttman Hatzvi", fontPx: 14, rotateDeg: 35 },
    outputs: { left: {}, right: {} },
  };
}

function fakeCanvasDocument() {
  const loads = [];
  const paints = [];
  const document = {
    fonts: {
      load: async (spec) => {
        loads.push(spec);
        if (document.fonts.fail) throw new Error("font failed");
        return [spec];
      },
    },
    createElement() {
      const canvas = {
        width: 0,
        height: 0,
        getContext() {
          const context = {
            font: "",
            direction: "",
            textAlign: "",
            textBaseline: "",
            fillStyle: "",
            strokeStyle: "",
            lineWidth: 0,
            globalAlpha: 1,
            save() {},
            restore() {},
            setTransform() {},
            clearRect() {},
            translate() {},
            rotate() {},
            fillText(text, x, y) {
              paints.push({ op: "fill", text, x, y, lineWidth: context.lineWidth, canvasWidth: canvas.width });
            },
            strokeText(text, x, y) {
              paints.push({ op: "stroke", text, x, y, lineWidth: context.lineWidth, canvasWidth: canvas.width });
            },
            measureText(text) {
              const size = Number(String(context.font).match(/(\d+(?:\.\d+)?)px/)?.[1] || 14);
              const width = [...text].length * size * 0.6;
              return {
                width,
                actualBoundingBoxLeft: width / 2,
                actualBoundingBoxRight: width / 2,
                actualBoundingBoxAscent: size * 0.7,
                actualBoundingBoxDescent: size * 0.2,
              };
            },
          };
          return context;
        },
      };
      return canvas;
    },
  };
  document.loads = loads;
  document.paints = paints;
  return document;
}

test("paints each label once with a single halo stroke and fill", async () => {
  const document = fakeCanvasDocument();
  const adapter = createProjectionSettlementNameAdapter({ document, output: "left" });
  await adapter.prepare({ catalog: catalogFixture(), settings: initializedSettingsFixture() });
  adapter.commit();
  const outputPaints = document.paints.filter((paint) => paint.canvasWidth === 1920);
  const fills = outputPaints.filter((paint) => paint.op === "fill");
  const strokes = outputPaints.filter((paint) => paint.op === "stroke");
  expect(fills).toHaveLength(2);
  expect(strokes).toHaveLength(2);
  expect(fills.map((paint) => paint.text)).toEqual(strokes.map((paint) => paint.text));
  expect(strokes.every((paint) => paint.lineWidth === 0.7)).toBe(true);
  for (const paint of fills) {
    expect(paint.x).toBeCloseTo(0, 5);
    expect(paint.y).toBeCloseTo(3.5, 5);
  }
  expect(outputPaints.some((paint) => paint.x === 0.5 || paint.x === -0.5)).toBe(false);
});

test("font and rotation changes preserve a saved center", async () => {
  const adapter = createProjectionSettlementNameAdapter({ document: fakeCanvasDocument(), output: "left" });
  const settings = initializedSettingsFixture();
  settings.outputs.left["0067"] = { x: 510, y: 350 };
  await adapter.prepare({ catalog: catalogFixture(), settings });
  adapter.commit();
  const before = adapter.getLabels().find((n) => n.citycode === "0067");
  settings.style = { ...settings.style, fontPx: 24, rotateDeg: -20 };
  await adapter.prepare({ catalog: catalogFixture(), settings });
  adapter.commit();
  const after = adapter.getLabels().find((n) => n.citycode === "0067");
  expect([after.x, after.y]).toEqual([before.x, before.y]);
  expect(after.rotateDeg).toBe(-20);
  expect(after.inkBox.right - after.inkBox.left).toBeGreaterThan(before.inkBox.right - before.inkBox.left);
});

test("translated positions move glyph bounds by the same delta", async () => {
  const adapter = createProjectionSettlementNameAdapter({ document: fakeCanvasDocument(), output: "left" });
  const settings = initializedSettingsFixture();
  await adapter.prepare({ catalog: catalogFixture(), settings });
  adapter.commit();
  const before = adapter.getLabels().find((n) => n.citycode === "0067");
  settings.outputs.left["0067"] = { x: before.x + 40, y: before.y + 15 };
  await adapter.prepare({ catalog: catalogFixture(), settings });
  adapter.commit();
  const after = adapter.getLabels().find((n) => n.citycode === "0067");
  expect(after.inkBox.left - before.inkBox.left).toBeCloseTo(40, 5);
  expect(after.inkBox.top - before.inkBox.top).toBeCloseTo(15, 5);
});

test("one output edit leaves the other output unchanged", async () => {
  const document = fakeCanvasDocument();
  const left = createProjectionSettlementNameAdapter({ document, output: "left" });
  const right = createProjectionSettlementNameAdapter({ document, output: "right" });
  const settings = initializedSettingsFixture();
  settings.outputs.left["0067"] = { x: 11, y: 22 };
  await left.prepare({ catalog: catalogFixture(), settings });
  left.commit();
  await right.prepare({ catalog: catalogFixture(), settings });
  right.commit();
  expect(left.getLabels().find((n) => n.citycode === "0067")).toMatchObject({ x: 11, y: 22 });
  expect(right.getLabels().find((n) => n.citycode === "0067")).toMatchObject({ x: 1400, y: 360 });
});

test("visibility changes descriptor opacity without repacking labels", async () => {
  const adapter = createProjectionSettlementNameAdapter({ document: fakeCanvasDocument(), output: "left" });
  const settings = initializedSettingsFixture();
  await adapter.prepare({ catalog: catalogFixture(), settings });
  adapter.commit();
  const before = adapter.getLabels();
  adapter.setVisible(false);
  expect(adapter.descriptor().opacity).toBe(0);
  expect(adapter.getLabels()).toEqual(before);
  adapter.setVisible(true);
  expect(adapter.descriptor().opacity).toBe(1);
});

test("failed, aborted, and stale preparation keep the active descriptor", async () => {
  const document = fakeCanvasDocument();
  const adapter = createProjectionSettlementNameAdapter({ document, output: "left" });
  const settings = initializedSettingsFixture();
  await adapter.prepare({ catalog: catalogFixture(), settings });
  adapter.commit();
  const active = adapter.descriptor();

  document.fonts.fail = true;
  await expect(adapter.prepare({ catalog: catalogFixture(), settings })).rejects.toThrow(/font/i);
  expect(adapter.descriptor()).toBe(active);
  document.fonts.fail = false;

  const controller = new AbortController();
  let release;
  document.fonts.load = () => new Promise((resolve) => { release = resolve; });
  const aborted = adapter.prepare({ catalog: catalogFixture(), settings, signal: controller.signal });
  controller.abort();
  release(["late"]);
  await aborted;
  expect(adapter.descriptor()).toBe(active);

  let releaseFirst;
  document.fonts.load = () => new Promise((resolve) => { releaseFirst = resolve; });
  const first = adapter.prepare({ catalog: catalogFixture(), settings });
  document.fonts.load = async () => ["ready"];
  const next = initializedSettingsFixture();
  next.outputs.left["0067"] = { x: 80, y: 90 };
  await adapter.prepare({ catalog: catalogFixture(), settings: next });
  adapter.commit();
  expect(adapter.getLabels().find((n) => n.citycode === "0067")).toMatchObject({ x: 80, y: 90 });
  releaseFirst(["stale"]);
  await first;
  expect(adapter.getLabels().find((n) => n.citycode === "0067")).toMatchObject({ x: 80, y: 90 });
  expect(adapter.descriptor().source).toBeTruthy();
});
