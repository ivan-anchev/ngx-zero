import { ErrorHandler, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import type { Zero, ZeroOptions } from '@rocicorp/zero';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { zeroFeature, type ZeroFeature } from '../src/features.js';
import {
  ZERO_CONSTRUCTOR,
  ZERO_INSTANCE,
  ZERO_INSTANCE_HOOKS,
  type ZeroInstanceManager,
} from '../src/instance-manager.js';
import { provideZero } from '../src/provide-zero.js';
import type { ZeroInstanceOptions, ZeroOptionsOrExternalSource } from '../src/types.js';
import { withBootstrap } from '../src/with-bootstrap.js';
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

function setup(source: ZeroInstanceOptions, ...features: ZeroFeature[]): SetupResult {
  const harness = fakeZeroHarness();
  const errors: unknown[] = [];
  const factory = typeof source === 'function' ? source : () => source;

  TestBed.configureTestingModule({
    providers: [
      provideTestChangeDetection(),
      { provide: ZERO_CONSTRUCTOR, useValue: harness.construct },
      { provide: ErrorHandler, useValue: { handleError: (error: unknown) => errors.push(error) } },
      provideZero(factory, ...features),
    ],
  });

  const manager = TestBed.inject(ZERO_INSTANCE);
  TestBed.tick();
  return { harness, manager, errors };
}

afterEach(() => TestBed.resetTestingModule());

describe('provideZero', () => {
  it('constructs before the first tick', () => {
    const harness = fakeZeroHarness();

    TestBed.configureTestingModule({
      providers: [
        provideTestChangeDetection(),
        { provide: ZERO_CONSTRUCTOR, useValue: harness.construct },
        provideZero(options()),
      ],
    });

    const manager = TestBed.inject(ZERO_INSTANCE);

    expect(manager.zeroOrThrow()).toBe(harness.latest() as unknown as Zero);
  });

  it('does not recreate on the effect initial run', () => {
    const harness = fakeZeroHarness();

    TestBed.configureTestingModule({
      providers: [
        provideTestChangeDetection(),
        { provide: ZERO_CONSTRUCTOR, useValue: harness.construct },
        provideZero(options()),
      ],
    });

    const manager = TestBed.inject(ZERO_INSTANCE);
    const initial = manager.zeroOrThrow();

    TestBed.tick();

    expect(manager.zeroOrThrow()).toBe(initial);
    expect(harness.created).toHaveLength(1);
  });

  it('constructs from the reactive source', () => {
    const { harness, manager } = setup(options());
    expect(harness.created).toHaveLength(1);
    expect(manager.zeroOrThrow()).toBe(harness.latest() as unknown as Zero);
  });

  it('does nothing when a tracked dependency reruns with identical options', () => {
    const dependency = signal(0);
    const { harness } = setup(() => {
      dependency();
      return options();
    });

    dependency.set(1);
    TestBed.tick();
    expect(harness.created).toHaveLength(1);
    expect(harness.latest().closeCalls).toBe(0);
  });

  it('connects in place for a string-to-string auth change', () => {
    const auth = signal('t1');
    const { harness } = setup(() => options({ auth: auth() }));

    auth.set('t2');
    TestBed.tick();
    expect(harness.created).toHaveLength(1);
    expect(harness.latest().connectCalls).toEqual([{ auth: 't2' }]);
  });

  it('recreates for login and logout boundaries', () => {
    const auth = signal<string | undefined>('t1');
    const { harness } = setup(() => options({ auth: auth() }));

    auth.set(undefined);
    TestBed.tick();
    expect(harness.created).toHaveLength(2);
    expect(harness.created[0]!.closeCalls).toBe(1);

    auth.set('t2');
    TestBed.tick();
    expect(harness.created).toHaveLength(3);
    expect(harness.created[1]!.closeCalls).toBe(1);
  });

  it('recreates when a non-auth option changes', () => {
    const userID = signal('u1');
    const { harness, manager } = setup(() => options({ userID: userID() }));

    userID.set('u2');
    TestBed.tick();
    expect(harness.created).toHaveLength(2);
    expect(harness.created[0]!.closeCalls).toBe(1);
    expect(manager.zeroOrThrow()).toBe(harness.latest() as unknown as Zero);
  });

  it('recreates for a fresh callback identity', () => {
    const generation = signal(0);
    const seen: number[] = [];
    const { harness } = setup(() => {
      const current = generation();
      return options({ onUpdateNeeded: () => void seen.push(current) });
    });

    generation.set(1);
    TestBed.tick();
    expect(harness.created).toHaveLength(2);
    harness.latest().options.onUpdateNeeded?.({ type: 0 as never });
    expect(seen).toEqual([1]);
  });

  describe('onClientStateNotFound', () => {
    const fire = (harness: FakeZeroHarness) => harness.latest().options.onClientStateNotFound?.();

    it('rotates when no user callback is provided', () => {
      const { harness } = setup(options());
      fire(harness);
      TestBed.tick();
      expect(harness.created).toHaveLength(2);
      expect(harness.created[0]!.closeCalls).toBe(1);
    });

    it('calls the user callback without rotating', () => {
      const callback = vi.fn();
      const { harness } = setup(options({ onClientStateNotFound: callback }));
      fire(harness);
      TestBed.tick();
      expect(callback).toHaveBeenCalledOnce();
      expect(harness.created).toHaveLength(1);
    });

    it('deduplicates repeated rotation requests before the effect flushes', () => {
      const { harness } = setup(options());
      fire(harness);
      fire(harness);
      TestBed.tick();
      expect(harness.created).toHaveLength(2);
    });
  });

  describe('external instances', () => {
    it('adopts and swaps external instances without closing them', () => {
      const externalHarness = fakeZeroHarness();
      const first = externalHarness.construct(options());
      const second = externalHarness.construct(options());
      const source = signal<ZeroOptionsOrExternalSource>({ zero: first });
      const { harness, manager } = setup(() => source());

      expect(harness.created).toHaveLength(0);
      expect(manager.zeroOrThrow()).toBe(first);

      source.set({ zero: second });
      TestBed.tick();
      expect(manager.zeroOrThrow()).toBe(second);
      expect((first as unknown as FakeZero).closeCalls).toBe(0);
    });

    it('closes an owned instance when switching to external', () => {
      const external = fakeZeroHarness().construct(options());
      const source = signal<ZeroOptionsOrExternalSource>(options());
      const { harness, manager } = setup(() => source());
      const owned = harness.latest();

      source.set({ zero: external });
      TestBed.tick();
      expect(owned.closeCalls).toBe(1);
      expect(manager.zeroOrThrow()).toBe(external);
      expect((external as unknown as FakeZero).closeCalls).toBe(0);
    });
  });

  describe('withBootstrap', () => {
    it('runs once for every owned construction', () => {
      const userID = signal('u1');
      const bootstrap = vi.fn();
      const { harness } = setup(
        () => options({ userID: userID() }),
        withBootstrap(bootstrap),
      );
      expect(bootstrap).toHaveBeenCalledTimes(1);
      expect(bootstrap).toHaveBeenLastCalledWith(harness.created[0]);

      userID.set('u2');
      TestBed.tick();
      expect(bootstrap).toHaveBeenCalledTimes(2);
      expect(bootstrap).toHaveBeenLastCalledWith(harness.created[1]);
    });

    it('does not run for external instances', () => {
      const bootstrap = vi.fn();
      const external = fakeZeroHarness().construct(options());
      setup({ zero: external }, withBootstrap(bootstrap));
      expect(bootstrap).not.toHaveBeenCalled();
    });
  });

  it('reports constructor errors and preserves the current instance', () => {
    const userID = signal('u1');
    const harness = fakeZeroHarness();
    const errors: unknown[] = [];
    let throwNext = false;

    TestBed.configureTestingModule({
      providers: [
        provideTestChangeDetection(),
        {
          provide: ZERO_CONSTRUCTOR,
          useValue: (zeroOptions: ZeroOptions) => {
            if (throwNext) {
              throwNext = false;
              throw new Error('constructor boom');
            }
            return harness.construct(zeroOptions);
          },
        },
        { provide: ErrorHandler, useValue: { handleError: (error: unknown) => errors.push(error) } },
        provideZero(() => options({ userID: userID() })),
      ],
    });

    const manager = TestBed.inject(ZERO_INSTANCE);
    TestBed.tick();
    const first = manager.zeroOrThrow();
    throwNext = true;
    userID.set('u2');
    TestBed.tick();

    expect(errors.some(error => /constructor boom/.test(String(error)))).toBe(true);
    expect(manager.zeroOrThrow()).toBe(first);
  });

  it('closes the owned instance on environment destruction', () => {
    const { harness } = setup(options());
    TestBed.resetTestingModule();
    expect(harness.latest().closeCalls).toBe(1);
  });

  it('rejects duplicate feature kinds', () => {
    expect(() =>
      provideZero(
        () => options(),
        withBootstrap(() => {}),
        withBootstrap(() => {}),
      ),
    ).toThrow(/duplicate feature "bootstrap"/);
  });

  it('allows internal feature providers to access the instance hooks token', () => {
    const calls: Zero[] = [];
    const feature = zeroFeature('bootstrap', [
      {
        provide: ZERO_INSTANCE_HOOKS,
        multi: true,
        useValue: { onInstanceCreated: (zero: Zero) => calls.push(zero) },
      },
    ]);
    const { harness } = setup(options(), feature);
    expect(calls).toEqual([harness.latest() as unknown as Zero]);
  });
});
