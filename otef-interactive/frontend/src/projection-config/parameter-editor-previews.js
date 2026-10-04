import { createProjectionPreviewFrame } from "./projection-preview-frame.js";

/** Creates view-owned, guarded previews for the shared transform and one-output geometry nodes. */
export function createParameterEditorPreviews({ document: doc, host, onStatus = () => {} }) {
  const slots = new Map();
  const previews = new Map();
  const states = new Map([["left", { text: "", retry: false }], ["right", { text: "", retry: false }]]);
  for (const side of ["left", "right"]) {
    const slot = doc.createElement("section"); slot.className = "parameter-preview-slot"; slot.dataset.output = side; slot.hidden = true;
    const label = doc.createElement("h3"); label.textContent = side === "left" ? "Left output" : "Right output";
    const surface = doc.createElement("div"); surface.className = "parameter-preview-surface";
    slot.append(label, surface); host.appendChild(slot); slots.set(side, slot);
    previews.set(side, createProjectionPreviewFrame({ document: doc, host: surface, frameClass: "parameter-preview-frame", titleForSide: (output) => `${output} projection preview`, onStatus: (message, retry) => {
      states.set(side, { text: message, retry });
      onStatus([...states].filter(([, value]) => value.text).map(([output, value]) => `${output === "left" ? "Left" : "Right"}: ${value.text}`).join(" · "), [...states.values()].some((value) => value.retry));
    } }));
  }
  let activeSides = [];
  return {
    open(nodeId) {
      activeSides = nodeId === "pre" ? ["left", "right"] : [nodeId.startsWith("right-") ? "right" : "left"];
      host.classList?.toggle("single-preview", activeSides.length === 1);
      for (const [side, slot] of slots) {
        const active = activeSides.includes(side); slot.hidden = !active;
        if (active) previews.get(side).mount(side);
        else previews.get(side).clear();
      }
    },
    update(config) { for (const side of activeSides) previews.get(side).update(config); },
    retry(side) { if (side) previews.get(side)?.retry(); else for (const output of activeSides) previews.get(output)?.retry(); },
    close() {
      host.classList?.toggle("single-preview", false);
      for (const preview of previews.values()) preview.clear();
      for (const slot of slots.values()) slot.hidden = true;
      activeSides = [];
    },
    dispose() { for (const preview of previews.values()) preview.dispose(); activeSides = []; },
  };
}
