import { afterEach, describe, expect, expectTypeOf, it } from 'vitest';
import { computed, Injector, signal, type Signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import type { Zero, ZeroOptions } from '@rocicorp/zero';
import { injectZero } from '../src/inject-zero.js';
import { provideZero } from '../src/provide-zero.js';
import { ZERO_CONSTRUCTOR } from '../src/instance-manager.js';
import {
  fakeZeroHarness,
  provideTestChangeDetection,
  zeroOptions as options,
  type FakeZeroHarness,
} from './helpers.js';

afterEach(() => TestBed.resetTestingModule());

describe('injectZero', () => {
  function setup(source: ZeroOptions | (() => ZeroOptions)): FakeZeroHarness {
    const harness = fakeZeroHarness();
    TestBed.configureTestingModule({
      providers: [
        provideTestChangeDetection(),
        { provide: ZERO_CONSTRUCTOR, useValue: harness.construct },
        provideZero(typeof source === 'function' ? source : () => source),
      ],
    });
    TestBed.inject(Injector);
    TestBed.tick();
    return harness;
  }

  it('throws at inject time when provideZero is missing, naming the fix', () => {
    TestBed.configureTestingModule({ providers: [provideTestChangeDetection()] });
    expect(() => TestBed.runInInjectionContext(() => injectZero())).toThrow(
      /\[ngx-zero\].*Add provideZero/s,
    );
  });

  it('returns a signal holding the current instance', () => {
    const harness = setup(options());
    const zero = TestBed.runInInjectionContext(() => injectZero());
    expect(zero()).toBe(harness.latest() as unknown as Zero);
  });

  it('rotation propagates through computed and never exposes a closed predecessor', () => {
    const userID = signal('u1');
    const harness = setup(() => options({ userID: userID() }));
    const zero = TestBed.runInInjectionContext(() => injectZero());
    const seen = computed(() => zero());

    expect(seen()).toBe(harness.created[0] as unknown as Zero);
    userID.set('u2');
    TestBed.tick();
    expect(seen()).toBe(harness.created[1] as unknown as Zero);
    expect((seen() as unknown as { closed: boolean }).closed).toBe(false);
  });

  it('works outside an injection context with an explicit { injector }', () => {
    setup(options());
    const injector = TestBed.inject(Injector);
    const zero = injectZero({ injector });
    expect(zero()).toBeDefined();
  });

  it('throws the CIF assertion outside an injection context without { injector }', () => {
    setup(options());
    expect(() => injectZero()).toThrow(/injection context/);
  });

  it('infers Signal<Zero> with zero explicit generics (DefaultTypes-driven)', () => {
    setup(options());
    const zero = TestBed.runInInjectionContext(() => injectZero());
    expectTypeOf(zero).toEqualTypeOf<Signal<Zero>>();
    expectTypeOf(zero()).toEqualTypeOf<Zero>();
  });
});
