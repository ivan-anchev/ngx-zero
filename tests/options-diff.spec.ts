import { describe, expect, it } from 'vitest';
import type { ZeroOptions } from '@rocicorp/zero';
import {
  diffZeroOptions,
  isExternalSource,
  type ZeroReconcileVerdict,
} from '../src/options-diff.js';
import { valueEquals } from '../src/utils.js';

const base = (over: Partial<ZeroOptions> = {}): ZeroOptions =>
  ({ schema: SCHEMA, cacheURL: 'http://cache', userID: 'u1', ...over }) as ZeroOptions;

const SCHEMA = { tables: {}, relationships: {} } as unknown as ZeroOptions['schema'];

describe('diffZeroOptions', () => {
  describe('auth 3-way semantics', () => {
    it('same string → noop', () => {
      expect(diffZeroOptions(base({ auth: 't1' }), base({ auth: 't1' }))).toBe('noop');
    });

    it('string→string rotation → connect', () => {
      expect(diffZeroOptions(base({ auth: 't1' }), base({ auth: 't2' }))).toBe('connect');
    });

    it('string↔null/undefined (login/logout boundary) → recreate', () => {
      expect(diffZeroOptions(base({ auth: 't1' }), base({ auth: null }))).toBe('recreate');
      expect(diffZeroOptions(base({ auth: 't1' }), base({ auth: undefined }))).toBe('recreate');
      expect(diffZeroOptions(base({ auth: undefined }), base({ auth: 't1' }))).toBe('recreate');
      expect(diffZeroOptions(base(), base({ auth: 't1' }))).toBe('recreate');
    });

    it('null → undefined (both non-string) → noop', () => {
      expect(diffZeroOptions(base({ auth: null }), base({ auth: undefined }))).toBe('noop');
    });
  });

  describe('function presence vs identity', () => {
    it('fresh inline closures on each factory run → noop', () => {
      expect(
        diffZeroOptions(
          base({ onUpdateNeeded: () => {}, getTraceparent: () => 'a' }),
          base({ onUpdateNeeded: () => {}, getTraceparent: () => 'b' }),
        ),
      ).toBe('noop');
    });

    it('function added or removed (presence flip) → recreate', () => {
      expect(diffZeroOptions(base(), base({ onUpdateNeeded: () => {} }))).toBe('recreate');
      expect(diffZeroOptions(base({ onUpdateNeeded: () => {} }), base())).toBe('recreate');
    });
  });

  describe('one-level shallow equality', () => {
    it('equal inline object/array literals → noop', () => {
      expect(
        diffZeroOptions(
          base({ queryHeaders: { a: '1' }, context: { user: 'u' } as never }),
          base({ queryHeaders: { a: '1' }, context: { user: 'u' } as never }),
        ),
      ).toBe('noop');
    });

    it('changed leaf → recreate', () => {
      expect(
        diffZeroOptions(base({ queryHeaders: { a: '1' } }), base({ queryHeaders: { a: '2' } })),
      ).toBe('recreate');
    });

    it('two-level nested rebuild → recreate (deliberately not recursive)', () => {
      expect(
        diffZeroOptions(
          base({ context: { nested: { a: 1 } } as never }),
          base({ context: { nested: { a: 1 } } as never }),
        ),
      ).toBe('recreate');
    });
  });

  describe('value edge semantics', () => {
    it('undefined vs absent key compare equal', () => {
      expect(diffZeroOptions(base({ storageKey: undefined }), base())).toBe('noop');
    });

    it('NaN equals NaN; -0 vs 0 unequal (Object.is)', () => {
      expect(
        diffZeroOptions(base({ pingTimeoutMs: NaN }), base({ pingTimeoutMs: NaN })),
      ).toBe('noop');
      expect(diffZeroOptions(base({ pingTimeoutMs: -0 }), base({ pingTimeoutMs: 0 }))).toBe(
        'recreate',
      );
    });

    it('onClientStateNotFound changes alone → noop (always wrapped, never diffed)', () => {
      expect(diffZeroOptions(base({ onClientStateNotFound: () => {} }), base())).toBe('noop');
      expect(diffZeroOptions(base(), base({ onClientStateNotFound: () => {} }))).toBe('noop');
    });
  });

  describe('canary: every current ZeroOptions key participates as expected', () => {
    // Typed Required<ZeroOptions>: an upstream option ADDITION fails typecheck
    // here first, forcing a deliberate decision about its diff semantics.
    const canary: Required<ZeroOptions> = {
      cacheURL: 'http://cache',
      server: 'http://server',
      auth: 'token',
      userID: 'u1',
      storageKey: 'k1',
      logLevel: 'error',
      logSink: { log: () => {} },
      schema: SCHEMA,
      mutators: {} as never,
      mutateURL: 'http://mutate',
      mutateHeaders: { h: '1' },
      getQueriesURL: 'http://get-queries',
      queryURL: 'http://query',
      queryHeaders: { h: '1' },
      getTraceparent: () => undefined,
      onOnlineChange: () => {},
      onUpdateNeeded: () => {},
      onClientStateNotFound: () => {},
      hiddenTabDisconnectDelay: 1,
      disconnectTimeoutMs: 2,
      pingTimeoutMs: 3,
      kvStore: 'mem',
      maxHeaderLength: 4,
      slowMaterializeThreshold: 5,
      batchViewUpdates: apply => apply(),
      maxRecentQueries: 6,
      queryChangeThrottleMs: 7,
      context: { c: 1 } as never,
    };

    // Per key: [replacement value, expected verdict when only that key changes].
    const expectations: Record<keyof Required<ZeroOptions>, [unknown, ZeroReconcileVerdict]> = {
      cacheURL: ['http://other', 'recreate'],
      server: ['http://other', 'recreate'],
      auth: ['token2', 'connect'],
      userID: ['u2', 'recreate'],
      storageKey: ['k2', 'recreate'],
      logLevel: ['debug', 'recreate'],
      logSink: [{ log: () => {} }, 'recreate'], // plain object w/ fresh fn leaf
      schema: [{ tables: { t: 1 }, relationships: {} }, 'recreate'],
      mutators: [{ m: 1 }, 'recreate'],
      mutateURL: ['http://other', 'recreate'],
      mutateHeaders: [{ h: '2' }, 'recreate'],
      getQueriesURL: ['http://other', 'recreate'],
      queryURL: ['http://other', 'recreate'],
      queryHeaders: [{ h: '2' }, 'recreate'],
      getTraceparent: [() => 'other', 'noop'], // fn identity ignored
      onOnlineChange: [() => {}, 'noop'],
      onUpdateNeeded: [() => {}, 'noop'],
      onClientStateNotFound: [() => {}, 'noop'], // never diffed
      hiddenTabDisconnectDelay: [10, 'recreate'],
      disconnectTimeoutMs: [20, 'recreate'],
      pingTimeoutMs: [30, 'recreate'],
      kvStore: ['idb', 'recreate'],
      maxHeaderLength: [40, 'recreate'],
      slowMaterializeThreshold: [50, 'recreate'],
      batchViewUpdates: [(apply: () => void) => apply(), 'noop'],
      maxRecentQueries: [60, 'recreate'],
      queryChangeThrottleMs: [70, 'recreate'],
      context: [{ c: 2 }, 'recreate'],
    };

    it('covers exactly the keys in the fixture', () => {
      expect(Object.keys(expectations).sort()).toEqual(Object.keys(canary).sort());
    });

    for (const [key, [replacement, verdict]] of Object.entries(expectations)) {
      it(`${key}: change → ${verdict}`, () => {
        const changed = { ...canary, [key]: replacement } as ZeroOptions;
        expect(diffZeroOptions(canary as ZeroOptions, changed)).toBe(verdict);
      });
    }
  });
});

describe('valueEquals', () => {
  it('compares class-prototyped values by identity', () => {
    class Sink {
      log() {}
    }
    const a = new Sink();
    expect(valueEquals(a, a)).toBe(true);
    expect(valueEquals(a, new Sink())).toBe(false);
  });

  it('compares arrays one level deep', () => {
    expect(valueEquals([1, 2], [1, 2])).toBe(true);
    expect(valueEquals([1, 2], [1, 3])).toBe(false);
    expect(valueEquals([1, 2], [1, 2, 3])).toBe(false);
  });
});

describe('isExternalSource', () => {
  it('discriminates on the zero key', () => {
    expect(isExternalSource({ zero: {} as never })).toBe(true);
    expect(isExternalSource({ schema: SCHEMA } as ZeroOptions)).toBe(false);
  });
});
