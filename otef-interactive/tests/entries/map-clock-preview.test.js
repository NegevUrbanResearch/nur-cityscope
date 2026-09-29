// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";

const spies = vi.hoisted(() => ({
  previewBoot: vi.fn(async () => async () => {}),
  init: vi.fn(),
  subscribe: vi.fn(),
  map: vi.fn(),
  viewport: vi.fn(),
  archive: vi.fn(),
  popup: vi.fn(),
  video: vi.fn(),
  presentation: vi.fn(),
  tableSwitcher: vi.fn(),
  websocketSetup: vi.fn(),
}));

vi.mock("../../frontend/src/map/clock-preview.js", () => ({
  bootClockPreview: spies.previewBoot,
}));
vi.mock("../../frontend/src/shared/OTEFDataContext.js", () => ({
  default: { init: spies.init, subscribe: spies.subscribe },
}));
vi.mock("../../frontend/src/shared/table-switcher.js", () => ({
  default: class {
    constructor() { spies.tableSwitcher(); }
    getCurrentTable() { return "otef"; }
  },
}));
vi.mock("../../frontend/src/shared/table-switcher-popup.js", () => ({ default: class { constructor() {} } }));
vi.mock("../../frontend/src/map/maplibre-map.js", () => ({
  createGISMap: spies.map,
  setGISBasemap: vi.fn(),
  maplibregl: {},
}));
vi.mock("../../frontend/src/map/maplibre-viewport-sync.js", () => ({ setupViewportSync: spies.viewport }));
vi.mock("../../frontend/src/map/nli-archive-window.js", () => ({
  createNliArchiveCommandBridge: spies.archive,
  createNliArchiveWindowController: spies.archive,
}));
vi.mock("../../frontend/src/map/maplibre-gis-popups.js", () => ({ attachGisFeaturePopups: spies.popup }));
vi.mock("../../frontend/src/shared/nli-video-playback-channel.js", () => ({ createNliVideoPlaybackPublisher: spies.video }));
vi.mock("../../frontend/src/shared/nli-presentation-manifest.js", () => ({ loadNliPresentationManifest: spies.presentation }));
vi.mock("../../frontend/src/shared/otef-data-context/OTEFDataContext-websocket.js", () => ({
  setupWebSocket: spies.websocketSetup,
}));

describe("isolated GIS clock preview boot", () => {
  afterEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    window.history.replaceState({}, "", "/otef-interactive/index.html");
  });

  it("branches before any live GIS initialization or action wiring", async () => {
    window.history.replaceState({}, "", "/otef-interactive/index.html?clockPreview=1&previewSession=session-a");

    await import("../../frontend/src/entries/map-main.js");
    await vi.waitFor(() => expect(spies.previewBoot).toHaveBeenCalledTimes(1));

    expect(spies.previewBoot).toHaveBeenCalledWith(expect.objectContaining({
      window: expect.anything(),
      document: expect.anything(),
      fetchImpl: expect.any(Function),
    }));
    expect(spies.init).not.toHaveBeenCalled();
    expect(spies.subscribe).not.toHaveBeenCalled();
    expect(spies.map).not.toHaveBeenCalled();
    expect(spies.viewport).not.toHaveBeenCalled();
    expect(spies.archive).not.toHaveBeenCalled();
    expect(spies.popup).not.toHaveBeenCalled();
    expect(spies.video).not.toHaveBeenCalled();
    expect(spies.presentation).not.toHaveBeenCalled();
    expect(spies.tableSwitcher).not.toHaveBeenCalled();
    expect(spies.websocketSetup).not.toHaveBeenCalled();
  });
});
