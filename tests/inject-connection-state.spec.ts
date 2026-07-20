import { afterEach, describe, expect, expectTypeOf, it } from 'vitest';
import { Injector, signal, type Signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import type { ConnectionState, ZeroOptions } from '@rocicorp/zero';
import { injectConnectionState } from '../src/inject-connection-state.js';
import { provideZero } from '../src/provide-zero.js';
import { ZERO_CONSTRUCTOR } from '../src/instance-manager.js';
import {
  fakeZeroHarness,
  NEEDS_AUTH,
  provideTestChangeDetection,
  zeroOptions as options,
  type FakeZeroHarness,
} from './helpers.js';

afterEach(() => TestBed.resetTestingModule());

describe('injectConnectionState', () => {
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
    expect(() => TestBed.runInInjectionContext(() => injectConnectionState())).toThrow(
      /\[ngx-zero\].*Add provideZero/s,
    );
  });

  it('seeds synchronously from the current state (subscribe does not replay)', () => {
    const harness = setup(options());
    harness.latest().state.emit({ name: 'connecting' });
    const state = TestBed.runInInjectionContext(() => injectConnectionState());
    expect(state()).toEqual({ name: 'connecting' });
  });

  it('follows emissions, including needs-auth (the auth-refresh signal)', () => {
    const harness = setup(options());
    const state = TestBed.runInInjectionContext(() => injectConnectionState());
    expect(state().name).toBe('disconnected');

    harness.latest().state.emit({ name: 'connected' });
    expect(state()).toEqual({ name: 'connected' });

    harness.latest().state.emit(NEEDS_AUTH);
    expect(state()).toEqual(NEEDS_AUTH);
  });

  it('re-seeds from a replacement instance and detaches from the old one', () => {
    const userID = signal('u1');
    const harness = setup(() => options({ userID: userID() }));
    const state = TestBed.runInInjectionContext(() => injectConnectionState());

    harness.created[0]!.state.emit({ name: 'connected' });
    expect(state()).toEqual({ name: 'connected' });

    userID.set('u2');
    TestBed.tick();
    expect(harness.created).toHaveLength(2);
    // Seeded from the new instance's current, not left on the old one's state.
    expect(state()).toEqual(harness.created[1]!.state.current);

    harness.created[0]!.state.emit({ name: 'error', reason: 'stale instance' });
    expect(state().name).not.toBe('error');

    harness.created[1]!.state.emit({ name: 'connected' });
    expect(state()).toEqual({ name: 'connected' });
  });

  it('stops writing after environment destruction', () => {
    const harness = setup(options());
    const state = TestBed.runInInjectionContext(() => injectConnectionState());
    const fake = harness.latest();

    TestBed.resetTestingModule();

    const before = state();
    fake.state.emit({ name: 'connected' });
    expect(state()).toBe(before);
  });

  it('works outside an injection context with an explicit { injector }', () => {
    setup(options());
    const injector = TestBed.inject(Injector);
    const state = injectConnectionState({ injector });
    expect(state().name).toBe('disconnected');
  });

  it('throws the CIF assertion outside an injection context without { injector }', () => {
    setup(options());
    expect(() => injectConnectionState()).toThrow(/injection context/);
  });

  it('infers Signal<ConnectionState> with zero explicit generics', () => {
    setup(options());
    const state = TestBed.runInInjectionContext(() => injectConnectionState());
    expectTypeOf(state).toEqualTypeOf<Signal<ConnectionState>>();
  });
});
