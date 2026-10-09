const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const HASH = /^[a-f0-9]{64}$/i;
const OUTPUTS = ['left', 'right'];
const INSTALLED_KEYS = ['datasetVersion', 'digest', 'expected', 'mode', 'placed', 'placementIdentity', 'revision'];

function validInstalled(value) {
  return value === null || (value && typeof value === 'object' && !Array.isArray(value) &&
    Object.keys(value).sort().join('|') === INSTALLED_KEYS.join('|') &&
    Number.isSafeInteger(value.revision) && value.revision >= 0 &&
    typeof value.datasetVersion === 'string' && value.datasetVersion.length > 0 && value.datasetVersion.length <= 128 &&
    HASH.test(value.placementIdentity || '') && ['wall', 'model'].includes(value.mode) && HASH.test(value.digest || '') &&
    Number.isSafeInteger(value.expected) && value.expected > 0 && Number.isSafeInteger(value.placed) && value.placed >= 0 && value.placed <= value.expected);
}

export function validProjectionNamesStatus(message) {
  if (!message || typeof message !== 'object' || Array.isArray(message)) return false;
  const required = ['datasetVersion', 'instanceId', 'installed', 'output', 'placementIdentity', 'requestId', 'revision', 'state', 'table', 'type'];
  const keys = Object.keys(message).sort();
  const allowed = [...required, 'error'].sort();
  if (keys.some((key) => !allowed.includes(key)) || required.some((key) => !keys.includes(key))) return false;
  const unavailableDatasetFailure = message.state === 'failed' && message.requestId === null && message.datasetVersion === '' && message.installed === null &&
    typeof message.error === 'string' && message.error.length > 0;
  return message.type === 'otef_projection_names_status' && message.table === 'otef' && OUTPUTS.includes(message.output) &&
    UUID.test(message.instanceId || '') && (message.requestId === null || UUID.test(message.requestId || '')) &&
    Number.isSafeInteger(message.revision) && message.revision >= 0 &&
    typeof message.datasetVersion === 'string' && (unavailableDatasetFailure || message.datasetVersion.length > 0 && message.datasetVersion.length <= 128) &&
    HASH.test(message.placementIdentity || '') && ['initializing', 'stale', 'rebuilding', 'failed', 'current'].includes(message.state) &&
    (message.error === undefined || typeof message.error === 'string' && message.error.length <= 240) && validInstalled(message.installed);
}

export function createProjectionNamesStatusTracker() {
  let target = null;
  let requestId = null;
  let connected = true;
  const outputs = new Map();
  const activeInstances = new Map();
  let pendingOutputs = new Set();

  function matchesTarget(message) {
    const unavailableDatasetFailure = message.state === 'failed' && message.requestId === null && message.datasetVersion === '' && message.installed === null;
    return target && message.revision === target.revision && (unavailableDatasetFailure || message.datasetVersion === target.datasetVersion) &&
      message.placementIdentity === target.placementIdentity && (requestId === null ? message.requestId === null : message.requestId === requestId);
  }

  function setTarget(next) {
    const changed = !target || !next || target.revision !== next.revision || target.datasetVersion !== next.datasetVersion || target.placementIdentity !== next.placementIdentity;
    target = next && Number.isSafeInteger(next.revision) && next.revision >= 0 && typeof next.datasetVersion === 'string' &&
      next.datasetVersion.length > 0 && next.datasetVersion.length <= 128 && HASH.test(next.placementIdentity || '') ? { ...next } : null;
    if (changed) { requestId = null; outputs.clear(); activeInstances.clear(); pendingOutputs.clear(); }
    return changed;
  }

  function beginRequest(id) {
    if (!UUID.test(id || '') || !target || pendingOutputs.size > 0) return false;
    requestId = id;
    outputs.clear();
    pendingOutputs = new Set(OUTPUTS);
    return true;
  }

  function accept(message) {
    if (!connected || !validProjectionNamesStatus(message) || !matchesTarget(message)) return false;
    if (activeInstances.has(message.output) && activeInstances.get(message.output) !== message.instanceId) return false;
    activeInstances.set(message.output, message.instanceId);
    outputs.set(message.output, { ...message, installed: message.installed && { ...message.installed } });
    if (message.requestId === requestId && ['current', 'stale', 'failed'].includes(message.state)) pendingOutputs.delete(message.output);
    if (requestId !== null && pendingOutputs.size === 0) requestId = null;
    return true;
  }

  function observeInstance(output, instanceId) {
    if (!OUTPUTS.includes(output) || !UUID.test(instanceId || '')) return false;
    const current = activeInstances.get(output);
    if (current === instanceId) return true;
    activeInstances.set(output, instanceId);
    outputs.delete(output);
    // A replacement cannot finish the run owned by the previous instance.
    // Keep the peer's installed report visible, but return to reconnect-style
    // null request correlation so fresh status can recover the pair.
    if (requestId !== null) {
      requestId = null;
      pendingOutputs.clear();
      for (const [side, message] of outputs) {
        if (message.state === 'rebuilding') outputs.set(side, { ...message, requestId: null, state: 'stale' });
      }
    }
    return true;
  }

  function getState() {
    const sides = Object.fromEntries(OUTPUTS.map((side) => [side, outputs.get(side) || null]));
    const messages = OUTPUTS.map((side) => sides[side]);
    const failed = messages.find((message) => message?.state === 'failed');
    const rebuilding = messages.some((message) => message?.state === 'rebuilding') ||
      pendingOutputs.size > 0;
    const installs = messages.map((message) => message?.installed || null);
    const pairedCurrent = messages.every((message) => message?.state === 'current' && message.installed &&
      message.installed.revision === target?.revision && message.installed.datasetVersion === target?.datasetVersion &&
      message.installed.placementIdentity === target?.placementIdentity) &&
      (requestId === null || messages.every((message) => message.requestId === requestId)) &&
      installs.every((installed) => installed && installed.expected > 0 && installed.placed === installed.expected &&
        ['revision', 'datasetVersion', 'placementIdentity', 'mode', 'digest', 'expected', 'placed'].every((key) => installed[key] === installs[0][key]));
    const state = !connected ? 'stale' : failed ? 'failed' : rebuilding ? 'rebuilding' : pairedCurrent ? 'current' : installs.some(Boolean) ? 'stale' : 'initializing';
    const installed = pairedCurrent ? installs[0] : null;
    const detail = state === 'failed' ? failed?.error || 'Name placement failed. Run names to retry.'
      : state === 'stale' ? 'Geometry changed. Finish geometry, then Run names.'
        : state === 'rebuilding' ? 'Rebuilding names on both outputs…'
          : state === 'current' ? `Names current · ${installed.placed} of ${installed.expected} placed.`
            : 'Waiting for names output status…';
    return { state, detail, installed, outputs: sides, requestId, connected, pending: pendingOutputs.size > 0 };
  }

  return { setTarget, beginRequest, accept, observeInstance, setConnected(value) { connected = Boolean(value); if (!connected) { outputs.clear(); activeInstances.clear(); pendingOutputs.clear(); requestId = null; } }, getState };
}
