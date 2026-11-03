import { expect, test, vi } from "vitest";
import { copyUrl } from "../../frontend/src/shared/copy-url.js";

function documentStub({ execResult = true } = {}) {
  const textarea = { value: "", select: vi.fn(), setAttribute: vi.fn(), style: {} };
  return {
    createElement: vi.fn(() => textarea),
    body: { appendChild: vi.fn(), removeChild: vi.fn() },
    execCommand: vi.fn(() => execResult),
  };
}

test("uses Clipboard API when available", async () => {
  const writeText = vi.fn().mockResolvedValue(undefined);
  expect(await copyUrl("https://example.test/", { navigator: { clipboard: { writeText } } })).toBe(true);
  expect(writeText).toHaveBeenCalledWith("https://example.test/");
});

test("falls back after rejected Clipboard API and reports legacy failure honestly", async () => {
  const document = documentStub({ execResult: false });
  const writeText = vi.fn().mockRejectedValue(new Error("denied"));
  expect(await copyUrl("http://localhost/", { navigator: { clipboard: { writeText } }, document })).toBe(false);
  expect(document.execCommand).toHaveBeenCalledWith("copy");
});

test("legacy fallback can succeed without Clipboard API", async () => {
  expect(await copyUrl("http://localhost/", { navigator: {}, document: documentStub() })).toBe(true);
});
