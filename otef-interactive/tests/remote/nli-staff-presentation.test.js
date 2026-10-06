import { afterEach, describe, expect, test, vi } from "vitest";
import {
  createNliStaffPresentationController,
  presentationControlsHtml,
  shouldAutoOpenNliPresentation,
} from "../../frontend/src/remote/nli-staff-presentation.js";

const step = { presentation: { segmentId: "nova_mor", open: "manual", onClose: "stay" } };
const shuraStep = { presentation: { segmentId: "shura", open: "auto", onClose: "stay" } };
const novaMemorialStep = { presentation: { segmentId: "nova_memorial", open: "auto", onClose: "stay" } };

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
  const replyTo = (command, fields) => resultListener({ ...command, ...fields });
  const openAndReply = async (segmentId) => {
    const pending = controller.run("open", segmentId);
    reply({ outcome: "opened", slide: segmentId === "hostages" ? 29 : 9,
      range: segmentId === "hostages" ? [29, 33] : [9, 11] });
    return pending;
  };
  return { controller, sent, reply, replyTo, openAndReply };
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

  test("only hides Next at a confirmed terminal slide and restores it after Previous", async () => {
    const h = makeControllerHarness();
    await h.openAndReply("nova_mor");
    const nextOne = h.controller.run("next", "nova_mor");
    h.reply({ outcome: "ready", slide: 10, range: [9, 11] });
    await nextOne;
    expect(presentationControlsHtml(step, h.controller.getState(), "en"))
      .toContain('data-presentation-action="next"');

    const nextTwo = h.controller.run("next", "nova_mor");
    h.reply({ outcome: "ready", slide: 11, range: [9, 11] });
    await nextTwo;
    const terminalHtml = presentationControlsHtml(step, h.controller.getState(), "en");
    expect(terminalHtml).not.toContain('data-presentation-action="next"');
    expect(terminalHtml).toContain('data-presentation-action="previous"');
    expect(terminalHtml).toContain('data-presentation-action="close"');

    const previous = h.controller.run("previous", "nova_mor");
    const pendingHtml = presentationControlsHtml(step, h.controller.getState(), "en");
    expect(pendingHtml).not.toContain('data-presentation-action="next"');
    h.reply({ outcome: "ready", slide: 10, range: [9, 11] });
    await previous;
    expect(presentationControlsHtml(step, h.controller.getState(), "en"))
      .toContain('data-presentation-action="next"');

    const toTerminal = h.controller.run("next", "nova_mor");
    h.reply({ outcome: "ready", slide: 11, range: [9, 11] });
    await toTerminal;
    const closing = h.controller.run("close", "nova_mor");
    expect(presentationControlsHtml(step, h.controller.getState(), "en"))
      .not.toContain('data-presentation-action="next"');
    h.reply({ outcome: "closed" });
    await closing;
  });

  test("keeps Next when the open presentation has no known slide range", () => {
    const html = presentationControlsHtml(step, {
      phase: "open", segmentId: step.presentation.segmentId, slide: 11, range: null,
    }, "en");
    expect(html).toContain('data-presentation-action="next"');
  });

  test("manual steps show Open while Shura never exposes a manual Open button", () => {
    expect(presentationControlsHtml(step, { phase: "closed" }, "en"))
      .toContain('data-presentation-action="open"');
    expect(presentationControlsHtml(shuraStep, { phase: "closed" }, "en"))
      .not.toContain("data-presentation-action");
  });

  test("explicit Close of an auto segment offers Open again on the same step", async () => {
    for (const [segmentId, autoStep] of [
      ["shura", shuraStep],
      ["nova_memorial", novaMemorialStep],
    ]) {
      const h = makeControllerHarness();
      await h.openAndReply(segmentId);
      const closing = h.controller.run("close", segmentId);
      h.reply({ outcome: "closed" });
      await closing;
      const html = presentationControlsHtml(autoStep, h.controller.getState(), "en");
      expect(html).toContain('data-presentation-action="open"');
      expect(html).toContain("Open presentation");
      expect(html).not.toContain('data-presentation-action="close"');
    }
  });

  test("names wall never renders presentation controls", () => {
    const wall = { presentation: { segmentId: "names_wall", open: "auto", onClose: "stay", controls: false } };
    const states = [
      { phase: "closed" },
      { phase: "opening", segmentId: "names_wall" },
      { phase: "open", segmentId: "names_wall", slide: 0, range: [0, 0] },
      { phase: "closing", segmentId: "names_wall" },
      { phase: "failed", segmentId: "names_wall", sessionId: null },
      { phase: "failed", segmentId: "names_wall", sessionId: "wall" },
    ];
    for (const state of states) {
      expect(presentationControlsHtml(wall, state, "en")).toBe("");
    }
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

  test("failed auto-open clears the session and offers one manual open retry", async () => {
    vi.useFakeTimers();
    const h = makeControllerHarness();
    const opening = h.controller.run("open", "shura");
    h.reply({ outcome: "unavailable" });
    expect(h.controller.getState().phase).toBe("opening");
    await vi.advanceTimersByTimeAsync(6000);
    await opening;
    const html = presentationControlsHtml(shuraStep, h.controller.getState(), "en");
    expect(html).toContain("Presentation unavailable");
    expect(html).toContain('data-presentation-action="open"');
    expect(html).toContain("Open presentation");
    expect(html).not.toMatch(/retry/i);
    expect(h.controller.getState().sessionId).toBeNull();
    expect(h.sent.filter((command) => command.presentationAction === "open")).toHaveLength(1);
    expect(shouldAutoOpenNliPresentation({
      item: { steps: [shuraStep] },
      index: 0,
      currentScript: { steps: [shuraStep] },
      currentStep: shuraStep,
      cueStatus: "failed",
    })).toBe(false);
  });

  test("forced cleanup clears an unavailable step so a later manual segment can open", async () => {
    vi.useFakeTimers();
    const h = makeControllerHarness();
    const opening = h.controller.run("open", "shura");
    h.reply({ outcome: "unavailable" });
    await vi.advanceTimersByTimeAsync(6000);
    await opening;

    const failedStepHtml = presentationControlsHtml(shuraStep, h.controller.getState(), "en");
    expect(failedStepHtml).toContain("Presentation unavailable");
    expect(failedStepHtml).toContain('data-presentation-action="open"');
    expect(failedStepHtml).not.toMatch(/retry/i);

    await expect(h.controller.closeForStepChange()).resolves.toBe(true);
    expect(h.controller.getState().phase).toBe("closed");
    expect(h.sent.map((command) => command.presentationAction)).toEqual(["open"]);

    const hostagesStep = { presentation: { segmentId: "hostages", open: "manual", onClose: "next" } };
    expect(presentationControlsHtml(hostagesStep, h.controller.getState(), "en"))
      .toContain('data-presentation-action="open"');
  });

  test("failed close keeps the session and a close retry instead of resetting", async () => {
    vi.useFakeTimers();
    const h = makeControllerHarness();
    await h.openAndReply("nova_mor");

    const closing = h.controller.closeForStepChange();
    expect(h.sent.at(-1).presentationAction).toBe("close");
    const sessionId = h.sent.at(-1).presentationSessionId;
    h.reply({ outcome: "unavailable" });
    expect(h.controller.getState().phase).toBe("closing");
    await vi.advanceTimersByTimeAsync(6000);
    const failedStepHtml = presentationControlsHtml(step, h.controller.getState(), "en");
    expect(failedStepHtml).toContain("Presentation unavailable");
    expect(failedStepHtml).toContain('data-presentation-action="close"');
    expect(failedStepHtml).toContain("Close presentation");
    expect(failedStepHtml).not.toMatch(/retry/i);

    await expect(closing).resolves.toBe(false);
    expect(h.controller.getState().sessionId).toBe(sessionId);
    expect(h.controller.getState().phase).toBe("failed");
    const hostagesStep = { presentation: { segmentId: "hostages", open: "manual", onClose: "next" } };
    expect(presentationControlsHtml(hostagesStep, h.controller.getState(), "en"))
      .not.toContain('data-presentation-action="open"');

    const retry = h.controller.closeForStepChange();
    expect(h.sent.at(-1)).toMatchObject({ presentationAction: "close", presentationSessionId: sessionId });
    h.reply({ outcome: "closed" });
    await expect(retry).resolves.toBe(true);
    expect(h.controller.getState().phase).toBe("closed");
  });

  test("forced cleanup joining an explicit Close normalizes its unavailable result after settling", async () => {
    vi.useFakeTimers();
    const h = makeControllerHarness();
    await h.openAndReply("nova_mor");

    const explicitClosing = h.controller.run("close", "nova_mor");
    const forcedClosing = h.controller.closeForStepChange();
    expect(h.sent.filter((command) => command.presentationAction === "close")).toHaveLength(1);
    h.reply({ outcome: "unavailable" });
    expect(h.controller.getState().phase).toBe("closing");
    await vi.advanceTimersByTimeAsync(6000);

    const failedStepHtml = presentationControlsHtml(step, h.controller.getState(), "en");
    expect(failedStepHtml).toContain("Presentation unavailable");
    expect(failedStepHtml).toContain('data-presentation-action="close"');
    expect(failedStepHtml).not.toMatch(/retry/i);
    await expect(explicitClosing).resolves.toBe(false);
    await expect(forcedClosing).resolves.toBe(false);
    expect(h.controller.getState().sessionId).toBe(h.sent[0].presentationSessionId);
    expect(h.controller.getState().phase).toBe("failed");
    const hostagesStep = { presentation: { segmentId: "hostages", open: "manual", onClose: "next" } };
    expect(presentationControlsHtml(hostagesStep, h.controller.getState(), "en"))
      .not.toContain('data-presentation-action="open"');
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

  test("a secondary GIS failure and ignored reply do not block the successful open", async () => {
    const h = makeControllerHarness();
    const opening = h.controller.run("open", "shura");

    h.reply({ outcome: "unavailable", sourceId: "gis-secondary" });
    expect(h.controller.getState().phase).toBe("opening");
    h.reply({ outcome: "ignored", sourceId: "gis-secondary" });
    expect(h.controller.getState().phase).toBe("opening");

    h.reply({ outcome: "opened", sourceId: "gis-active", slide: 9, range: [9, 11] });
    await expect(opening).resolves.toBe(true);
    expect(h.controller.getState()).toMatchObject({ phase: "open", segmentId: "shura", slide: 9 });
  });

  test("a non-owning GIS closed reply cannot confirm closure of the active viewer", async () => {
    const h = makeControllerHarness();
    const opening = h.controller.run("open", "nova_mor");
    h.reply({ outcome: "opened", sourceId: "gis-active", slide: 9, range: [9, 11] });
    await opening;

    const closing = h.controller.run("close", "nova_mor");
    h.reply({ outcome: "closed", sourceId: "gis-secondary" });
    expect(h.controller.getState().phase).toBe("closing");
    h.reply({ outcome: "closed", sourceId: "gis-active" });
    await expect(closing).resolves.toBe(true);
    expect(h.controller.getState().phase).toBe("closed");
  });

  test("an ignored Close keeps Close available for an honest retry", async () => {
    vi.useFakeTimers();
    const h = makeControllerHarness();
    const opening = h.controller.run("open", "nova_mor");
    h.reply({ outcome: "opened", sourceId: "gis-active", slide: 9, range: [9, 11] });
    await opening;

    const closing = h.controller.run("close", "nova_mor");
    h.reply({ outcome: "ignored", sourceId: "gis-active" });
    expect(h.controller.getState().phase).toBe("closing");
    await vi.advanceTimersByTimeAsync(6000);
    await expect(closing).resolves.toBe(false);
    expect(h.controller.getState()).toMatchObject({ phase: "failed", sessionId: h.sent[0].presentationSessionId });
    expect(presentationControlsHtml(step, h.controller.getState(), "en"))
      .toContain('data-presentation-action="close"');
  });

  test("Close waits for every known viewer and accepts success after a negative reply", async () => {
    vi.useFakeTimers();
    const h = makeControllerHarness();
    const opening = h.controller.run("open", "nova_mor");
    h.reply({ outcome: "opened", sourceId: "gis-one", slide: 9, range: [9, 11] });
    await opening;
    // The second viewer can finish opening after the first one settled Open.
    h.reply({ outcome: "opened", sourceId: "gis-two", slide: 9, range: [9, 11] });

    const closing = h.controller.run("close", "nova_mor");
    h.reply({ outcome: "unavailable", sourceId: "gis-one" });
    expect(h.controller.getState().phase).toBe("closing");
    h.reply({ outcome: "closed", sourceId: "gis-one" });
    expect(h.controller.getState().phase).toBe("closing");
    h.replyTo(h.sent[0], { outcome: "opened", sourceId: "gis-one", slide: 9, range: [9, 11] });
    h.reply({ outcome: "closed", sourceId: "gis-two" });
    await expect(closing).resolves.toBe(true);
    expect(h.controller.getState().phase).toBe("closed");
    await vi.advanceTimersByTimeAsync(6000);
  });

  test("a secondary navigation failure cannot override a correlated ready reply", async () => {
    const h = makeControllerHarness();
    const opening = h.controller.run("open", "nova_mor");
    h.reply({ outcome: "opened", sourceId: "gis-active", slide: 9, range: [9, 11] });
    await opening;

    const moving = h.controller.run("next", "nova_mor");
    h.reply({ outcome: "unavailable", sourceId: "gis-secondary" });
    h.reply({ outcome: "ignored", sourceId: "gis-secondary" });
    expect(h.controller.getState().phase).toBe("applying");
    h.reply({ outcome: "ready", sourceId: "gis-active", slide: 10, range: [9, 11] });
    await expect(moving).resolves.toBe(true);
    expect(h.controller.getState()).toMatchObject({ phase: "open", slide: 10 });
  });

  test("a known GIS failure cannot override a later correlated navigation success", async () => {
    const h = makeControllerHarness();
    const opening = h.controller.run("open", "nova_mor");
    h.reply({ outcome: "opened", sourceId: "gis-test", slide: 9, range: [9, 11] });
    await opening;

    const moving = h.controller.run("next", "nova_mor");
    h.reply({ outcome: "unavailable", sourceId: "gis-test" });
    expect(h.controller.getState().phase).toBe("applying");
    h.reply({ outcome: "ready", sourceId: "gis-real", slide: 10, range: [9, 11] });
    await expect(moving).resolves.toBe(true);
    expect(h.controller.getState()).toMatchObject({ phase: "open", slide: 10 });
  });

  test("ignored navigation replies fail at the existing command deadline", async () => {
    vi.useFakeTimers();
    const h = makeControllerHarness();
    const opening = h.controller.run("open", "nova_mor");
    h.reply({ outcome: "opened", sourceId: "gis-active", slide: 9, range: [9, 11] });
    await opening;

    const moving = h.controller.run("next", "nova_mor");
    h.reply({ outcome: "ignored", sourceId: "gis-active" });
    expect(h.controller.getState().phase).toBe("applying");
    await vi.advanceTimersByTimeAsync(6000);
    await expect(moving).resolves.toBe(false);
    const sessionId = h.sent[0].presentationSessionId;
    expect(h.controller.getState()).toMatchObject({ phase: "failed", sessionId });
    expect(presentationControlsHtml(step, h.controller.getState(), "en"))
      .toContain('data-presentation-action="close"');
  });

  test("timed-out Nova memorial offers a manual Open after recovery Close", async () => {
    vi.useFakeTimers();
    const h = makeControllerHarness();
    const opening = h.controller.run("open", "nova_memorial");
    const sessionId = h.sent[0].presentationSessionId;
    await vi.advanceTimersByTimeAsync(6000);
    await expect(opening).resolves.toBe(false);
    expect(h.controller.getState().sessionId).toBe(sessionId);

    const recoveryClose = h.controller.closeForStepChange();
    expect(h.sent.at(-1)).toMatchObject({ presentationAction: "close", segmentId: "nova_memorial", presentationSessionId: sessionId });
    h.reply({ outcome: "closed" });
    await expect(recoveryClose).resolves.toBe(true);
    expect(h.controller.getState().phase).toBe("closed");
    expect(presentationControlsHtml(novaMemorialStep, h.controller.getState(), "en"))
      .toContain('data-presentation-action="open"');

    const retry = h.controller.run("open", "nova_memorial");
    expect(h.sent.at(-1)).toMatchObject({ presentationAction: "open", segmentId: "nova_memorial" });
    h.reply({ outcome: "opened", slide: 12, range: [12, 16] });
    await expect(retry).resolves.toBe(true);
    expect(h.controller.getState()).toMatchObject({ phase: "open", segmentId: "nova_memorial" });
    expect(h.sent.map((command) => command.presentationAction)).toEqual(["open", "close", "open"]);
  });

  test("opening, applying, and closing keep the control actions present and disabled", async () => {
    const h = makeControllerHarness();
    const opening = h.controller.run("open", "nova_mor");
    const openingHtml = presentationControlsHtml(step, h.controller.getState(), "en");
    expect(openingHtml).toContain('data-presentation-action="previous"');
    expect(openingHtml).toContain('data-presentation-action="next"');
    expect(openingHtml).toContain('data-presentation-action="close"');
    expect(openingHtml).toMatch(/data-presentation-action="next"[^>]*disabled/);
    h.reply({ outcome: "opened", slide: 9, range: [9, 11] });
    await opening;

    const moving = h.controller.run("next", "nova_mor");
    const applyingHtml = presentationControlsHtml(step, h.controller.getState(), "en");
    expect(applyingHtml).toMatch(/data-presentation-action="previous"[^>]*disabled/);
    expect(applyingHtml).toMatch(/data-presentation-action="close"[^>]*disabled/);
    h.reply({ outcome: "ready", slide: 10, range: [9, 11] });
    await moving;

    const closing = h.controller.run("close", "nova_mor");
    const closingHtml = presentationControlsHtml(step, h.controller.getState(), "en");
    expect(closingHtml).toMatch(/data-presentation-action="next"[^>]*disabled/);
    expect(h.controller.getState().phase).toBe("closing");
    h.reply({ outcome: "closed" });
    await closing;
  });

  test("a lost close keeps the session so Home can retry that same close", async () => {
    vi.useFakeTimers();
    const h = makeControllerHarness();
    await h.openAndReply("nova_mor");
    const sessionId = h.sent[0].presentationSessionId;
    const closing = h.controller.closeForStepChange();
    await vi.advanceTimersByTimeAsync(6000);
    await expect(closing).resolves.toBe(false);
    expect(h.controller.getState().sessionId).toBe(sessionId);
    expect(h.controller.getState().phase).toBe("failed");
    const retry = h.controller.closeForStepChange();
    expect(h.sent.at(-1)).toMatchObject({ presentationAction: "close", presentationSessionId: sessionId });
    h.reply({ outcome: "closed" });
    await expect(retry).resolves.toBe(true);
  });
});


describe("failed presentation recovery", () => {
  test("replacement GIS can open a new session without accepting its unrelated Close", async () => {
    vi.useFakeTimers();
    const h = makeControllerHarness();
    const opened = h.controller.run("open", "nova_mor");
    h.reply({ outcome: "opened", sourceId: "A" });
    await opened;
    const old = h.sent[0];
    const close = h.controller.run("close", "nova_mor");
    h.reply({ outcome: "closed", sourceId: "B" });
    await vi.advanceTimersByTimeAsync(6000);
    expect(await close).toBe(false);
    expect(presentationControlsHtml(step, h.controller.getState(), "en")).toContain('data-presentation-action="recover-open"');
    const retry = h.controller.recoverOpen("nova_mor");
    expect(h.sent.at(-1).presentationGeneration).toBeGreaterThan(old.presentationGeneration);
    h.replyTo(old, { outcome: "opened", sourceId: "A" });
    h.reply({ outcome: "opened", sourceId: "B" });
    expect(await retry).toBe(true);
    const replacementClose = h.controller.run("close", "nova_mor");
    h.reply({ outcome: "closed", sourceId: "B" });
    expect(await replacementClose).toBe(true);
  });

  test("failure-only Home recovery releases correlation without claiming confirmed closure", async () => {
    vi.useFakeTimers();
    const h = makeControllerHarness();
    expect(h.controller.releaseFailedSession()).toBe(false);
    const opening = h.controller.run("open", "nova_mor");
    expect(h.controller.releaseFailedSession()).toBe(false);
    await vi.advanceTimersByTimeAsync(6000);
    await opening;
    expect(presentationControlsHtml(step, h.controller.getState(), "en")).toContain('data-presentation-action="recover-home"');
    expect(h.controller.releaseFailedSession()).toBe(true);
    expect(h.controller.getState()).toMatchObject({ phase: "released", sessionId: null });
    h.replyTo(h.sent[0], { outcome: "opened", sourceId: "A" });
    expect(await h.controller.closeForStepChange()).toBe(true);
  });

  test("command deadline and destroy abort outstanding transport", async () => {
    vi.useFakeTimers();
    const signals = [];
    const h = createNliStaffPresentationController({ dataContext: {
      subscribe: () => () => {},
      narrativePresentationCommand: (_command, options) => {
        signals.push(options.signal);
        return new Promise(() => {});
      },
    } });
    const opening = h.run("open", "nova_mor");
    expect(signals[0].aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(6000);
    expect(await opening).toBe(false);
    expect(signals[0].aborted).toBe(true);
    const retry = h.recoverOpen("nova_mor");
    expect(signals.filter(signal => !signal.aborted)).toHaveLength(1);
    h.destroy();
    expect(await retry).toBe(false);
    expect(signals.every(signal => signal.aborted)).toBe(true);
  });
});
