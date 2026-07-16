import { describe, expect, expectTypeOf, it } from 'vitest';
import { expBackoffMs, tryCatch, type Result } from '../src/utils.js';

describe('tryCatch', () => {
  it('returns ok with the value for a sync function', () => {
    const result = tryCatch(() => 42);
    expect(result).toEqual({ ok: true, value: 42 });
  });

  it('returns the thrown error for a sync function', () => {
    const boom = new Error('boom');
    const result = tryCatch(() => {
      throw boom;
    });
    expect(result).toEqual({ ok: false, error: boom });
  });

  it('resolves ok with the value for an async function', async () => {
    const result = await tryCatch(async () => 'token');
    expect(result).toEqual({ ok: true, value: 'token' });
  });

  it('resolves (never rejects) with the error for a rejecting async function', async () => {
    const boom = new Error('boom');
    const result = await tryCatch(async () => {
      throw boom;
    });
    expect(result).toEqual({ ok: false, error: boom });
  });

  it('captures non-Error throws as-is', () => {
    const result = tryCatch(() => {
      throw 'plain string';
    });
    expect(result).toEqual({ ok: false, error: 'plain string' });
  });

  it('infers the value type and narrows on ok', () => {
    const sync = tryCatch(() => 42);
    expectTypeOf(sync).toEqualTypeOf<Result<number>>();
    if (sync.ok) {
      expectTypeOf(sync.value).toEqualTypeOf<number>();
    } else {
      expectTypeOf(sync.error).toEqualTypeOf<unknown>();
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
