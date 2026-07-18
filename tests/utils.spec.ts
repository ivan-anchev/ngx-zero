import { describe, expect, expectTypeOf, it } from 'vitest';
import { tryCatch, type Result } from '../src/utils.js';

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

  it('resolves with the error for a rejecting async function', async () => {
    const boom = new Error('boom');
    const outcome = await tryCatch(async () => {
      throw boom;
    });
    expect(outcome.error).toBe(boom);
  });

  it('wraps non-Error throws and preserves the cause', () => {
    const outcome = tryCatch(() => {
      throw 'plain string';
    });
    expect(outcome.error).toBeInstanceOf(Error);
    expect(outcome.error?.message).toBe('plain string');
    expect(outcome.error?.cause).toBe('plain string');
  });

  it('infers and narrows the result type', () => {
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
