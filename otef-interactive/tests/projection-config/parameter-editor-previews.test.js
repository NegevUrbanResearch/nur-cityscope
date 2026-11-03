// @vitest-environment jsdom
import { afterEach, expect, test, vi } from "vitest";
import { createParameterEditorPreviews } from "../../frontend/src/projection-config/parameter-editor-previews.js";

afterEach(() => { document.body.replaceChildren(); vi.restoreAllMocks(); });
const notify = (frame, data, origin = window.location.origin) => window.dispatchEvent(new MessageEvent("message", { data, origin, source: frame.contentWindow }));

test("shared transform sends the current full draft to both guarded output previews", () => {
  const host = document.createElement("div"); document.body.appendChild(host);
  const onStatus = vi.fn(); const previews = createParameterEditorPreviews({ document, host, onStatus });
  const draft = { pre: { scale: 1.2 }, outputs: { left: { crop: { x0: 0.1 } }, right: { crop: { x0: 0.2 } } } };
  previews.open("pre"); previews.update(draft);
  const frames = [...host.querySelectorAll("iframe")];
  expect(frames.map((frame) => new URL(frame.src).searchParams.get("span"))).toEqual(["left", "right"]);
  for (const [index, frame] of frames.entries()) {
    const side = index === 0 ? "left" : "right";
    const post = vi.spyOn(frame.contentWindow, "postMessage");
    notify(frame, { type: "otef_projection_preview_ready", output: side });
    expect(post).toHaveBeenCalledTimes(1);
    expect(post.mock.calls[0][0]).toMatchObject({ type: "otef_projection_preview_config", output: side, config: draft });
    const { requestId } = post.mock.calls[0][0];
    notify(frame, { type: "otef_projection_preview_applied", output: side, requestId, success: true });
    expect(frame.style.visibility).toBe("visible");
  }
  previews.open("left-crop");
  expect(host.classList.contains("single-preview")).toBe(true);
  expect(host.querySelectorAll("iframe")).toHaveLength(1);
  expect(new URL(host.querySelector("iframe").src).searchParams.get("span")).toBe("left");
  previews.close();
  expect(host.querySelectorAll("iframe")).toHaveLength(0);
  previews.dispose();
});

test("Crop and Fit previews use the node's projector and preserve retry and teardown", () => {
  const host = document.createElement("div"); document.body.appendChild(host);
  const statuses = [];
  const previews = createParameterEditorPreviews({ document, host, onStatus: (message, retry) => statuses.push([message, retry]) });
  previews.open("right-fit"); previews.update({ pre: { scale: 1 }, outputs: { right: { post: { scale: 1.3 } } } });
  let frame = host.querySelector("iframe");
  const post = vi.spyOn(frame.contentWindow, "postMessage");
  expect(new URL(frame.src).searchParams.get("span")).toBe("right");
  notify(frame, { type: "otef_projection_preview_ready", output: "right" }, "https://wrong.example");
  expect(frame.style.visibility).toBe("hidden");
  notify(frame, { type: "otef_projection_preview_ready", output: "right" });
  const requestId = post.mock.calls[0][0].requestId;
  notify(frame, { type: "otef_projection_preview_applied", output: "right", requestId: requestId + 1, success: true });
  expect(frame.style.visibility).toBe("hidden");
  notify(frame, { type: "otef_projection_preview_applied", output: "right", requestId, success: true });
  expect(frame.style.visibility).toBe("visible");
  previews.retry("right");
  const reloaded = host.querySelector("iframe");
  expect(reloaded).not.toBe(frame);
  notify(frame, { type: "otef_projection_preview_ready", output: "right" });
  expect(reloaded.style.visibility).toBe("hidden");
  expect(statuses.some(([, retry]) => retry)).toBe(false);
  previews.open("left-crop");
  frame = host.querySelector("iframe");
  expect(new URL(frame.src).searchParams.get("span")).toBe("left");
  previews.close(); previews.dispose();
  expect(host.querySelectorAll("iframe")).toHaveLength(0);
});

test("Applied timeout keeps the last successful frame stale and ignores retired acknowledgments", () => {
  vi.useFakeTimers();
  const host = document.createElement("div"); document.body.appendChild(host);
  const statuses = [];
  const previews = createParameterEditorPreviews({ document, host, onStatus: (message, retry) => statuses.push([message, retry]) });
  const firstDraft = { pre: { scale: 1 } };
  previews.open("left-crop"); previews.update(firstDraft);
  let frame = host.querySelector("iframe");
  const post = vi.spyOn(frame.contentWindow, "postMessage");
  notify(frame, { type: "otef_projection_preview_ready", output: "left" });
  const firstRequest = post.mock.calls[0][0].requestId;
  notify(frame, { type: "otef_projection_preview_applied", output: "left", requestId: firstRequest, success: true });
  expect(frame.style.visibility).toBe("visible");

  const intermediateDraft = { pre: { scale: 1.05 } };
  previews.update(intermediateDraft);
  const intermediateRequest = post.mock.calls[1][0].requestId;
  vi.advanceTimersByTime(29000);
  const secondDraft = { pre: { scale: 1.1 } };
  previews.update(secondDraft);
  const secondRequest = post.mock.calls[2][0].requestId;
  expect(frame.style.visibility).toBe("visible");
  expect(statuses.at(-1)[0]).toMatch(/stale/i);
  notify(frame, { type: "otef_projection_preview_applied", output: "left", requestId: intermediateRequest, success: false, error: "retired" });
  expect(statuses.at(-1)[0]).toMatch(/stale/i);
  vi.advanceTimersByTime(29999);
  expect(statuses.at(-1)[1]).toBe(false);
  vi.advanceTimersByTime(1);
  expect(statuses.at(-1)).toEqual([expect.stringMatching(/did not finish/i), true]);

  notify(frame, { type: "otef_projection_preview_applied", output: "left", requestId: secondRequest, success: true });
  expect(statuses.at(-1)).toEqual([expect.stringMatching(/did not finish/i), true]);
  expect(frame.style.visibility).toBe("visible");

  previews.retry("left");
  const freshFrame = host.querySelector("iframe");
  expect(freshFrame).not.toBe(frame);
  expect(statuses.at(-1)[1]).toBe(false);
  previews.close(); previews.dispose();
  vi.useRealTimers();
});

test("Ready without Applied leaves an empty error state and allows Retry", () => {
  vi.useFakeTimers();
  const host = document.createElement("div"); document.body.appendChild(host);
  const statuses = [];
  const previews = createParameterEditorPreviews({ document, host, onStatus: (message, retry) => statuses.push([message, retry]) });
  previews.open("left-crop"); previews.update({ pre: { scale: 1 } });
  const frame = host.querySelector("iframe");
  const post = vi.spyOn(frame.contentWindow, "postMessage");
  notify(frame, { type: "otef_projection_preview_ready", output: "left" });
  const requestId = post.mock.calls[0][0].requestId;
  vi.advanceTimersByTime(30000);
  expect(statuses.at(-1)).toEqual([expect.stringMatching(/did not finish/i), true]);
  expect(frame.style.visibility).toBe("hidden");
  notify(frame, { type: "otef_projection_preview_applied", output: "left", requestId, success: true });
  expect(statuses.at(-1)).toEqual([expect.stringMatching(/did not finish/i), true]);
  expect(frame.style.visibility).toBe("hidden");
  previews.retry("left");
  expect(host.querySelector("iframe")).not.toBe(frame);
  previews.close(); previews.dispose();
  expect(vi.getTimerCount()).toBe(0);
  vi.useRealTimers();
});
