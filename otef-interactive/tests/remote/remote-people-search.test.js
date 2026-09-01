import { describe, expect, test, vi } from "vitest";

const index = {
  datasetVersion: "v1",
  people: [
    { pid: "2", nameForms: ["לא ידוע", "David Cohen"], location: "Be'eri", sublocation: "North", hasArchiveRecord: false },
    { pid: "1", nameForms: ["דוד כהן", "David Cohen"], location: "Alumim", sublocation: "South", hasArchiveRecord: true },
    { pid: "3", nameForms: ["Dana"], location: "Be'eri", sublocation: "Old road" },
  ],
};
const metadata = { datasetVersion: "v1", runtimeArtifactHashes: { "people-search-index.json": "hash" } };

function fetcher(url) {
  const payload = url.includes("release") ? metadata : index;
  return Promise.resolve({ data: payload, bytes: new Uint8Array([1, 2, 3]) });
}

describe("remote people search", () => {
  test("loads promoted people artifacts from the nginx-mounted OTEF public path", async () => {
    const { PEOPLE_INDEX_URL, PEOPLE_RELEASE_METADATA_URL } = await import("../../frontend/src/remote/remote-people-search.js");
    expect(PEOPLE_INDEX_URL).toBe("/otef-interactive/public/processed/layers/nli/people-search-index.json");
    expect(PEOPLE_RELEASE_METADATA_URL).toBe("/otef-interactive/public/processed/layers/nli/release-metadata.json");
  });

  test("validates version and promoted index bytes, then caches the two-file load", async () => {
    const { createPeopleSearchRuntime } = await import("../../frontend/src/remote/remote-people-search.js");
    const fetchJson = vi.fn(fetcher);
    const runtime = createPeopleSearchRuntime({ fetchJson, hashBytes: async () => "hash" });
    await Promise.all([runtime.load(), runtime.load()]);
    expect(fetchJson).toHaveBeenCalledTimes(2);
    expect(runtime.datasetVersion()).toBe("v1");
  });

  test("fails closed on version or promoted byte hash mismatch", async () => {
    const { createPeopleSearchRuntime } = await import("../../frontend/src/remote/remote-people-search.js");
    await expect(createPeopleSearchRuntime({ fetchJson: fetcher, hashBytes: async () => "wrong" }).load()).rejects.toThrow(/hash/);
    const mismatched = { ...metadata, datasetVersion: "v2" };
    await expect(createPeopleSearchRuntime({
      fetchJson: (url) => Promise.resolve({ data: url.includes("release") ? mismatched : index, bytes: new Uint8Array([1]) }),
      hashBytes: async () => "hash",
    }).load()).rejects.toThrow(/version/);
  });

  test("ranks exact, prefix, and substring matches by PID, caps eight, and resolves names safely", async () => {
    const { createPeopleSearchRuntime } = await import("../../frontend/src/remote/remote-people-search.js");
    const runtime = createPeopleSearchRuntime({ fetchJson: fetcher, hashBytes: async () => "hash" });
    await runtime.load();
    expect(runtime.search("david", "en").map((row) => row.pid)).toEqual(["1", "2"]);
    expect(runtime.search("eri", "en")[0].pid).toBe("2");
    expect(runtime.resolve("1", "v1")).toMatchObject({ pid: "1", hasArchiveRecord: true });
    expect(runtime.resolve("2", "v1")).toMatchObject({ pid: "2", name: "David Cohen", location: "Be'eri", hasArchiveRecord: false });
    expect(runtime.resolve("2", "v2")).toBeNull();
    expect(runtime.search("", "en")).toEqual([]);
  });

  test("supports acknowledged selection and clears before returning to settlements", async () => {
    const { initRemotePlaceNavigation } = await import("../../frontend/src/remote/remote-place-navigation.js");
    const listeners = new Map();
    const make = (id) => {
      const handlers = new Map();
      const classNames = new Set();
      const el = { id, value: "", children: [], hidden: false, dataset: {}, attributes: {}, className: "", classList: { toggle(name, enabled) { enabled ? classNames.add(name) : classNames.delete(name); }, contains: (name) => classNames.has(name) }, focus: vi.fn(),
        setAttribute(k, v) { this.attributes[k] = String(v); }, removeAttribute(k) { delete this.attributes[k]; }, getAttribute(k) { return this.attributes[k] ?? null; },
        addEventListener(k, fn) { handlers.set(k, fn); }, dispatchEvent(event) { handlers.get(event.type)?.(event); }, append(c) { this.children.push(c); c.parentNode = this; }, replaceChildren(...c) { this.children = c; },
        showModal: vi.fn(), close: vi.fn(),
      };
      return el;
    };
    const root = make("placeSearchGroup");
    const input = make("placeSearchInput");
    const clear = make("placeSearchClear");
    const list = make("placeSuggestions");
    const status = make("placeSearchStatus");
    const settlementButton = make("settlements"); settlementButton.dataset.searchMode = "settlements";
    const peopleButton = make("people"); peopleButton.dataset.searchMode = "people";
    root.querySelector = (selector) => ({ "#placeSearchInput": input, "#placeSearchClear": clear, "#placeSuggestions": list, "#placeSearchStatus": status }[selector] || null);
    root.querySelectorAll = (selector) => selector === "[data-search-mode]" ? [settlementButton, peopleButton] : [];
    root.closest = () => root;
    const doc = { createElement: () => make("child"), addEventListener: vi.fn(), removeEventListener: vi.fn(), querySelectorAll: () => list.children, querySelector: () => list.children[0], getElementById: () => null };
    vi.stubGlobal("document", doc);
    vi.stubGlobal("window", { addEventListener: vi.fn(), removeEventListener: vi.fn() });
    const person = { pid: "1", name: "David Cohen", location: "Alumim", hasArchiveRecord: true, datasetVersion: "v1" };
    const otherPerson = { pid: "2", name: "Dana Levi", location: "Be'eri", hasArchiveRecord: false, datasetVersion: "v1" };
    let snapshot = { personId: null, datasetVersion: null, revision: 0 }; let forceAckRevision = 0;
    const dataContext = { getPersonSelection: () => snapshot, subscribe: (key, fn) => { listeners.set(key, fn); fn(snapshot); return () => {}; },
      selectPerson: vi.fn(async (pid, version) => { snapshot = { personId: pid, datasetVersion: version, revision: Math.max(snapshot.revision + 1, forceAckRevision) }; listeners.get("personSelection")(snapshot); return { person_selection: snapshot }; }),
      clearPerson: vi.fn(async () => { snapshot = { personId: null, datasetVersion: null, revision: snapshot.revision + 1 }; listeners.get("personSelection")(snapshot); return { person_selection: snapshot }; }),
      archiveWindowCommand: vi.fn(async (action, pid, version, requestId) => {
        listeners.get("archiveWindow")?.({ action, personId: pid, datasetVersion: version, requestId });
        listeners.get("archiveWindowResult")?.({
          personId: pid,
          datasetVersion: version,
          requestId,
          outcome: action === "open" ? "navigation_attempted" : "closed",
        });
        return { acknowledged: true };
      }) };
    const runtime = { load: () => Promise.resolve(), search: () => [person, otherPerson], resolve: (pid, version) => version === "v1" && (pid === "2" ? otherPerson : pid === "1" ? person : null) };
    initRemotePlaceNavigation({ root, dataContext, peopleRuntime: runtime, searchPlaces: () => [] });
    peopleButton.dispatchEvent({ type: "click" });
    input.value = "d";
    input.dispatchEvent({ type: "input" });
    await Promise.resolve();
    expect(list.children).toHaveLength(2);
    expect(input.attributes["aria-activedescendant"]).toBe("person-option-1");
    input.dispatchEvent({ type: "keydown", key: "End", preventDefault: vi.fn() });
    expect(input.attributes["aria-activedescendant"]).toBe("person-option-2");
    input.dispatchEvent({ type: "keydown", key: "Home", preventDefault: vi.fn() });
    expect(input.attributes["aria-activedescendant"]).toBe("person-option-1");
    input.dispatchEvent({ type: "keydown", key: "Escape", preventDefault: vi.fn() });
    expect(list.children).toHaveLength(0);
    input.dispatchEvent({ type: "input" });
    await Promise.resolve();
    list.children[0].dispatchEvent({ type: "click" });
    await Promise.resolve();
    expect(dataContext.selectPerson).toHaveBeenCalledWith("1", "v1");
    expect(input.value).toBe("David Cohen");
    expect(root.classList.contains("is-pending")).toBe(false);
    const archiveButton = root.children[0];
    const missingDialog = root.children[1];
    expect(archiveButton.hidden).toBe(false);
    archiveButton.dispatchEvent({ type: "click" });
    await Promise.resolve(); await Promise.resolve();
    expect(dataContext.archiveWindowCommand.mock.calls[0].slice(0, 3)).toEqual(["open", "1", "v1"]);
    expect(root.classList.contains("is-archive-open")).toBe(true);
    snapshot = { personId: null, datasetVersion: null, revision: 2 };
    listeners.get("personSelection")(snapshot);
    expect(root.classList.contains("is-archive-open")).toBe(false);
    snapshot = { personId: "1", datasetVersion: "v1", revision: 3 };
    listeners.get("personSelection")(snapshot);
    await Promise.resolve(); await Promise.resolve();
    archiveButton.dispatchEvent({ type: "click" });
    await Promise.resolve(); await Promise.resolve();
    expect(root.classList.contains("is-archive-open")).toBe(true);
    archiveButton.dispatchEvent({ type: "click" });
    await Promise.resolve(); await Promise.resolve();
    expect(dataContext.archiveWindowCommand.mock.calls[2].slice(0, 3)).toEqual(["close", "1", "v1"]);
    expect(root.classList.contains("is-archive-open")).toBe(false);
    dataContext.archiveWindowCommand.mockResolvedValueOnce(undefined);
    archiveButton.dispatchEvent({ type: "click" });
    await Promise.resolve(); await Promise.resolve();
    expect(root.classList.contains("is-archive-open")).toBe(false);
    clear.dispatchEvent({ type: "click" });
    expect(input.value).toBe("David Cohen");
    dataContext.clearPerson.mockRejectedValueOnce(new Error("timeout"));
    settlementButton.dispatchEvent({ type: "click" });
    await Promise.resolve();
    expect(settlementButton.attributes["aria-pressed"]).toBe("false");
    expect(input.value).toBe("David Cohen");
    settlementButton.dispatchEvent({ type: "click" });
    await Promise.resolve();
    expect(dataContext.clearPerson).toHaveBeenCalledTimes(2);
    expect(settlementButton.attributes["aria-pressed"]).toBe("true");
    peopleButton.dispatchEvent({ type: "click" });
    await Promise.resolve();
    expect(archiveButton.hidden).toBe(true);
    snapshot = { personId: "2", datasetVersion: "v1", revision: 5 };
    listeners.get("personSelection")(snapshot);
    await Promise.resolve(); await Promise.resolve();
    expect(input.value).toBe("Dana Levi");
    expect(archiveButton.hidden).toBe(false);
    archiveButton.dispatchEvent({ type: "click" });
    await Promise.resolve();
    expect(missingDialog.showModal).toHaveBeenCalledTimes(1);
    listeners.get("personSelection")({ personId: "1", datasetVersion: "v1", revision: 2 });
    await Promise.resolve();
    expect(input.value).toBe("Dana Levi");
    listeners.get("personSelection")({ personId: "missing", datasetVersion: "v1", revision: 6 });
    await Promise.resolve();
    expect(input.value).toBe("Dana Levi");
    listeners.get("personSelection")({ personId: "1", datasetVersion: "v2", revision: 7 });
    await Promise.resolve();
    expect(input.value).toBe("Dana Levi");
    listeners.get("personSelection")({ personId: "1", datasetVersion: "v1", revision: 4 });
    await Promise.resolve();
    expect(input.value).toBe("Dana Levi");
    forceAckRevision = 8;
    input.value = "d";
    input.dispatchEvent({ type: "input" });
    await Promise.resolve();
    await Promise.resolve();
    input.dispatchEvent({ type: "keydown", key: "Enter", preventDefault: vi.fn() });
    await Promise.resolve();
    expect(dataContext.selectPerson).toHaveBeenCalledTimes(2);
    dataContext.selectPerson.mockRejectedValueOnce(new Error("rejected"));
    input.value = "d"; input.dispatchEvent({ type: "input" }); await Promise.resolve(); await Promise.resolve();
    list.children[0].dispatchEvent({ type: "click" }); await Promise.resolve();
    expect(input.value).toBe("David Cohen");
    let resolveLate;
    dataContext.selectPerson.mockImplementationOnce(() => new Promise((resolve) => { resolveLate = resolve; }));
    input.value = "d"; input.dispatchEvent({ type: "input" }); await Promise.resolve(); await Promise.resolve();
    list.children[0].dispatchEvent({ type: "click" });
    resolveLate({ person_selection: { personId: "1", datasetVersion: "v1", revision: 1 } });
    await Promise.resolve(); await Promise.resolve();
    expect(input.value).toBe("David Cohen");
    listeners.get("personSelection")({ personId: null, datasetVersion: null, revision: 9 });
    await Promise.resolve();
    expect(input.value).toBe("");
    expect(root.classList.contains("is-pending")).toBe(false);
  });

  test("keeps a newer acknowledged clear ahead of an older valid hydration", async () => {
    const { initRemotePlaceNavigation } = await import("../../frontend/src/remote/remote-place-navigation.js");
    const el = (id) => { const handlers = {}; return { id, value: "", children: [], dataset: {}, attributes: {}, hidden: false, classList: { toggle() {}, contains: () => false }, focus: vi.fn(), setAttribute(k, v) { this.attributes[k] = String(v); }, removeAttribute(k) { delete this.attributes[k]; }, addEventListener(k, f) { handlers[k] = f; }, dispatchEvent(e) { handlers[e.type]?.(e); }, append(c) { this.children.push(c); }, replaceChildren(...c) { this.children = c; } }; };
    const root = el("placeSearchGroup"), input = el("placeSearchInput"), clear = el("placeSearchClear"), list = el("placeSuggestions"), status = el("placeSearchStatus"), settlement = el("settlement"), people = el("people");
    settlement.dataset.searchMode = "settlements"; people.dataset.searchMode = "people";
    root.querySelector = (s) => ({ "#placeSearchInput": input, "#placeSearchClear": clear, "#placeSuggestions": list, "#placeSearchStatus": status }[s] || null); root.querySelectorAll = (s) => s === "[data-search-mode]" ? [settlement, people] : [];
    vi.stubGlobal("document", { createElement: () => el("child"), addEventListener: vi.fn(), removeEventListener: vi.fn(), getElementById: () => null }); vi.stubGlobal("window", { addEventListener: vi.fn(), removeEventListener: vi.fn() });
    const person = { pid: "3", name: "Rina", location: "Be'eri", datasetVersion: "v1" }; let notify; const context = { getPersonSelection: () => ({ personId: "3", datasetVersion: "v1", revision: 3 }), subscribe: (key, fn) => { if (key === "personSelection") { notify = fn; fn({ personId: "3", datasetVersion: "v1", revision: 3 }); } return () => {}; } };
    const runtime = { load: () => Promise.resolve(), search: () => [], resolve: () => person };
    initRemotePlaceNavigation({ root, dataContext: context, peopleRuntime: runtime, searchPlaces: () => [] }); people.dispatchEvent({ type: "click" }); await Promise.resolve(); await Promise.resolve();
    expect(input.value).toBe("Rina"); notify({ personId: null, datasetVersion: null, revision: 5 }); await Promise.resolve(); expect(input.value).toBe(""); notify({ personId: "3", datasetVersion: "v1", revision: 4 }); await Promise.resolve(); expect(input.value).toBe("");
  });
});
