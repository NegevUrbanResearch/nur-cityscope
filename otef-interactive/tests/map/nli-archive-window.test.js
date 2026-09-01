import { readFileSync } from "node:fs";
import { describe, expect, test, vi } from "vitest";
import { createNliArchiveCommandBridge, createNliArchiveWindowController } from "../../frontend/src/map/nli-archive-window.js";

describe("NLI archive window controller", () => {
  test("opens the final validated NLI URL on demand in the named top-level window", () => {
    const handle = { closed: false, location: {} };
    const open = vi.fn(() => handle);
    const c = createNliArchiveWindowController({ windowOpen: open });
    const url = "https://www.nli.org.il/he/authorities/11";
    expect(c.navigate(url)).toEqual({ ok: true });
    expect(open).toHaveBeenCalledWith(url, "otef-nli-archive");
    expect(c.getHandle()).toBe(handle);
  });

  test("reports unavailable when the browser denies the on-demand popup", () => {
    const open = vi.fn(() => null);
    const c = createNliArchiveWindowController({ windowOpen: open });
    const url = "https://www.nli.org.il/he/authorities/11";
    expect(c.navigate(url)).toEqual({ ok: false, reason: "unavailable" });
    expect(open).toHaveBeenCalledWith(url, "otef-nli-archive");
    expect(c.getHandle()).toBeNull();
  });

  test("reuses an existing named window for a later validated URL", () => {
    const handle = { closed: false, location: {} };
    const open = vi.fn(() => handle);
    const c = createNliArchiveWindowController({ windowOpen: open });
    c.navigate("https://www.nli.org.il/he/authorities/11");
    expect(c.navigate("https://www.nli.org.il/he/authorities/12")).toEqual({ ok: true });
    expect(open).toHaveBeenCalledTimes(1);
    expect(handle.location.href).toBe("https://www.nli.org.il/he/authorities/12");
  });

  test("does not reactivate an archive after close cancels a pending navigation result", async () => {
    let releaseNavigationResult;
    const controller = {
      navigate: vi.fn(() => ({ ok: true })),
      close: vi.fn(() => ({ ok: true })),
    };
    const emitResult = vi.fn()
      .mockImplementationOnce(() => new Promise((resolve) => { releaseNavigationResult = resolve; }))
      .mockResolvedValue(undefined);
    const bridge = createNliArchiveCommandBridge({
      windowController: controller,
      resolvePerson: async () => ({ nliUrl: "https://www.nli.org.il/he/authorities/1" }),
      getPersonSelection: () => ({ personId: "1", datasetVersion: "v1" }),
      emitResult,
    });

    const opening = bridge.handleCommand({ action: "open", personId: "1", datasetVersion: "v1", requestId: "r-open", sourceId: "remote" });
    await Promise.resolve();
    await Promise.resolve();
    expect(emitResult).toHaveBeenCalledWith(expect.objectContaining({ requestId: "r-open", outcome: "navigation_attempted" }));

    await bridge.handleCommand({ action: "close", personId: "1", datasetVersion: "v1", requestId: "r-close", sourceId: "remote" });
    releaseNavigationResult();
    await opening;

    bridge.handlePersonSelection({ personId: "2", datasetVersion: "v1" });
    expect(controller.close).toHaveBeenCalledTimes(1);
  });

  test("reopens the named window when the retained handle is closed", () => {
    const firstHandle = { closed: false, location: {} };
    const secondHandle = { closed: false, location: {} };
    const open = vi.fn()
      .mockReturnValueOnce(firstHandle)
      .mockReturnValueOnce(secondHandle);
    const c = createNliArchiveWindowController({ windowOpen: open });
    const url = "https://www.nli.org.il/he/authorities/11";
    expect(c.navigate(url)).toEqual({ ok: true });
    firstHandle.closed = true;
    expect(c.navigate(url)).toEqual({ ok: true });
    expect(open).toHaveBeenLastCalledWith(url, "otef-nli-archive");
    expect(open).toHaveBeenCalledTimes(2);
  });

  test("closes the retained named window and is safe when no window exists", () => {
    const handle = { closed: false, close: vi.fn(), location: {} };
    const focus = vi.fn();
    const c = createNliArchiveWindowController({ windowOpen: vi.fn(() => handle), focus });
    c.navigate("https://www.nli.org.il/he/authorities/11");
    expect(c.close()).toEqual({ ok: true });
    expect(handle.close).toHaveBeenCalledTimes(1);
    expect(c.close()).toEqual({ ok: true });
    expect(focus).toHaveBeenCalledTimes(2);
  });

  test("focuses the archive window after navigation and restores the opener only on close", () => {
    const handle = { closed: false, location: {}, focus: vi.fn(), close: vi.fn() };
    const openerFocus = vi.fn();
    const c = createNliArchiveWindowController({ windowOpen: vi.fn(() => handle), focus: openerFocus });

    c.navigate("https://www.nli.org.il/he/authorities/11");
    expect(handle.focus).toHaveBeenCalledTimes(1);
    expect(openerFocus).not.toHaveBeenCalled();

    c.close();
    expect(openerFocus).toHaveBeenCalledTimes(1);
  });

  test("rejects non-NLI and non-HTTPS URLs", () => {
    const open = vi.fn();
    const c = createNliArchiveWindowController({ windowOpen: open });
    expect(c.open("https://example.test/record")).toMatchObject({ ok: false, reason: "invalid_url" });
    expect(c.open("http://www.nli.org.il/he/authorities/11")).toMatchObject({ ok: false, reason: "invalid_url" });
    expect(open).not.toHaveBeenCalled();
  });

  test("removes the GIS archive setup control and status", () => {
    const html = readFileSync(new URL("../../frontend/index.html", import.meta.url), "utf8");
    const mapMain = readFileSync(new URL("../../frontend/src/entries/map-main.js", import.meta.url), "utf8");
    const styles = readFileSync(new URL("../../frontend/css/styles.css", import.meta.url), "utf8");
    expect(html).not.toContain("enableNliArchive");
    expect(html).not.toContain("nliArchiveSetupStatus");
    expect(mapMain).not.toContain("enableNliArchive");
    expect(mapMain).not.toContain("nliArchiveSetupStatus");
    expect(styles).not.toContain("#enableNliArchive");
    expect(styles).not.toContain("#nliArchiveSetup");
  });

  test("closes on selection change and ignores a delayed close for another person", async () => {
    const controller = { navigate: vi.fn(() => ({ ok: true })), close: vi.fn(() => ({ ok: true })) };
    const results = vi.fn();
    let selection = { personId: "1", datasetVersion: "v1" };
    const bridge = createNliArchiveCommandBridge({
      windowController: controller,
      resolvePerson: async (personId) => ({ pid: personId, nliUrl: `https://www.nli.org.il/he/authorities/${personId}` }),
      getPersonSelection: () => selection,
      emitResult: results,
    });
    await bridge.handleCommand({ action: "open", personId: "1", datasetVersion: "v1", requestId: "r1", sourceId: "remote" });
    expect(results).toHaveBeenCalledWith(expect.objectContaining({ requestId: "r1", outcome: "navigation_attempted" }));
    await bridge.handleCommand({ action: "close", personId: "2", datasetVersion: "v1" });
    expect(controller.close).not.toHaveBeenCalled();
    selection = { personId: "2", datasetVersion: "v1" };
    bridge.handlePersonSelection(selection);
    expect(controller.close).toHaveBeenCalledTimes(1);
  });

  test("does not open after selection changes during asynchronous resolution", async () => {
    let resolvePerson;
    let selection = { personId: "1", datasetVersion: "v1" };
    const controller = { navigate: vi.fn(), close: vi.fn(() => ({ ok: true })) };
    const results = vi.fn();
    const bridge = createNliArchiveCommandBridge({
      windowController: controller,
      resolvePerson: () => new Promise((resolve) => { resolvePerson = resolve; }),
      getPersonSelection: () => selection,
      emitResult: results,
    });
    const pending = bridge.handleCommand({ action: "open", personId: "1", datasetVersion: "v1", requestId: "r1", sourceId: "remote" });
    selection = { personId: "2", datasetVersion: "v1" };
    bridge.handlePersonSelection(selection);
    resolvePerson({ nliUrl: "https://www.nli.org.il/he/authorities/1" });
    await pending;
    expect(controller.navigate).not.toHaveBeenCalled();
    expect(results).toHaveBeenCalledWith(expect.objectContaining({ requestId: "r1", outcome: "unavailable" }));
  });

  test("reports closed and unavailable outcomes exactly once", async () => {
    const results = vi.fn();
    const bridge = createNliArchiveCommandBridge({
      windowController: {
        navigate: vi.fn(() => ({ ok: false, reason: "closed" })),
        close: vi.fn(() => ({ ok: true })),
      },
      resolvePerson: async () => ({ nliUrl: "https://www.nli.org.il/he/authorities/1" }),
      getPersonSelection: () => ({ personId: "1", datasetVersion: "v1" }),
      emitResult: results,
    });
    await bridge.handleCommand({ action: "open", personId: "1", datasetVersion: "v1", requestId: "r1", sourceId: "remote" });
    await bridge.handleCommand({ action: "close", personId: "1", datasetVersion: "v1", requestId: "r2", sourceId: "remote" });
    expect(results.mock.calls.map(([result]) => result.outcome)).toEqual(["closed", "closed"]);
    expect(results).toHaveBeenCalledTimes(2);
  });

  test("does not permanently dedupe a result when emission fails", async () => {
    const emitResult = vi.fn()
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce(undefined);
    const bridge = createNliArchiveCommandBridge({
      windowController: { navigate: vi.fn(() => ({ ok: false, reason: "closed" })), close: vi.fn(() => ({ ok: true })) },
      resolvePerson: async () => ({ nliUrl: "https://www.nli.org.il/he/authorities/1" }),
      getPersonSelection: () => ({ personId: "1", datasetVersion: "v1" }),
      emitResult,
    });
    await bridge.handleCommand({ action: "open", personId: "1", datasetVersion: "v1", requestId: "r1", sourceId: "remote" });
    await bridge.handleCommand({ action: "open", personId: "1", datasetVersion: "v1", requestId: "r1", sourceId: "remote" });
    expect(emitResult).toHaveBeenCalledTimes(2);
  });

  test("tombstones a timed-out open when close with the same request arrives first", async () => {
    let resolvePerson;
    const navigate = vi.fn(() => ({ ok: true }));
    const results = vi.fn();
    const bridge = createNliArchiveCommandBridge({
      windowController: { navigate, close: vi.fn(() => ({ ok: true })) },
      resolvePerson: () => new Promise((resolve) => { resolvePerson = resolve; }),
      getPersonSelection: () => ({ personId: "1", datasetVersion: "v1" }),
      emitResult: results,
    });
    await bridge.handleCommand({ action: "close", personId: "1", datasetVersion: "v1", requestId: "r-timeout", sourceId: "remote" });
    const opening = bridge.handleCommand({ action: "open", personId: "1", datasetVersion: "v1", requestId: "r-timeout", sourceId: "remote" });
    await opening;
    expect(navigate).not.toHaveBeenCalled();
    expect(results.mock.calls.map(([result]) => result.outcome)).toEqual(["closed"]);
  });
});
