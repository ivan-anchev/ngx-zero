import type { MutatorResultDetails } from '@rocicorp/zero';
import { describe, expect, it } from 'vitest';
import { MutatorCallTracker } from '../src/mutator-call-tracker.js';

const success = { type: 'success' } as const satisfies MutatorResultDetails;
const clientFailure = {
  type: 'error',
  error: { type: 'app', message: 'client failed', details: undefined },
} as const satisfies MutatorResultDetails;
const serverFailure = {
  type: 'error',
  error: { type: 'zero', message: 'server failed' },
} as const satisfies MutatorResultDetails;

describe('MutatorCallTracker', () => {
  it('starts idle', () => {
    const tracker = new MutatorCallTracker();

    expect(tracker.clientPending()).toBe(false);
    expect(tracker.pending()).toBe(false);
    expect(tracker.clientResult()).toBeUndefined();
    expect(tracker.serverResult()).toBeUndefined();
    expect(tracker.error()).toBeUndefined();
  });

  it('begins calls with increasing tickets and resets the state', () => {
    const tracker = new MutatorCallTracker();

    expect(tracker.begin()).toBe(1);
    expect(tracker.clientPending()).toBe(true);
    expect(tracker.pending()).toBe(true);
    expect(tracker.clientResult()).toBeUndefined();
    expect(tracker.serverResult()).toBeUndefined();
    expect(tracker.error()).toBeUndefined();
    expect(tracker.begin()).toBe(2);
  });

  it('tracks a client success followed by a server rollback', () => {
    const tracker = new MutatorCallTracker();
    const callId = tracker.begin();

    tracker.settleClient(callId, success);
    expect(tracker.clientPending()).toBe(false);
    expect(tracker.pending()).toBe(true);
    expect(tracker.clientResult()).toBe(success);
    expect(tracker.error()).toBeUndefined();

    tracker.settleServer(callId, serverFailure);
    expect(tracker.pending()).toBe(false);
    expect(tracker.serverResult()).toBe(serverFailure);
    expect(tracker.error()).toBe(serverFailure.error);
  });

  it('prioritizes a client error over a server error', () => {
    const tracker = new MutatorCallTracker();
    const callId = tracker.begin();

    tracker.settleClient(callId, clientFailure);
    tracker.settleServer(callId, serverFailure);

    expect(tracker.error()).toBe(clientFailure.error);
  });

  it('atomically clears a settled error when the next call begins', () => {
    const tracker = new MutatorCallTracker();
    const firstCallId = tracker.begin();
    tracker.settleClient(firstCallId, clientFailure);

    tracker.begin();

    expect(tracker.clientPending()).toBe(true);
    expect(tracker.pending()).toBe(true);
    expect(tracker.clientResult()).toBeUndefined();
    expect(tracker.serverResult()).toBeUndefined();
    expect(tracker.error()).toBeUndefined();
  });

  it('drops out-of-order results from superseded calls', () => {
    const tracker = new MutatorCallTracker();
    const firstCallId = tracker.begin();
    tracker.begin();

    tracker.settleServer(firstCallId, serverFailure);

    expect(tracker.pending()).toBe(true);
    expect(tracker.serverResult()).toBeUndefined();
    expect(tracker.error()).toBeUndefined();
  });

  it('freezes signals after destroy while continuing to issue tickets', () => {
    const tracker = new MutatorCallTracker();
    const firstCallId = tracker.begin();
    tracker.destroy();

    tracker.settleClient(firstCallId, success);
    expect(tracker.begin()).toBe(2);

    expect(tracker.clientPending()).toBe(true);
    expect(tracker.pending()).toBe(true);
    expect(tracker.clientResult()).toBeUndefined();
    expect(tracker.serverResult()).toBeUndefined();
    expect(tracker.error()).toBeUndefined();
  });
});
