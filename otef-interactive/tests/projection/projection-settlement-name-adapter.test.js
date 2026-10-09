import { expect, test } from "vitest";
import { createProjectionSettlementNameAdapter } from "../../frontend/src/projection/projection-settlement-name-adapter.js";

test('draws a chosen two-line projection name centered as one rotated label', async () => {
  const document = fakeCanvasDocument();
  const adapter = createProjectionSettlementNameAdapter({ document, output: 'left' });
  const settings = initializedSettingsFixture();
  settings.lineBreaks = { '0067': 1 };
  const catalog = { entries: [{ citycode: '0067', text: 'שדי אברהם', lng: 34.4, lat: 31.3 }] };
  await adapter.prepare({ catalog, settings }); adapter.commit();
  expect(document.paints.filter(p => p.op === 'fill').map(p => p.text)).toEqual(['שדי', 'אברהם']);
  const label = adapter.getLabels()[0];
  expect(label).toMatchObject({ x: 500, y: 340, rotateDeg: 35 });
  expect(label.inkBox.bottom - label.inkBox.top).toBeGreaterThan(28);
  expect(catalog.entries[0].text).toBe('שדי אברהם');
});

test('connects the outline boundary to the moved label edge using both line strokes', async () => {
  const document = fakeCanvasDocument();
  const adapter = createProjectionSettlementNameAdapter({ document, output: 'left' });
  const settings = initializedSettingsFixture(); settings.style.rotateDeg = 0;
  const catalog = { entries: [catalogFixture().entries[0]] };
  adapter.setFramingProvider(() => ({ matrix: [1,0,0,1,0,0], clip: [0,0,1,1], outlines: { '0067': [[[100,300],[200,300],[200,380],[100,380],[100,300]]] } }));
  await adapter.prepare({ catalog, settings }); adapter.commit();
  const first = adapter.getLabels()[0];
  expect(first.connector.start).toEqual({ x: 200, y: 340 });
  expect(first.connector.end.x).toBeCloseTo(first.inkBox.left - 2);
  expect(document.lines).toHaveLength(2);
  settings.outputs.left['0067'] = { x: 600, y: 340 };
  await adapter.prepare({ catalog, settings }); adapter.commit();
  expect(adapter.getLabels()[0].connector.end.x).toBeCloseTo(first.connector.end.x + 100);
});

test('applies saved connector width and opacity without changing the text halo', async () => {
  const document = fakeCanvasDocument();
  const adapter = createProjectionSettlementNameAdapter({ document, output: 'left' });
  const settings = initializedSettingsFixture(); settings.style.rotateDeg = 0;
  settings.leaderStyle = { widthPx: 3, outlineWidthPx: 1, color: '#ffffff', outlineColor: '#bfbf99', opacity: 0.4 };
  adapter.setFramingProvider(() => ({ matrix: [1,0,0,1,0,0], clip: [0,0,1,1], outlines: { '0067': [[[100,300],[200,300],[200,380],[100,380]]] } }));
  await adapter.prepare({ catalog: { entries: [catalogFixture().entries[0]] }, settings }); adapter.commit();
  expect(document.lines.map(line => line.width)).toEqual([5, 3]);
  expect(document.lines.every(line => line.opacity === 1)).toBe(true);
  expect(document.images[0].opacity).toBe(0.4);
  expect(document.paints.every(paint => paint.lineWidth === 0.7)).toBe(true);
  adapter.applyScaledOpacity(0.08);
  expect(document.images.at(-2).opacity).toBeCloseTo(0.032);
  expect(document.images.at(-1).opacity).toBe(0.08);
});

test.each([['240P', 'מועצה אזורית אשכול'], ['724P', 'מכללת ספיר'], ['0338', 'איבים'], ['1223', 'שדי אברהם'], ['1231', 'פרי גן']])('never paints excluded settlement %s even if its historical position remains in the baseline', async (citycode, text) => {
  const document = fakeCanvasDocument();
  const settings = initializedSettingsFixture(); settings.baseline.outputs.left[citycode] = { x: 800, y: 500 };
  const adapter = createProjectionSettlementNameAdapter({ document, output: 'left' });
  await adapter.prepare({ catalog: { entries: [{ citycode, text, lng: 34.4, lat: 31.3 }] }, settings }); adapter.commit();
  expect(document.paints).toHaveLength(0);
  expect(adapter.getLabels()).toHaveLength(0);
});

test.each([1,2])('keeps Reim whole on the left and suppresses its cropped right copy at raster scale %s', async rasterScale => {
  const catalog={entries:[{citycode:'0713',text:'רעים',lng:34.46,lat:31.38}]};
  const settings=initializedSettingsFixture(); settings.style.rotateDeg=82;
  settings.baseline.outputs.left['0713']={x:1730.141,y:679.05};
  settings.baseline.outputs.right['0713']={x:194.141,y:679.05};
  const original=structuredClone(settings);
  const leftDoc=fakeCanvasDocument(),rightDoc=fakeCanvasDocument();
  const left=createProjectionSettlementNameAdapter({document:leftDoc,output:'left',rasterScale});
  const right=createProjectionSettlementNameAdapter({document:rightDoc,output:'right',rasterScale});
  left.setFramingProvider(()=>({matrix:[1,0,0,1,-20,0],clip:[0,0,0.9,1]}));
  right.setFramingProvider(()=>({matrix:[1,0,0,1,0,0],clip:[0.1,0,1,1]}));
  for (const adapter of [left,right]) { await adapter.prepare({catalog,settings}); adapter.commit(); }
  expect(leftDoc.paints.filter(paint=>paint.op==='fill').map(paint=>paint.text)).toEqual(['רעים']);
  expect(rightDoc.paints).toHaveLength(0);
  expect(right.getLabels()[0]).toMatchObject({citycode:'0713',cropped:true});
  expect(settings).toEqual(original);
});

test.each([
  ['left',0,196,540],['right',0,1724,540],['top',82,960,220],['bottom',82,960,860],
])('suppresses an entire rotated label crossing the %s crop edge', async (_edge,rotateDeg,x,y) => {
  const document=fakeCanvasDocument(),adapter=createProjectionSettlementNameAdapter({document,output:'left'});
  const settings=initializedSettingsFixture(); settings.style.rotateDeg=rotateDeg; settings.outputs.left['0067']={x,y};
  adapter.setFramingProvider(()=>({matrix:[1,0,0,1,0,0],clip:[0.1,0.2,0.9,0.8]}));
  await adapter.prepare({catalog:{entries:[catalogFixture().entries[0]]},settings}); adapter.commit();
  expect(document.paints).toHaveLength(0);
  expect(adapter.getLabels()[0].cropped).toBe(true);
});

test('a crop-only change restores a previously hidden label without changing its saved coordinates', async () => {
  const document=fakeCanvasDocument(),adapter=createProjectionSettlementNameAdapter({document,output:'left'});
  let clip=[0.3,0,1,1];
  adapter.setFramingProvider(()=>({matrix:[1,0,0,1,0,0],clip}));
  await adapter.prepare({catalog:{entries:[catalogFixture().entries[0]]},settings:initializedSettingsFixture()}); adapter.commit();
  expect(document.paints).toHaveLength(0);
  clip=[0,0,1,1]; adapter.descriptor();
  expect(document.paints.filter(paint=>paint.op==='fill')).toHaveLength(1);
  expect(adapter.getLabels()[0]).toMatchObject({x:500,y:340,cropped:false});
});

test('camera changes move saved label adjustments and clip with the map, without opacity double transforms', async () => {
  const adapter=createProjectionSettlementNameAdapter({document:fakeCanvasDocument(),output:'left',rasterScale:2});
  let frame={matrix:[2,0,0,2,10,-15],clip:[0.2,0,0.8,1]};
  adapter.setFramingProvider(()=>frame);
  const settings=initializedSettingsFixture(); settings.outputs.left['0067']={x:537,y:321};
  await adapter.prepare({catalog:catalogFixture(),settings}); adapter.commit();
  expect(adapter.getLabels()[0]).toMatchObject({x:1084,y:627});
  expect(adapter.descriptor().clip).toEqual(frame.clip);
  adapter.setVisible(false); adapter.applyScaledOpacity(0.4);
  expect(adapter.getLabels()[0]).toMatchObject({x:1084,y:627});
  expect(adapter.descriptor().opacity).toBe(0);
  frame={matrix:[1,0,0,1,-300,20],clip:[0,0,1,1]};
  adapter.descriptor();
  expect(adapter.getLabels()[0]).toMatchObject({x:237,y:341});
  expect(adapter.descriptor().opacity).toBe(0);
});

test('a camera or opacity repaint cannot cancel a saved position waiting for fonts', async () => {
  const document=fakeCanvasDocument(), adapter=createProjectionSettlementNameAdapter({document,output:'left'});
  let frame={matrix:[1,0,0,1,0,0],clip:[0,0,1,1]};
  adapter.setFramingProvider(()=>frame);
  const settings=initializedSettingsFixture();
  await adapter.prepare({catalog:catalogFixture(),settings}); adapter.commit();
  let finishFont; document.fonts.load=()=>new Promise(resolve=>{finishFont=resolve;});
  settings.outputs.left['0067']={x:600,y:340};
  const pending=adapter.prepare({catalog:catalogFixture(),settings});
  frame={matrix:[1,0,0,1,100,0],clip:[0,0,1,1]};
  adapter.descriptor(); adapter.applyScaledOpacity(0.5);
  finishFont();
  expect(await pending).not.toMatchObject({stale:true});
  adapter.commit();
  expect(adapter.getLabels()[0]).toMatchObject({x:700,y:340});
});

test('4K settlement names retain logical ink bounds and placements', async () => {
  const labDoc = fakeCanvasDocument(), exhibitDoc = fakeCanvasDocument();
  const lab = createProjectionSettlementNameAdapter({ document: labDoc, output: 'left' });
  const exhibit = createProjectionSettlementNameAdapter({ document: exhibitDoc, output: 'left', rasterScale: 2 });
  for (const adapter of [lab, exhibit]) { await adapter.prepare({ catalog: catalogFixture(), settings: initializedSettingsFixture() }); adapter.commit(); }
  expect(exhibit.descriptor().source.width).toBe(3840);
  expect(exhibit.descriptor().source.height).toBe(2160);
  expect(exhibitDoc.paints.map(({ canvasWidth, ...paint }) => paint)).toEqual(labDoc.paints.map(({ canvasWidth, ...paint }) => paint));
});

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
  const lines = [];
  const images = [];
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
            rotate(radians) { context.lastRotate = radians; },
            beginPath() { context.path = []; },
            moveTo(x, y) { context.path.push({x,y}); },
            lineTo(x, y) { context.path.push({x,y}); },
            stroke() { lines.push({ points: context.path, width: context.lineWidth, color: context.strokeStyle, opacity: context.globalAlpha }); },
            drawImage(source, ...bounds) { images.push({ source, bounds, opacity: context.globalAlpha, rotate: context.lastRotate }); },
            fillText(text, x, y) {
              canvas.text = text;
              paints.push({ op: "fill", text, x, y, lineWidth: context.lineWidth, canvasWidth: canvas.width, globalAlpha: context.globalAlpha, rotate: context.lastRotate });
            },
            strokeText(text, x, y) {
              paints.push({ op: "stroke", text, x, y, lineWidth: context.lineWidth, canvasWidth: canvas.width, globalAlpha: context.globalAlpha, rotate: context.lastRotate });
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
  document.lines = lines;
  document.images = images;
  return document;
}

test('applies settlement fade once to the combined text and halo', async () => {
  const document = fakeCanvasDocument();
  const adapter = createProjectionSettlementNameAdapter({ document, output: 'left' });
  await adapter.prepare({ catalog: { entries: [catalogFixture().entries[0]] }, settings: initializedSettingsFixture() });
  adapter.commit();
  const initialPaints = document.paints.length;
  adapter.applyScaledOpacity(0.08);
  expect(document.images).toHaveLength(1);
  expect(document.images[0].opacity).toBe(0.08);
  expect(document.paints.slice(initialPaints).map(paint => paint.globalAlpha)).toEqual([1, 1]);
  expect(document.images[0].rotate).toBeCloseTo(35 * Math.PI / 180);
});

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

test("applies shared rotation on the canvas and per-cityname lifecycle opacity", async () => {
  const document = fakeCanvasDocument();
  const adapter = createProjectionSettlementNameAdapter({ document, output: "left" });
  await adapter.prepare({ catalog: catalogFixture(), settings: initializedSettingsFixture() });
  adapter.commit();
  const fills = document.paints.filter((paint) => paint.op === "fill" && paint.canvasWidth === 1920);
  expect(fills.every((paint) => Number.isFinite(paint.rotate))).toBe(true);
  expect(fills[0].rotate).toBeCloseTo(35 * Math.PI / 180);
  adapter.applyScaledOpacity(["case", ["in", ["get", "cityname"], ["literal", ["נירים"]]], 1, 0.08]);
  const later = document.paints.filter((paint) => paint.op === "fill" && paint.canvasWidth === 1920);
  expect(later.filter((paint) => paint.text === "נירים").at(-1).globalAlpha).toBe(1);
  expect(document.images.filter(image => image.source.text === "מחוץ").at(-1).opacity).toBeCloseTo(0.08);
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

test("scaled opacity repaint keeps an explicit hidden descriptor", async () => {
  const adapter = createProjectionSettlementNameAdapter({ document: fakeCanvasDocument(), output: "left" });
  await adapter.prepare({ catalog: catalogFixture(), settings: initializedSettingsFixture() });
  adapter.commit();
  adapter.setVisible(false);
  adapter.applyScaledOpacity(0.5);
  expect(adapter.descriptor().opacity).toBe(0);
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
