import { describe, expect, test } from 'vitest';
import { createProjectionNamesStatusTracker } from '../../frontend/src/projection/projection-names-status.js';

const target = { revision: 12, datasetVersion: 'release-1', placementIdentity: 'a'.repeat(64), requestId: null };
const leftId = '10000000-0000-4000-8000-000000000001';
const rightId = '20000000-0000-4000-8000-000000000002';
function status(output, instanceId, changes = {}) {
  const identity = { revision: 12, datasetVersion: 'release-1', placementIdentity: 'a'.repeat(64) };
  return { type: 'otef_projection_names_status', table: 'otef', output, instanceId, requestId: null,
    ...identity, state: 'current', installed: { ...identity, mode: 'wall', digest: 'b'.repeat(64), expected: 1200, placed: 1200 }, ...changes };
}

describe('projection names status tracker', () => {
  test('terminal cancellation retires Run correlation and accepts automatic language-refresh reports', () => {
    const tracker = createProjectionNamesStatusTracker(); tracker.setTarget(target);
    const requestId = '30000000-0000-4000-8000-000000000003';
    tracker.beginRequest(requestId);
    tracker.accept(status('left', leftId, { requestId, state: 'stale' }));
    tracker.accept(status('right', rightId, { requestId, state: 'stale' }));
    expect(tracker.accept(status('left', leftId))).toBe(true);
    expect(tracker.accept(status('right', rightId))).toBe(true);
    expect(tracker.getState().state).toBe('current');
    expect(tracker.accept(status('left', leftId, { requestId }))).toBe(false);
  });
  test('geometry acknowledgements never establish names current and two matching output reports are required', () => {
    const tracker = createProjectionNamesStatusTracker();
    tracker.setTarget(target);
    expect(tracker.getState().state).toBe('initializing');
    tracker.accept({ type: 'otef_projection_applied', output: 'left', revision: 12, success: true });
    expect(tracker.getState().state).toBe('initializing');
    tracker.accept(status('left', leftId));
    expect(tracker.getState().state).toBe('stale');
    tracker.accept(status('right', rightId));
    expect(tracker.getState()).toMatchObject({ state: 'current', installed: { expected: 1200, placed: 1200 } });
  });

  test('rejects malformed, superseded, and stale output reports', () => {
    const tracker = createProjectionNamesStatusTracker();
    tracker.setTarget(target);
    expect(tracker.accept(status('left', 'not-a-uuid'))).toBe(false);
    expect(tracker.accept(status('left', leftId, { revision: 11 }))).toBe(false);
    expect(tracker.accept(status('left', leftId, { installed: { expected: -1 } }))).toBe(false);
    expect(tracker.getState().state).toBe('initializing');
  });

  test('accepts an output release-identity failure for the matching calibration without treating it as current', () => {
    const tracker = createProjectionNamesStatusTracker();
    tracker.setTarget(target);
    const failed = status('left', leftId, { state: 'failed', datasetVersion: '', installed: null,
      error: 'Name wall release metadata unavailable' });
    expect(tracker.accept(failed)).toBe(true);
    expect(tracker.getState()).toMatchObject({ state: 'failed', outputs: { left: { state: 'failed' }, right: null } });
    expect(tracker.accept({ ...failed, requestId: '30000000-0000-4000-8000-000000000003' })).toBe(false);
  });

  test('partial installed outputs stay stale and replaced instances reject delayed reports', () => {
    const tracker = createProjectionNamesStatusTracker();
    tracker.setTarget(target);
    tracker.accept(status('left', leftId, { installed: { ...status('left', leftId).installed, placed: 1199 } }));
    tracker.accept(status('right', rightId));
    expect(tracker.getState().state).toBe('stale');
    tracker.observeInstance('left', '30000000-0000-4000-8000-000000000003');
    expect(tracker.accept(status('left', leftId))).toBe(false);
    expect(tracker.accept(status('left', '30000000-0000-4000-8000-000000000003'))).toBe(true);
  });

  test('a fresh tracker can recover null-request current status; an active run filters delayed acknowledgements', () => {
    const tracker = createProjectionNamesStatusTracker();
    tracker.setTarget(target);
    tracker.accept(status('left', leftId)); tracker.accept(status('right', rightId));
    expect(tracker.getState().state).toBe('current');
    const requestId = '30000000-0000-4000-8000-000000000003';
    tracker.beginRequest(requestId);
    expect(tracker.getState().state).toBe('rebuilding');
    expect(tracker.accept(status('left', leftId))).toBe(false);
    expect(tracker.accept(status('left', leftId, { requestId }))).toBe(true);
  });

  test('keeps successful peer visible while reporting partial failure, then permits retry', () => {
    const tracker = createProjectionNamesStatusTracker();
    tracker.setTarget(target);
    tracker.accept(status('left', leftId));
    tracker.accept(status('right', rightId, { state: 'failed', requestId: null, error: 'placement failed' }));
    expect(tracker.getState()).toMatchObject({ state: 'failed', outputs: { left: { state: 'current' }, right: { state: 'failed', error: 'placement failed' } } });
    tracker.beginRequest('30000000-0000-4000-8000-000000000003');
    expect(tracker.getState().requestId).toBe('30000000-0000-4000-8000-000000000003');
  });

  test('locks a request immediately, including after a prior failure, until both output terminals arrive', () => {
    const tracker = createProjectionNamesStatusTracker();
    tracker.setTarget(target);
    const first = '30000000-0000-4000-8000-000000000003';
    expect(tracker.beginRequest(first)).toBe(true);
    expect(tracker.getState()).toMatchObject({ state: 'rebuilding', pending: true });
    expect(tracker.beginRequest('40000000-0000-4000-8000-000000000004')).toBe(false);
    tracker.accept(status('left', leftId, { requestId: first, state: 'failed', error: 'placement failed' }));
    expect(tracker.getState().pending).toBe(true);
    tracker.accept(status('right', rightId, { requestId: first, state: 'failed', error: 'placement failed' }));
    expect(tracker.getState()).toMatchObject({ state: 'failed', pending: false });
    expect(tracker.beginRequest('40000000-0000-4000-8000-000000000004')).toBe(true);
  });

  test('correlated stale rejection releases a rejected Run side so retry is available', () => {
    const tracker = createProjectionNamesStatusTracker();
    tracker.setTarget(target);
    const requestId = '30000000-0000-4000-8000-000000000003';
    tracker.beginRequest(requestId);
    expect(tracker.accept(status('left', leftId, { requestId, state: 'stale', error: 'Run target no longer matches the applied calibration' }))).toBe(true);
    expect(tracker.getState()).toMatchObject({ state: 'rebuilding', pending: true });
    expect(tracker.accept(status('right', rightId, { requestId, state: 'stale', error: 'Run target no longer matches the applied calibration' }))).toBe(true);
    expect(tracker.getState()).toMatchObject({ state: 'stale', pending: false });
    expect(tracker.beginRequest('40000000-0000-4000-8000-000000000004')).toBe(true);
  });

  test('instance replacement abandons run correlation but preserves the peer and accepts fresh null-request status', () => {
    const tracker = createProjectionNamesStatusTracker();
    tracker.setTarget(target);
    tracker.accept(status('left', leftId)); tracker.accept(status('right', rightId));
    const oldRequest = '30000000-0000-4000-8000-000000000003';
    tracker.beginRequest(oldRequest);
    tracker.accept(status('right', rightId, { requestId: oldRequest, state: 'current' }));
    tracker.accept(status('left', leftId, { requestId: oldRequest, state: 'rebuilding' }));
    tracker.observeInstance('left', '40000000-0000-4000-8000-000000000004');
    expect(tracker.getState()).toMatchObject({ state: 'stale', pending: false, requestId: null,
      outputs: { left: null, right: { state: 'current', installed: { placed: 1200 } } } });
    expect(tracker.accept(status('left', leftId, { requestId: oldRequest, state: 'current' }))).toBe(false);
    expect(tracker.accept(status('left', '40000000-0000-4000-8000-000000000004', { state: 'stale' }))).toBe(true);
    expect(tracker.getState()).toMatchObject({ state: 'stale', pending: false });
    expect(tracker.beginRequest('50000000-0000-4000-8000-000000000005')).toBe(true);
  });

  test('replacement during a paired rebuild does not leave the peer rebuilding under a retired request', () => {
    const tracker = createProjectionNamesStatusTracker();
    tracker.setTarget(target);
    tracker.accept(status('left', leftId)); tracker.accept(status('right', rightId));
    const oldRequest = '60000000-0000-4000-8000-000000000006';
    tracker.beginRequest(oldRequest);
    tracker.accept(status('left', leftId, { requestId: oldRequest, state: 'rebuilding' }));
    tracker.accept(status('right', rightId, { requestId: oldRequest, state: 'rebuilding' }));
    tracker.observeInstance('left', '70000000-0000-4000-8000-000000000007');
    expect(tracker.getState()).toMatchObject({ state: 'stale', pending: false, requestId: null,
      outputs: { left: null, right: { state: 'stale', installed: { placed: 1200 } } } });
    expect(tracker.accept(status('right', rightId, { requestId: oldRequest, state: 'current' }))).toBe(false);
    expect(tracker.accept(status('left', leftId, { requestId: oldRequest, state: 'current' }))).toBe(false);
    expect(tracker.accept(status('left', '70000000-0000-4000-8000-000000000007', { state: 'stale' }))).toBe(true);
    expect(tracker.getState().pending).toBe(false);
    expect(tracker.beginRequest('80000000-0000-4000-8000-000000000008')).toBe(true);
  });
});
