import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { createElement, installDom } from "./remote-navigation-fixtures.js";

describe("remote People selection controller", () => {
  beforeEach(() => {
    vi.resetModules();
    installDom();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  test("stops an active investigation and waits for idle before selecting a person", async () => {
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
    let clock = { phase: "playing", revision: 3 };
    let clockListener;
    const order = [];
    const dataContext = {
      getInvestigationClock: vi.fn(() => clock),
      subscribe: vi.fn((topic, handler) => {
        if (topic === "investigationClock") clockListener = handler;
        return vi.fn();
      }),
      patchInvestigationClock: vi.fn(async (next) => {
        order.push("stop");
        clock = { ...next, revision: 4 };
        clockListener?.(clock);
      }),
      selectPerson: vi.fn(async () => {
        order.push("select");
        return { person_selection: { personId: "11", datasetVersion: "v1", revision: 5 } };
      }),
    };
    initRemotePlaceNavigation({ dataContext, peopleRuntime, isConnected: () => true });

    modeButton.dispatchEvent({ type: "click" });
    const input = document.getElementById("placeSearchInput");
    input.value = "Ada";
    input.dispatchEvent({ type: "input" });
    for (let i = 0; i < 4; i += 1) await Promise.resolve();
    document.getElementById("placeSuggestions").children[0].dispatchEvent({ type: "click" });
    for (let i = 0; i < 12; i += 1) await Promise.resolve();

    expect(order).toEqual(["stop", "select"]);
    expect(dataContext.patchInvestigationClock).toHaveBeenCalledTimes(1);
    expect(dataContext.patchInvestigationClock.mock.calls[0][0].phase).toBe("idle");
    expect(dataContext.selectPerson).toHaveBeenCalledWith("11", "v1");
  });

  test("keeps the acknowledged person and shows a specific stop failure", async () => {
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
    const people = [
      { pid: "11", name: "Ada", location: "Alumim", hasArchiveRecord: true, datasetVersion: "v1" },
      { pid: "12", name: "Ben", location: "Be'eri", hasArchiveRecord: true, datasetVersion: "v1" },
    ];
    const peopleRuntime = {
      load: vi.fn().mockResolvedValue(undefined),
      search: vi.fn((query) => people.filter((person) => person.name.toLowerCase().includes(query.toLowerCase()))),
      resolve: vi.fn((pid) => people.find((person) => person.pid === pid)),
    };
    let clock = { phase: "idle", revision: 1 };
    const dataContext = {
      getInvestigationClock: vi.fn(() => clock),
      subscribe: vi.fn(() => vi.fn()),
      selectPerson: vi.fn().mockResolvedValue({ person_selection: { personId: "11", datasetVersion: "v1", revision: 2 } }),
      patchInvestigationClock: vi.fn().mockRejectedValue(new Error("stop failed")),
    };
    initRemotePlaceNavigation({ dataContext, peopleRuntime, isConnected: () => true });
    modeButton.dispatchEvent({ type: "click" });
    const input = document.getElementById("placeSearchInput");
    input.value = "Ada";
    input.dispatchEvent({ type: "input" });
    for (let i = 0; i < 4; i += 1) await Promise.resolve();
    document.getElementById("placeSuggestions").children[0].dispatchEvent({ type: "click" });
    for (let i = 0; i < 6; i += 1) await Promise.resolve();

    clock = { phase: "playing", revision: 3 };
    input.value = "Ben";
    input.dispatchEvent({ type: "input" });
    for (let i = 0; i < 4; i += 1) await Promise.resolve();
    document.getElementById("placeSuggestions").children[0].dispatchEvent({ type: "click" });
    for (let i = 0; i < 6; i += 1) await Promise.resolve();

    const { t } = await import("../../frontend/src/remote/remote-locale.js");
    expect(dataContext.selectPerson).toHaveBeenCalledTimes(1);
    expect(input.value).toBe("Ada");
    expect(document.getElementById("placeSearchStatus").textContent).toBe(t("peopleSearchStopFailed"));
  });

  test("recovers one server-reported clock_active conflict with Stop before retrying", async () => {
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
    const peopleRuntime = { load: vi.fn().mockResolvedValue(undefined), search: vi.fn(() => [person]), resolve: vi.fn(() => person) };
    let clock = { phase: "idle", revision: 3 };
    let clockListener;
    let selectCalls = 0;
    const dataContext = {
      getInvestigationClock: vi.fn(() => clock),
      subscribe: vi.fn((topic, handler) => { if (topic === "investigationClock") clockListener = handler; return vi.fn(); }),
      patchInvestigationClock: vi.fn(async (next) => { clock = { ...next, revision: 4 }; clockListener?.(clock); }),
      selectPerson: vi.fn(async () => {
        selectCalls += 1;
        if (selectCalls === 1) throw Object.assign(new Error("clock active"), {
          status: 409,
          details: { error: "person selection is unavailable while the investigation clock is active", person_selection: { personId: null, datasetVersion: null, revision: 3 } },
        });
        return { person_selection: { personId: "11", datasetVersion: "v1", revision: 5 } };
      }),
    };
    initRemotePlaceNavigation({ dataContext, peopleRuntime, isConnected: () => true });
    modeButton.dispatchEvent({ type: "click" });
    const input = document.getElementById("placeSearchInput");
    input.value = "Ada";
    input.dispatchEvent({ type: "input" });
    for (let i = 0; i < 4; i += 1) await Promise.resolve();
    document.getElementById("placeSuggestions").children[0].dispatchEvent({ type: "click" });
    for (let i = 0; i < 20; i += 1) await Promise.resolve();

    expect(dataContext.patchInvestigationClock).toHaveBeenCalledTimes(1);
    expect(dataContext.selectPerson).toHaveBeenCalledTimes(2);
    expect(input.value).toBe("Ada");
  });

  test("times out a Stop wait, unsubscribes, and reports a usable failure", async () => {
    vi.useFakeTimers();
    try {
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
      const peopleRuntime = { load: vi.fn().mockResolvedValue(undefined), search: vi.fn(() => [person]), resolve: vi.fn(() => person) };
      const unsubscribe = vi.fn();
      const dataContext = {
        getInvestigationClock: vi.fn(() => ({ phase: "playing", revision: 3 })),
        subscribe: vi.fn((_topic, _handler) => unsubscribe),
        patchInvestigationClock: vi.fn().mockResolvedValue(undefined),
        selectPerson: vi.fn(),
      };
      initRemotePlaceNavigation({ dataContext, peopleRuntime, personSelectionClockTimeoutMs: 10, isConnected: () => true });
      modeButton.dispatchEvent({ type: "click" });
      const input = document.getElementById("placeSearchInput");
      input.value = "Ada";
      input.dispatchEvent({ type: "input" });
      for (let i = 0; i < 4; i += 1) await Promise.resolve();
      document.getElementById("placeSuggestions").children[0].dispatchEvent({ type: "click" });
      for (let i = 0; i < 4; i += 1) await Promise.resolve();
      await vi.runAllTimersAsync();
      for (let i = 0; i < 12; i += 1) await Promise.resolve();

      const { t } = await import("../../frontend/src/remote/remote-locale.js");
      expect(dataContext.selectPerson).not.toHaveBeenCalled();
      expect(unsubscribe).toHaveBeenCalledTimes(1);
      expect(document.getElementById("placeSearchStatus").textContent).toBe(t("peopleSearchStopFailed"));
    } finally {
      vi.useRealTimers();
    }
  });

  test("keeps selection failure visible when stale hydration notifies personSelection", async () => {
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
    const people = [
      { pid: "11", name: "Ada", location: "Alumim", hasArchiveRecord: true, datasetVersion: "v1" },
      { pid: "p-2", name: "Ben", location: "Be'eri", hasArchiveRecord: true, datasetVersion: "v2" },
    ];
    const person = people[0];
    let personListener;
    const peopleRuntime = {
      load: vi.fn().mockResolvedValue(undefined),
      search: vi.fn(() => [person]),
      resolve: vi.fn((pid) => people.find((candidate) => candidate.pid === pid)),
    };
    const dataContext = {
      subscribe: vi.fn((topic, handler) => { if (topic === "personSelection") personListener = handler; return vi.fn(); }),
      selectPerson: vi.fn(async () => {
        personListener?.({ personId: "p-2", datasetVersion: "v2", revision: 5 });
        throw Object.assign(new Error("stale"), { status: 409, details: { error: "stale person selection revision", person_selection: { personId: "p-2", datasetVersion: "v2", revision: 5 } } });
      }),
    };
    initRemotePlaceNavigation({ dataContext, peopleRuntime, isConnected: () => true });
    modeButton.dispatchEvent({ type: "click" });
    const input = document.getElementById("placeSearchInput");
    input.value = "Ada";
    input.dispatchEvent({ type: "input" });
    for (let i = 0; i < 4; i += 1) await Promise.resolve();
    document.getElementById("placeSuggestions").children[0].dispatchEvent({ type: "click" });
    for (let i = 0; i < 8; i += 1) await Promise.resolve();

    const { t } = await import("../../frontend/src/remote/remote-locale.js");
    expect(input.value).toBe("Ben");
    expect(document.getElementById("placeSearchStatus").textContent).toBe(t("peopleSearchSelectionFailed"));
  });

  test("a slower first selection cannot overwrite the newer selection", async () => {
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
    const people = [
      { pid: "11", name: "Ada", location: "Alumim", hasArchiveRecord: true, datasetVersion: "v1" },
      { pid: "12", name: "Ben", location: "Be'eri", hasArchiveRecord: true, datasetVersion: "v1" },
    ];
    const gates = [];
    const peopleRuntime = { load: vi.fn().mockResolvedValue(undefined), search: vi.fn((query) => people.filter((person) => person.name.toLowerCase().includes(query.toLowerCase()))), resolve: vi.fn((pid) => people.find((person) => person.pid === pid)) };
    const dataContext = {
      subscribe: vi.fn(() => vi.fn()),
      selectPerson: vi.fn((pid) => new Promise((resolve) => gates.push({ pid, resolve }))),
    };
    initRemotePlaceNavigation({ dataContext, peopleRuntime, isConnected: () => true });
    modeButton.dispatchEvent({ type: "click" });
    const input = document.getElementById("placeSearchInput");
    input.value = "a";
    input.dispatchEvent({ type: "input" });
    for (let i = 0; i < 4; i += 1) await Promise.resolve();
    const options = document.getElementById("placeSuggestions").children;
    options[0].dispatchEvent({ type: "click" });
    input.value = "b";
    input.dispatchEvent({ type: "input" });
    for (let i = 0; i < 4; i += 1) await Promise.resolve();
    document.getElementById("placeSuggestions").children[0].dispatchEvent({ type: "click" });
    gates[1].resolve({ person_selection: { personId: "12", datasetVersion: "v1", revision: 2 } });
    await Promise.resolve();
    gates[0].resolve({ person_selection: { personId: "11", datasetVersion: "v1", revision: 3 } });
    for (let i = 0; i < 6; i += 1) await Promise.resolve();

    expect(input.value).toBe("Ben");
  });

  test("does not let an older HTTP acknowledgement regress a newer context selection", async () => {
    const { initRemotePlaceNavigation } = await import(
      "../../frontend/src/remote/remote-place-navigation.js"
    );
    const modeButton = createElement("peopleMode");
    modeButton.dataset = { searchMode: "people" };
    const root = document.getElementById("placeSearchGroup");
    root.classList = { toggle: vi.fn() };
    const originalQuerySelectorAll = root.querySelectorAll;
    root.querySelectorAll = (selector) => selector === "[data-search-mode]"
      ? [modeButton]
      : originalQuerySelectorAll(selector);
    const people = [
      { pid: "11", name: "Ada", location: "Alumim", hasArchiveRecord: true, datasetVersion: "v1" },
      { pid: "12", name: "Ben", location: "Be'eri", hasArchiveRecord: true, datasetVersion: "v1" },
    ];
    const newer = { personId: "12", datasetVersion: "v1", revision: 9 };
    const peopleRuntime = {
      load: vi.fn().mockResolvedValue(undefined),
      search: vi.fn(() => [people[0]]),
      resolve: vi.fn((pid) => people.find((person) => person.pid === pid)),
    };
    const dataContext = {
      subscribe: vi.fn(() => vi.fn()),
      getPersonSelection: vi.fn(() => newer),
      selectPerson: vi.fn().mockResolvedValue({
        person_selection: { personId: "11", datasetVersion: "v1", revision: 8 },
      }),
    };
    initRemotePlaceNavigation({ dataContext, peopleRuntime, isConnected: () => true });
    modeButton.dispatchEvent({ type: "click" });
    const input = document.getElementById("placeSearchInput");
    input.value = "Ada";
    input.dispatchEvent({ type: "input" });
    for (let i = 0; i < 4; i += 1) await Promise.resolve();
    document.getElementById("placeSuggestions").children[0].dispatchEvent({ type: "click" });
    for (let i = 0; i < 10; i += 1) await Promise.resolve();

    expect(input.value).toBe("Ben");
    expect(document.getElementById("placeSearchStatus").textContent).toBe("");
    expect(root.classList.toggle).toHaveBeenLastCalledWith("is-pending", false);
  });

  test("authoritative newer selection supersedes a different pending local selection", async () => {
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
    const people = [
      { pid: "11", name: "Ada", location: "Alumim", hasArchiveRecord: true, datasetVersion: "v1" },
      { pid: "12", name: "Ben", location: "Be'eri", hasArchiveRecord: true, datasetVersion: "v1" },
    ];
    let resolveSelection;
    let personListener;
    const peopleRuntime = {
      load: vi.fn().mockResolvedValue(undefined),
      search: vi.fn(() => [people[0]]),
      resolve: vi.fn((pid) => people.find((person) => person.pid === pid)),
    };
    const dataContext = {
      subscribe: vi.fn((topic, handler) => {
        if (topic === "personSelection") personListener = handler;
        return vi.fn();
      }),
      selectPerson: vi.fn(() => new Promise((resolve) => { resolveSelection = resolve; })),
    };
    initRemotePlaceNavigation({ dataContext, peopleRuntime, isConnected: () => true });

    modeButton.dispatchEvent({ type: "click" });
    const input = document.getElementById("placeSearchInput");
    input.value = "Ada";
    input.dispatchEvent({ type: "input" });
    for (let i = 0; i < 4; i += 1) await Promise.resolve();
    document.getElementById("placeSuggestions").children[0].dispatchEvent({ type: "click" });

    personListener?.({ personId: "12", datasetVersion: "v1", revision: 9 });
    for (let i = 0; i < 4; i += 1) await Promise.resolve();
    resolveSelection?.({ person_selection: { personId: "11", datasetVersion: "v1", revision: 8 } });
    for (let i = 0; i < 8; i += 1) await Promise.resolve();

    expect(input.value).toBe("Ben");
    expect(document.getElementById("placeSearchStatus").textContent).toBe("");
  });

  test("destroy invalidates People and archive continuations and clears archive timeout", async () => {
    vi.useFakeTimers();
    try {
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
      let personListener;
      let resolveSelection;
      let resolveArchive;
      const peopleRuntime = {
        load: vi.fn().mockResolvedValue(undefined),
        search: vi.fn(() => [person]),
        resolve: vi.fn(() => person),
      };
      const dataContext = {
        subscribe: vi.fn((topic, handler) => {
          if (topic === "personSelection") personListener = handler;
          return vi.fn();
        }),
        selectPerson: vi.fn(() => new Promise((resolve) => { resolveSelection = resolve; })),
        archiveWindowCommand: vi.fn(() => new Promise((resolve) => { resolveArchive = resolve; })),
      };
      const controller = initRemotePlaceNavigation({
        dataContext,
        peopleRuntime,
        archiveResultTimeoutMs: 10,
        isConnected: () => true,
      });

      modeButton.dispatchEvent({ type: "click" });
      const input = document.getElementById("placeSearchInput");
      input.value = "Ada";
      input.dispatchEvent({ type: "input" });
      await Promise.resolve();
      document.getElementById("placeSuggestions").children[0].dispatchEvent({ type: "click" });
      const selectionStatus = document.getElementById("placeSearchStatus").textContent;
      controller.destroy();
      resolveSelection?.({ person_selection: { personId: "11", datasetVersion: "v1", revision: 1 } });
      personListener?.({ personId: "11", datasetVersion: "v1", revision: 1 });
      await Promise.resolve();
      expect(input.value).toBe("Ada");
      expect(document.getElementById("placeSearchStatus").textContent).toBe(selectionStatus);

      // A fresh instance verifies that destruction cancels an archive timeout
      // without allowing the late command acknowledgement to update the UI.
      installDom();
      const archiveModeButton = createElement("peopleMode");
      archiveModeButton.dataset = { searchMode: "people" };
      const archiveRoot = document.getElementById("placeSearchGroup");
      const archiveQuerySelectorAll = archiveRoot.querySelectorAll;
      archiveRoot.querySelectorAll = (selector) => selector === "[data-search-mode]"
        ? [archiveModeButton]
        : archiveQuerySelectorAll(selector);
      const subscriptions = {};
      const archiveContext = {
        subscribe: vi.fn((topic, handler) => { subscriptions[topic] = handler; return vi.fn(); }),
        archiveWindowCommand: vi.fn(() => new Promise((resolve) => { resolveArchive = resolve; })),
      };
      const archiveController = initRemotePlaceNavigation({
        dataContext: archiveContext,
        peopleRuntime,
        archiveResultTimeoutMs: 10,
        isConnected: () => true,
      });
      archiveModeButton.dispatchEvent({ type: "click" });
      subscriptions.personSelection({ personId: "11", datasetVersion: "v1", revision: 1 });
      await Promise.resolve();
      const archiveButton = archiveRoot.children.find((child) => child.className === "place-search-archive-button");
      archiveButton.click();
      await Promise.resolve();
      const archiveStatus = document.getElementById("placeSearchStatus").textContent;
      const archiveLabel = archiveButton.textContent;
      archiveController.destroy();
      await vi.advanceTimersByTimeAsync(11);
      resolveArchive?.({ acknowledged: true });
      await Promise.resolve();

      expect(archiveContext.archiveWindowCommand).toHaveBeenCalledTimes(1);
      expect(archiveButton.textContent).toBe(archiveLabel);
      expect(document.getElementById("placeSearchStatus").textContent).toBe(archiveStatus);
    } finally {
      vi.useRealTimers();
    }
  });

  test("reports selection failure after a successful Stop", async () => {
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
    let clockListener;
    const peopleRuntime = { load: vi.fn().mockResolvedValue(undefined), search: vi.fn(() => [person]), resolve: vi.fn(() => person) };
    const dataContext = {
      getInvestigationClock: vi.fn(() => ({ phase: "playing", revision: 3 })),
      subscribe: vi.fn((topic, handler) => { if (topic === "investigationClock") clockListener = handler; return vi.fn(); }),
      patchInvestigationClock: vi.fn(async (next) => clockListener?.({ ...next, revision: 4 })),
      selectPerson: vi.fn().mockRejectedValue(new Error("selection failed")),
    };
    initRemotePlaceNavigation({ dataContext, peopleRuntime, isConnected: () => true });
    modeButton.dispatchEvent({ type: "click" });
    const input = document.getElementById("placeSearchInput");
    input.value = "Ada";
    input.dispatchEvent({ type: "input" });
    for (let i = 0; i < 4; i += 1) await Promise.resolve();
    document.getElementById("placeSuggestions").children[0].dispatchEvent({ type: "click" });
    for (let i = 0; i < 8; i += 1) await Promise.resolve();

    const { t } = await import("../../frontend/src/remote/remote-locale.js");
    expect(document.getElementById("placeSearchStatus").textContent).toBe(t("peopleSearchSelectionFailed"));
  });
});
