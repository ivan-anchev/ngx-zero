import { afterEach, beforeEach, describe, expect, expectTypeOf, it, vi } from 'vitest';
import {
  createRetryRunner,
  expBackoffMs,
  sleep,
  tryCatch,
  type Result,
} from '../src/utils.js';

describe('tryCatch', () => {
  it('returns the result for a sync function', () => {
    expect(tryCatch(() => 42)).toEqual({ result: 42 });
  });

  it('returns the thrown error for a sync function', () => {
    const boom = new Error('boom');
    const outcome = tryCatch(() => {
      throw boom;
    });
    expect(outcome.error).toBe(boom);
    expect(outcome.result).toBeUndefined();
  });

  it('resolves with the result for an async function', async () => {
    expect(await tryCatch(async () => 'token')).toEqual({ result: 'token' });
  });

  it('resolves (never rejects) with the error for a rejecting async function', async () => {
    const boom = new Error('boom');
    const outcome = await tryCatch(async () => {
      throw boom;
    });
    expect(outcome.error).toBe(boom);
  });

  it('wraps a non-Error throw, preserving the original value on cause', () => {
    const outcome = tryCatch(() => {
      throw 'plain string';
    });
    expect(outcome.error).toBeInstanceOf(Error);
    expect(outcome.error?.message).toBe('plain string');
    expect(outcome.error?.cause).toBe('plain string');
  });

  it('infers the result type and narrows on error', () => {
    const sync = tryCatch(() => 42);
    expectTypeOf(sync).toEqualTypeOf<Result<number>>();
    if (sync.error) {
      expectTypeOf(sync.error).toEqualTypeOf<Error>();
      expectTypeOf(sync.result).toEqualTypeOf<undefined>();
    } else {
      expectTypeOf(sync.result).toEqualTypeOf<number>();
    }

    const async = tryCatch(async () => 'token');
    expectTypeOf(async).toEqualTypeOf<Promise<Result<string>>>();
  });
});

describe('expBackoffMs', () => {
  it('doubles per attempt and caps at 30s', () => {
    expect([0, 1, 2, 5, 10].map(attempt => expBackoffMs(attempt))).toEqual([
      1000, 2000, 4000, 30_000, 30_000,
    ]);
  });
});

describe('createRetryRunner', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('runs the function and returns its outcome', async () => {
    const runner = createRetryRunner({ maxAttempts: 3 });
    const run = await runner.run(async () => 'token');
    expect(run).toEqual({ status: 'completed', outcome: { result: 'token' } });
  });

  it('skips while a run is in flight (dedup)', async () => {
    const runner = createRetryRunner({ maxAttempts: 3 });
    let resolve!: (value: string) => void;
    const first = runner.run(() => new Promise<string>(r => (resolve = r)));

    expect(await runner.run(async () => 'second')).toEqual({ status: 'skipped' });

    resolve('first');
    expect(await first).toEqual({ status: 'completed', outcome: { result: 'first' } });
  });

  it('holds the runner through the backoff after a failure', async () => {
    const runner = createRetryRunner({ maxAttempts: 3, backoffMs: () => 1000 });
    const failing = runner.run(async () => {
      throw new Error('boom');
    });

    await vi.advanceTimersByTimeAsync(500); // mid-backoff
    expect(await runner.run(async () => 'ignored')).toEqual({ status: 'skipped' });

    await vi.advanceTimersByTimeAsync(500);
    const run = await failing;
    expect(run.status).toBe('completed');
    expect(run.status === 'completed' && run.outcome.error?.message).toBe('boom');
  });

  it('gives up exactly once when the budget is spent, then skips until reset', async () => {
    const runner = createRetryRunner({ maxAttempts: 1 });
    await runner.run(async () => 'spent');

    expect(await runner.run(async () => 'over')).toEqual({ status: 'gave-up' });
    expect(runner.givenUp).toBe(true);
    expect(await runner.run(async () => 'over')).toEqual({ status: 'skipped' });

    runner.reset();
    expect(runner.givenUp).toBe(false);
    expect(await runner.run(async () => 'again')).toEqual({
      status: 'completed',
      outcome: { result: 'again' },
    });
  });

  it('giveUp() latches explicitly and reports only the flipping call', () => {
    const runner = createRetryRunner({ maxAttempts: 3 });
    expect(runner.giveUp()).toBe(true);
    expect(runner.giveUp()).toBe(false);
    expect(runner.givenUp).toBe(true);
  });

  it('abort resolves a pending backoff without a timer left behind', async () => {
    const controller = new AbortController();
    const runner = createRetryRunner({
      maxAttempts: 3,
      backoffMs: () => 60_000,
      abort: controller.signal,
    });
    const failing = runner.run(async () => {
      throw new Error('boom');
    });
    await vi.advanceTimersByTimeAsync(0); // enter the backoff sleep

    controller.abort();
    expect((await failing).status).toBe('completed');
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe('sleep', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('resolves after the given delay', async () => {
    let elapsed = false;
    void sleep(1000).then(() => (elapsed = true));

    await vi.advanceTimersByTimeAsync(999);
    expect(elapsed).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(elapsed).toBe(true);
  });

  it('abort resolves early (never rejects) and clears the timer', async () => {
    const controller = new AbortController();
    let elapsed = false;
    void sleep(1000, controller.signal).then(() => (elapsed = true));

    controller.abort();
    await vi.advanceTimersByTimeAsync(0);
    expect(elapsed).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('resolves immediately on an already-aborted signal without scheduling a timer', async () => {
    const controller = new AbortController();
    controller.abort();

    let elapsed = false;
    void sleep(1000, controller.signal).then(() => (elapsed = true));
    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(0);
    expect(elapsed).toBe(true);
  });
});
