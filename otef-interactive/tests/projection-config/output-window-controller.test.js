import { expect, test, vi } from "vitest";
import { createOutputWindowController, FULLSCREEN_TIMEOUT_MS } from "../../frontend/src/projection-config/output-window-controller.js";

const displays = [
  { label: "Projector right", left: 900, top: -1080, width: 1920, height: 1080, availLeft: 900, availTop: -1080, availWidth: 1920, availHeight: 1040 },
  { label: "Projector left", left: -1020, top: -1080, width: 1920, height: 1080, availLeft: -1020, availTop: -1080, availWidth: 1920, availHeight: 1040 },
];

function storageStub(initial = null) {
  let value = initial;
  return {
    getItem: vi.fn(() => value),
    setItem: vi.fn((_key, next) => { value = next; }),
  };
}

function screenApi(screens = displays) {
  return {
    permissions: { query: vi.fn(async ({ name }) => { expect(name).toBe("window-management"); return { state: "granted" }; }) },
    getScreenDetails: vi.fn(async () => ({ screens })),
  };
}

function deferred() {
  let resolve;
  const promise = new Promise((next) => { resolve = next; });
  return { promise, resolve };
}

function popupFor(url, { autoLoad = true, fullscreen = "success", details = displays, swapDocument = false, registrationError = "" } = {}) {
  const listeners = new Map();
  const addListener = (key, handler) => { if (!listeners.has(key)) listeners.set(key, new Set()); listeners.get(key).add(handler); };
  const removeListener = (key, handler) => { const handlers = listeners.get(key); if (!handlers) return; handlers.delete(handler); if (!handlers.size) listeners.delete(key); };
  const dispatchListeners = (key) => { for (const handler of listeners.get(key) || []) handler(); };
  const documentElement = { requestFullscreen: vi.fn(async () => {
    if (fullscreen === "reject") throw new Error("fullscreen denied");
    if (fullscreen === "missing") return;
  }) };
  let document = {
    documentElement,
    fullscreenElement: null,
    addEventListener: vi.fn((type, handler) => {
      if (registrationError === type) throw new Error(`cannot register ${type}`);
      addListener(type, handler);
    }),
    removeEventListener: vi.fn((type, handler) => { removeListener(type, handler); }),
  };
  const win = {
    closed: false,
    location: { href: "about:blank" },
    document,
    getScreenDetails: vi.fn(async () => ({ screens: details })),
    addEventListener: vi.fn((type, handler) => { addListener(`window:${type}`, handler); if (type === "load" && autoLoad) queueMicrotask(() => { win.location.href = url; document = { ...document, URL: url, readyState: "complete", fullscreenElement: null }; win.document = document; handler(); }); }),
    removeEventListener: vi.fn((type, handler) => { removeListener(`window:${type}`, handler); }),
    close: vi.fn(() => { win.closed = true; }),
    replaceDocument(next) { document = next; win.document = next; },
    dispatch(type) {
      dispatchListeners(`window:${type}`);
    },
    dispatchFullscreen(type = "fullscreenchange", active = true) {
      if (type === "fullscreenchange") document.fullscreenElement = active ? document.documentElement : null;
      dispatchListeners(type);
    },
  };
  documentElement.requestFullscreen.mockImplementation(async () => {
    if (fullscreen === "reject") throw new Error("fullscreen denied");
    if (fullscreen === "error") { queueMicrotask(() => win.dispatchFullscreen("fullscreenerror")); return; }
    if (fullscreen === "missing" || fullscreen === "pending") return;
    queueMicrotask(() => win.dispatchFullscreen());
  });
  if (fullscreen === "missing-api") delete documentElement.requestFullscreen;
  return win;
}

function outputOpen(controller, opened, options = {}) {
  const open = vi.fn((url, name, features) => {
    const win = popupFor(url, options);
    opened.push({ url, name, features, win });
    return win;
  });
  return open;
}

test("opens explicit browser URLs on selected display bounds and owns only this session", async () => {
  const opened = [];
  const open = outputOpen(null, opened);
  const api = screenApi();
  const controller = createOutputWindowController({ open, screenApi: api, storage: storageStub(), sessionId: "session-a", location: "http://localhost:80/otef-interactive/projection.html" });
  const screens = await controller.identifyDisplays();
  controller.assignDisplays({ left: screens[1].key, right: screens[0].key });

  await controller.openBoth();

  expect(opened).toHaveLength(2);
  expect(opened[0].url).toContain("span=left");
  expect(opened[0].url).toContain("outputMode=browser");
  expect(opened[0].name).toBe("otef-projector-left-session-a-1");
  expect(opened[0].features).toContain("left=-1020");
  expect(opened[1].features).toContain("left=900");
  expect(controller.getOwnedWindows().size).toBe(2);

  await controller.openBoth();
  expect(opened[0].win.close).toHaveBeenCalledTimes(1);
  expect(opened[1].win.close).toHaveBeenCalledTimes(1);
  expect(opened[2].name).not.toBe(opened[0].name);
  controller.closeBoth();
  expect(opened[2].win.close).toHaveBeenCalledTimes(1);
  expect(opened[3].win.close).toHaveBeenCalledTimes(1);
});

test("rejects a blocked screen permission before opening any popup", async () => {
  const open = vi.fn();
  const screenApi = { permissions: { query: vi.fn(async () => ({ state: "denied" })) }, getScreenDetails: vi.fn() };
  const controller = createOutputWindowController({ open, screenApi, storage: storageStub() });

  await expect(controller.identifyDisplays()).rejects.toThrow(/window-management permission/i);
  await expect(controller.openBoth()).rejects.toThrow(/window-management permission/i);
  expect(open).not.toHaveBeenCalled();
});

test("cleans up a partial popup attempt and closes only owned windows", async () => {
  const opened = [];
  const open = vi.fn((url, name) => {
    if (name.includes("right")) throw new Error("popup blocked");
    const win = { closed: false, close: vi.fn(() => { win.closed = true; }) };
    opened.push(win); return win;
  });
  const controller = createOutputWindowController({ open, screenApi: screenApi(), storage: storageStub() });
  const screens = await controller.identifyDisplays();
  controller.assignDisplays({ left: screens[0].key, right: screens[1].key });

  await expect(controller.openBoth()).rejects.toThrow(/popup blocked/i);
  expect(opened[0].close).toHaveBeenCalledTimes(1);
  expect(controller.getOwnedWindows()).toEqual(new Map());
});

test("requires explicit reassignment when saved labels or bounds are ambiguous or changed", async () => {
  const storage = storageStub(JSON.stringify({
    left: { label: "Projector left", bounds: { left: -1020, top: -1080, width: 1920, height: 1080 } },
    right: { label: "Projector right", bounds: { left: 900, top: -1080, width: 1920, height: 1080 } },
  }));
  const duplicate = { ...displays[0] };
  const controller = createOutputWindowController({ open: vi.fn(), screenApi: screenApi([displays[0], duplicate, displays[1]]), storage });
  await controller.identifyDisplays();
  await expect(controller.openBoth()).rejects.toThrow(/ambiguous|reassign/i);

  const changed = { ...displays[0], left: 901 };
  const reconfigured = createOutputWindowController({ open: vi.fn(), screenApi: screenApi([changed, displays[1]]), storage });
  await reconfigured.identifyDisplays();
  await expect(reconfigured.openBoth()).rejects.toThrow(/reconfigured|reassign/i);
});

test("requests automatic fullscreen on each loaded child and waits for completion", async () => {
  const opened = [];
  const open = outputOpen(null, opened, { swapDocument: true });
  const controller = createOutputWindowController({ open, screenApi: screenApi(), storage: storageStub(), sessionId: "fullscreen" });
  const screens = await controller.identifyDisplays();
  controller.assignDisplays({ left: screens[0].key, right: screens[1].key });
  await controller.openBoth();

  expect(opened[0].win.document.documentElement.requestFullscreen).toHaveBeenCalledWith({ screen: displays[0] });
  expect(opened[1].win.document.documentElement.requestFullscreen).toHaveBeenCalledWith({ screen: displays[1] });
  expect(controller.getState().message).toMatch(/fullscreen/i);
});

test("waits for the replacement document when the destination URL appears before document swap", async () => {
  const opened = [];
  const initialDocuments = [];
  const replacementDocuments = [];
  const open = vi.fn((url) => {
    const win = popupFor(url, { autoLoad: false });
    const initialDocument = win.document;
    const replacementElement = { requestFullscreen: vi.fn(async () => {
      queueMicrotask(() => win.dispatchFullscreen());
    }) };
    const replacementDocument = {
      ...initialDocument,
      URL: url,
      readyState: "complete",
      documentElement: replacementElement,
      fullscreenElement: null,
    };
    initialDocuments.push(initialDocument);
    replacementDocuments.push(replacementDocument);
    const addEventListener = win.addEventListener;
    win.addEventListener = vi.fn((type, handler) => {
      addEventListener(type, handler);
      if (type !== "load") return;
      win.location.href = url;
      queueMicrotask(() => queueMicrotask(() => {
        win.replaceDocument(replacementDocument);
        win.dispatch("load");
      }));
    });
    opened.push(win);
    return win;
  });
  const controller = createOutputWindowController({ open, screenApi: screenApi(), storage: storageStub() });
  const screens = await controller.identifyDisplays();
  controller.assignDisplays({ left: screens[0].key, right: screens[1].key });

  await controller.openBoth();

  expect(initialDocuments[0].documentElement.requestFullscreen).not.toHaveBeenCalled();
  expect(initialDocuments[1].documentElement.requestFullscreen).not.toHaveBeenCalled();
  expect(replacementDocuments[0].documentElement.requestFullscreen).toHaveBeenCalledWith({ screen: displays[0] });
  expect(replacementDocuments[1].documentElement.requestFullscreen).toHaveBeenCalledWith({ screen: displays[1] });
});

test("reports listener registration failures through fullscreen readiness", async () => {
  vi.useFakeTimers();
  try {
    const opened = [];
    const open = outputOpen(null, opened, { registrationError: "fullscreenerror" });
    const controller = createOutputWindowController({ open, screenApi: screenApi(), storage: storageStub() });
    const screens = await controller.identifyDisplays();
    controller.assignDisplays({ left: screens[0].key, right: screens[1].key });
    const pending = controller.openBoth();
    pending.catch(() => {});

    await vi.advanceTimersByTimeAsync(0);
    await expect(pending).rejects.toThrow(/cannot register fullscreenerror/i);
    expect(opened[0].win.close).toHaveBeenCalled();
    expect(opened[1].win.close).toHaveBeenCalled();
  } finally {
    vi.useRealTimers();
  }
});

test("does not fullscreen the initial about:blank document before projection load", async () => {
  const opened = [];
  const open = outputOpen(null, opened, { autoLoad: false });
  const controller = createOutputWindowController({ open, screenApi: screenApi(), storage: storageStub() });
  const screens = await controller.identifyDisplays();
  controller.assignDisplays({ left: screens[0].key, right: screens[1].key });
  const pending = controller.openBoth();
  await vi.waitFor(() => expect(opened).toHaveLength(2));
  expect(opened[0].win.document.documentElement.requestFullscreen).not.toHaveBeenCalled();
  expect(opened[1].win.document.documentElement.requestFullscreen).not.toHaveBeenCalled();
  controller.closeBoth();
  await expect(pending).rejects.toThrow(/cancelled|closed/i);
});

test.each([
  ["request rejection", { fullscreen: "reject" }, /fullscreen denied/i],
  ["fullscreen error", { fullscreen: "error" }, /fullscreen/i],
  ["missing fullscreen API", { fullscreen: "missing-api" }, /fullscreen API unavailable/i],
  ["missing exact child screen", { details: [displays[0]] }, /right.*screen|display/i],
])("closes both windows when automatic fullscreen fails: %s", async (_label, options, error) => {
  const opened = [];
  const open = outputOpen(null, opened, options);
  const controller = createOutputWindowController({ open, screenApi: screenApi(), storage: storageStub() });
  const screens = await controller.identifyDisplays();
  controller.assignDisplays({ left: screens[0].key, right: screens[1].key });
  await expect(controller.openBoth()).rejects.toThrow(error);
  expect(opened).toHaveLength(2);
  expect(opened[0].win.close).toHaveBeenCalled();
  expect(opened[1].win.close).toHaveBeenCalled();
  expect(controller.getOwnedWindows().size).toBe(0);
});

test("times out an unconfirmed fullscreen launch and closes the attempt pair", async () => {
  vi.useFakeTimers();
  try {
    const opened = [];
    const open = outputOpen(null, opened, { fullscreen: "pending" });
    const controller = createOutputWindowController({ open, screenApi: screenApi(), storage: storageStub() });
    const screens = await controller.identifyDisplays();
    controller.assignDisplays({ left: screens[0].key, right: screens[1].key });
    const pending = controller.openBoth();
    pending.catch(() => {});
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(FULLSCREEN_TIMEOUT_MS);
    await expect(pending).rejects.toThrow(/timed out/i);
    expect(opened[0].win.close).toHaveBeenCalled();
    expect(opened[1].win.close).toHaveBeenCalled();
  } finally {
    vi.useRealTimers();
  }
});

test("reports a later fullscreen exit after a successful launch", async () => {
  const opened = [];
  const open = outputOpen(null, opened);
  const controller = createOutputWindowController({ open, screenApi: screenApi(), storage: storageStub() });
  const screens = await controller.identifyDisplays();
  controller.assignDisplays({ left: screens[0].key, right: screens[1].key });
  await controller.openBoth();
  opened[0].win.document.fullscreenElement = null;
  opened[0].win.dispatchFullscreen("fullscreenchange", false);
  expect(controller.getState().message).toMatch(/left.*exited|exited.*left/i);
});

test("reports the remaining active output when one fullscreen output exits", async () => {
  const opened = [];
  const open = outputOpen(null, opened);
  const controller = createOutputWindowController({ open, screenApi: screenApi(), storage: storageStub() });
  const screens = await controller.identifyDisplays();
  controller.assignDisplays({ left: screens[0].key, right: screens[1].key });
  await controller.openBoth();

  opened[0].win.dispatchFullscreen("fullscreenchange", false);

  expect(controller.getState().message).toMatch(/left.*exited/i);
  expect(controller.getState().message).toMatch(/right.*active/i);
});

test("close and reopen removes obsolete fullscreen callbacks", async () => {
  const opened = [];
  const open = vi.fn((url) => {
    const win = popupFor(url, { fullscreen: "pending" });
    opened.push({ url, win });
    return win;
  });
  const controller = createOutputWindowController({ open, screenApi: screenApi(), storage: storageStub() });
  const screens = await controller.identifyDisplays();
  controller.assignDisplays({ left: screens[0].key, right: screens[1].key });

  const first = controller.openBoth();
  await vi.waitFor(() => expect(opened).toHaveLength(2));
  const oldWindows = opened.map(({ win }) => win);
  await vi.waitFor(() => expect(oldWindows[0].document.addEventListener).toHaveBeenCalledWith("fullscreenchange", expect.any(Function)));
  const oldDocument = oldWindows[0].document;
  controller.closeBoth();
  await expect(first).rejects.toThrow(/cancelled|closed/i);

  open.mockImplementation((url) => {
    const win = popupFor(url);
    opened.push({ url, win });
    return win;
  });
  await controller.openBoth();
  const activeMessage = controller.getState().message;
  oldWindows[0].location.href = opened[0].url;
  oldWindows[0].dispatch("load");
  oldWindows[0].dispatchFullscreen("fullscreenchange", false);
  expect(controller.getState().message).toBe(activeMessage);
  expect(oldDocument.removeEventListener).toHaveBeenCalledWith("fullscreenchange", expect.any(Function));
  expect(oldWindows[0].removeEventListener).toHaveBeenCalledWith("load", expect.any(Function));
});

test("Close Both invalidates a pending Open Both before it can create windows", async () => {
  const gate = deferred();
  const api = screenApi();
  const originalGet = api.getScreenDetails;
  const open = vi.fn((url) => popupFor(url, { autoLoad: false }));
  const controller = createOutputWindowController({ open, screenApi: api, storage: storageStub() });
  const screens = await controller.identifyDisplays();
  controller.assignDisplays({ left: screens[0].key, right: screens[1].key });
  api.getScreenDetails = vi.fn(() => gate.promise);

  const pending = controller.openBoth();
  controller.closeBoth();
  gate.resolve(await originalGet());

  await expect(pending).rejects.toThrow(/cancelled|closed/i);
  expect(open).not.toHaveBeenCalled();
  expect(controller.getState().message).toMatch(/closed/i);
});

test("serializes overlapping Open Both clicks to one launch", async () => {
  const gate = deferred();
  const api = screenApi();
  const originalGet = api.getScreenDetails;
  const open = vi.fn((url) => popupFor(url));
  const controller = createOutputWindowController({ open, screenApi: api, storage: storageStub() });
  const screens = await controller.identifyDisplays();
  controller.assignDisplays({ left: screens[0].key, right: screens[1].key });
  api.getScreenDetails = vi.fn(() => gate.promise);

  const first = controller.openBoth();
  const second = controller.openBoth();
  expect(second).toBe(first);
  gate.resolve(await originalGet());
  await first;
  expect(open).toHaveBeenCalledTimes(2);
});

test("reports existing owned windows when validation fails", async () => {
  const api = screenApi();
  const open = vi.fn((url) => popupFor(url));
  const controller = createOutputWindowController({ open, screenApi: api, storage: storageStub() });
  const screens = await controller.identifyDisplays();
  controller.assignDisplays({ left: screens[0].key, right: screens[1].key });
  await controller.openBoth();
  api.getScreenDetails = vi.fn(async () => ({ screens: [{ ...displays[0], left: 901 }, displays[1]] }));

  await expect(controller.openBoth()).rejects.toThrow(/reconfigured|reassign/i);
  expect(controller.getOwnedWindows().size).toBe(2);
  expect(controller.getState().message).toMatch(/remain open|manually/i);
});

test("retains a window reference and gives manual-close instructions when close throws", async () => {
  const opened = [];
  const open = vi.fn((url) => {
    const failing = popupFor(url);
    failing.close = vi.fn(() => { throw new Error("close denied"); });
    opened.push(failing);
    return failing;
  });
  const controller = createOutputWindowController({ open, screenApi: screenApi(), storage: storageStub() });
  const screens = await controller.identifyDisplays();
  controller.assignDisplays({ left: screens[0].key, right: screens[1].key });
  await controller.openBoth();

  controller.closeBoth();
  expect(controller.getOwnedWindows().size).toBe(2);
  expect(opened[0].close).toHaveBeenCalled();
  expect(controller.getState().message).toMatch(/manually close/i);
});

test("reports session-only assignment when local storage cannot persist", async () => {
  const storage = { getItem: vi.fn(() => null), setItem: vi.fn(() => { throw new Error("storage denied"); }) };
  const controller = createOutputWindowController({ open: vi.fn(), screenApi: screenApi(), storage });
  const screens = await controller.identifyDisplays();
  controller.assignDisplays({ left: screens[0].key, right: screens[1].key });

  expect(controller.getState().message).toMatch(/session-only|storage/i);
});

test("allows empty display labels when bounds make explicit selections distinct", async () => {
  const unlabeled = displays.map((display) => ({ ...display, label: "" }));
  const controller = createOutputWindowController({ open: vi.fn((url) => popupFor(url, { details: unlabeled })), screenApi: screenApi(unlabeled), storage: storageStub() });
  const screens = await controller.identifyDisplays();
  controller.assignDisplays({ left: screens[0].key, right: screens[1].key });

  await controller.openBoth();
  expect(controller.getOwnedWindows().size).toBe(2);
});
