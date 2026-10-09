/** @vitest-environment jsdom */
import { expect, test } from "vitest";
import { navigationButtonContent } from "../../frontend/src/remote/nli-staff-icons.js";

test.each([
  ["he", "next", "הבא", "M19 12H5m6-6-6 6 6 6", "SPAN"],
  ["he", "previous", "הקודם", "M5 12h14m-6-6 6 6-6 6", "svg"],
  ["en", "next", "Next", "M5 12h14m-6-6 6 6-6 6", "SPAN"],
  ["en", "previous", "Previous", "M19 12H5m6-6-6 6 6 6", "svg"],
])("%s %s has the correct arrow and retains its label", (locale, action, label, path, firstTag) => {
  const button = document.createElement("button");
  button.innerHTML = navigationButtonContent(label, action, locale);
  expect(button.textContent).toBe(label);
  expect(button.querySelector("svg").getAttribute("aria-hidden")).toBe("true");
  expect(button.querySelector("path").getAttribute("d")).toBe(path);
  expect(button.firstElementChild.tagName).toBe(firstTag);
});
