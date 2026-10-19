import { describe, expect, test } from "vitest";

const helpers = () => import("../../frontend/src/shared/experience-state.js");

describe("experience activation identity", () => {
  test("rejects malformed snapshots rather than inventing a current activation", async () => {
    const { normalizedExperienceState } = await helpers();
    for (const value of [null, {}, { active_experience: "other", revision: 2 }, { active_experience: "nli", revision: -1 }, { active_experience: "nli", revision: "2" }]) {
      expect(normalizedExperienceState(value)).toBeNull();
    }
  });

  test("copies bookmark and transition metadata without retaining caller references", async () => {
    const { normalizedExperienceState } = await helpers();
    const raw = { active_experience: "nli", revision: 3, pending_transition: { request_id: "switch-1" }, nli_bookmark: { scriptId: "show", step: 3 } };
    const result = normalizedExperienceState(raw);
    raw.nli_bookmark.step = 9;
    raw.pending_transition.request_id = "changed";
    expect(result).toMatchObject({ active_experience: "nli", revision: 3, pending_transition: { request_id: "switch-1" }, last_transition: null, nli_bookmark: { scriptId: "show", step: 3 } });
  });

  test("binds command identity to its application instead of relabeling inactive controls", async () => {
    const { captureExperienceScope, isExperienceScopeCurrent } = await helpers();
    const state = { active_experience: "regular", revision: 5 };
    const scope = captureExperienceScope(state, "nli");
    expect(scope).toEqual({ experience: "nli", experience_revision: 5 });
    expect(isExperienceScopeCurrent(scope, state)).toBe(false);
    expect(isExperienceScopeCurrent({ experience: "regular", experience_revision: 5 }, state)).toBe(true);
    expect(isExperienceScopeCurrent({ experience: "regular", experience_revision: 4 }, state)).toBe(false);
  });

  test("uses revision zero only for an explicitly uninitialized legacy caller", async () => {
    const { captureExperienceScope, isExperienceScopeCurrent } = await helpers();
    expect(captureExperienceScope(null)).toEqual({ experience: "regular", experience_revision: 0 });
    expect(isExperienceScopeCurrent({ experience: "regular", experience_revision: 0 }, null)).toBe(false);
  });

  test("orders cleanup and abort snapshots within one activation", async () => {
    const { normalizedExperienceState, isExperienceStateCurrentOrNewer } = await helpers();
    const prepared = { active_experience: "nli", revision: 3, state_sequence: 8, pending_transition: { cleanup_confirmed: false } };
    const cleaned = { ...prepared, state_sequence: 9, pending_transition: { cleanup_confirmed: true } };
    const aborted = { ...cleaned, state_sequence: 10, pending_transition: null };
    expect(isExperienceStateCurrentOrNewer(prepared, cleaned)).toBe(false);
    expect(isExperienceStateCurrentOrNewer(cleaned, aborted)).toBe(false);
    expect(isExperienceStateCurrentOrNewer(aborted, cleaned)).toBe(true);
    expect(isExperienceStateCurrentOrNewer(aborted, aborted)).toBe(true);
    expect(isExperienceStateCurrentOrNewer({ active_experience: "regular", revision: 4, state_sequence: 11 }, aborted)).toBe(true);
    expect(normalizedExperienceState({ ...prepared, state_sequence: -1 })).toBeNull();
    expect(normalizedExperienceState({ ...prepared, state_sequence: "8" })).toBeNull();
    expect(normalizedExperienceState({ active_experience: "regular", revision: 0 }).state_sequence).toBe(0);
  });

  test("does not confuse narrative revision conflicts with experience conflicts", async () => {
    const { isExperienceWriteError } = await helpers();
    expect(isExperienceWriteError({ status: 409, details: { reason: "stale", narrative_state: {} } })).toBe(false);
    expect(isExperienceWriteError({ status: 409, details: { reason: "stale_experience" } })).toBe(true);
    expect(isExperienceWriteError({ status: 409, details: { reason: "transition_pending", experience_state: {} } })).toBe(true);
    expect(isExperienceWriteError({ status: 500, details: { experience_state: {} } })).toBe(false);
  });
});
