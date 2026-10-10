import { withRequestDeadline } from "./request-deadline.js";

export const isDeviceId = value => typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(value);
export const isBuildId = value => typeof value === "string" && /^frontend-[a-f0-9]{16}$/.test(value);
const counter = value => Number.isSafeInteger(value) && value >= 0;
const keys = (value, names) => value && typeof value === "object" && !Array.isArray(value) && Object.keys(value).sort().join() === names.sort().join();

export function validateManagementState(value) {
  if (!keys(value, ["table", "revision", "deviceId", "notice"]) || value.table !== "otef" || !counter(value.revision) ||
      !(value.deviceId === null || isDeviceId(value.deviceId))) throw new Error("Invalid tablet management response");
  const notice = value.notice;
  if (notice !== null && (!keys(notice, ["revision", "targetBuildId", "createdAt"]) || !isDeviceId(value.deviceId) ||
      notice.revision !== value.revision || !isBuildId(notice.targetBuildId) || typeof notice.createdAt !== "string" ||
      !Number.isFinite(Date.parse(notice.createdAt)))) throw new Error("Invalid tablet notice response");
  return value;
}

async function boundedText(response, limit) {
  if (!response.body?.getReader) {
    const text = await response.text();
    if (new TextEncoder().encode(text).byteLength > limit) throw new Error("Response too large");
    return text;
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let bytes = 0, text = "";
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) return text + decoder.decode();
      bytes += chunk.value.byteLength;
      if (bytes > limit) { await reader.cancel(); throw new Error("Response too large"); }
      text += decoder.decode(chunk.value, { stream: true });
    }
  } finally { reader.releaseLock(); }
}

export function readFrontendBuildId({ fetchImpl = globalThis.fetch, signal } = {}) {
  return withRequestDeadline(async deadlineSignal => {
    const response = await fetchImpl("/otef-interactive/runtime/frontend-version.js", { cache: "no-store", signal: deadlineSignal });
    if (!response.ok) throw new Error("Frontend version unavailable");
    const text = await boundedText(response, 1024);
    const match = text.match(/^\s*export const FRONTEND_BUILD_ID = "(frontend-[a-f0-9]{16})";\s*$/);
    if (!match) throw new Error("Frontend version invalid");
    return match[1];
  }, { signal, timeoutMs: 3000 });
}

export function createStaffRemoteUpdateApi({ fetchImpl = globalThis.fetch, baseUrl = "/api" } = {}) {
  const url = `${baseUrl.replace(/\/$/, "")}/otef/staff-remote-management/`;
  const request = (body, deviceId, signal) => withRequestDeadline(async deadlineSignal => {
    const query = body ? "" : `?table=otef${deviceId ? `&deviceId=${encodeURIComponent(deviceId)}` : ""}`;
    const response = await fetchImpl(url + query, { cache: "no-store", signal: deadlineSignal,
      ...(body ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : {}) });
    const value = JSON.parse(await boundedText(response, 4096));
    if (!response.ok) {
      const error = new Error(value.error || "Tablet management unavailable");
      error.code = value.error;
      if (value.state) error.state = validateManagementState(value.state);
      throw error;
    }
    return validateManagementState(value);
  }, { signal, timeoutMs: 3000 });
  return {
    read: ({ deviceId, signal } = {}) => request(null, deviceId, signal),
    register: ({ signal, ...body }) => request({ table: "otef", action: "register", ...body }, null, signal),
    send: ({ signal, ...body }) => request({ table: "otef", action: "send_notice", ...body }, null, signal),
  };
}
