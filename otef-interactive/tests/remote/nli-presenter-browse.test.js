import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { createPresenterBrowse } from "../../frontend/src/remote/nli-presenter-browse.js";

const snap = (boundaryKey = "scene1", keys = ["a", "b", "c"], appliedKey = "a") => ({
  boundaryKey, beats: keys.map((key) => ({ key })), appliedKey,
});

it("keeps browse position during applied updates and restores canceled drag", () => {
  const b = createPresenterBrowse();
  const s = snap();
  b.sync(s); b.browse("b"); b.begin(7); b.move("c"); b.cancel();
  expect(b.getState().browseKey).toBe("b");
  b.sync({ ...s, appliedKey: "c" });
  expect(b.getState()).toMatchObject({ mode: "browse", browseKey: "b" });
  b.follow({ ...s, appliedKey: "c" });
  expect(b.getState()).toMatchObject({ mode: "follow", browseKey: "c" });
});

it("ignores invalid keys and keeps returned state detached from internal gesture state", () => {
  const b = createPresenterBrowse();
  b.sync(snap());
  b.browse("b");
  expect(b.browse("missing").browseKey).toBe("b");
  b.begin(3);
  const exposed = b.getState();
  exposed.gesture.pointerId = 99;
  expect(b.getState().gesture.pointerId).toBe(3);
});

it("resets when scene, membership, window, or dataset changes the boundary key", () => {
  const b = createPresenterBrowse();
  for (const boundaryKey of ["scene1|membership1", "scene1|membership2", "scene1|window2", "scene1|dataset2"]) {
    b.sync(snap(`${boundaryKey}|before`));
    b.browse("c");
    b.begin(2);
    expect(b.sync(snap(boundaryKey, ["x", "y"], "x"))).toMatchObject({
      boundaryKey, mode: "follow", browseKey: "x", gesture: null,
    });
  }
});

it("preserves key identity across locale and orientation updates", () => {
  const b = createPresenterBrowse();
  b.sync({ ...snap(), locale: "he", orientation: "portrait" });
  b.browse("b");
  expect(b.sync({ ...snap("scene1", ["a", "b", "c"], "c"), locale: "en", orientation: "landscape" }))
    .toMatchObject({ mode: "browse", browseKey: "b" });
});

it("cancels a follow-mode drag back to follow and checks pointer IDs on end", () => {
  const b = createPresenterBrowse();
  b.sync(snap());
  b.begin(7); b.move("b"); b.end(8);
  expect(b.getState().gesture.pointerId).toBe(7);
  b.cancel();
  expect(b.getState()).toMatchObject({ mode: "follow", browseKey: "a", gesture: null });
});

it("handles empty and single-row snapshots", () => {
  const b = createPresenterBrowse();
  expect(b.sync(snap("empty", [], null))).toMatchObject({ mode: "follow", browseKey: null });
  expect(b.browse("missing").browseKey).toBeNull();
  expect(b.sync(snap("one", ["only"], null)).browseKey).toBe("only");
  b.begin(1); b.move("only"); b.end(1);
  expect(b.getState()).toMatchObject({ mode: "browse", browseKey: "only", gesture: null });
});

it("keeps browsing isolated from clock, context, host, and transport modules", () => {
  const source = readFileSync(new URL("../../frontend/src/remote/nli-presenter-browse.js", import.meta.url), "utf8");
  expect(source).not.toMatch(/(?:clock|context|transport|host)/i);
});
