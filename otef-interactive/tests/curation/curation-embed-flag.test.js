import { describe, expect, test } from "vitest";
import {
  getCurationEmbedModeFromSearch,
  isOtefCurationEmbedded,
  isOtefCurationInIframeContext,
} from "../../frontend/src/curation/curation-embed.js";

describe("curation embed flag", () => {
  test("getCurationEmbedModeFromSearch accepts embed=1 and embed=true", () => {
    expect(getCurationEmbedModeFromSearch("?embed=1")).toBe(true);
    expect(getCurationEmbedModeFromSearch("?embed=true")).toBe(true);
    expect(getCurationEmbedModeFromSearch("embed=1")).toBe(true);
    expect(getCurationEmbedModeFromSearch("?embed=0")).toBe(false);
    expect(getCurationEmbedModeFromSearch("")).toBe(false);
    expect(getCurationEmbedModeFromSearch("?other=1")).toBe(false);
  });

  test("isOtefCurationInIframeContext is false when self equals top", () => {
    const prev = globalThis.window;
    try {
      const topRef = {};
      globalThis.window = { self: topRef, top: topRef };
      expect(isOtefCurationInIframeContext()).toBe(false);
    } finally {
      globalThis.window = prev;
    }
  });

  test("isOtefCurationInIframeContext is true in a nested frame (self !== top)", () => {
    const prev = globalThis.window;
    try {
      globalThis.window = { self: {}, top: {} };
      expect(isOtefCurationInIframeContext()).toBe(true);
    } finally {
      globalThis.window = prev;
    }
  });

  test("isOtefCurationEmbedded is true only with embed flag and iframe context", () => {
    const prev = globalThis.window;
    try {
      const topRef = {};
      globalThis.window = {
        location: { search: "?embed=1" },
        self: topRef,
        top: topRef,
      };
      expect(isOtefCurationEmbedded()).toBe(false);

      globalThis.window = {
        location: { search: "?embed=1" },
        self: {},
        top: {},
      };
      expect(isOtefCurationEmbedded()).toBe(true);

      globalThis.window = {
        location: { search: "" },
        self: {},
        top: {},
      };
      expect(isOtefCurationEmbedded()).toBe(false);
    } finally {
      globalThis.window = prev;
    }
  });
});
