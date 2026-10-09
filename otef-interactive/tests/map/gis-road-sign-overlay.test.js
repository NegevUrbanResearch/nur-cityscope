import { expect, test } from "vitest";
import { createGisRoadSignOverlay } from "../../frontend/src/map/gis-road-sign-overlay.js";
import { createRoadSign } from "../../frontend/src/shared/road-sign-settings.js";
import { gisRoadSignCoordinate, projectGisRoadSigns } from "../../frontend/src/map/gis-road-sign-geography.js";

test("GIS paints only its signs, reacts to live settings and road visibility, and disposes", async () => {
  const calls = [], children = [], listeners = new Map();
  const context = new Proxy({}, { get: (_, name) => (...args) => calls.push([name, ...args]) });
  const doc = { createElement(tag) {
    if (tag === "canvas") return { style: {}, setAttribute() {}, getContext: () => context,
      remove() { children.splice(children.indexOf(this), 1); } };
    return { naturalWidth: 524, complete: true, decode: async () => {} };
  } };
  const container = { ownerDocument: doc, appendChild: node => children.push(node) };
  container.clientWidth = 1920; container.clientHeight = 1080;
  let offset = 0;
  const mapListeners = new Map();
  const map = { on: (event, callback) => mapListeners.set(event, callback), off: event => mapListeners.delete(event),
    project: ([lng, lat]) => ({ x: 960 + lng * 512 * 2 ** 10 / 360 + offset,
      y: 540 - Math.log(Math.tan(Math.PI / 4 + lat * Math.PI / 360)) * 512 * 2 ** 10 / (2 * Math.PI) }) };
  const sign = createRoadSign({ id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", x: 800, y: 400 });
  let settings = { version: 1, outputs: { left: [{ ...sign, id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", x: 50 }], right: [], gis: [sign] } };
  let groups = [{ id: "nli", layers: [{ id: "ציר_232", enabled: true }] }];
  const overlay = createGisRoadSignOverlay({ map, getHomeCamera: () => ({ center: [0, 0], zoom: 10 }), container, getGroups: () => groups,
    dataContext: { getRoadSigns: () => ({ settings }), subscribe(topic, listener) { listeners.set(topic, listener); return () => listeners.delete(topic); } } });
  await overlay.ready();
  expect(children).toHaveLength(1);
  expect(children[0].hidden).toBe(false);
  expect(children[0].style.pointerEvents).toBe("none");
  const translation = () => calls.filter(call => call[0] === "translate").at(-1).slice(1);
  expect(translation()[0]).toBeCloseTo(800);
  expect(translation()[1]).toBeCloseTo(400);
  expect(calls).not.toContainEqual(["translate", 50, 400]);
  const originalCoordinate = gisRoadSignCoordinate(sign, { center: [0, 0], zoom: 10 });
  offset = -1200;
  mapListeners.get("move")();
  expect(translation()[0]).toBeCloseTo(-400);
  expect(gisRoadSignCoordinate(sign, { center: [0, 0], zoom: 10 })).toEqual(originalCoordinate);
  offset = 0;
  settings = structuredClone(settings); settings.outputs.gis[0].x = 900;
  listeners.get("roadSigns")();
  expect(translation()[0]).toBeCloseTo(900);
  container.clientWidth = 960; container.clientHeight = 540;
  mapListeners.get("resize")();
  expect(translation()[0]).toBeCloseTo(1800);
  groups = [];
  overlay.sync();
  expect(children[0].hidden).toBe(true);
  groups = [{ id: "nli", layers: [{ id: "ציר_232", enabled: true }] }];
  settings.outputs.gis[0].visible = false;
  overlay.sync();
  expect(children[0].hidden).toBe(true);
  overlay.dispose();
  expect(children).toHaveLength(0);
  expect(listeners.size).toBe(0);
  expect(mapListeners.size).toBe(0);
});

test("Home placement resolves to a fixed geographic point and leader endpoint", () => {
  const home = { center: [34.5, 31.4], zoom: 10 };
  expect(gisRoadSignCoordinate({ x: 960, y: 540 }, home)[0]).toBeCloseTo(34.5);
  expect(gisRoadSignCoordinate({ x: 960, y: 540 }, home)[1]).toBeCloseTo(31.4);
  const northeast = gisRoadSignCoordinate({ x: 1200, y: 300 }, home);
  expect(northeast[0]).toBeGreaterThan(34.5);
  expect(northeast[1]).toBeGreaterThan(31.4);
  const sign = createRoadSign({ id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", x: 960, y: 540 });
  sign.leader = { enabled: true, x: 1200, y: 300 };
  const coordinates = [];
  projectGisRoadSigns([sign], { project(coordinate) { coordinates.push(coordinate); return { x: 10, y: 20 }; } }, home, 1920, 1080);
  expect(coordinates[0][0]).toBeCloseTo(34.5);
  expect(coordinates[1]).toEqual(northeast);
});
