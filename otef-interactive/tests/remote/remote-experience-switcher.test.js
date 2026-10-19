import { beforeEach, expect, test, vi } from "vitest";
import { createExperienceSwitcher } from "../../frontend/src/remote/remote-experience-switcher.js";
let ctx, calls, state;
beforeEach(() => {
  calls = [];
  state = { active_experience: "nli", revision: 2, pending_transition: null };
  ctx = {
    getExperienceState: () => structuredClone(state),
    refreshExperienceState: vi.fn(async () => ({ experience_state: state })),
    transitionExperience: vi.fn(async (stage, intent) => {
      calls.push(stage);
      if (stage === "prepare") state.pending_transition = { request_id: intent.requestId, target: intent.target, cleanup_confirmed: true };
      if (stage === "commit") state = { active_experience: intent.target, revision: 3, pending_transition: null, last_transition: { request_id: intent.requestId, target: intent.target, status: "committed" } };
      if (stage === "abort") state.pending_transition = null;
      return { experience_state: state };
    }),
    subscribe: () => () => {},
  };
});
test("saves authored intent before freezing writes, cleans NLI, then commits", async () => {
  const staffRemote = { flushBookmark: async () => calls.push("bookmark"), suspendForExperienceSwitch: async () => { calls.push("cleanup");return true; } };
  const switcher = createExperienceSwitcher({ dataContext: ctx, staffRemote, requestId: () => "switch-1" });
  await switcher.activate("regular");
  expect(calls).toEqual(["bookmark", "prepare", "cleanup", "commit"]);
});
test("opening an already active destination performs no scene mutation", async () => {
  const switcher = createExperienceSwitcher({ dataContext: ctx });
  await switcher.activate("nli");
  expect(ctx.transitionExperience).not.toHaveBeenCalled();
});
test("cleanup failure aborts this request without changing the active experience", async () => {
  const staffRemote = { suspendForExperienceSwitch: async () => false, resumeAfterSwitchFailure: vi.fn() };
  const switcher = createExperienceSwitcher({ dataContext: ctx, staffRemote, requestId: () => "switch-2" });
  await expect(switcher.activate("regular")).rejects.toThrow();
  expect(calls).toEqual(["prepare", "abort"]);
  expect(state.active_experience).toBe("nli");
  expect(staffRemote.resumeAfterSwitchFailure).toHaveBeenCalled();
});
test("a lost commit response reconciles its matching receipt without replaying commands", async () => {
  const transition = ctx.transitionExperience;
  ctx.transitionExperience = vi.fn(async (...args) => {
    const result = await transition(...args);
    if (args[0] === "commit") throw new Error("network");
    return result;
  });
  await createExperienceSwitcher({ dataContext: ctx, requestId: () => "switch-3" }).activate("regular");
  expect(calls).toEqual(["prepare", "commit"]);
});
test("another device's prepared switch cannot be stolen or aborted", async () => {
  state.pending_transition = { request_id: "foreign", target: "regular" };
  await expect(createExperienceSwitcher({ dataContext: ctx }).activate("regular")).rejects.toThrow();
  expect(ctx.transitionExperience).not.toHaveBeenCalled();
});

test("an unresolved prepare stays uncertain and a retry reconciles it before resuming NLI", async () => {
  const transition = ctx.transitionExperience;
  ctx.transitionExperience = vi.fn(async (...args) => {
    const result = await transition(...args);
    if (args[0] === "prepare") throw new Error("lost prepare response");
    return result;
  });
  ctx.refreshExperienceState.mockRejectedValue(new Error("offline"));
  const staffRemote = { resumeAfterSwitchFailure: vi.fn() };
  const switcher = createExperienceSwitcher({ dataContext: ctx, staffRemote, requestId: () => "lost" });
  await expect(switcher.activate("regular")).rejects.toThrow();
  expect(switcher.isUncertain()).toBe(true);
  expect(state.pending_transition.request_id).toBe("lost");
  ctx.refreshExperienceState.mockResolvedValue({});
  await switcher.activate("nli");
  expect(calls).toEqual(["prepare", "abort"]);
  expect(switcher.isUncertain()).toBe(false);
  expect(staffRemote.resumeAfterSwitchFailure).toHaveBeenCalled();
});

test("regular presentation drafts finish saving before the transition freezes writes", async () => {
  state.active_experience = "regular";
  const switcher = createExperienceSwitcher({ dataContext: ctx, flushRegularSettings: async () => calls.push("draft"), requestId: () => "draft-switch" });
  await switcher.activate("nli");
  expect(calls).toEqual(["draft", "prepare", "commit"]);
});
