import { afterEach, describe, expect, it, vi } from 'vitest';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import type { ZeroOptions } from '@rocicorp/zero';
import { provideZero } from '../src/provide-zero.js';
import { withAuthRefresh, type ZeroAuthRefreshFn } from '../src/with-auth-refresh.js';
import { ZERO_CONSTRUCTOR, ZERO_INSTANCE_MANAGER } from '../src/instance-manager.js';
import {
  fakeZeroHarness,
  provideTestChangeDetection,
  zeroOptions as options,
  NEEDS_AUTH,
  type FakeZeroHarness,
} from './helpers.js';

interface Deferred {
  resolve: (v: string | null | undefined | false) => void;
  reject: (e: unknown) => void;
}

/** refreshFn returning caller-controlled deferreds, one per invocation. */
function deferredRefresh(): { fn: ZeroAuthRefreshFn; calls: Deferred[] } {
  const calls: Deferred[] = [];
  const fn: ZeroAuthRefreshFn = () => {
    const deferred = new Promise<string | null | undefined | false>((resolve, reject) =>
      calls.push({ resolve, reject }),
    );
    // Pre-attach a handled branch: the refresher's try/catch does handle the
    // rejection, but zone.js's ZoneAwarePromise still prints the trace to
    // stderr in the zone project — pure log noise for deliberate rejections.
    deferred.catch(() => {});
    return deferred;
  };
  return { fn, calls };
}

function setup(
  refreshFn: ZeroAuthRefreshFn,
  refreshOptions?: Parameters<typeof withAuthRefresh>[1],
  source: ZeroOptions | (() => ZeroOptions) = options(),
): FakeZeroHarness {
  const harness = fakeZeroHarness();
  TestBed.configureTestingModule({
    providers: [
      provideTestChangeDetection(),
      { provide: ZERO_CONSTRUCTOR, useValue: harness.construct },
      provideZero(source, withAuthRefresh(refreshFn, refreshOptions)),
    ],
  });
  TestBed.inject(ZERO_INSTANCE_MANAGER);
  return harness;
}

const flushMicrotasks = () => new Promise<void>(resolve => setTimeout(resolve, 0));

afterEach(() => {
  TestBed.resetTestingModule();
  vi.useRealTimers();
});

describe('withAuthRefresh', () => {
  it('needs-auth emission → refresh → token pushed via connect', async () => {
    const { fn, calls } = deferredRefresh();
    const harness = setup(fn);

    harness.latest().state.emit(NEEDS_AUTH);
    expect(calls).toHaveLength(1);

    calls[0]!.resolve('fresh-token');
    await flushMicrotasks();
    expect(harness.latest().connectCalls).toEqual([{ auth: 'fresh-token' }]);
  });

  it('kicks immediately when the instance is ALREADY needs-auth at attach (no replay)', () => {
    const { fn, calls } = deferredRefresh();
    const harness = fakeZeroHarness();
    TestBed.configureTestingModule({
      providers: [
        provideTestChangeDetection(),
        {
          provide: ZERO_CONSTRUCTOR,
          useValue: (opts: ZeroOptions) => {
            const zero = harness.construct(opts);
            // Expired token at construction: already needs-auth before attach.
            harness.latest().state.current = NEEDS_AUTH;
            return zero;
          },
        },
        provideZero(options(), withAuthRefresh(fn)),
      ],
    });
    TestBed.inject(ZERO_INSTANCE_MANAGER);
    expect(calls).toHaveLength(1);
  });

  it('dedups rapid needs-auth emissions into a single in-flight refresh', () => {
    const { fn, calls } = deferredRefresh();
    const harness = setup(fn);

    harness.latest().state.emit(NEEDS_AUTH);
    harness.latest().state.emit(NEEDS_AUTH);
    harness.latest().state.emit(NEEDS_AUTH);
    expect(calls).toHaveLength(1);
  });

  it('null-like resolve → immediate give-up: onGiveUp once, no connect, refresher dormant', async () => {
    const { fn, calls } = deferredRefresh();
    const onGiveUp = vi.fn();
    const harness = setup(fn, { onGiveUp });

    harness.latest().state.emit(NEEDS_AUTH);
    calls[0]!.resolve(null);
    await flushMicrotasks();

    expect(onGiveUp).toHaveBeenCalledTimes(1);
    expect(onGiveUp).toHaveBeenCalledWith(NEEDS_AUTH);
    expect(harness.latest().connectCalls).toHaveLength(0);

    harness.latest().state.emit(NEEDS_AUTH); // dormant: no further refresh
    expect(calls).toHaveLength(1);
  });

  it('rejection → backoff, then retry on the still-needs-auth recheck', async () => {
    vi.useFakeTimers();
    const { fn, calls } = deferredRefresh();
    const harness = setup(fn, { backoffMs: () => 1_000 });

    harness.latest().state.emit(NEEDS_AUTH);
    calls[0]!.reject(new Error('network'));
    await vi.advanceTimersByTimeAsync(999);
    expect(calls).toHaveLength(1); // still backing off

    await vi.advanceTimersByTimeAsync(1);
    expect(calls).toHaveLength(2); // recheck saw needs-auth → retried

    calls[1]!.resolve('t2');
    await vi.advanceTimersByTimeAsync(0);
    expect(harness.latest().connectCalls).toEqual([{ auth: 't2' }]);
  });

  it('server keeps rejecting accepted tokens → converges to give-up after maxAttempts', async () => {
    const refreshFn = vi.fn(async () => 'always-a-token');
    const onGiveUp = vi.fn();
    const harness = setup(refreshFn, { maxAttempts: 3, onGiveUp });

    // Each push is followed by the server flipping back to needs-auth.
    for (let i = 0; i < 5; i++) {
      harness.latest().state.emit(NEEDS_AUTH);
      await flushMicrotasks();
    }

    expect(refreshFn).toHaveBeenCalledTimes(3); // budget NOT reset per episode
    expect(onGiveUp).toHaveBeenCalledTimes(1);
  });

  it('factory-driven auth change during an in-flight refresh discards the stale token (epoch)', async () => {
    const { fn, calls } = deferredRefresh();
    const auth = signal('t1');
    const harness = setup(fn, undefined, () => options({ auth: auth() }));

    harness.latest().state.emit(NEEDS_AUTH);
    expect(calls).toHaveLength(1); // refresh in flight

    auth.set('t2'); // factory rotates the token in place → epoch bump
    TestBed.tick();
    expect(harness.latest().connectCalls).toEqual([{ auth: 't2' }]);

    calls[0]!.resolve('stale-token');
    await flushMicrotasks();
    // state.current is STILL needs-auth — only the epoch guard blocks the push.
    expect(harness.latest().connectCalls).toEqual([{ auth: 't2' }]);
  });

  it('recreate during an in-flight refresh: no stale push on old or new instance; latch released', async () => {
    const { fn, calls } = deferredRefresh();
    const userID = signal('u1');
    const harness = setup(fn, undefined, () => options({ userID: userID() }));

    harness.created[0]!.state.emit(NEEDS_AUTH);
    expect(calls).toHaveLength(1);

    userID.set('u2'); // rotation while the refresh is in flight
    TestBed.tick();
    expect(harness.created).toHaveLength(2);

    calls[0]!.resolve('stale-token');
    await flushMicrotasks();
    expect(harness.created[0]!.connectCalls).toHaveLength(0);
    expect(harness.created[1]!.connectCalls).toHaveLength(0);

    // The latch was released: a fresh needs-auth on the NEW instance re-kicks.
    harness.created[1]!.state.emit(NEEDS_AUTH);
    expect(calls).toHaveLength(2);
  });

  it('backoff recheck skips the retry when auth was fixed meanwhile', async () => {
    vi.useFakeTimers();
    const { fn, calls } = deferredRefresh();
    const harness = setup(fn, { backoffMs: () => 1_000 });

    harness.latest().state.emit(NEEDS_AUTH);
    calls[0]!.reject(new Error('network'));
    await vi.advanceTimersByTimeAsync(0); // reach the backoff sleep

    harness.latest().state.emit({ name: 'connected' }); // fixed while backing off
    await vi.advanceTimersByTimeAsync(1_000);
    expect(calls).toHaveLength(1); // recheck saw a healthy state → no retry
  });

  it('destroy while a refresh is awaiting: resolved token dropped, no push', async () => {
    const { fn, calls } = deferredRefresh();
    const harness = setup(fn);

    harness.latest().state.emit(NEEDS_AUTH);
    TestBed.resetTestingModule(); // destroy mid-flight

    calls[0]!.resolve('late-token');
    await flushMicrotasks();
    expect(harness.latest().connectCalls).toHaveLength(0);
  });

  it('destroy during backoff clears the pending timer — no retry ever fires', async () => {
    vi.useFakeTimers();
    const { fn, calls } = deferredRefresh();
    const harness = setup(fn, { backoffMs: () => 1_000 });

    harness.latest().state.emit(NEEDS_AUTH);
    calls[0]!.reject(new Error('network'));
    await vi.advanceTimersByTimeAsync(0); // now sleeping in backoff

    TestBed.resetTestingModule();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(calls).toHaveLength(1); // pending backoff cancelled, refresher dead
    expect(vi.getTimerCount()).toBe(0); // no timer leak
  });

  it('throwing onGiveUp is contained; give-up state passed through; refresher dormant after', async () => {
    const { fn, calls } = deferredRefresh();
    const seen: unknown[] = [];
    const harness = setup(fn, {
      onGiveUp: state => {
        seen.push(state);
        throw new Error('giveup boom');
      },
    });

    harness.latest().state.emit(NEEDS_AUTH);
    calls[0]!.resolve(null); // null-like → give-up
    await flushMicrotasks(); // throw contained — nothing escapes

    expect(seen).toEqual([NEEDS_AUTH]);
    harness.latest().state.emit(NEEDS_AUTH);
    expect(calls).toHaveLength(1); // still dormant
  });

  it('throwing backoffMs is contained: default backoff applies, the latch is not wedged', async () => {
    vi.useFakeTimers();
    const { fn, calls } = deferredRefresh();
    const harness = setup(fn, {
      backoffMs: () => {
        throw new Error('backoff boom');
      },
    });

    harness.latest().state.emit(NEEDS_AUTH);
    calls[0]!.reject(new Error('network'));
    // Default backoff for attempt 0 is 1000ms — a throwing user backoffMs must
    // fall back to it, not wedge the in-flight latch forever.
    await vi.advanceTimersByTimeAsync(1_000);
    expect(calls).toHaveLength(2);
  });

  it("'connected' re-arms the budget and the give-up latch", async () => {
    const refreshFn = vi.fn(async () => 'token');
    const onGiveUp = vi.fn();
    const harness = setup(refreshFn, { maxAttempts: 1, onGiveUp });

    harness.latest().state.emit(NEEDS_AUTH);
    await flushMicrotasks();
    harness.latest().state.emit(NEEDS_AUTH); // budget exhausted → give-up
    await flushMicrotasks();
    expect(onGiveUp).toHaveBeenCalledTimes(1);
    expect(refreshFn).toHaveBeenCalledTimes(1);

    harness.latest().state.emit({ name: 'connected' }); // healthy again
    harness.latest().state.emit(NEEDS_AUTH);
    await flushMicrotasks();
    expect(refreshFn).toHaveBeenCalledTimes(2); // re-armed
  });
});
