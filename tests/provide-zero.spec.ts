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
import type { ZeroFeature } from '../src/features.js';
import {
  fakeZeroHarness,
  provideTestChangeDetection,
  zeroOptions as options,
  type FakeZero,
  type FakeZeroHarness,
} from './helpers.js';

interface SetupResult {
  harness: FakeZeroHarness;
  manager: ZeroInstanceManager;
  errors: unknown[];
}

function setup(
  source: ZeroInstanceSource | (() => ZeroInstanceSource),
  ...features: ZeroFeature[]
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

  it('factory throw at bootstrap fails loudly (broken options factory = programming error)', () => {
    TestBed.configureTestingModule({
      providers: [
        provideTestChangeDetection(),
        { provide: ZERO_CONSTRUCTOR, useValue: fakeZeroHarness().construct },
        provideZero(() => {
          throw new Error('factory boom');
        }),
      ],
    });
    expect(() => TestBed.inject(ZERO_INSTANCE_MANAGER)).toThrow(/factory boom/);
  });

  it('rapid a→b→c flips: each superseded instance closed once; late close settling never republishes', async () => {
    const userID = signal('u1');
    const { harness, manager } = setup(() => options({ userID: userID() }));
    harness.created[0]!.closeBehavior = 'manual';

    userID.set('u2');
    TestBed.tick();
    harness.created[1]!.closeBehavior = 'manual';
    userID.set('u3');
    TestBed.tick();

    expect(harness.created).toHaveLength(3);
    expect(harness.created.map(f => f.closeCalls)).toEqual([1, 1, 0]);
    expect(manager.instance()).toBe(harness.created[2] as unknown as Zero);

    // Unresolved close promises settle late, out of order — must never
    // republish an old instance or double-close anything.
    harness.created[1]!.settlePendingClose();
    harness.created[0]!.settlePendingClose();
    await Promise.resolve();
    expect(manager.instance()).toBe(harness.created[2] as unknown as Zero);
    expect(harness.created.map(f => f.closeCalls)).toEqual([1, 1, 0]);
  });

  it('CSNF rotation racing a factory recreate in the same flush → exactly one new instance', () => {
    const userID = signal('u1');
    const { harness, manager } = setup(() => options({ userID: userID() }));

    harness.latest().options.onClientStateNotFound!(); // rotation requested…
    userID.set('u2'); // …and a factory change lands before the same flush
    TestBed.tick();

    expect(harness.created).toHaveLength(2); // collapsed into ONE recreate
    expect(manager.instance()).toBe(harness.created[1] as unknown as Zero);
    expect(harness.created[1]!.options.userID).toBe('u2'); // newest options win
  });

  it('rejecting close during a routine recreate is swallowed — no throw, no ErrorHandler report', async () => {
    const userID = signal('u1');
    const { harness, errors } = setup(() => options({ userID: userID() }));
    harness.created[0]!.closeBehavior = 'reject';

    userID.set('u2');
    expect(() => TestBed.tick()).not.toThrow();
    await Promise.resolve();
    await Promise.resolve(); // rejection settles → swallowed
    expect(harness.created).toHaveLength(2);
    expect(errors).toHaveLength(0);
  });

  describe('connect() rejection routing', () => {
    it('reports via ErrorHandler when the instance is still current', async () => {
      const auth = signal('t1');
      const { harness, errors } = setup(() => options({ auth: auth() }));
      let rejectConnect!: (e: unknown) => void;
      harness.latest().connectResult = new Promise((_, rej) => (rejectConnect = rej));

      auth.set('t2');
      TestBed.tick(); // string→string → connect in place, promise pending
      expect(harness.latest().connectCalls).toEqual([{ auth: 't2' }]);

      rejectConnect(new Error('connect boom'));
      await Promise.resolve();
      await Promise.resolve();
      expect(errors.some(e => /connect boom/.test(String(e)))).toBe(true);
    });

    it('does NOT report when the instance was superseded before the rejection settled', async () => {
      const auth = signal('t1');
      const userID = signal('u1');
      const { harness, errors } = setup(() => options({ auth: auth(), userID: userID() }));
      let rejectConnect!: (e: unknown) => void;
      harness.latest().connectResult = new Promise((_, rej) => (rejectConnect = rej));

      auth.set('t2');
      TestBed.tick(); // connect in place, promise pending
      userID.set('u2');
      TestBed.tick(); // recreate — the connecting instance is superseded

      rejectConnect(new Error('connect boom'));
      await Promise.resolve();
      await Promise.resolve();
      expect(errors).toHaveLength(0);
    });
  });

  it('wrapper invoked in the presence-flip transient window: batchViewUpdates stays synchronous', () => {
    const withFns = signal(true);
    const { harness } = setup(() =>
      withFns()
        ? options({ batchViewUpdates: apply => apply(), onUpdateNeeded: () => {} })
        : options(),
    );
    const first = harness.created[0]!;
    const wrappedBatch = first.options.batchViewUpdates!;
    const wrappedUpdateNeeded = first.options.onUpdateNeeded!;

    withFns.set(false); // presence flip → recreate; latest options lack the fns
    TestBed.tick();
    expect(harness.created).toHaveLength(2);

    // Zero may still invoke the old instance's wrappers from a microtask
    // mid-close: applyViewUpdates MUST run synchronously; others are inert.
    let applied = false;
    wrappedBatch(() => (applied = true));
    expect(applied).toBe(true);
    expect(() => wrappedUpdateNeeded({ type: 'NewClientGroup' })).not.toThrow();
  });

  it('re-emitting the same external instance is a strict no-op (no detach/re-attach, never closed)', () => {
    const external = fakeZeroHarness().construct(options());
    const events: string[] = [];
    const feature = zeroFeature('auth-refresh', [
      {
        provide: ZERO_INSTANCE_HOOKS,
        multi: true,
        useValue: {
          onInstanceAttached: () => {
            events.push('attach');
            return () => events.push('detach');
          },
        },
      },
    ]);
    const source = signal<ZeroInstanceSource>({ zero: external });
    setup(() => source(), feature);
    expect(events).toEqual(['attach']);

    source.set({ zero: external }); // NEW wrapper object, same instance
    TestBed.tick();
    expect(events).toEqual(['attach']);
    expect((external as unknown as FakeZero).closeCalls).toBe(0);
  });

  describe('stale callbacks from superseded instances', () => {
    it('stale CSNF from a superseded instance does not rotate its replacement', () => {
      const { harness, manager } = setup(options());
      const staleCsnf = harness.latest().options.onClientStateNotFound;
      expect(staleCsnf).toBeTypeOf('function');

      staleCsnf!(); // legitimate fire → rotation
      TestBed.tick();
      expect(harness.created).toHaveLength(2);

      // The closed predecessor fires again, late (e.g. a server message that was
      // already in flight when close() started). Must NOT rotate the replacement.
      staleCsnf!();
      TestBed.tick();
      expect(harness.created).toHaveLength(2);
      expect(manager.instance()).toBe(harness.created[1] as unknown as Zero);
    });
  });

  describe('throwing feature hooks', () => {
    it('throwing withInit at bootstrap is contained: reported, instance still published', () => {
      const { harness, manager, errors } = setup(
        options(),
        withInit(() => {
          throw new Error('init boom');
        }),
      );
      expect(errors.some(e => /init boom/.test(String(e)))).toBe(true);
      expect(harness.created).toHaveLength(1);
      expect(manager.instance()).toBe(harness.latest() as unknown as Zero);
    });

    it('withInit throw during rotation never leaves the closed predecessor visible', () => {
      const userID = signal('u1');
      let boom = false;
      const { harness, manager, errors } = setup(
        () => options({ userID: userID() }),
        withInit(() => {
          if (boom) throw new Error('init boom');
        }),
      );
      boom = true;
      userID.set('u2');
      expect(() => TestBed.tick()).not.toThrow();
      expect(harness.created).toHaveLength(2);
      expect(manager.instance()).toBe(harness.created[1] as unknown as Zero);
      expect(harness.created[0]!.closed).toBe(true); // predecessor closed AND hidden
      expect(errors.some(e => /init boom/.test(String(e)))).toBe(true);
    });

    it('throwing onInstanceAttached is contained and later hooks still attach', () => {
      const attached: string[] = [];
      const feature = zeroFeature('auth-refresh', [
        {
          provide: ZERO_INSTANCE_HOOKS,
          multi: true,
          useValue: {
            onInstanceAttached: () => {
              throw new Error('attach boom');
            },
          },
        },
        {
          provide: ZERO_INSTANCE_HOOKS,
          multi: true,
          useValue: { onInstanceAttached: () => void attached.push('second') },
        },
      ]);
      const { harness, manager, errors } = setup(options(), feature);
      expect(errors.some(e => /attach boom/.test(String(e)))).toBe(true);
      expect(attached).toEqual(['second']);
      expect(manager.instance()).toBe(harness.latest() as unknown as Zero);
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
