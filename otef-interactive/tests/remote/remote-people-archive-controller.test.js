import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { createElement, installDom } from "./remote-navigation-fixtures.js";

function deferred() {
  let resolve;
  const promise = new Promise((next) => { resolve = next; });
  return { promise, resolve };
}

async function createArchiveFixture({
  archiveWindowCommand = vi.fn().mockResolvedValue({ acknowledged: true }),
  selectPersonCommand = vi.fn(),
  archiveResultTimeoutMs = 6000,
  isNarrativeActive = () => false,
  localizePerson = person => ({ ...person }),
} = {}) {
  const { createRemotePeopleArchiveController } = await import(
    "../../frontend/src/remote/remote-people-archive-controller.js"
  );
  const people = [
    { pid: "11", name: "Ada", hasArchiveRecord: true, datasetVersion: "v1" },
    { pid: "12", name: "Bea", hasArchiveRecord: true, datasetVersion: "v1" },
  ];
  const subscriptions = {};
  const status = document.getElementById("placeSearchStatus");
  const dataContext = {
    getInvestigationClock: () => ({ phase: "idle" }),
    subscribe: vi.fn((topic, handler) => { subscriptions[topic] = handler; return vi.fn(); }),
    archiveWindowCommand,
    selectPerson: selectPersonCommand,
  };
  const root = document.getElementById("placeSearchGroup");
  const controller = createRemotePeopleArchiveController({
    root,
    input: document.getElementById("placeSearchInput"),
    clear: document.getElementById("placeSearchClear"),
    list: document.getElementById("placeSuggestions"),
    status,
    navigationSection: root,
    dataContext,
    peopleRuntime: {
      load: vi.fn().mockResolvedValue(undefined),
      resolve: (pid, datasetVersion, locale) => { const person = people.find((item) => item.pid === pid && item.datasetVersion === datasetVersion); return person ? localizePerson(person, locale) : null; },
    },
    getMode: () => "people",
    setMode: vi.fn(),
    renderSuggestions: vi.fn(),
    setStatus: (message) => { status.textContent = message; },
    setRootClass: vi.fn(),
    setHidden: vi.fn(),
    syncInputDirection: vi.fn(),
    archiveResultTimeoutMs,
    isNarrativeActive,
  });
  const selectPerson = async (pid, revision) => {
    controller.handlePersonSnapshot({ personId: pid, datasetVersion: "v1", revision });
    for (let index = 0; index < 4; index += 1) await Promise.resolve();
  };
  await selectPerson("11", 1);
  const archiveButton = root.children.find((child) => child.className === "place-search-archive-button");
  return { controller, dataContext, subscriptions, people, root, status, archiveButton, selectPerson };
}

describe("remote People and archive controller", () => {
  beforeEach(() => {
    vi.resetModules();
    installDom();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  test.each([["11", true], ["12", false]])("unchanged selection acknowledges only the already selected person: %s", async (requestedPid, accepted) => {
    const snapshot = { personId: "11", datasetVersion: "v1", revision: 1 };
    const fixture = await createArchiveFixture({
      selectPersonCommand: async () => ({ person_selection: snapshot }),
    });
    fixture.dataContext.getPersonSelection = () => snapshot;
    try {
      const person = fixture.people.find((item) => item.pid === requestedPid);
      await expect(fixture.controller.selectPerson(person)).resolves.toBe(accepted);
      expect(fixture.controller.getAcknowledgedPerson().pid).toBe("11");
      expect(document.getElementById("placeSearchInput").value).toBe("Ada");
      if (accepted) expect(fixture.status.textContent).toBe("");
      else expect(fixture.status.textContent).not.toBe("");
    } finally {
      fixture.controller.destroy();
    }
  });

  test('locale refresh changes acknowledged titles without commands and preserves an edited query', async () => {
    document.documentElement = { setAttribute: vi.fn() };
    const { setLocale } = await import('../../frontend/src/remote/remote-locale.js');
    setLocale('he', { persist: false });
    const fixture = await openArchiveSession(await createArchiveFixture({ localizePerson: (person, locale) => ({ ...person, name: locale === 'en' ? 'Ada' : 'עדה' }) }));
    const input = document.getElementById('placeSearchInput');
    const phase = fixture.controller.getArchivePhase();
    setLocale('en', { persist: false });
    fixture.controller.handleLocaleChange();
    expect(fixture.controller.getAcknowledgedPerson().name).toBe('Ada');
    expect(input.value).toBe('Ada');
    input.value = 'edited search';
    setLocale('he', { persist: false });
    fixture.controller.handleLocaleChange();
    expect(input.value).toBe('edited search');
    expect(fixture.controller.getAcknowledgedPerson().name).toBe('עדה');
    expect(fixture.controller.getArchivePhase()).toBe(phase);
    expect(fixture.dataContext.selectPerson).not.toHaveBeenCalled();
    expect(fixture.dataContext.archiveWindowCommand).not.toHaveBeenCalled();
  });

  test("clear waits for an in-flight selection and then clears its acknowledged revision", async () => {
    const { createRemotePeopleArchiveController } = await import(
      "../../frontend/src/remote/remote-people-archive-controller.js"
    );
    const person = { pid: "11", name: "Ada", hasArchiveRecord: true, datasetVersion: "v1" };
    let selection = { personId: null, datasetVersion: null, revision: 0 };
    const selectResponse = deferred();
    const dataContext = {
      getInvestigationClock: () => ({ phase: "idle" }),
      getPersonSelection: () => selection,
      selectPerson: vi.fn(() => selectResponse.promise.then((result) => {
        selection = result.person_selection;
        return result;
      })),
      clearPerson: vi.fn(async () => {
        selection = { personId: null, datasetVersion: null, revision: 5 };
        return { person_selection: selection };
      }),
    };
    const root = document.getElementById("placeSearchGroup");
    const controller = createRemotePeopleArchiveController({
      root,
      input: document.getElementById("placeSearchInput"),
      clear: document.getElementById("placeSearchClear"),
      list: document.getElementById("placeSuggestions"),
      status: document.getElementById("placeSearchStatus"),
      navigationSection: root,
      dataContext,
      peopleRuntime: { load: vi.fn(), resolve: vi.fn(() => person) },
      getMode: () => "people",
      setMode: vi.fn(), renderSuggestions: vi.fn(), setStatus: vi.fn(),
      setRootClass: vi.fn(), setHidden: vi.fn(), syncInputDirection: vi.fn(),
    });

    const select = controller.selectPerson(person);
    const clear = controller.clearPersonSelection();
    expect(dataContext.clearPerson).not.toHaveBeenCalled();
    selectResponse.resolve({
      person_selection: { personId: "11", datasetVersion: "v1", revision: 4 },
    });
    await select;
    await expect(clear).resolves.toBe(true);
    expect(dataContext.clearPerson).toHaveBeenCalledOnce();
    expect(controller.getAcknowledgedPerson()).toBeNull();
  });

  test("clear rejects an unacknowledged or non-empty response", async () => {
    const { createRemotePeopleArchiveController } = await import(
      "../../frontend/src/remote/remote-people-archive-controller.js"
    );
    const person = { pid: "11", name: "Ada", hasArchiveRecord: true, datasetVersion: "v1" };
    let selection = { personId: null, datasetVersion: null, revision: 0 };
    const dataContext = {
      getInvestigationClock: () => ({ phase: "idle" }),
      getPersonSelection: () => selection,
      selectPerson: vi.fn(),
      clearPerson: vi.fn(async () => ({
        person_selection: { revision: 4, personId: "p1", datasetVersion: "v1" },
      })),
    };
    const root = document.getElementById("placeSearchGroup");
    const controller = createRemotePeopleArchiveController({
      root,
      input: document.getElementById("placeSearchInput"),
      clear: document.getElementById("placeSearchClear"),
      list: document.getElementById("placeSuggestions"),
      status: document.getElementById("placeSearchStatus"),
      navigationSection: root,
      dataContext,
      peopleRuntime: { load: vi.fn(), resolve: vi.fn(() => person) },
      getMode: () => "people",
      setMode: vi.fn(), renderSuggestions: vi.fn(), setStatus: vi.fn(),
      setRootClass: vi.fn(), setHidden: vi.fn(), syncInputDirection: vi.fn(),
    });
    controller.handlePersonSnapshot({ personId: "11", datasetVersion: "v1", revision: 4 });
    await Promise.resolve();
    await expect(controller.clearPersonSelection()).resolves.toBe(false);
  });

  test("refresh restriction tracks archive requests, ownership, and recoverable opens", async () => {
    const fixture = await createArchiveFixture();
    expect(fixture.controller.getRefreshRestriction()).toBeNull();
    const opening = fixture.controller.openArchive();
    expect(fixture.controller.getRefreshRestriction()).toBe("owned_session");
    await opening;
    const requestId = fixture.dataContext.archiveWindowCommand.mock.calls[0][3];
    fixture.controller.handleArchiveResult({ requestId, personId: "11", datasetVersion: "v1", outcome: "unavailable" });
    expect(fixture.controller.getArchivePhase()).toBe("closed");
    expect(fixture.controller.getRefreshRestriction()).toBe("owned_session");
    fixture.controller.destroy();
  });

  test("archive ownership takes precedence over a pending page request", async () => {
    let finishPage;
    const archiveWindowCommand = vi.fn((action) => action === "page_down"
      ? new Promise((resolve) => { finishPage = resolve; })
      : Promise.resolve({ acknowledged: true }));
    const fixture = await createArchiveFixture({ archiveWindowCommand });
    await openArchiveSession(fixture);
    const paging = fixture.controller.pageArchive("down");
    expect(fixture.controller.getRefreshRestriction()).toBe("owned_session");
    finishPage({ acknowledged: true });
    await paging;
    fixture.controller.destroy();
  });

  test("recoverable archive ownership takes precedence over pending selection", async () => {
    let finishSelection;
    const fixture = await createArchiveFixture({
      selectPersonCommand: vi.fn(() => new Promise((resolve) => { finishSelection = resolve; })),
    });
    const selecting = fixture.controller.selectPerson(fixture.people[1]);
    const opening = fixture.controller.openArchive();
    await opening;
    const requestId = fixture.dataContext.archiveWindowCommand.mock.calls[0][3];
    fixture.controller.handleArchiveResult({ requestId, personId: "11", datasetVersion: "v1", outcome: "unavailable" });
    expect(fixture.controller.getArchivePhase()).toBe("closed");
    expect(fixture.controller.getRefreshRestriction()).toBe("owned_session");
    finishSelection({ person_selection: { personId: "12", datasetVersion: "v1", revision: 2 } });
    await selecting;
    fixture.controller.destroy();
  });

  test("refresh restriction covers person selection until its request settles", async () => {
    let finishSelection;
    const fixture = await createArchiveFixture({
      selectPersonCommand: vi.fn(() => new Promise((resolve) => { finishSelection = resolve; })),
    });
    const selecting = fixture.controller.selectPerson(fixture.people[1]);
    expect(fixture.controller.getRefreshRestriction()).toBe("busy");
    finishSelection({ person_selection: { personId: "12", datasetVersion: "v1", revision: 2 } });
    await selecting;
    expect(fixture.controller.getRefreshRestriction()).toBeNull();
    fixture.controller.destroy();
  });

  test("refresh stays busy until timeout cancellation settles", async () => {
    vi.useFakeTimers();
    try {
      let finishCancellation;
      const archiveWindowCommand = vi.fn((action) => action === "close"
        ? new Promise((resolve) => { finishCancellation = resolve; })
        : Promise.resolve({ acknowledged: true }));
      const fixture = await createArchiveFixture({ archiveWindowCommand, archiveResultTimeoutMs: 10 });
      await fixture.controller.openArchive();
      await vi.advanceTimersByTimeAsync(11);
      expect(fixture.controller.getArchivePhase()).toBe("closed");
      expect(fixture.controller.getRefreshRestriction()).toBe("busy");
      finishCancellation({ acknowledged: true });
      await Promise.resolve();
      await Promise.resolve();
      expect(fixture.controller.getRefreshRestriction()).toBeNull();
      fixture.controller.destroy();
    } finally {
      vi.useRealTimers();
    }
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

  test("clearing an acknowledged people selection cancels focus without reopening suggestions", async () => {
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
      cancelNavigationFocus: vi.fn().mockResolvedValue({ ok: true }),
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

    expect(input.value).toBe("");
    expect(dataContext.cancelNavigationFocus).toHaveBeenCalledOnce();
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

  test("Back to map reports unavailable when GIS close is a no-op", async () => {
    const [{ initRemotePlaceNavigation }, { t }, { createNliArchiveCommandBridge, createNliArchiveWindowController }] = await Promise.all([
      import("../../frontend/src/remote/remote-place-navigation.js"),
      import("../../frontend/src/remote/remote-locale.js"),
      import("../../frontend/src/map/nli-archive-window.js"),
    ]);
    const modeButton = createElement("peopleMode");
    modeButton.dataset = { searchMode: "people" };
    const root = document.getElementById("placeSearchGroup");
    const originalQuerySelectorAll = root.querySelectorAll;
    root.querySelectorAll = (selector) => selector === "[data-search-mode]" ? [modeButton] : originalQuerySelectorAll(selector);
    const person = { pid: "11", name: "Ada", location: "Alumim", hasArchiveRecord: true, datasetVersion: "v1" };
    const peopleRuntime = { load: vi.fn().mockResolvedValue(undefined), search: vi.fn(() => []), resolve: vi.fn(() => person) };
    const subscriptions = {};
    const handle = { closed: false, close: vi.fn(), location: { replace: vi.fn() } };
    const windowController = createNliArchiveWindowController({ windowOpen: () => handle });
    const bridge = createNliArchiveCommandBridge({
      windowController,
      resolvePerson: async () => ({ nliUrl: "https://www.nli.org.il/he/authorities/11" }),
      getPersonSelection: () => ({ personId: "11", datasetVersion: "v1" }),
      emitResult: async (result) => { subscriptions.archiveWindowResult?.(result); },
    });
    const dataContext = {
      subscribe: vi.fn((topic, handler) => { subscriptions[topic] = handler; return vi.fn(); }),
      archiveWindowCommand: vi.fn((action, pid, version, requestId) => {
        void bridge.handleCommand({ action, personId: pid, datasetVersion: version, requestId, sourceId: "remote" });
        return Promise.resolve({ acknowledged: true });
      }),
    };
    initRemotePlaceNavigation({ dataContext, peopleRuntime, isConnected: () => true });
    modeButton.dispatchEvent({ type: "click" });
    subscriptions.personSelection({ personId: "11", datasetVersion: "v1", revision: 1 });
    for (let i = 0; i < 4; i += 1) await Promise.resolve();

    const archiveButton = root.children.find((child) => child.className === "place-search-archive-button");
    archiveButton.click();
    for (let i = 0; i < 4; i += 1) await Promise.resolve();
    expect(archiveButton.textContent).toBe(t("backToMap"));

    archiveButton.click();
    for (let i = 0; i < 4; i += 1) await Promise.resolve();
    expect(document.getElementById("placeSearchStatus").textContent).toBe(t("nliArchiveUnavailable"));
    expect(archiveButton.textContent).toBe(t("openNliRecord"));
    expect(handle.closed).toBe(false);
  });

  test("prefers closed over unavailable for the same archive requestId", async () => {
    const { initRemotePlaceNavigation } = await import(
      "../../frontend/src/remote/remote-place-navigation.js"
    );
    const modeButton = createElement("peopleMode");
    modeButton.dataset = { searchMode: "people" };
    const root = document.getElementById("placeSearchGroup");
    const classNames = new Set();
    root.classList = {
      toggle(name, enabled) { enabled ? classNames.add(name) : classNames.delete(name); },
      contains: (name) => classNames.has(name),
    };
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
      archiveWindowCommand: vi.fn().mockResolvedValue({ acknowledged: true }),
      subscribe: (topic, fn) => {
        subscriptions[topic] = fn;
        return () => {};
      },
      getInvestigationClock: () => ({ phase: "idle" }),
    };
    initRemotePlaceNavigation({ dataContext, peopleRuntime, isConnected: () => true });
    modeButton.dispatchEvent({ type: "click" });
    subscriptions.personSelection({ personId: "11", datasetVersion: "v1", revision: 1 });
    for (let i = 0; i < 4; i += 1) await Promise.resolve();

    const archiveButton = root.children.find((child) => child.className === "place-search-archive-button");
    const navigationSection = root;
    const status = document.getElementById("placeSearchStatus");
    archiveButton.click();
    await Promise.resolve();
    const openId = dataContext.archiveWindowCommand.mock.calls[0][3];
    subscriptions.archiveWindowResult({ requestId: openId, personId: "11", datasetVersion: "v1", outcome: "navigation_attempted" });
    archiveButton.click();
    await Promise.resolve();
    const closeId = dataContext.archiveWindowCommand.mock.calls[1][3];
    subscriptions.archiveWindowResult({ requestId: closeId, personId: "11", datasetVersion: "v1", outcome: "unavailable" });
    subscriptions.archiveWindowResult({ requestId: closeId, personId: "11", datasetVersion: "v1", outcome: "closed" });
    expect(navigationSection.classList.contains("is-archive-open")).toBe(false);
    expect(status.textContent).toBe("");
  });

  test("a successful GIS tab wins when another tab reports the same open unavailable", async () => {
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
    const person = { pid: "11", name: "Ada", hasArchiveRecord: true, datasetVersion: "v1" };
    const peopleRuntime = { load: vi.fn().mockResolvedValue(undefined), resolve: vi.fn(() => person) };
    const subscriptions = {};
    const dataContext = {
      subscribe: (topic, fn) => { subscriptions[topic] = fn; return () => {}; },
      archiveWindowCommand: vi.fn().mockResolvedValue({ acknowledged: true }),
    };
    initRemotePlaceNavigation({ dataContext, peopleRuntime, isConnected: () => true });
    modeButton.dispatchEvent({ type: "click" });
    subscriptions.personSelection({ personId: "11", datasetVersion: "v1", revision: 1 });
    for (let i = 0; i < 4; i += 1) await Promise.resolve();

    const archiveButton = root.children.find((child) => child.className === "place-search-archive-button");
    archiveButton.click();
    await Promise.resolve();
    const requestId = dataContext.archiveWindowCommand.mock.calls[0][3];
    const response = { requestId, personId: "11", datasetVersion: "v1" };
    subscriptions.archiveWindowResult({ ...response, outcome: "unavailable", sourceId: "gis-blocked" });
    expect(archiveButton.textContent).not.toBe(t("backToMap"));

    subscriptions.archiveWindowResult({ ...response, outcome: "navigation_attempted", sourceId: "gis-opened" });
    expect(archiveButton.textContent).toBe(t("backToMap"));
  });

  test("a late success cannot reopen after archive presentation cancellation", async () => {
    const { t } = await import("../../frontend/src/remote/remote-locale.js");
    let narrativeActive = false;
    const fixture = await createArchiveFixture({ isNarrativeActive: () => narrativeActive });
    await fixture.controller.openArchive();
    const requestId = fixture.dataContext.archiveWindowCommand.mock.calls[0][3];
    fixture.controller.handleArchiveResult({ requestId, personId: "11", datasetVersion: "v1", outcome: "unavailable" });

    narrativeActive = true;
    fixture.subscriptions.narrativeState();
    narrativeActive = false;
    fixture.controller.syncArchiveButton();
    fixture.controller.handleArchiveResult({ requestId, personId: "11", datasetVersion: "v1", outcome: "navigation_attempted" });

    expect(fixture.controller.getArchivePhase()).toBe("closed");
    expect(fixture.archiveButton.textContent).not.toBe(t("backToMap"));
    fixture.controller.destroy();
  });

  test.each([
    ["failed acknowledgment", vi.fn().mockResolvedValue({ acknowledged: false })],
    ["transport rejection", vi.fn().mockRejectedValue(new Error("transport failed"))],
  ])("a late success cannot reopen after %s", async (_kind, archiveWindowCommand) => {
    const { t } = await import("../../frontend/src/remote/remote-locale.js");
    const fixture = await createArchiveFixture({ archiveWindowCommand });
    await fixture.controller.openArchive();
    const requestId = archiveWindowCommand.mock.calls[0][3];
    fixture.controller.handleArchiveResult({ requestId, personId: "11", datasetVersion: "v1", outcome: "navigation_attempted" });

    expect(fixture.controller.getArchivePhase()).toBe("closed");
    expect(fixture.archiveButton.textContent).not.toBe(t("backToMap"));
    fixture.controller.destroy();
  });

  test("a late success cannot reopen after an archive open times out", async () => {
    vi.useFakeTimers();
    try {
      const [{ t }, fixture] = await Promise.all([
        import("../../frontend/src/remote/remote-locale.js"),
        createArchiveFixture({ archiveResultTimeoutMs: 10 }),
      ]);
      await fixture.controller.openArchive();
      const requestId = fixture.dataContext.archiveWindowCommand.mock.calls[0][3];
      await vi.advanceTimersByTimeAsync(11);
      fixture.controller.handleArchiveResult({ requestId, personId: "11", datasetVersion: "v1", outcome: "navigation_attempted" });

      expect(fixture.controller.getArchivePhase()).toBe("closed");
      expect(fixture.archiveButton.textContent).not.toBe(t("backToMap"));
      fixture.controller.destroy();
    } finally {
      vi.useRealTimers();
    }
  });

  test("a person selection invalidates recovery even if that person is selected again", async () => {
    const { t } = await import("../../frontend/src/remote/remote-locale.js");
    const fixture = await createArchiveFixture();
    await fixture.controller.openArchive();
    const oldRequestId = fixture.dataContext.archiveWindowCommand.mock.calls[0][3];
    fixture.controller.handleArchiveResult({ requestId: oldRequestId, personId: "11", datasetVersion: "v1", outcome: "unavailable" });

    await fixture.selectPerson("12", 2);
    await fixture.selectPerson("11", 3);
    fixture.controller.handleArchiveResult({ requestId: oldRequestId, personId: "11", datasetVersion: "v1", outcome: "navigation_attempted" });
    expect(fixture.controller.getArchivePhase()).toBe("closed");
    expect(fixture.archiveButton.textContent).not.toBe(t("backToMap"));
    fixture.controller.destroy();
  });

  test("a newer archive request invalidates prior unavailable recovery", async () => {
    const { t } = await import("../../frontend/src/remote/remote-locale.js");
    const fixture = await createArchiveFixture();
    await fixture.controller.openArchive();
    const oldRequestId = fixture.dataContext.archiveWindowCommand.mock.calls[0][3];
    fixture.controller.handleArchiveResult({ requestId: oldRequestId, personId: "11", datasetVersion: "v1", outcome: "unavailable" });

    await fixture.controller.openArchive();
    const newerRequestId = fixture.dataContext.archiveWindowCommand.mock.calls[1][3];
    fixture.controller.handleArchiveResult({ requestId: oldRequestId, personId: "11", datasetVersion: "v1", outcome: "navigation_attempted" });
    expect(fixture.controller.getArchivePhase()).toBe("opening");
    fixture.controller.handleArchiveResult({ requestId: newerRequestId, personId: "11", datasetVersion: "v1", outcome: "navigation_attempted" });
    expect(fixture.archiveButton.textContent).toBe(t("backToMap"));
    fixture.controller.destroy();
  });

  test("late success after unavailable is rejected at the original open deadline", async () => {
    vi.useFakeTimers();
    try {
      const { t } = await import("../../frontend/src/remote/remote-locale.js");
      const fixture = await createArchiveFixture({ archiveResultTimeoutMs: 10 });
      await fixture.controller.openArchive();
      const requestId = fixture.dataContext.archiveWindowCommand.mock.calls[0][3];

      await vi.advanceTimersByTimeAsync(8);
      fixture.controller.handleArchiveResult({ requestId, personId: "11", datasetVersion: "v1", outcome: "unavailable" });
      await vi.advanceTimersByTimeAsync(3);
      fixture.controller.handleArchiveResult({ requestId, personId: "11", datasetVersion: "v1", outcome: "navigation_attempted" });

      expect(fixture.controller.getArchivePhase()).toBe("closed");
      expect(fixture.archiveButton.textContent).not.toBe(t("backToMap"));
      expect(fixture.dataContext.archiveWindowCommand).toHaveBeenLastCalledWith("close", "11", "v1", requestId);
      fixture.controller.destroy();
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

  test("openArchive selects the person then sends the shared archive command", async () => {
    const { createRemotePeopleArchiveController } = await import(
      "../../frontend/src/remote/remote-people-archive-controller.js"
    );
    const person = { pid: "11", name: "Ada", hasArchiveRecord: true, datasetVersion: "v1" };
    const peopleRuntime = {
      load: vi.fn().mockResolvedValue(undefined),
      resolve: vi.fn(() => person),
    };
    const dataContext = {
      getInvestigationClock: () => ({ phase: "idle" }),
      selectPerson: vi.fn().mockResolvedValue({
        person_selection: { personId: "11", datasetVersion: "v1", revision: 1 },
      }),
      archiveWindowCommand: vi.fn().mockResolvedValue({ acknowledged: true }),
    };
    const root = document.getElementById("placeSearchGroup");
    const controller = createRemotePeopleArchiveController({
      root,
      input: document.getElementById("placeSearchInput"),
      clear: document.getElementById("placeSearchClear"),
      list: document.getElementById("placeSuggestions"),
      status: document.getElementById("placeSearchStatus"),
      navigationSection: root,
      dataContext,
      peopleRuntime,
      getMode: () => "people",
      setMode: () => {},
      renderSuggestions: () => {},
      setStatus: () => {},
      setRootClass: () => {},
      setHidden: () => {},
      syncInputDirection: () => {},
    });

    await controller.openArchive(person);

    expect(dataContext.selectPerson).toHaveBeenCalledWith("11", "v1");
    expect(dataContext.archiveWindowCommand).toHaveBeenCalledWith("open", "11", "v1", expect.any(String));
    expect(controller.getAcknowledgedPerson()).toEqual(person);
    expect(controller.getArchivePhase()).toBe("opening");
  });

  async function openArchiveSession(fixture) {
    await fixture.controller.openArchive();
    const requestId = fixture.dataContext.archiveWindowCommand.mock.calls[0][3];
    fixture.controller.handleArchiveResult({
      requestId,
      personId: "11",
      datasetVersion: "v1",
      outcome: "navigation_attempted",
    });
    expect(fixture.controller.getArchivePhase()).toBe("open");
    fixture.dataContext.archiveWindowCommand.mockClear();
    return fixture;
  }

  test("pageArchive sends page_down without changing an open phase", async () => {
    const fixture = await openArchiveSession(await createArchiveFixture());
    await expect(fixture.controller.pageArchive("down")).resolves.toBe(true);
    expect(fixture.dataContext.archiveWindowCommand).toHaveBeenCalledWith(
      "page_down",
      "11",
      "v1",
      expect.any(String),
    );
    expect(fixture.controller.getArchivePhase()).toBe("open");
    fixture.controller.destroy();
  });

  test.each(["up", "down"])("pageArchive %s preserves the real data context receiver", async (direction) => {
    const { OTEFDataContext } = await import("../../frontend/src/shared/OTEFDataContext.js");
    const { OTEF_API } = await import("../../frontend/src/shared/api-client.js");
    const transport = vi.spyOn(OTEF_API, "archiveWindowCommand").mockResolvedValue({ acknowledged: true });
    const fixture = await createArchiveFixture({
      archiveWindowCommand: vi.fn(OTEFDataContext.archiveWindowCommand),
    });
    Object.assign(fixture.dataContext, { _tableName: "otef", _clientId: "scroll-test" });
    try {
      await openArchiveSession(fixture);
      transport.mockClear();
      await expect(fixture.controller.pageArchive(direction)).resolves.toBe(true);
      expect(transport).toHaveBeenCalledWith("otef", {
        action: direction === "up" ? "page_up" : "page_down",
        personId: "11",
        datasetVersion: "v1",
        requestId: expect.any(String),
        sourceId: "scroll-test",
      });
      expect(fixture.controller.getArchivePhase()).toBe("open");
    } finally {
      fixture.controller.destroy();
      transport.mockRestore();
    }
  });

  test("pageArchive while closed does not send", async () => {
    const fixture = await createArchiveFixture();
    await expect(fixture.controller.pageArchive("down")).resolves.toBe(false);
    expect(fixture.dataContext.archiveWindowCommand).not.toHaveBeenCalled();
    expect(fixture.controller.getArchivePhase()).toBe("closed");
    fixture.controller.destroy();
  });

  test("pageArchive while opening does not send", async () => {
    const fixture = await createArchiveFixture();
    await fixture.controller.openArchive();
    expect(fixture.controller.getArchivePhase()).toBe("opening");
    fixture.dataContext.archiveWindowCommand.mockClear();
    await expect(fixture.controller.pageArchive("down")).resolves.toBe(false);
    expect(fixture.dataContext.archiveWindowCommand).not.toHaveBeenCalled();
    fixture.controller.destroy();
  });

  test("pageArchive swallows transport errors and stays open", async () => {
    const archiveWindowCommand = vi.fn()
      .mockResolvedValueOnce({ acknowledged: true })
      .mockRejectedValueOnce(new Error("transport failed"));
    const fixture = await openArchiveSession(await createArchiveFixture({ archiveWindowCommand }));
    await expect(fixture.controller.pageArchive("up")).resolves.toBe(false);
    expect(archiveWindowCommand).toHaveBeenCalledWith("page_up", "11", "v1", expect.any(String));
    expect(fixture.controller.getArchivePhase()).toBe("open");
    fixture.controller.destroy();
  });

  test("archiveButton undefined still synthesizes the workshop dummy button", async () => {
    const { createRemotePeopleArchiveController } = await import(
      "../../frontend/src/remote/remote-people-archive-controller.js"
    );
    const root = document.getElementById("placeSearchGroup");
    const controller = createRemotePeopleArchiveController({
      root,
      input: document.getElementById("placeSearchInput"),
      clear: document.getElementById("placeSearchClear"),
      list: document.getElementById("placeSuggestions"),
      status: document.getElementById("placeSearchStatus"),
      navigationSection: root,
      dataContext: { getInvestigationClock: () => ({ phase: "idle" }) },
      peopleRuntime: { load: vi.fn(), resolve: vi.fn() },
      getMode: () => "people",
      setMode: vi.fn(),
      renderSuggestions: vi.fn(),
      setStatus: vi.fn(),
      setRootClass: vi.fn(),
      setHidden: vi.fn(),
      syncInputDirection: vi.fn(),
      archiveButton: undefined,
    });
    const dummy = root.children.find((child) => child.className === "place-search-archive-button");
    expect(dummy).toBeDefined();
    expect(dummy.type).toBe("button");
    expect(dummy.hidden).toBe(true);
    expect(controller.archiveButton).toBe(dummy);
    controller.destroy();
  });

  test("archiveButton null does not append a workshop dummy button", async () => {
    const { createRemotePeopleArchiveController } = await import(
      "../../frontend/src/remote/remote-people-archive-controller.js"
    );
    const onStateChange = vi.fn();
    const root = document.getElementById("placeSearchGroup");
    const controller = createRemotePeopleArchiveController({
      root,
      input: document.getElementById("placeSearchInput"),
      clear: document.getElementById("placeSearchClear"),
      list: document.getElementById("placeSuggestions"),
      status: document.getElementById("placeSearchStatus"),
      navigationSection: root,
      dataContext: { getInvestigationClock: () => ({ phase: "idle" }) },
      peopleRuntime: { load: vi.fn(), resolve: vi.fn() },
      getMode: () => "people",
      setMode: vi.fn(),
      renderSuggestions: vi.fn(),
      setStatus: vi.fn(),
      setRootClass: vi.fn(),
      setHidden: vi.fn(),
      syncInputDirection: vi.fn(),
      archiveButton: null,
      onStateChange,
    });
    expect(root.children.find((child) => child.className === "place-search-archive-button")).toBeUndefined();
    expect(controller.archiveButton).toBeNull();
    expect(onStateChange).toHaveBeenCalled();
    controller.destroy();
  });

  test("a cancelled queued stop does not treat the old idle snapshot as acknowledgement", async () => {
    const { waitForInvestigationClockIdle } = await import(
      "../../frontend/src/remote/remote-people-archive-controller.js"
    );
    let cancelled = false;
    const patchInvestigationClock = vi.fn(async () => ({ ok: false, stale: true, error: "Superseded" }));
    const dataContext = {
      getInvestigationClock: () => ({ phase: "playing", revision: 2 }),
      patchInvestigationClock,
      subscribe: vi.fn(() => () => {}),
    };
    cancelled = true;

    await expect(waitForInvestigationClockIdle(dataContext, {
      forceStop: true,
      timeoutMs: 50,
      isCancelled: () => cancelled,
    })).resolves.toBeUndefined();
    expect(patchInvestigationClock).toHaveBeenCalledTimes(1);
    expect(patchInvestigationClock.mock.calls[0][1]?.isCurrent?.()).toBe(false);
  });

  test("a failed stop rejects even when the local snapshot is already idle", async () => {
    const { waitForInvestigationClockIdle } = await import(
      "../../frontend/src/remote/remote-people-archive-controller.js"
    );
    const failure = new Error("stop rejected");
    const dataContext = {
      getInvestigationClock: () => ({ phase: "idle", revision: 3 }),
      patchInvestigationClock: vi.fn(async () => ({ ok: false, error: failure })),
      subscribe: vi.fn(() => () => {}),
    };

    await expect(waitForInvestigationClockIdle(dataContext, { forceStop: true })).rejects.toBe(failure);
    expect(dataContext.patchInvestigationClock).toHaveBeenCalledTimes(1);
  });

  test("an idle clock returned before HTTP settles the forced stop", async () => {
    const { waitForInvestigationClockIdle } = await import(
      "../../frontend/src/remote/remote-people-archive-controller.js"
    );
    const idle = { phase: "idle", revision: 6, membership: [], beats: [], loop: false };
    const dataContext = {
      getInvestigationClock: () => ({ phase: "playing", revision: 5 }),
      patchInvestigationClock: vi.fn(async () => ({ ok: true, clock: idle })),
      subscribe: vi.fn(() => () => {}),
    };

    await expect(waitForInvestigationClockIdle(dataContext, {
      forceStop: true,
      timeoutMs: 50,
    })).resolves.toBeUndefined();
  });

  test("a forced stop follows an already-sent play and leaves the clock idle", async () => {
    vi.spyOn(Date, "now").mockReturnValue(10_000);
    const api = await import("../../frontend/src/shared/api-client.js");
    const sent = [];
    let releasePlay;
    vi.spyOn(api.OTEF_API, "updateInvestigationClock").mockImplementation(async (_table, clock) => {
      sent.push(clock.phase);
      if (clock.phase === "playing") {
        await new Promise((resolve) => { releasePlay = resolve; });
      }
      return {
        investigation_clock: {
          ...clock,
          revision: clock.phase === "playing" ? 2 : 3,
          serverNowMs: 11_000,
        },
      };
    });
    const { default: OTEFDataContext } = await import("../../frontend/src/shared/OTEFDataContext.js");
    const { waitForInvestigationClockIdle } = await import(
      "../../frontend/src/remote/remote-people-archive-controller.js"
    );
    OTEFDataContext._tableName = "otef";
    OTEFDataContext._clientId = "clock-client";
    OTEFDataContext._setInvestigationClock({
      phase: "idle",
      membership: [],
      beats: [],
      loop: false,
      positionMs: 0,
      anchorMs: null,
      seekKind: "none",
      revision: 1,
    });
    const play = {
      phase: "playing",
      membership: ["nli.lines"],
      beats: [400],
      loop: false,
      positionMs: 0,
      anchorMs: 10_000,
      seekKind: "none",
      revision: 1,
    };

    const playing = OTEFDataContext.patchInvestigationClock(play);
    await vi.waitFor(() => expect(sent).toEqual(["playing"]));
    expect(OTEFDataContext.getInvestigationClock().phase).toBe("idle");
    const home = waitForInvestigationClockIdle(OTEFDataContext, { forceStop: true });
    await Promise.resolve();
    expect(sent).toEqual(["playing"]);
    releasePlay();
    await playing;
    await home;

    expect(sent).toEqual(["playing", "idle"]);
    expect(OTEFDataContext.getInvestigationClock().phase).toBe("idle");
  });

});
