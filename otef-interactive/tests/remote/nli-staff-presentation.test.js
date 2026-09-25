import { afterEach, describe, expect, test, vi } from "vitest";
import {
  createNliStaffPresentationController,
  presentationControlsHtml,
} from "../../frontend/src/remote/nli-staff-presentation.js";

const step = { presentation: { segmentId: "nova_mor", open: "manual", onClose: "stay" } };
const shuraStep = { presentation: { segmentId: "shura", open: "auto", onClose: "resume" } };

function makeControllerHarness() {
  const sent = [];
  let resultListener;
  const dataContext = {
    subscribe(topic, listener) {
      if (topic === "narrativePresentationResult") resultListener = listener;
      return () => { resultListener = null; };
    },
    narrativePresentationCommand: vi.fn(async (command) => {
      sent.push(command);
      return { status: "ok" };
    }),
  };
  const controller = createNliStaffPresentationController({ dataContext, onStateChange: vi.fn() });
  const reply = (fields) => resultListener({ ...sent.at(-1), ...fields });
  const openAndReply = async (segmentId) => {
    const pending = controller.run("open", segmentId);
    reply({ outcome: "opened", slide: segmentId === "hostages" ? 29 : 9,
      range: segmentId === "hostages" ? [29, 34] : [9, 11] });
    return pending;
  };
  return { controller, sent, reply, openAndReply };
}

afterEach(() => vi.useRealTimers());

describe("NLI staff presentation controller", () => {
  test("open state renders Previous, Next, Close, and the confirmed relative counter", async () => {
    const h = makeControllerHarness();
    const opening = h.controller.run("open", "nova_mor");
    h.reply({ outcome: "opened", slide: 9, range: [9, 11] });
    await opening;
    const html = presentationControlsHtml(step, h.controller.getState(), "en");
    expect(html).toMatch(/1 \/ 3/);
    expect(html).toMatch(/Previous/);
    expect(html).toMatch(/Next/);
    expect(html).toMatch(/Close/);
    expect(html).not.toMatch(/play|pause|replay|retry/i);
  });

  test("manual steps show Open while Shura never exposes a manual Open button", () => {
    expect(presentationControlsHtml(step, { phase: "closed" }, "en"))
      .toContain('data-presentation-action="open"');
    expect(presentationControlsHtml(shuraStep, { phase: "closed" }, "en"))
      .not.toContain("data-presentation-action");
  });

  test("navigation waits for a pending slide command, then sends one Close", async () => {
    const h = makeControllerHarness();
    await h.openAndReply("nova_mor");
    const moving = h.controller.run("next", "nova_mor");
    const closing = h.controller.closeForStepChange();
    h.reply({ outcome: "ready", slide: 10, range: [9, 11] });
    await moving;
    expect(h.sent.at(-1).presentationAction).toBe("close");
    h.reply({ outcome: "closed" });
    await closing;
    expect(h.sent.filter((value) => value.presentationAction === "close")).toHaveLength(1);
  });

  test("concurrent forced cleanup calls share one Close promise", async () => {
    const h = makeControllerHarness();
    await h.openAndReply("nova_mor");
    const first = h.controller.closeForStepChange();
    const second = h.controller.closeForStepChange();
    expect(second).toBe(first);
    expect(h.sent.filter((value) => value.presentationAction === "close")).toHaveLength(1);
    h.reply({ outcome: "closed" });
    await first;
  });

  test("failure clears the session and renders status without an Open or Retry button", async () => {
    const h = makeControllerHarness();
    const opening = h.controller.run("open", "shura");
    h.reply({ outcome: "unavailable" });
    await opening;
    const html = presentationControlsHtml(shuraStep, h.controller.getState(), "en");
    expect(html).toContain("Presentation unavailable");
    expect(html).not.toMatch(/data-presentation|retry/i);
    expect(h.controller.getState().sessionId).toBeNull();
  });

  test("forced cleanup clears an unavailable step so a later manual segment can open", async () => {
    const h = makeControllerHarness();
    const opening = h.controller.run("open", "shura");
    h.reply({ outcome: "unavailable" });
    await opening;

    const failedStepHtml = presentationControlsHtml(shuraStep, h.controller.getState(), "en");
    expect(failedStepHtml).toContain("Presentation unavailable");
    expect(failedStepHtml).not.toMatch(/data-presentation|retry/i);

    await expect(h.controller.closeForStepChange()).resolves.toBe(true);
    expect(h.controller.getState().phase).toBe("closed");
    expect(h.sent.map((command) => command.presentationAction)).toEqual(["open"]);

    const hostagesStep = { presentation: { segmentId: "hostages", open: "manual", onClose: "next" } };
    expect(presentationControlsHtml(hostagesStep, h.controller.getState(), "en"))
      .toContain('data-presentation-action="open"');
  });

  test("forced Close unavailable keeps the failed step non-interactive and enables the next manual segment", async () => {
    const h = makeControllerHarness();
    await h.openAndReply("nova_mor");

    const closing = h.controller.closeForStepChange();
    expect(h.sent.at(-1).presentationAction).toBe("close");
    h.reply({ outcome: "unavailable" });
    const failedStepHtml = presentationControlsHtml(step, h.controller.getState(), "en");
    expect(failedStepHtml).toContain("Presentation unavailable");
    expect(failedStepHtml).not.toMatch(/data-presentation|retry/i);

    await expect(closing).resolves.toBe(false);
    const hostagesStep = { presentation: { segmentId: "hostages", open: "manual", onClose: "next" } };
    expect(presentationControlsHtml(hostagesStep, h.controller.getState(), "en"))
      .toContain('data-presentation-action="open"');
  });

  test("forced cleanup joining an explicit Close normalizes its unavailable result after settling", async () => {
    const h = makeControllerHarness();
    await h.openAndReply("nova_mor");

    const explicitClosing = h.controller.run("close", "nova_mor");
    const forcedClosing = h.controller.closeForStepChange();
    expect(h.sent.filter((command) => command.presentationAction === "close")).toHaveLength(1);
    h.reply({ outcome: "unavailable" });

    const failedStepHtml = presentationControlsHtml(step, h.controller.getState(), "en");
    expect(failedStepHtml).toContain("Presentation unavailable");
    expect(failedStepHtml).not.toMatch(/data-presentation|retry/i);
    await expect(explicitClosing).resolves.toBe(false);
    await expect(forcedClosing).resolves.toBe(false);

    const hostagesStep = { presentation: { segmentId: "hostages", open: "manual", onClose: "next" } };
    expect(presentationControlsHtml(hostagesStep, h.controller.getState(), "en"))
      .toContain('data-presentation-action="open"');
  });

  test("a lost Open result retains private correlation so navigation can still Close", async () => {
    vi.useFakeTimers();
    const h = makeControllerHarness();
    const opening = h.controller.run("open", "nova_mor");
    await vi.advanceTimersByTimeAsync(6000);
    expect(await opening).toBe(false);
    const closing = h.controller.closeForStepChange();
    expect(h.sent.at(-1)).toMatchObject({
      presentationAction: "close", presentationSessionId: h.sent[0].presentationSessionId,
    });
    h.reply({ outcome: "closed" });
    await closing;
  });
});
