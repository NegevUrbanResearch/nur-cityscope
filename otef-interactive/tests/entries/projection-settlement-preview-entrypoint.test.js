// @vitest-environment jsdom
import { expect, test, vi } from "vitest";

const harness = vi.hoisted(() => ({
  settlement: vi.fn(async () => () => {}),
  clock: vi.fn(async () => () => {}),
  table: vi.fn(),
}));
vi.mock("../../frontend/src/projection/projection-settlement-name-preview.js", () => ({ bootProjectionSettlementNamePreview: harness.settlement }));
vi.mock("../../frontend/src/projection/projection-clock-preview.js", () => ({ bootProjectionClockPreview: harness.clock }));
vi.mock("../../frontend/src/shared/table-switcher.js", () => ({
  default: class TableSwitcher { constructor(...args) { harness.table(...args); } getCurrentTable() { return "otef"; } },
}));
vi.mock("../../frontend/src/shared/table-switcher-popup.js", () => ({ default: class TableSwitcherPopup {} }));

const sockets = [];
window.WebSocket = class { constructor() { sockets.push("socket"); } close() {} };

async function boot(search) {
  vi.resetModules();
  harness.settlement.mockClear();
  harness.clock.mockClear();
  harness.table.mockClear();
  sockets.length = 0;
  window.history.replaceState({}, "", search);
  window.maplibregl = { addProtocol: vi.fn() };
  window.pmtiles = { Protocol: class { tile() {} } };
  window.fetch = vi.fn(async (_url, options = {}) => {
    if (options.method && options.method !== "GET") throw new Error(`write fetch ${options.method}`);
    return { ok: true, json: async () => ({}) };
  });
  const context = await import("../../frontend/src/shared/OTEFDataContext.js");
  const init = vi.spyOn(context.default, "init");
  await import("../../frontend/src/entries/projection-main.js");
  await new Promise((resolve) => setTimeout(resolve, 0));
  return { init };
}

test.each(["left", "right"])("settlement preview %s boots only the settlement frame", async (output) => {
  const { init } = await boot(`/frontend/projection.html?settlementPreview=1&span=${output}&outputMode=browser&previewSession=frame-${output}`);
  expect(harness.settlement).toHaveBeenCalledTimes(1);
  expect(harness.settlement.mock.calls[0][0]).toEqual(expect.objectContaining({ window, document }));
  expect(typeof harness.settlement.mock.calls[0][0].fetchImpl).toBe("function");
  expect(harness.clock).not.toHaveBeenCalled();
  expect(init).not.toHaveBeenCalled();
  expect(harness.table).not.toHaveBeenCalled();
  expect(sockets).toEqual([]);
  expect(window.fetch).not.toHaveBeenCalled();
});

test.each([
  "/frontend/projection.html?settlementPreview=1&span=left&outputMode=browser",
  "/frontend/projection.html?settlementPreview=1&clockPreview=1&span=right&outputMode=browser&previewSession=mixed",
  "/frontend/projection.html?settlementPreview=1&span=middle&outputMode=browser&previewSession=bad",
])("invalid settlement preview %s does not start the exhibit", async (search) => {
  const { init } = await boot(search);
  expect(harness.settlement).not.toHaveBeenCalled();
  expect(harness.clock).not.toHaveBeenCalled();
  expect(init).not.toHaveBeenCalled();
  expect(harness.table).not.toHaveBeenCalled();
  expect(sockets).toEqual([]);
});
