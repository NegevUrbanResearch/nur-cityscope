import { describe, expect, it } from "vitest";
import { validateStaffRemoteMessage } from "../../frontend/src/shared/staff-remote-management-protocol.js";

const uuid = "11111111-1111-4111-8111-111111111111";
const fixtures = {
  otef_staff_remote_subscribe: { sourceId: uuid },
  otef_staff_remote_status_query: { sourceId: uuid },
  otef_staff_remote_status: { remoteId: uuid, instanceId: uuid, connectionSeq: 1, leaseSeq: 1, buildId: null, visibility: "visible", ready: true, refreshBlockReason: null, reloadReceipt: null },
  otef_staff_remote_refresh: { sourceId: uuid, requestId: uuid, remoteId: uuid, instanceId: uuid, connectionSeq: 1, leaseSeq: 1 },
  otef_staff_remote_refresh_ack: { sourceId: uuid, requestId: uuid, remoteId: uuid, instanceId: uuid, connectionSeq: 1, result: "accepted", reason: null },
  otef_staff_remote_disconnected: { remoteId: uuid, instanceId: uuid, connectionSeq: 1 },
};
const message = (type, fields = {}) => ({ type, table: "otef", ...fixtures[type], ...fields });

describe("staff remote management protocol", () => {
  it("accepts exact schemas and rejects extra fields and wrong rooms", () => {
    for (const [type, fields] of Object.entries(fixtures)) {
      expect(validateStaffRemoteMessage(message(type, fields))).toMatchObject({ type });
    }
    expect(validateStaffRemoteMessage(message("otef_staff_remote_status", { extra: true }))).toBeNull();
    expect(validateStaffRemoteMessage({ ...message("otef_staff_remote_subscribe"), table: "presentation" })).toBeNull();
  });

  it("checks UUIDs, counters, receipt shape, roles, and UTF-8 size", () => {
    for (const bad of [
      message("otef_staff_remote_status", { remoteId: "bad" }),
      message("otef_staff_remote_status", { connectionSeq: 0 }),
      message("otef_staff_remote_status", { leaseSeq: Number.MAX_SAFE_INTEGER + 1 }),
      message("otef_staff_remote_status", { buildId: "x".repeat(65) }),
      message("otef_staff_remote_status", { visibility: "gone" }),
      message("otef_staff_remote_status", { ready: 1 }),
      message("otef_staff_remote_status", { reloadReceipt: { sourceId: uuid } }),
      message("otef_staff_remote_refresh_ack", { result: "accepted", reason: "busy" }),
      { type: "otef_staff_remote_status_query", table: "otef", sourceId: uuid, extra: "é".repeat(600) },
    ]) expect(validateStaffRemoteMessage(bad)).toBeNull();
  });

  it("accepts an exact server-delivered status payload", () => {
    const delivered = {
      type: "otef_staff_remote_status", table: "otef", remoteId: uuid, instanceId: uuid,
      connectionSeq: 1, leaseSeq: 1, buildId: "frontend-0123456789abcdef", visibility: "visible",
      ready: true, refreshBlockReason: null, reloadReceipt: null,
    };
    expect(validateStaffRemoteMessage(delivered)).toEqual(delivered);
  });
});
