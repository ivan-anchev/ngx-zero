import { afterEach, describe, expect, it, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import type { ZeroOptions } from '@rocicorp/zero';
import { provideZero } from '../src/provide-zero.js';
import { withAuthRefresh, type ZeroAuthRefreshFn } from '../src/with-auth-refresh.js';
import { ZERO_CONSTRUCTOR, ZERO_INSTANCE_MANAGER } from '../src/instance-manager.js';
import {
  fakeZeroHarness,
  provideTestChangeDetection,
  NEEDS_AUTH,
  type FakeZeroHarness,
} from './helpers.js';

const SCHEMA = { tables: {}, relationships: {} } as unknown as ZeroOptions['schema'];

const options = (over: Partial<ZeroOptions> = {}): ZeroOptions =>
  ({ schema: SCHEMA, cacheURL: 'http://cache', userID: 'u1', ...over }) as ZeroOptions;

interface Deferred {
  resolve: (v: string | null | undefined | false) => void;
  reject: (e: unknown) => void;
}

/** refreshFn returning caller-controlled deferreds, one per invocation. */
function deferredRefresh(): { fn: ZeroAuthRefreshFn; calls: Deferred[] } {
  const calls: Deferred[] = [];
  const fn: ZeroAuthRefreshFn = () =>
    new Promise((resolve, reject) => calls.push({ resolve, reject }));
  return { fn, calls };
}

function setup(
  refreshFn: ZeroAuthRefreshFn,
  refreshOptions?: Parameters<typeof withAuthRefresh>[1],
): FakeZeroHarness {
  const harness = fakeZeroHarness();
  TestBed.configureTestingModule({
    providers: [
      provideTestChangeDetection(),
      { provide: ZERO_CONSTRUCTOR, useValue: harness.construct },
      provideZero(options(), withAuthRefresh(refreshFn, refreshOptions)),
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
