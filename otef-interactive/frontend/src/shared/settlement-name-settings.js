const OUTPUTS = ["left", "right"];
const FONTS = ["Guttman Hatzvi", "Arial"];
const X_MIN = -1920;
const X_MAX = 3840;
const Y_MIN = -1080;
const Y_MAX = 2160;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function finiteNumber(value) {
  return typeof value === "number" && Number.isFinite(value);
}

function clone(value) {
  return value == null ? value : structuredClone(value);
}

function same(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function positionErrors(errors, warnings, fieldPath, position, { warnOffscreen = false } = {}) {
  if (!position || typeof position !== "object" || Array.isArray(position)) {
    errors.push(fieldPath);
    return;
  }
  if (!finiteNumber(position.x)) errors.push(`${fieldPath}.x`);
  else if (position.x < X_MIN || position.x > X_MAX) errors.push(`${fieldPath}.x`);
  else if (warnOffscreen && (position.x < 0 || position.x > 1920)) warnings.push(`${fieldPath} offscreen`);
  if (!finiteNumber(position.y)) errors.push(`${fieldPath}.y`);
  else if (position.y < Y_MIN || position.y > Y_MAX) errors.push(`${fieldPath}.y`);
  else if (warnOffscreen && (position.y < 0 || position.y > 1080)) warnings.push(`${fieldPath} offscreen`);
}

function positionMap(errors, warnings, fieldPath, value, warnOffscreen) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    errors.push(fieldPath);
    return;
  }
  for (const [citycode, position] of Object.entries(value)) {
    if (typeof citycode !== "string" || !citycode) errors.push(`${fieldPath}.citycode`);
    positionErrors(errors, warnings, `${fieldPath}.${citycode}`, position, { warnOffscreen });
  }
}

export function normalizeRotationDeg(value) {
  if (typeof value !== "number" || !Number.isFinite(value)) throw new TypeError("Invalid rotation");
  return ((value + 180) % 360 + 360) % 360 - 180;
}

export function effectiveSettlementPosition(settings, output, citycode) {
  return settings?.outputs?.[output]?.[citycode] ?? settings?.baseline?.outputs?.[output]?.[citycode] ?? null;
}

export function validateSettlementNameSettings(value) {
  const errors = [];
  const warnings = [];
  const settings = value && typeof value === "object" ? value : null;
  if (!settings) errors.push("settings");
  const baseline = settings?.baseline;
  if (!baseline || typeof baseline !== "object") errors.push("baseline");
  for (const field of ["captureId", "captureDigest", "sourceDigest", "catalogDigest"]) {
    if (typeof baseline?.[field] !== "string" || !baseline[field]) errors.push(`baseline.${field}`);
  }
  for (const side of ["predecessor", "successor"]) {
    const record = baseline?.[side];
    if (!record || !Number.isSafeInteger(record.revision) || typeof record.configDigest !== "string") errors.push(`baseline.${side}`);
  }
  if (!baseline?.outputs) errors.push("baseline.outputs");
  for (const output of OUTPUTS) {
    positionMap(errors, warnings, `baseline.outputs.${output}`, baseline?.outputs?.[output], true);
    positionMap(errors, warnings, `outputs.${output}`, settings?.outputs?.[output], true);
  }
  const style = settings?.style;
  if (!style || typeof style !== "object") errors.push("style");
  if (!FONTS.includes(style?.fontFamily)) errors.push("style.fontFamily");
  if (!finiteNumber(style?.fontPx) || style.fontPx < 8 || style.fontPx > 64) errors.push("style.fontPx");
  if (!finiteNumber(style?.rotateDeg) || style.rotateDeg < -180 || style.rotateDeg > 180) errors.push("style.rotateDeg");
  if (settings?.leaderStyle != null) errors.push(...settlementLeaderStyleErrors(settings.leaderStyle));
  if (settings?.lineBreaks != null) {
    if (typeof settings.lineBreaks !== 'object' || Array.isArray(settings.lineBreaks)) errors.push('lineBreaks');
    else for (const [code, afterWord] of Object.entries(settings.lineBreaks)) {
      if (!code || !Number.isInteger(afterWord) || afterWord < 1 || afterWord > 16) errors.push(`lineBreaks.${code}`);
    }
  }
  if (settings?.leaderOrigins != null) {
    if (typeof settings.leaderOrigins !== 'object' || Array.isArray(settings.leaderOrigins)) errors.push('leaderOrigins');
    else for (const [code, origin] of Object.entries(settings.leaderOrigins)) if (!code || !validSettlementLeaderOrigin(origin)) errors.push(`leaderOrigins.${code}`);
  }
  return { errors, warnings, value: errors.length ? null : clone(settings) };
}

function knownCitycode(settings, output, citycode) {
  return Object.hasOwn(settings?.baseline?.outputs?.[output] || {}, citycode)
    || Object.hasOwn(settings?.outputs?.[output] || {}, citycode);
}

export function settlementLeaderStyleErrors(style) {
  const errors = [];
  for (const [key, min, max] of [['widthPx', 0.25, 8], ['outlineWidthPx', 0, 4], ['opacity', 0, 1]]) {
    if (!finiteNumber(style?.[key]) || style[key] < min || style[key] > max) errors.push(`leaderStyle.${key}`);
  }
  for (const key of ['color', 'outlineColor']) if (typeof style?.[key] !== 'string' || !/^#[0-9a-f]{6}$/i.test(style[key])) errors.push(`leaderStyle.${key}`);
  return errors;
}

export function validSettlementLeaderOrigin(origin) {
  return origin && typeof origin === 'object' && Object.keys(origin).length === 2
    && finiteNumber(origin.lng) && origin.lng >= -180 && origin.lng <= 180
    && finiteNumber(origin.lat) && origin.lat >= -85 && origin.lat <= 85;
}

export function validateSettlementNameOperation(value, settings) {
  const errors = [];
  const warnings = [];
  const operation = value && typeof value === "object" ? value : null;
  if (operation?.action !== "set_settlement_names") errors.push("action");
  const kind = operation?.operation;
  if (!["position", "reset_position", "style", "line_break", "leader_style", "leader_origin", "reset_leader_origin", "append_baseline"].includes(kind)) errors.push("operation");
  if (!Number.isSafeInteger(operation?.baseRevision) || operation.baseRevision < 0) errors.push("baseRevision");
  if (typeof operation?.sourceId !== "string" || !UUID.test(operation.sourceId)) errors.push("sourceId");
  if (typeof operation?.timestamp !== "string" || !operation.timestamp) errors.push("timestamp");
  const next = settings ? clone(settings) : null;
  if (kind === 'leader_origin' || kind === 'reset_leader_origin') {
    if (typeof operation.citycode !== 'string' || !operation.citycode || (settings && !OUTPUTS.some(output => knownCitycode(settings, output, operation.citycode)))) errors.push('citycode');
    if (kind === 'leader_origin' && !validSettlementLeaderOrigin(operation.origin)) errors.push('origin');
    if (['output', 'position', 'style', 'leaderStyle'].some(key => Object.hasOwn(operation, key))) errors.push('operation');
    if (!errors.length && next) {
      next.leaderOrigins ||= {};
      if (kind === 'reset_leader_origin') delete next.leaderOrigins[operation.citycode];
      else next.leaderOrigins[operation.citycode] = clone(operation.origin);
    }
  }
  if (kind === 'line_break') {
    if (typeof operation.citycode !== 'string' || !operation.citycode || (settings && !OUTPUTS.some(output => knownCitycode(settings, output, operation.citycode)))) errors.push('citycode');
    if (!Number.isInteger(operation.afterWord) || operation.afterWord < 0 || operation.afterWord > 16) errors.push('afterWord');
    if (['output', 'position', 'style', 'leaderStyle'].some(key => Object.hasOwn(operation, key))) errors.push('operation');
    if (!errors.length && next) {
      next.lineBreaks ||= {};
      if (operation.afterWord === 0) delete next.lineBreaks[operation.citycode];
      else next.lineBreaks[operation.citycode] = operation.afterWord;
    }
  }
  if (kind === 'leader_style') {
    if (['output', 'position', 'style', 'citycode'].some(key => Object.hasOwn(operation, key))) errors.push('operation');
    errors.push(...settlementLeaderStyleErrors(operation.leaderStyle));
    if (!errors.length && next) next.leaderStyle = clone(operation.leaderStyle);
  }
  if (kind === "position" || kind === "reset_position") {
    if (Object.hasOwn(operation, "style") || Object.hasOwn(operation, "positions") || Object.hasOwn(operation, "catalogJson")) errors.push("operation");
    if (!OUTPUTS.includes(operation.output)) errors.push("output");
    if (typeof operation.citycode !== "string" || !operation.citycode) errors.push("citycode");
    else if (settings && !knownCitycode(settings, operation.output, operation.citycode)) errors.push("citycode");
    if (kind === "position") {
      positionErrors(errors, warnings, "position", operation.position, { warnOffscreen: true });
      if (!errors.length && next) next.outputs[operation.output][operation.citycode] = { x: operation.position.x, y: operation.position.y };
    } else if (!errors.length && next) {
      delete next.outputs[operation.output][operation.citycode];
    }
  }
  if (kind === "style") {
    if (Object.hasOwn(operation, "position") || Object.hasOwn(operation, "citycode") || Object.hasOwn(operation, "output")) errors.push("operation");
    const probe = settings ? { ...clone(settings), style: operation.style } : null;
    if (probe) {
      const checked = validateSettlementNameSettings(probe);
      if (checked.errors.some((item) => item.startsWith("style."))) errors.push(...checked.errors.filter((item) => item.startsWith("style.")));
      else if (!errors.length && next) next.style = clone(operation.style);
    }
  }
  return { errors, warnings, settings: errors.length ? null : next };
}

export function acceptSettlementNameSnapshot(current, incoming) {
  const currentRevision = current?.revision ?? 0;
  const incomingRevision = incoming?.revision;
  if (!Number.isSafeInteger(incomingRevision) || incomingRevision < currentRevision) return current;
  if (incomingRevision === currentRevision) {
    if (!same(current?.settings, incoming?.settings)) return { ...current, requiresFreshRead: true };
    return current;
  }
  const checked = validateSettlementNameSettings(incoming?.settings);
  if (checked.errors.length) throw new TypeError(checked.errors.join(", "));
  return { revision: incomingRevision, settings: checked.value };
}

export function sharedCapturedStyle(leftLayout, rightLayout) {
  const pick = (layout) => {
    const family = Array.isArray(layout?.["text-font"]) ? layout["text-font"][0] : layout?.["text-font"];
    return { fontFamily: family, fontPx: layout?.["text-size"], rotateDeg: layout?.["text-rotate"] };
  };
  const left = pick(leftLayout);
  const right = pick(rightLayout);
  if (left.fontFamily !== right.fontFamily || left.fontPx !== right.fontPx || left.rotateDeg !== right.rotateDeg) {
    throw new Error("conflicting settlement styles");
  }
  if (!FONTS.includes(left.fontFamily) || !finiteNumber(left.fontPx) || !finiteNumber(left.rotateDeg)) {
    throw new Error("conflicting settlement styles");
  }
  return { fontFamily: left.fontFamily, fontPx: left.fontPx, rotateDeg: normalizeRotationDeg(left.rotateDeg) };
}

export const SETTLEMENT_FONT_STACK = Object.freeze({
  "Guttman Hatzvi": '"Guttman Hatzvi", "Noto Sans Hebrew", Arial, sans-serif',
  Arial: 'Arial, "Noto Sans Hebrew", sans-serif',
});
