import { expect, test, vi } from "vitest";
import { DEFAULT_PROJECTION_CONFIG } from "../../frontend/src/shared/projection-config-schema.js";
import { createActiveOutputPreview } from "../../frontend/src/projection-config/active-output-preview.js";

function element(width = 260, height = 0) {
  return {
    children: [], style: {}, classList: { add() {}, remove() {}, toggle() {} }, clientWidth: width, clientHeight: height, textContent: "",
    appendChild(child) { if (child.parentElement && child.parentElement !== this) child.parentElement.children = child.parentElement.children.filter((item) => item !== child); this.children.push(child); child.parentElement = this; return child; },
    replaceChildren(...children) { this.children = []; children.forEach((child) => this.appendChild(child)); },
    contains(child) { return this.children.includes(child) || this.children.some((item) => item.contains?.(child)); },
    remove() { if (this.parentElement) this.parentElement.children = this.parentElement.children.filter((child) => child !== this); },
    addEventListener(type, callback) { this.listeners ||= new Map(); this.listeners.set(type, callback); },
    setAttribute(key, value) { this.attributes ||= {}; this.attributes[key] = value; },
  };
}

test("one output frame receives latest local draft only after its trusted ready message", () => {
  const listeners = new Map();
  const win = { location: { origin: "http://localhost" }, addEventListener: (name, fn) => listeners.set(name, fn), removeEventListener: (name) => listeners.delete(name) };
  const frames = [];
  const document = { defaultView: win, createElement: (tag) => {
    const node = element();
    if (tag === "iframe") { node.contentWindow = { postMessage: vi.fn() }; frames.push(node); }
    return node;
  } };
  const hosts = new Map([["left", element()], ["right", element()]]);
  const preview = createActiveOutputPreview({ document, hosts, mobileHost: element(), mobileQuery: { matches: false, addEventListener() {}, removeEventListener() {} } });
  const draft = structuredClone(DEFAULT_PROJECTION_CONFIG);
  preview.update(draft);
  preview.show("left");
  expect(frames[0].src).toContain("span=left&preview=1&mapPixelRatio=1");
  expect(frames[0].contentWindow.postMessage).not.toHaveBeenCalled();
  const ready = { type: "otef_projection_preview_ready", output: "left" };
  listeners.get("message")({ source: {}, origin: "http://localhost", data: ready });
  listeners.get("message")({ source: frames[0].contentWindow, origin: "http://other", data: ready });
  expect(frames[0].contentWindow.postMessage).not.toHaveBeenCalled();
  listeners.get("message")({ source: frames[0].contentWindow, origin: "http://localhost", data: ready });
  expect(frames[0].contentWindow.postMessage).toHaveBeenCalledWith(expect.objectContaining({ type: "otef_projection_preview_config", output: "left", config: draft }), "http://localhost");
  draft.pre.tx = 0.02;
  preview.update(draft); // Local draft changes send even when the editor's Live switch is off.
  expect(frames[0].contentWindow.postMessage).toHaveBeenCalledTimes(2);
  preview.show("right");
  expect(frames).toHaveLength(2);
  expect(hosts.get("left").children).toHaveLength(0);
  preview.dispose();
  expect(listeners.has("message")).toBe(false);
});

test("orientation changes keep the selected warp node in the mobile host", () => {
  const listeners = new Map();
  const mediaListeners = new Map();
  const win = { location: { origin: "http://localhost" }, addEventListener: (name, fn) => listeners.set(name, fn), removeEventListener: (name) => listeners.delete(name) };
  const media = { matches: false, addEventListener: (name, fn) => mediaListeners.set(name, fn), removeEventListener: () => {} };
  const frames = [];
  const document = { defaultView: win, createElement: (tag) => { const node = element(); if (tag === "iframe") { node.contentWindow = { postMessage: vi.fn() }; frames.push(node); } return node; } };
  const mobileHost = element();
  const preview = createActiveOutputPreview({ document, nodeHosts: new Map([["pre", element()], ["left-output", element()]]), mobileHost, mobileQuery: media });
  preview.select("left-grid");
  media.matches = true; mediaListeners.get("change")?.({ matches: true });
  expect(mobileHost.children[0]).toBeTruthy();
  expect(mobileHost.children[0].children[0].className).toBe("active-preview-status");
  media.matches = false; mediaListeners.get("change")?.({ matches: false });
  preview.dispose();
  expect(listeners.has("message")).toBe(false);
});

test("warp selection reuses the output browser frame for its overlay and enlarged preview", () => {
  const listeners = new Map();
  const win = { location: { origin: "http://localhost" }, addEventListener: (name, fn) => listeners.set(name, fn), removeEventListener: (name) => listeners.delete(name) };
  const frames = [];
  const document = { defaultView: win, createElement: (tag) => { const node = element(); if (tag === "iframe") { node.contentWindow = { postMessage: vi.fn() }; frames.push(node); } return node; } };
  const hosts = new Map(["pre", "left-output"].map((id) => [id, element()]));
  const preview = createActiveOutputPreview({ document, nodeHosts: hosts, mobileHost: element(), mobileQuery: { matches: false, addEventListener() {}, removeEventListener() {} } });
  const home = element(); const overlay = element(); home.appendChild(overlay);
  preview.setWarpOverlay("left-grid", overlay);
  expect(frames[1].src).toContain("span=left");
  expect(frames[1].src).toContain("mapPixelRatio=1");
  expect(frames[1].src).toContain("outputMode=browser");
  expect(overlay.parentElement).toBeTruthy();
  preview.show("left-grid");
  expect(hosts.get("left-output").children[0].className).toBe("active-preview stage-preview");
  preview.setWarpOverlay(null, null);
  expect(overlay.parentElement).toBe(home);
  preview.dispose();
  expect(listeners.has("message")).toBe(false);
});

test("enlarged warp preview uses a top-level host and maps its padded image", () => {
  const listeners = new Map();
  const win = { location: { origin: "http://localhost" }, addEventListener: (name, fn) => listeners.set(name, fn), removeEventListener: (name) => listeners.delete(name) };
  const frames = [];
  const document = { defaultView: win, createElement: (tag) => { const node = element(); if (tag === "iframe") { node.contentWindow = { postMessage: vi.fn() }; frames.push(node); } return node; } };
  const hosts = new Map(["pre", "left-output"].map((id) => [id, element()]));
  const enlargedHost = element(900, 620); const editorHome = element(); const editor = element(); editorHome.appendChild(editor);
  const preview = createActiveOutputPreview({ document, nodeHosts: hosts, mobileHost: element(), enlargedHost, enlargedEditor: editor, mobileQuery: { matches: false, addEventListener() {}, removeEventListener() {} } });
  const overlay = element(); const home = element(); home.appendChild(overlay);
  preview.setWarpOverlay("left-grid", overlay, { x: -240, y: -90, width: 2400, height: 1260 });
  const surface = hosts.get("left-output").children[0];
  expect(frames[1].style.transform).toContain("translate(");
  expect(frames[1].style.width).toBe("1920px");
  expect(frames[1].style.height).toBe("1080px");
  expect(frames[1].style.transform).not.toContain("translate(0px, 0px)");
  preview.show("left-grid");
  expect(enlargedHost.hidden).toBe(false);
  expect(enlargedHost.children[0].textContent).toBe("Close enlarged preview");
  expect(enlargedHost.children).toContain(surface);
  expect(enlargedHost.children).toContain(editor);
  const paddedTransform = frames[1].style.transform;
  preview.setWarpOverlay(null, null);
  expect(enlargedHost.hidden).toBe(true);
  expect(overlay.parentElement).toBe(home);
  expect(editor.parentElement).toBe(editorHome);
  expect(frames[1].style.transform).not.toBe(paddedTransform);
  expect(frames[1].style.transform).toContain("scale(0.135");
  preview.dispose();
});

test("moving one overlay between output branches restores the old frame mapping", () => {
  const listeners = new Map();
  const win = { location: { origin: "http://localhost" }, addEventListener: (name, fn) => listeners.set(name, fn), removeEventListener: (name) => listeners.delete(name) };
  const frames = [];
  const document = { defaultView: win, createElement: (tag) => { const node = element(); if (tag === "iframe") { node.contentWindow = { postMessage: vi.fn() }; frames.push(node); } return node; } };
  const hosts = new Map(["left-output", "right-output"].map((id) => [id, element()]));
  const preview = createActiveOutputPreview({ document, nodeHosts: hosts, mobileHost: element(), mobileQuery: { matches: false, addEventListener() {}, removeEventListener() {} } });
  const overlay = element(); const home = element(); home.appendChild(overlay);
  preview.setWarpOverlay("left-grid", overlay, { x: -240, y: -90, width: 2400, height: 1260 });
  const leftFrame = frames[0];
  expect(leftFrame.style.transform).toContain("scale(0.108");
  preview.setWarpOverlay("right-grid", overlay, { x: -240, y: -90, width: 2400, height: 1260 });
  expect(leftFrame.style.transform).toContain("scale(0.135");
  expect(overlay.parentElement).toBe(hosts.get("right-output").children[0].children[1]);
  preview.dispose();
});

test("changing orientation closes the combined editor before moving its preview", () => {
  const listeners = new Map(); const mediaListeners = new Map();
  const win = { location: { origin: "http://localhost" }, addEventListener: (name, fn) => listeners.set(name, fn), removeEventListener: (name) => listeners.delete(name) };
  const media = { matches: false, addEventListener: (name, fn) => mediaListeners.set(name, fn), removeEventListener: () => {} };
  const document = { defaultView: win, createElement: (tag) => { const node = element(); if (tag === "iframe") node.contentWindow = { postMessage: vi.fn() }; return node; } };
  const hosts = new Map([["pre", element()], ["left-output", element()]]); const mobileHost = element(); const enlargedHost = element();
  const editorHome = element(); const editor = element(); editorHome.appendChild(editor);
  const preview = createActiveOutputPreview({ document, nodeHosts: hosts, mobileHost, enlargedHost, enlargedEditor: editor, mobileQuery: media });
  const overlay = element(); const home = element(); home.appendChild(overlay);
  preview.setWarpOverlay("left-grid", overlay, { x: 0, y: 0, width: 1920, height: 1080 });
  const surface = hosts.get("left-output").children[0];
  preview.select("left-grid"); preview.show("left-grid");
  media.matches = true; mediaListeners.get("change")?.({ matches: true });
  expect(enlargedHost.hidden).toBe(true);
  expect(editor.parentElement).toBe(editorHome);
  expect(mobileHost.children).toHaveLength(1);
  expect(mobileHost.children[0]).toBe(surface);
  preview.dispose();
});

test('only the final output frames can validate a matching complete wall pair', async () => {
  const listeners = new Map();
  const win = { location: { origin: 'http://localhost' }, addEventListener: (name, fn) => listeners.set(name, fn), removeEventListener() {} };
  const frames = [];
  const document = { defaultView: win, createElement: (tag) => { const node = element(); if (tag === 'iframe') { node.contentWindow = { postMessage: vi.fn() }; frames.push(node); } return node; } };
  const hosts = new Map(['content', 'left-output', 'right-output'].map((id) => [id, element()]));
  const preview = createActiveOutputPreview({ document, nodeHosts: hosts });
  const config = structuredClone(DEFAULT_PROJECTION_CONFIG);
  preview.update(config);
  for (const frame of frames) listeners.get('message')({ source: frame.contentWindow, origin: 'http://localhost', data: { type: 'otef_projection_preview_ready', output: frame.src.includes('span=right') ? 'right' : 'left' } });
  const validating = preview.validateCandidate({ config, generation: 7, identity: JSON.stringify(config) });
  const requests = frames.map((frame) => frame.contentWindow.postMessage.mock.calls.at(-1)?.[0]);
  expect(requests[0].type).toBe('otef_projection_preview_config');
  expect(requests.slice(1).map((item) => item.type)).toEqual(['otef_projection_preview_validate', 'otef_projection_preview_validate']);
  const wall = { datasetVersion: 'nli-1', mode: 'wall', digest: 'a'.repeat(64), expected: 1228, placed: 1228 };
  listeners.get('message')({ source: frames[1].contentWindow, origin: 'http://localhost', data: { type: 'otef_projection_preview_validated', output: 'left', requestId: requests[1].requestId, identity: requests[1].identity, valid: true, wall } });
  listeners.get('message')({ source: frames[2].contentWindow, origin: 'http://localhost', data: { type: 'otef_projection_preview_validated', output: 'right', requestId: requests[2].requestId, identity: requests[2].identity, valid: true, wall } });
  await expect(validating).resolves.toMatchObject({ valid: true, identity: JSON.stringify(config), wall });
  const reloading = preview.validateCandidate({ config, generation: 8, identity: JSON.stringify(config) });
  frames[1].listeners.get('load')();
  await expect(reloading).resolves.toMatchObject({ valid: false, reason: 'final output preview reloaded' });
  preview.dispose();
});

test('final preview readiness callback fires for each recovered ready pair', () => {
  const listeners = new Map();
  const win = { location: { origin: 'http://localhost' }, addEventListener: (name, fn) => listeners.set(name, fn), removeEventListener() {} };
  const frames = [];
  const document = { defaultView: win, createElement: (tag) => { const node = element(); if (tag === 'iframe') { node.contentWindow = { postMessage: vi.fn() }; frames.push(node); } return node; } };
  const preview = createActiveOutputPreview({ document, nodeHosts: new Map(['left-output', 'right-output'].map((id) => [id, element()])) });
  const ready = vi.fn();
  preview.onFinalOutputsReady(ready);
  const handshake = (frame) => listeners.get('message')({ source: frame.contentWindow, origin: 'http://localhost', data: {
    type: 'otef_projection_preview_ready', output: frame.src.includes('span=right') ? 'right' : 'left',
  } });
  handshake(frames[0]);
  expect(ready).not.toHaveBeenCalled();
  handshake(frames[1]);
  expect(ready).toHaveBeenCalledTimes(1);
  frames[0].listeners.get('load')();
  expect(ready).toHaveBeenCalledTimes(1);
  handshake(frames[0]);
  expect(ready).toHaveBeenCalledTimes(2);
  preview.dispose();
});

test('paired preview returns actual font and count diagnostics for valid and invalid candidates', async () => {
  const listeners = new Map();
  const win = { location: { origin: 'http://localhost' }, addEventListener: (name, fn) => listeners.set(name, fn), removeEventListener() {} };
  const frames = [];
  const document = { defaultView: win, createElement: (tag) => { const node = element(); if (tag === 'iframe') { node.contentWindow = { postMessage: vi.fn() }; frames.push(node); } return node; } };
  const preview = createActiveOutputPreview({ document, nodeHosts: new Map(['left-output', 'right-output'].map((id) => [id, element()])) });
  const config = structuredClone(DEFAULT_PROJECTION_CONFIG);
  preview.update(config);
  for (const frame of frames) listeners.get('message')({ source: frame.contentWindow, origin: 'http://localhost', data: { type: 'otef_projection_preview_ready', output: frame.src.includes('span=right') ? 'right' : 'left' } });
  const answerPair = (valid, diagnostics, reason = undefined) => {
    const requestFrames = frames.slice(-2);
    const requests = requestFrames.map((frame) => frame.contentWindow.postMessage.mock.calls.at(-1)[0]);
    for (const [index, frame] of requestFrames.entries()) listeners.get('message')({
      source: frame.contentWindow, origin: 'http://localhost', data: {
        type: 'otef_projection_preview_validated', output: index ? 'right' : 'left',
        requestId: requests[index].requestId, identity: requests[index].identity, valid,
        diagnostics: { datasetVersion: 'nli-1', mode: 'wall', expected: 1228, ...diagnostics },
        ...(valid ? { wall: { datasetVersion: 'nli-1', mode: 'wall', digest: 'b'.repeat(64), expected: 1228, placed: 1228 } } : {}),
        ...(reason ? { error: reason } : {}),
      },
    });
  };
  const identity = JSON.stringify(config);
  const reduced = preview.validateCandidate({ config, generation: 1, identity });
  const reducedDiagnostics = { requestedFontPx: 12, effectiveFontPx: 9, placed: 1228, state: 'valid', left: 614, right: 614 };
  answerPair(true, reducedDiagnostics);
  await expect(reduced).resolves.toMatchObject({ valid: true, diagnostics: { ...reducedDiagnostics, datasetVersion: 'nli-1', mode: 'wall', expected: 1228 } });

  config.namesWall.profiles.wall.edgeInsetPx = 4;
  const invalidIdentity = JSON.stringify(config);
  const invalid = preview.validateCandidate({ config, generation: 2, identity: invalidIdentity });
  const invalidDiagnostics = { requestedFontPx: 12, effectiveFontPx: null, placed: 801, state: 'invalid', reason: 'capacity through 1px', left: 400, right: 401 };
  answerPair(false, invalidDiagnostics, 'capacity through 1px');
  await expect(invalid).resolves.toMatchObject({ valid: false, diagnostics: { ...invalidDiagnostics, datasetVersion: 'nli-1', mode: 'wall', expected: 1228 } });
  preview.dispose();
});

test('stale paired-preview replies cannot validate a newer profile draft', async () => {
  const listeners = new Map();
  const win = { location: { origin: 'http://localhost' }, addEventListener: (name, fn) => listeners.set(name, fn), removeEventListener() {} };
  const frames = [];
  const document = { defaultView: win, createElement: (tag) => { const node = element(); if (tag === 'iframe') { node.contentWindow = { postMessage: vi.fn() }; frames.push(node); } return node; } };
  const preview = createActiveOutputPreview({ document, nodeHosts: new Map(['left-output', 'right-output'].map((id) => [id, element()])) });
  const configA = structuredClone(DEFAULT_PROJECTION_CONFIG);
  preview.update(configA);
  for (const frame of frames) listeners.get('message')({ source: frame.contentWindow, origin: 'http://localhost', data: { type: 'otef_projection_preview_ready', output: frame.src.includes('span=right') ? 'right' : 'left' } });
  const identityA = JSON.stringify(configA);
  const pendingA = preview.validateCandidate({ config: configA, generation: 1, identity: identityA });
  const requestsA = frames.slice(-2).map((frame) => frame.contentWindow.postMessage.mock.calls.at(-1)[0]);
  const configB = structuredClone(configA); configB.namesWall.activeMode = 'model';
  const identityB = JSON.stringify(configB);
  const pendingB = preview.validateCandidate({ config: configB, generation: 2, identity: identityB });
  await expect(pendingA).resolves.toMatchObject({ valid: false, reason: 'superseded wall preview' });
  const requestsB = frames.slice(-2).map((frame) => frame.contentWindow.postMessage.mock.calls.at(-1)[0]);
  const late = { datasetVersion: 'nli-1', mode: 'wall', digest: 'c'.repeat(64), expected: 1228, placed: 1228 };
  for (const [index, frame] of frames.slice(-2).entries()) listeners.get('message')({ source: frame.contentWindow, origin: 'http://localhost', data: {
    type: 'otef_projection_preview_validated', output: index ? 'right' : 'left', requestId: requestsA[index].requestId,
    identity: identityA, valid: true, wall: late,
  } });
  const modelWall = { ...late, mode: 'model', digest: 'd'.repeat(64) };
  for (const [index, frame] of frames.slice(-2).entries()) listeners.get('message')({ source: frame.contentWindow, origin: 'http://localhost', data: {
    type: 'otef_projection_preview_validated', output: index ? 'right' : 'left', requestId: requestsB[index].requestId,
    identity: identityB, valid: true, wall: modelWall,
  } });
  await expect(pendingB).resolves.toMatchObject({ valid: true, identity: identityB, wall: modelWall });
  preview.dispose();
});
