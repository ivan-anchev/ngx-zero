import { afterEach, beforeEach, describe, expect, expectTypeOf, it, vi } from 'vitest';
import { expBackoffMs, sleep, tryCatch, type Result } from '../src/utils.js';

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
