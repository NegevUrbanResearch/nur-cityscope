import { afterEach, describe, expect, it, vi } from "vitest";

import {
  SLIDESHOW_CHANNEL_NAME,
  slideshowPost,
} from "../../frontend/src/shared/slideshow-projection-channel.js";

const channelCtor = vi.fn();

function installBroadcastChannelMock() {
  channelCtor.mockImplementation(function BroadcastChannelMock(name) {
    this.name = name;
    this.postMessage = vi.fn();
    this.close = vi.fn();
  });
  vi.stubGlobal(
    "BroadcastChannel",
    /** @type {unknown} */ (channelCtor),
  );
}

describe("slideshow projection channel", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    channelCtor.mockReset();
  });

  it("posts normalized start payload to expected channel", () => {
    installBroadcastChannelMock();
    slideshowPost({
      type: "start",
      payload: {
        packOrder: ["pack_a", "pack_b"],
        intervalMs: 5000,
        crossfadeMs: 800,
        warmupLeadMs: 1200,
      },
    });

    expect(channelCtor).toHaveBeenCalledWith(SLIDESHOW_CHANNEL_NAME);
    const instance = channelCtor.mock.results[0].value;
    expect(instance.postMessage).toHaveBeenCalledWith({
      type: "start",
      payload: {
        packOrder: ["pack_a", "pack_b"],
        intervalMs: 5000,
        crossfadeMs: 800,
        warmupLeadMs: 1200,
      },
    });
    expect(instance.close).toHaveBeenCalledTimes(1);
  });

  it("posts stop with empty payload", () => {
    installBroadcastChannelMock();
    slideshowPost({ type: "stop", payload: { ignored: true } });
    const instance = channelCtor.mock.results[0].value;
    expect(instance.postMessage).toHaveBeenCalledWith({
      type: "stop",
      payload: {},
    });
    expect(instance.close).toHaveBeenCalledTimes(1);
  });
});
