import { describe, expect, test } from "vitest";
import {
  INVESTIGATION_ALARMS_FULL_ID,
  INVESTIGATION_LINES_FULL_ID,
  INVESTIGATION_POLYGONS_FULL_ID,
} from "../../frontend/src/shared/nli-investigation-beats.js";
import { idleNliClock, playNliClock } from "../../frontend/src/shared/nli-investigation-clock.js";
import { novaVirtualMembership } from "../../frontend/src/shared/nli-nova-virtual-membership.js";

describe("novaVirtualMembership", () => {
  test("unions polygons and lines while nova is playing without mutating chips", () => {
    const chips = [INVESTIGATION_ALARMS_FULL_ID];
    const frozen = [...chips];
    const clock = playNliClock(idleNliClock(), chips, [400], 0);
    expect(novaVirtualMembership(chips, "nova", clock)).toEqual([
      INVESTIGATION_POLYGONS_FULL_ID,
      INVESTIGATION_LINES_FULL_ID,
      INVESTIGATION_ALARMS_FULL_ID,
    ]);
    expect(chips).toEqual(frozen);
  });

  test("idle nova and non-nova stay chip-only", () => {
    const chips = [INVESTIGATION_ALARMS_FULL_ID];
    expect(novaVirtualMembership(chips, "nova", idleNliClock())).toEqual(chips);
    expect(novaVirtualMembership(chips, "segev", playNliClock(idleNliClock(), chips, [400], 0)))
      .toEqual(chips);
    expect(novaVirtualMembership(chips, null, idleNliClock())).toEqual(chips);
  });
});
