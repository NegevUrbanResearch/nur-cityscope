const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const MAX = Number.MAX_SAFE_INTEGER;
const REASONS = new Set(["not_ready", "not_home", "busy", "owned_session"]);
const REJECTIONS = new Set([...REASONS, "expired", "storage_unavailable", "state_unavailable"]);

export const STAFF_REMOTE_MANAGEMENT = Object.freeze({
  HEARTBEAT_MS: 10_000,
  STALE_AFTER_MS: 30_000,
  LEASE_MS: 10_000,
  MAX_REPORT_BYTES: 1_024,
  MAX_BUFFERED_BYTES: 64 * 1_024,
});

const schemas = {
  otef_staff_remote_subscribe: ["sourceId"],
  otef_staff_remote_status_query: ["sourceId"],
  otef_staff_remote_status: ["remoteId", "instanceId", "connectionSeq", "leaseSeq", "buildId", "visibility", "ready", "refreshBlockReason", "reloadReceipt"],
  otef_staff_remote_refresh: ["sourceId", "requestId", "remoteId", "instanceId", "connectionSeq", "leaseSeq"],
  otef_staff_remote_refresh_ack: ["sourceId", "requestId", "remoteId", "instanceId", "connectionSeq", "result", "reason"],
  otef_staff_remote_disconnected: ["remoteId", "instanceId", "connectionSeq"],
};

const isId = (value) => typeof value === "string" && UUID.test(value);
const isCounter = (value) => Number.isSafeInteger(value) && value > 0;

export function validateStaffRemoteMessage(value) {
  if (!value || typeof value !== "object" || Array.isArray(value) || value.table !== "otef") return null;
  const required = schemas[value.type];
  if (!required) return null;
  const keys = ["type", "table", ...required].sort();
  if (Object.keys(value).sort().join("\0") !== keys.join("\0")) return null;
  if (new TextEncoder().encode(JSON.stringify(value)).byteLength >= STAFF_REMOTE_MANAGEMENT.MAX_REPORT_BYTES) return null;
  const idFields = required.filter((key) => ["sourceId", "requestId", "remoteId", "instanceId"].includes(key));
  if (!idFields.every((key) => isId(value[key]))) return null;
  if (["connectionSeq", "leaseSeq"].some((key) => key in value && !isCounter(value[key]))) return null;
  if (value.type === "otef_staff_remote_status") {
    if (!(value.buildId === null || (typeof value.buildId === "string" && /^[\x20-\x7e]{0,64}$/.test(value.buildId)))) return null;
    if (!(["visible", "hidden"].includes(value.visibility)) || typeof value.ready !== "boolean") return null;
    if (!(value.refreshBlockReason === null || REASONS.has(value.refreshBlockReason))) return null;
    if (value.reloadReceipt !== null) {
      const receipt = value.reloadReceipt;
      if (!receipt || typeof receipt !== "object" || Array.isArray(receipt) ||
          Object.keys(receipt).sort().join("\0") !== ["sourceId", "requestId", "previousInstanceId"].sort().join("\0") ||
          !["sourceId", "requestId", "previousInstanceId"].every((key) => isId(receipt[key]))) return null;
    }
  }
  if (value.type === "otef_staff_remote_refresh_ack" &&
      !((value.result === "accepted" && value.reason === null) ||
        (value.result === "rejected" && REJECTIONS.has(value.reason)))) return null;
  return { ...value };
}
