import { sha256Hex } from "../shared/sha256-hex.js";
import { validateProjectionConfig } from "../shared/projection-config-schema.js";
import { nameTextStyle } from "../shared/nli-name-language.js";

/** Hash only calibration and names settings that determine wall placements. */
export async function projectionPlacementInputIdentity(config, language = 'he') {
  if (!config || Object.keys(validateProjectionConfig(config)).length) throw new Error("invalid projection config for names wall");
  const textStyle = nameTextStyle(language, config.nliFonts);
  const inputs = { pre: config.pre, outputs: config.outputs, namesWall: config.namesWall,
    renderedName: { language: textStyle.language, direction: textStyle.direction, fontFamily: textStyle.fontFamily } };
  return sha256Hex(new TextEncoder().encode(JSON.stringify(inputs)));
}
