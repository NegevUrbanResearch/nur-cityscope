import { expect, test } from "vitest";
import { createUuid } from "../../frontend/src/shared/uuid.js";

test("creates a UUID v4 with getRandomValues when randomUUID is unavailable", () => {
  const value = createUuid({ randomUUID: undefined, getRandomValues: (bytes) => {
    bytes.fill(0);
    bytes[6] = 0x40;
    bytes[8] = 0x80;
    return bytes;
  } });
  expect(value).toBe("00000000-0000-4000-8000-000000000000");
});

test("fails when no secure UUID source is available", () => {
  expect(() => createUuid({})).toThrow("secure random UUID generation is unavailable");
});
