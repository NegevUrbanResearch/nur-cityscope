import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { createElement, installDom } from "./remote-navigation-fixtures.js";

describe("remote People and archive controller", () => {
  beforeEach(() => {
    vi.resetModules();
    installDom();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  test("acknowledged people selection keeps the name, closes suggestions, and does not reopen them from focus", async () => {
    const { initRemotePlaceNavigation } = await import(
      "../../frontend/src/remote/remote-place-navigation.js"
    );
    const modeButton = createElement("peopleMode");
    modeButton.dataset = { searchMode: "people" };
    const root = document.getElementById("placeSearchGroup");
    const originalQuerySelectorAll = root.querySelectorAll;
    root.querySelectorAll = (selector) => selector === "[data-search-mode]"
      ? [modeButton]
      : originalQuerySelectorAll(selector);
    const person = {
      pid: "11",
      name: "Ada",
      location: "Alumim",
      hasArchiveRecord: true,
      datasetVersion: "v1",
    };
    const peopleRuntime = {
      load: vi.fn().mockResolvedValue(undefined),
      search: vi.fn(() => [person]),
      resolve: vi.fn(() => person),
    };
    const dataContext = {
      selectPerson: vi.fn().mockResolvedValue({
        person_selection: { personId: "11", datasetVersion: "v1", revision: 1 },
      }),
    };
    initRemotePlaceNavigation({ dataContext, peopleRuntime, isConnected: () => true });

    const input = document.getElementById("placeSearchInput");
    input.focus = vi.fn(() => input.dispatchEvent({ type: "focus" }));
    modeButton.dispatchEvent({ type: "click" });
    input.value = "Ada";
    input.dispatchEvent({ type: "input" });
    for (let i = 0; i < 4; i += 1) await Promise.resolve();
    expect(peopleRuntime.search).toHaveBeenCalled();
    expect(document.getElementById("placeSuggestions").children).toHaveLength(1);

    document.getElementById("placeSuggestions").children[0].dispatchEvent({ type: "click" });
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    const archiveButton = root.children.find((child) => child.className === "place-search-archive-button");
    expect(dataContext.selectPerson).toHaveBeenCalledWith("11", "v1");
    expect(input.value).toBe("Ada");
    expect(document.getElementById("placeSuggestions").children).toHaveLength(0);
    expect(input.getAttribute("aria-expanded")).toBe("false");
    expect(archiveButton.hidden).toBe(false);
  });

  test("a real focus event after acknowledged people selection does not reopen suggestions", async () => {
    const { initRemotePlaceNavigation } = await import(
      "../../frontend/src/remote/remote-place-navigation.js"
    );
    const modeButton = createElement("peopleMode");
    modeButton.dataset = { searchMode: "people" };
    const root = document.getElementById("placeSearchGroup");
    const originalQuerySelectorAll = root.querySelectorAll;
    root.querySelectorAll = (selector) => selector === "[data-search-mode]"
      ? [modeButton]
      : originalQuerySelectorAll(selector);
    const person = { pid: "11", name: "Ada", location: "Alumim", hasArchiveRecord: true, datasetVersion: "v1" };
    const peopleRuntime = {
      load: vi.fn().mockResolvedValue(undefined),
      search: vi.fn(() => [person]),
      resolve: vi.fn(() => person),
    };
    const dataContext = {
      selectPerson: vi.fn().mockResolvedValue({
        person_selection: { personId: "11", datasetVersion: "v1", revision: 1 },
      }),
    };
    initRemotePlaceNavigation({ dataContext, peopleRuntime, isConnected: () => true });

    const input = document.getElementById("placeSearchInput");
    modeButton.dispatchEvent({ type: "click" });
    input.value = "Ada";
    input.dispatchEvent({ type: "input" });
    for (let i = 0; i < 4; i += 1) await Promise.resolve();
    document.getElementById("placeSuggestions").children[0].dispatchEvent({ type: "click" });
    for (let i = 0; i < 4; i += 1) await Promise.resolve();

    peopleRuntime.search.mockClear();
    input.dispatchEvent({ type: "focus" });
    for (let i = 0; i < 4; i += 1) await Promise.resolve();

    expect(peopleRuntime.search).not.toHaveBeenCalled();
    expect(document.getElementById("placeSuggestions").children).toHaveLength(0);
    expect(input.getAttribute("aria-expanded")).toBe("false");
  });

  test("clearing an acknowledged people selection keeps its name without reopening suggestions", async () => {
    const { initRemotePlaceNavigation } = await import(
      "../../frontend/src/remote/remote-place-navigation.js"
    );
    const modeButton = createElement("peopleMode");
    modeButton.dataset = { searchMode: "people" };
    const root = document.getElementById("placeSearchGroup");
    const originalQuerySelectorAll = root.querySelectorAll;
    root.querySelectorAll = (selector) => selector === "[data-search-mode]"
      ? [modeButton]
      : originalQuerySelectorAll(selector);
    const person = { pid: "11", name: "Ada", location: "Alumim", hasArchiveRecord: true, datasetVersion: "v1" };
    const peopleRuntime = {
      load: vi.fn().mockResolvedValue(undefined),
      search: vi.fn(() => [person]),
      resolve: vi.fn(() => person),
    };
    const dataContext = {
      selectPerson: vi.fn().mockResolvedValue({
        person_selection: { personId: "11", datasetVersion: "v1", revision: 1 },
      }),
    };
    initRemotePlaceNavigation({ dataContext, peopleRuntime, isConnected: () => true });

    const input = document.getElementById("placeSearchInput");
    modeButton.dispatchEvent({ type: "click" });
    input.value = "Ada";
    input.dispatchEvent({ type: "input" });
    for (let i = 0; i < 4; i += 1) await Promise.resolve();
    document.getElementById("placeSuggestions").children[0].dispatchEvent({ type: "click" });
    for (let i = 0; i < 4; i += 1) await Promise.resolve();

    input.focus = vi.fn(() => input.dispatchEvent({ type: "focus" }));
    document.getElementById("placeSearchClear").click();
    for (let i = 0; i < 4; i += 1) await Promise.resolve();

    expect(input.value).toBe("Ada");
    expect(document.getElementById("placeSuggestions").children).toHaveLength(0);
    expect(input.getAttribute("aria-expanded")).toBe("false");
  });

  test("subscription acknowledgement resolves the selected person and shows the archive action", async () => {
    const { initRemotePlaceNavigation } = await import(
      "../../frontend/src/remote/remote-place-navigation.js"
    );
    const modeButton = createElement("peopleMode");
    modeButton.dataset = { searchMode: "people" };
    const root = document.getElementById("placeSearchGroup");
    const originalQuerySelectorAll = root.querySelectorAll;
    root.querySelectorAll = (selector) => selector === "[data-search-mode]"
      ? [modeButton]
      : originalQuerySelectorAll(selector);
    const person = { pid: "11", name: "Ada", location: "Alumim", hasArchiveRecord: true, datasetVersion: "v1" };
    const peopleRuntime = {
      load: vi.fn().mockResolvedValue(undefined),
      search: vi.fn(() => []),
      resolve: vi.fn(() => person),
    };
    const subscriptions = {};
    const dataContext = {
      subscribe: vi.fn((topic, handler) => {
        subscriptions[topic] = handler;
        return vi.fn();
      }),
    };
    initRemotePlaceNavigation({ dataContext, peopleRuntime, isConnected: () => true });
    modeButton.dispatchEvent({ type: "click" });
    subscriptions.personSelection({ personId: "11", datasetVersion: "v1", revision: 1 });
    for (let i = 0; i < 4; i += 1) await Promise.resolve();

    const input = document.getElementById("placeSearchInput");
    const archiveButton = root.children.find((child) => child.className === "place-search-archive-button");
    expect(input.value).toBe("Ada");
    expect(archiveButton.hidden).toBe(false);
    expect(peopleRuntime.resolve).toHaveBeenCalledWith("11", "v1", expect.any(String));
  });

  test("keeps archive open pending until matching GIS result, then waits for closed on Back", async () => {
    const [{ initRemotePlaceNavigation }, { t }] = await Promise.all([
      import("../../frontend/src/remote/remote-place-navigation.js"),
      import("../../frontend/src/remote/remote-locale.js"),
    ]);
    const modeButton = createElement("peopleMode");
    modeButton.dataset = { searchMode: "people" };
    const root = document.getElementById("placeSearchGroup");
    const originalQuerySelectorAll = root.querySelectorAll;
    root.querySelectorAll = (selector) => selector === "[data-search-mode]"
      ? [modeButton]
      : originalQuerySelectorAll(selector);
    const person = { pid: "11", name: "Ada", location: "Alumim", hasArchiveRecord: true, datasetVersion: "v1" };
    const peopleRuntime = {
      load: vi.fn().mockResolvedValue(undefined),
      search: vi.fn(() => []),
      resolve: vi.fn(() => person),
    };
    const subscriptions = {};
    const dataContext = {
      subscribe: vi.fn((topic, handler) => { subscriptions[topic] = handler; return vi.fn(); }),
      archiveWindowCommand: vi.fn().mockResolvedValue({ acknowledged: true }),
    };
    initRemotePlaceNavigation({ dataContext, peopleRuntime, isConnected: () => true });
    modeButton.dispatchEvent({ type: "click" });
    subscriptions.personSelection({ personId: "11", datasetVersion: "v1", revision: 1 });
    for (let i = 0; i < 4; i += 1) await Promise.resolve();

    const archiveButton = root.children.find((child) => child.className === "place-search-archive-button");
    archiveButton.click();
    await Promise.resolve();
    expect(dataContext.archiveWindowCommand).toHaveBeenCalledWith("open", "11", "v1", expect.any(String));
    expect(archiveButton.textContent).not.toBe(t("backToMap"));

    const requestId = dataContext.archiveWindowCommand.mock.calls[0][3];
    subscriptions.archiveWindowResult({ requestId: "stale", personId: "11", datasetVersion: "v1", outcome: "navigation_attempted" });
    expect(archiveButton.textContent).not.toBe(t("backToMap"));
    subscriptions.archiveWindowResult({ requestId, personId: "11", datasetVersion: "v1", outcome: "navigation_attempted" });
    expect(archiveButton.textContent).toBe(t("backToMap"));

    archiveButton.click();
    await Promise.resolve();
    expect(dataContext.archiveWindowCommand).toHaveBeenLastCalledWith("close", "11", "v1", expect.any(String));
    expect(archiveButton.textContent).not.toBe(t("openNliRecord"));
    const closeRequestId = dataContext.archiveWindowCommand.mock.calls[1][3];
    subscriptions.archiveWindowResult({ requestId: closeRequestId, personId: "11", datasetVersion: "v1", outcome: "closed" });
    expect(archiveButton.textContent).toBe(t("openNliRecord"));
  });

  test("returns to a usable open state when GIS reports unavailable or result times out", async () => {
    vi.useFakeTimers();
    try {
      const [{ initRemotePlaceNavigation }, { t }] = await Promise.all([
        import("../../frontend/src/remote/remote-place-navigation.js"),
        import("../../frontend/src/remote/remote-locale.js"),
      ]);
      const modeButton = createElement("peopleMode");
      modeButton.dataset = { searchMode: "people" };
      const root = document.getElementById("placeSearchGroup");
      const originalQuerySelectorAll = root.querySelectorAll;
      root.querySelectorAll = (selector) => selector === "[data-search-mode]" ? [modeButton] : originalQuerySelectorAll(selector);
      const person = { pid: "11", name: "Ada", hasArchiveRecord: true, datasetVersion: "v1" };
      const peopleRuntime = { load: vi.fn().mockResolvedValue(undefined), search: vi.fn(() => []), resolve: vi.fn(() => person) };
      const subscriptions = {};
      const dataContext = {
        subscribe: vi.fn((topic, handler) => { subscriptions[topic] = handler; return vi.fn(); }),
        archiveWindowCommand: vi.fn().mockResolvedValue({ acknowledged: true }),
      };
      initRemotePlaceNavigation({ dataContext, peopleRuntime, archiveResultTimeoutMs: 10, isConnected: () => true });
      modeButton.dispatchEvent({ type: "click" });
      subscriptions.personSelection({ personId: "11", datasetVersion: "v1", revision: 1 });
      await Promise.resolve();
      const archiveButton = root.children.find((child) => child.className === "place-search-archive-button");
      archiveButton.click();
      await Promise.resolve();
      const requestId = dataContext.archiveWindowCommand.mock.calls[0][3];
      subscriptions.archiveWindowResult({ requestId, personId: "11", datasetVersion: "v1", outcome: "unavailable" });
      expect(archiveButton.textContent).toBe(t("openNliRecord"));
      expect(document.getElementById("placeSearchStatus").textContent).toBe(t("nliArchiveUnavailable"));

      archiveButton.click();
      await Promise.resolve();
      const retryRequestId = dataContext.archiveWindowCommand.mock.calls[1][3];
      await vi.advanceTimersByTimeAsync(11);
      expect(archiveButton.textContent).toBe(t("openNliRecord"));
      expect(document.getElementById("placeSearchStatus").textContent).toBe(t("nliArchiveUnavailable"));
      expect(dataContext.archiveWindowCommand).toHaveBeenLastCalledWith("close", "11", "v1", retryRequestId);
    } finally {
      vi.useRealTimers();
    }
  });

  test("timeout cancels a slow GIS resolve and prevents late navigation", async () => {
    vi.useFakeTimers();
    try {
      const { initRemotePlaceNavigation } = await import("../../frontend/src/remote/remote-place-navigation.js");
      const { createNliArchiveCommandBridge } = await import("../../frontend/src/map/nli-archive-window.js");
      const modeButton = createElement("peopleMode"); modeButton.dataset = { searchMode: "people" };
      const root = document.getElementById("placeSearchGroup");
      const originalQuerySelectorAll = root.querySelectorAll;
      root.querySelectorAll = (selector) => selector === "[data-search-mode]" ? [modeButton] : originalQuerySelectorAll(selector);
      let resolvePerson;
      let selection = { personId: "11", datasetVersion: "v1" };
      const person = { pid: "11", name: "Ada", hasArchiveRecord: true, datasetVersion: "v1" };
      const peopleRuntime = { load: vi.fn().mockResolvedValue(undefined), search: vi.fn(() => []), resolve: vi.fn(() => person) };
      const subscriptions = {};
      const windowController = { navigate: vi.fn(() => ({ ok: true })), close: vi.fn(() => ({ ok: true })) };
      const bridge = createNliArchiveCommandBridge({
        windowController,
        resolvePerson: () => new Promise((resolve) => { resolvePerson = resolve; }),
        getPersonSelection: () => selection,
      });
      const dataContext = {
        subscribe: vi.fn((topic, handler) => { subscriptions[topic] = handler; return vi.fn(); }),
        archiveWindowCommand: vi.fn((action, pid, version, requestId) => {
          if (action === "open") {
            void bridge.handleCommand({ action, personId: pid, datasetVersion: version, requestId, sourceId: "remote" });
          } else {
            void bridge.handleCommand({ action, personId: pid, datasetVersion: version, requestId, sourceId: "remote" });
          }
          return Promise.resolve({ acknowledged: true });
        }),
      };
      initRemotePlaceNavigation({ dataContext, peopleRuntime, archiveResultTimeoutMs: 10, isConnected: () => true });
      modeButton.dispatchEvent({ type: "click" });
      subscriptions.personSelection({ personId: "11", datasetVersion: "v1", revision: 1 });
      await Promise.resolve();
      const archiveButton = root.children.find((child) => child.className === "place-search-archive-button");
      archiveButton.click();
      await Promise.resolve();
      await vi.advanceTimersByTimeAsync(11);
      expect(dataContext.archiveWindowCommand).toHaveBeenLastCalledWith("close", "11", "v1", expect.any(String));
      resolvePerson?.({ nliUrl: "https://www.nli.org.il/he/authorities/11" });
      await Promise.resolve();
      expect(windowController.navigate).not.toHaveBeenCalled();
      expect(windowController.close).toHaveBeenCalledTimes(1);
      expect(document.getElementById("placeSearchStatus").textContent).not.toBe("");
    } finally { vi.useRealTimers(); }
  });

});
