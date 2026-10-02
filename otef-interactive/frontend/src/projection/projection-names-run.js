import { sha256Hex } from "../shared/sha256-hex.js";
import { validateProjectionConfig } from "../shared/projection-config-schema.js";

/** Hash only calibration and names settings that determine wall placements. */
export async function projectionPlacementInputIdentity(config) {
  if (!config || Object.keys(validateProjectionConfig(config)).length) throw new Error("invalid projection config for names wall");
  const inputs = { pre: config.pre, outputs: config.outputs, namesWall: config.namesWall };
  return sha256Hex(new TextEncoder().encode(JSON.stringify(inputs)));
}
