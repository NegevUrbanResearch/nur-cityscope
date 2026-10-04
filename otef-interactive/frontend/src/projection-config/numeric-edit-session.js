export function parseNumericText(text, { sign = 1, signed = true } = {}) {
  const raw = String(text).trim();
  if (!/^[+-]?(?:\d+(?:[.,]\d+)?|[.,]\d+)$/.test(raw)) return { ok: false, error: 'Enter a complete number.' };
  const parsed = Number(raw.replace(',', '.'));
  const value = /^[+-]/.test(raw) ? parsed : parsed * sign;
  if (!Number.isFinite(value) || (!signed && value < 0)) return { ok: false, error: 'Enter a number within the allowed bounds.' };
  return { ok: true, value: value === 0 ? 0 : value };
}

/** Baselines and candidates always use storage units, never rounded labels. */
export function createNumericEditSession({ path, resolvedPath = path, value, toDisplay = v => v, fromDisplay = v => v }) {
  let baseline = { resolvedPath, value };
  let latest = { ...baseline };
  let text = String(toDisplay(value));
  let sign = 1;
  let dirty = false;
  let conflict = false;
  const cancel = () => { baseline = { ...latest }; text = String(toDisplay(latest.value)); sign = 1; dirty = false; conflict = false; };
  return {
    input(nextText, nextSign = 1) { text = nextText; sign = nextSign; dirty = true; },
    sync(next) {
      latest = { ...next };
      if (!dirty) cancel();
      else if (next.resolvedPath !== baseline.resolvedPath || !Object.is(next.value, baseline.value)) conflict = true;
    },
    candidate() {
      const meta = { baseValue: baseline.value, resolvedPath: baseline.resolvedPath };
      if (!dirty) return { kind: 'unchanged', ...meta };
      if (conflict) return { kind: 'conflict', error: 'Value changed while editing. Use latest or use my value.', ...meta };
      const parsed = parseNumericText(text, { sign });
      if (!parsed.ok) return { kind: 'invalid', error: parsed.error, ...meta };
      // Avoid adapter round-trip drift when the input matches the exact baseline display.
      const next = parsed.value === toDisplay(baseline.value) ? baseline.value
        : parsed.value === toDisplay(-baseline.value) ? -baseline.value : fromDisplay(parsed.value);
      if (!Number.isFinite(next)) return { kind: 'invalid', error: 'Enter a complete number.', ...meta };
      return Object.is(next, baseline.value) ? { kind: 'unchanged', ...meta } : { kind: 'commit', value: next, ...meta };
    },
    cancel,
    isDirty: () => dirty,
  };
}
