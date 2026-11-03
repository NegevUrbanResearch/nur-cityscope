import { createHash } from "node:crypto";
import { describe, expect, test, vi } from "vitest";
import { sha256Hex } from "../../frontend/src/shared/sha256-hex.js";

describe("sha256Hex fallback", () => {
  test("matches NIST vectors when SubtleCrypto is missing", async () => {
    vi.stubGlobal("crypto", { subtle: undefined });
    try {
      expect(await sha256Hex(new Uint8Array())).toBe(
        "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
      );
      expect(await sha256Hex(new TextEncoder().encode("abc"))).toBe(
        "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
      );
      const bytes = Uint8Array.from({ length: 200 }, (_, i) => i);
      expect(await sha256Hex(bytes)).toBe(createHash("sha256").update(bytes).digest("hex"));
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
