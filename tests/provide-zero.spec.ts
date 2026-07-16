import { afterEach, describe, expect, it, vi } from 'vitest';
import { ErrorHandler, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import type { Zero, ZeroOptions } from '@rocicorp/zero';
import { provideZero } from '../src/provide-zero.js';
import { withInit } from '../src/with-init.js';
import { zeroFeature } from '../src/features.js';
import {
  ZERO_CONSTRUCTOR,
  ZERO_INSTANCE_HOOKS,
  ZERO_INSTANCE_MANAGER,
  type ZeroInstanceManager,
} from '../src/instance-manager.js';
import type { ZeroInstanceSource } from '../src/options-diff.js';
import {
  fakeZeroHarness,
  provideTestChangeDetection,
  type FakeZero,
  type FakeZeroHarness,
} from './helpers.js';

const SCHEMA = { tables: {}, relationships: {} } as unknown as ZeroOptions['schema'];

const options = (over: Partial<ZeroOptions> = {}): ZeroOptions =>
  ({ schema: SCHEMA, cacheURL: 'http://cache', userID: 'u1', ...over }) as ZeroOptions;

interface SetupResult {
  harness: FakeZeroHarness;
  manager: ZeroInstanceManager;
  errors: unknown[];
}

function setup(
  source: ZeroInstanceSource | (() => ZeroInstanceSource),
  ...features: Parameters<typeof provideZero> extends [unknown, ...infer F] ? F : never
): SetupResult {
  const harness = fakeZeroHarness();
  const errors: unknown[] = [];
  TestBed.configureTestingModule({
    providers: [
      provideTestChangeDetection(),
      { provide: ZERO_CONSTRUCTOR, useValue: harness.construct },
      { provide: ErrorHandler, useValue: { handleError: (e: unknown) => errors.push(e) } },
      provideZero(source, ...features),
    ],
  });
  return { harness, manager: TestBed.inject(ZERO_INSTANCE_MANAGER), errors };
}

afterEach(() => TestBed.resetTestingModule());

describe('provideZero', () => {
  it('constructs eagerly and synchronously — no tick needed before first read', () => {
    const { harness, manager } = setup(options());
    expect(harness.created).toHaveLength(1);
    expect(manager.instance()).toBe(harness.latest() as unknown as Zero);
    expect(manager.zeroOrThrow()).toBe(harness.latest() as unknown as Zero);
  });

  it('accepts static options without a factory', () => {
    const { harness } = setup(options({ userID: 'static' }));
    expect(harness.latest().options.userID).toBe('static');
  });

  it('identical factory rerun → zero churn', () => {
    const dep = signal(0);
    const { harness } = setup(() => {
      dep(); // tracked but not part of the options
      return options();
    });
    dep.set(1);
    TestBed.tick();
    expect(harness.created).toHaveLength(1);
    expect(harness.latest().closeCalls).toBe(0);
    expect(harness.latest().connectCalls).toHaveLength(0);
  });

  it('fresh inline callback identity → no churn AND latest-closure delegation', () => {
    const generation = signal(0);
    const seen: number[] = [];
    const { harness } = setup(() => {
      const gen = generation();
      return options({ onUpdateNeeded: () => void seen.push(gen) });
    });
    generation.set(1);
    TestBed.tick();
    expect(harness.created).toHaveLength(1); // identity ignored

    // The wrapper Zero received delegates to the LATEST closure.
    const wrapped = harness.latest().options.onUpdateNeeded;
    wrapped?.({ type: 0 as never });
    expect(seen).toEqual([1]);
  });

  describe('auth matrix (construct/close/connect deltas)', () => {
    it('same string → 0/0/0', () => {
      const auth = signal<string | undefined>('t1');
      const { harness } = setup(() => options({ auth: auth() }));
      auth.set('t1');
      TestBed.tick();
      expect(harness.created).toHaveLength(1);
      expect(harness.latest().closeCalls).toBe(0);
      expect(harness.latest().connectCalls).toHaveLength(0);
    });

    it('string→string → connect in place (0/0/1)', () => {
      const auth = signal<string | undefined>('t1');
      const { harness } = setup(() => options({ auth: auth() }));
      auth.set('t2');
      TestBed.tick();
      expect(harness.created).toHaveLength(1);
      expect(harness.latest().closeCalls).toBe(0);
      expect(harness.latest().connectCalls).toEqual([{ auth: 't2' }]);
    });

    it('string→undefined (logout) → recreate (1/1/0)', () => {
      const auth = signal<string | undefined>('t1');
      const { harness } = setup(() => options({ auth: auth() }));
      auth.set(undefined);
      TestBed.tick();
      expect(harness.created).toHaveLength(2);
      expect(harness.created[0]!.closeCalls).toBe(1);
      expect(harness.created[1]!.connectCalls).toHaveLength(0);
    });

    it('undefined→string (login) → recreate (1/1/0)', () => {
      const auth = signal<string | undefined>(undefined);
      const { harness } = setup(() => options({ auth: auth() }));
      auth.set('t1');
      TestBed.tick();
      expect(harness.created).toHaveLength(2);
      expect(harness.created[0]!.closeCalls).toBe(1);
    });
  });

  it('callback presence flip → recreate', () => {
    const withCallback = signal(false);
    const { harness } = setup(() =>
      withCallback() ? options({ onUpdateNeeded: () => {} }) : options(),
    );
    withCallback.set(true);
    TestBed.tick();
    expect(harness.created).toHaveLength(2);
    expect(harness.created[0]!.closeCalls).toBe(1);
  });

  it('non-auth option change → close + recreate, signal points at newest', () => {
    const userID = signal('u1');
    const { harness, manager } = setup(() => options({ userID: userID() }));
    userID.set('u2');
    TestBed.tick();
    expect(harness.created).toHaveLength(2);
    expect(harness.created[0]!.closeCalls).toBe(1);
    expect(manager.instance()).toBe(harness.created[1] as unknown as Zero);
  });

  describe('onClientStateNotFound rotation', () => {
    const fireCsnf = (harness: FakeZeroHarness) => {
      const wrapped = harness.latest().options.onClientStateNotFound;
      expect(wrapped).toBeTypeOf('function');
      wrapped!();
    };

    it('absent user callback → in-place rotation with same options', () => {
      const { harness, manager } = setup(options());
      fireCsnf(harness);
      TestBed.tick();
      expect(harness.created).toHaveLength(2);
      expect(harness.created[0]!.closeCalls).toBe(1);
      expect(manager.instance()).toBe(harness.created[1] as unknown as Zero);
    });

    it('user callback wins — no rotation', () => {
      const userCsnf = vi.fn();
      const { harness } = setup(options({ onClientStateNotFound: userCsnf }));
      fireCsnf(harness);
      TestBed.tick();
      expect(userCsnf).toHaveBeenCalledTimes(1);
      expect(harness.created).toHaveLength(1);
    });

    it('throwing user callback falls through to rotation', () => {
      const { harness } = setup(
        options({
          onClientStateNotFound: () => {
            throw new Error('user callback boom');
          },
        }),
      );
      fireCsnf(harness);
      TestBed.tick();
      expect(harness.created).toHaveLength(2);
    });

    it('double fire before the recreate lands → exactly one rotation', () => {
      const { harness } = setup(options());
      fireCsnf(harness);
      fireCsnf(harness);
      TestBed.tick();
      expect(harness.created).toHaveLength(2);
    });
  });

  describe('external { zero }', () => {
    it('adopts the external instance and never closes it', () => {
      const externalA = fakeZeroHarness().construct(options());
      const externalB = fakeZeroHarness().construct(options());
      const source = signal<ZeroInstanceSource>({ zero: externalA });
      const { harness, manager } = setup(() => source());

      expect(harness.created).toHaveLength(0); // adopted, not constructed
      expect(manager.instance()).toBe(externalA);

      source.set({ zero: externalB }); // external → external swap
      TestBed.tick();
      expect(manager.instance()).toBe(externalB);
      expect((externalA as unknown as { closeCalls: number }).closeCalls).toBe(0);
    });

    it('owned → external: owned closed; external → owned: external left open', () => {
      const external = fakeZeroHarness().construct(options());
      const source = signal<ZeroInstanceSource>(options());
      const { harness, manager } = setup(() => source());
      const owned = harness.latest();

      source.set({ zero: external });
      TestBed.tick();
      expect(owned.closeCalls).toBe(1);
      expect(manager.instance()).toBe(external);

      source.set(options({ userID: 'back-to-owned' }));
      TestBed.tick();
      expect(manager.instance()).toBe(harness.created[1] as unknown as Zero);
      expect((external as unknown as { closeCalls: number }).closeCalls).toBe(0);
    });
  });

  it('factory throw on rerun → previous instance retained; recovers on next valid emission', () => {
    const mode = signal<'ok' | 'throw' | 'ok2'>('ok');
    const { harness, manager } = setup(() => {
      if (mode() === 'throw') throw new Error('factory boom');
      return options({ userID: mode() });
    });
    const first = harness.latest();

    mode.set('throw');
    expect(() => TestBed.tick()).toThrow(/factory boom/);
    expect(manager.instance()).toBe(first as unknown as Zero); // retained

    mode.set('ok2');
    TestBed.tick();
    expect(harness.created).toHaveLength(2); // recovered
    expect(manager.instance()).toBe(harness.created[1] as unknown as Zero);
  });

  it('constructor throw → predecessor closed & hidden, ErrorHandler notified, next emission recovers', () => {
    const userID = signal('u1');
    const harness = fakeZeroHarness();
    const errors: unknown[] = [];
    let throwNext = false;
    TestBed.configureTestingModule({
      providers: [
        provideTestChangeDetection(),
        {
          provide: ZERO_CONSTRUCTOR,
          useValue: (opts: ZeroOptions) => {
            if (throwNext) {
              throwNext = false;
              throw new Error('constructor boom');
            }
            return harness.construct(opts);
          },
        },
        { provide: ErrorHandler, useValue: { handleError: (e: unknown) => errors.push(e) } },
        provideZero(() => options({ userID: userID() })),
      ],
    });
    const manager = TestBed.inject(ZERO_INSTANCE_MANAGER);
    expect(harness.created).toHaveLength(1);

    throwNext = true;
    userID.set('u2');
    TestBed.tick();
    expect(errors.some(e => /constructor boom/.test(String(e)))).toBe(true);
    expect(manager.instance()).toBeUndefined(); // never re-expose the closed predecessor
    expect(() => manager.zeroOrThrow()).toThrow(/\[ngx-zero\].*No Zero instance/s);

    userID.set('u3');
    TestBed.tick();
    expect(harness.created).toHaveLength(2);
    expect(manager.instance()).toBe(harness.created[1] as unknown as Zero);
  });

  it('destroy → close called exactly once; rejecting close swallowed', async () => {
    const { harness } = setup(options());
    harness.latest().closeBehavior = 'reject';
    expect(() => TestBed.resetTestingModule()).not.toThrow();
    expect(harness.latest().closeCalls).toBe(1);
    await Promise.resolve(); // rejection handled, no unhandled rejection
  });

  it('providing provideZero twice in the same environment throws at startup', () => {
    TestBed.configureTestingModule({
      providers: [
        provideTestChangeDetection(),
        { provide: ZERO_CONSTRUCTOR, useValue: fakeZeroHarness().construct },
        provideZero(options()),
        provideZero(options()),
      ],
    });
    expect(() => TestBed.inject(ZERO_INSTANCE_MANAGER)).toThrow(
      /\[ngx-zero\].*more than once/s,
    );
  });

  it('duplicate feature kinds are rejected at provide time', () => {
    expect(() => provideZero(options(), withInit(() => {}), withInit(() => {}))).toThrow(
      /\[ngx-zero\].*duplicate feature "init"/s,
    );
  });

  describe('withInit', () => {
    it('runs once per owned construction, after construction, before the signal flips', () => {
      const events: string[] = [];
      const userID = signal('u1');
      const managerBox: { current?: ZeroInstanceManager } = {};
      const { harness, manager } = setup(
        () => options({ userID: userID() }),
        withInit(zero => {
          // Once the box is filled (second construction on), assert the signal
          // has NOT flipped to the new instance yet at init time.
          const beforeFlip = managerBox.current === undefined || managerBox.current.instance() !== zero;
          events.push(beforeFlip ? 'init' : 'init-after-flip');
        }),
      );
      managerBox.current = manager;
      expect(events).toEqual(['init']);
      expect(harness.created).toHaveLength(1);

      userID.set('u2');
      TestBed.tick();
      expect(events).toEqual(['init', 'init']); // once per construction, before flip
    });

    it('never runs for an external { zero }', () => {
      const init = vi.fn();
      const external = fakeZeroHarness().construct(options());
      setup({ zero: external }, withInit(init));
      expect(init).not.toHaveBeenCalled();
    });
  });

  it('feature hooks attach to every current instance and detach before replacement', () => {
    const events: string[] = [];
    const userID = signal('u1');
    const hookFeature = zeroFeature('auth-refresh', [
      {
        provide: ZERO_INSTANCE_HOOKS,
        multi: true,
        useValue: {
          onInstanceAttached: (zero: Zero) => {
            const id = (zero as unknown as FakeZero).options.userID;
            events.push(`attach:${id}`);
            return () => events.push(`detach:${id}`);
          },
        },
      },
    ]);
    setup(() => options({ userID: userID() }), hookFeature);
    expect(events).toEqual(['attach:u1']);

    userID.set('u2');
    TestBed.tick();
    expect(events).toEqual(['attach:u1', 'detach:u1', 'attach:u2']);

    TestBed.resetTestingModule();
    expect(events).toEqual(['attach:u1', 'detach:u1', 'attach:u2', 'detach:u2']);
  });
});
