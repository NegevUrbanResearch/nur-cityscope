import { validateProjectionConfig } from "../shared/projection-config-schema.js";

export function installProjectionPreviewBridge({ win, output, map, nameFieldController, syncContextInvestigation, applyProjectionConfig }) {
  if (!win?.parent || win.parent === win || !["left", "right"].includes(output)) return () => {};
  const origin = win.location.origin;
  const reply = (message) => win.parent.postMessage({ ...message, output }, origin);
  const onMessage = (event) => {
    const message = event.data;
    if (event.source !== win.parent || event.origin !== origin || message?.type !== "otef_projection_preview_config" || message.output !== output || !Number.isSafeInteger(message.requestId)) return;
    if (Object.keys(validateProjectionConfig(message.config)).length) {
      reply({ type: "otef_projection_preview_applied", requestId: message.requestId, success: false, error: "Invalid calibration draft" });
      return;
    }
    try {
      if (typeof applyProjectionConfig === "function" && applyProjectionConfig(message.config) === false) throw new Error("Projection output rejected draft");
      if (map.setEffectiveProjectionConfig(message.config) === false) throw new Error("Projection camera rejected draft");
      if (nameFieldController.setProjectionConfig(message.config) === false) throw new Error("Projection labels rejected draft");
      syncContextInvestigation();
      reply({ type: "otef_projection_preview_applied", requestId: message.requestId, success: true });
    } catch (error) {
      reply({ type: "otef_projection_preview_applied", requestId: message.requestId, success: false, error: error.message || "Preview failed" });
    }
  };
  win.addEventListener("message", onMessage);
  reply({ type: "otef_projection_preview_ready" });
  return () => win.removeEventListener("message", onMessage);
}
