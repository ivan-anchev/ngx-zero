import {
  provideZonelessChangeDetection,
  provideZoneChangeDetection,
  type EnvironmentProviders,
} from '@angular/core';
import type { ConnectionState, Zero, ZeroOptions } from '@rocicorp/zero';

/** Which vitest project is running — zone.js is loaded by the zone project's setup file. */
export const ZONE_MODE: 'zoneless' | 'zone' =
  (globalThis as Record<string, unknown>)['Zone'] === undefined ? 'zoneless' : 'zone';

/**
 * The suite runs in two vitest projects (zoneless / zone.js). Change detection
 * must be provided to match the loaded runtime.
 */
export function provideTestChangeDetection(): EnvironmentProviders {
  return ZONE_MODE === 'zoneless'
    ? provideZonelessChangeDetection()
    : provideZoneChangeDetection();
}

/** Minimal schema stand-in for lifecycle specs driven through the FakeZero seam. */
export const SCHEMA = { tables: {}, relationships: {} } as unknown as ZeroOptions['schema'];

/** Baseline valid options for lifecycle specs; override per test. */
export const zeroOptions = (over: Partial<ZeroOptions> = {}): ZeroOptions =>
  ({ schema: SCHEMA, cacheURL: 'http://cache', userID: 'u1', ...over }) as ZeroOptions;

/**
 * Controllable stand-in for Zero's `connection.state` Source. Matches Zero
 * 1.8's Subscribable semantics: subscribe does NOT replay the current value.
 */
export class FakeConnectionStateSource {
  #listeners = new Set<(state: ConnectionState) => void>();
  current: ConnectionState = { name: 'disconnected', reason: 'fake-initial' };

  subscribe(listener: (state: ConnectionState) => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  emit(state: ConnectionState): void {
    this.current = state;
    for (const listener of [...this.#listeners]) listener(state);
  }
}

/**
 * Fake Zero instance handed out by the `ZERO_CONSTRUCTOR` seam. Captures the
 * exact options passed (including the manager's wrapped callbacks, so specs
 * can invoke them) and exposes spied `close()`/`connection.connect()`.
 */
export class FakeZero {
  readonly options: ZeroOptions;
  closed = false;
  closeCalls = 0;
  closeBehavior: 'resolve' | 'manual' | 'reject' = 'resolve';
  readonly connectCalls: Array<{ auth: string } | undefined> = [];
  readonly state = new FakeConnectionStateSource();

  readonly connection = {
    state: this.state,
    connect: (opts?: { auth: string }): Promise<void> => {
      this.connectCalls.push(opts);
      return this.connectResult;
    },
  };
  connectResult: Promise<void> = Promise.resolve();

  #pendingClose: Array<{ resolve: () => void; reject: (err: unknown) => void }> = [];

  constructor(options: ZeroOptions) {
    this.options = options;
  }

  close(): Promise<void> {
    this.closeCalls++;
    this.closed = true;
    this.state.emit({ name: 'closed', reason: 'fake-close' });
    switch (this.closeBehavior) {
      case 'resolve':
        return Promise.resolve();
      case 'reject':
        return Promise.reject(new Error('fake close rejection'));
      case 'manual':
        return new Promise((resolve, reject) => this.#pendingClose.push({ resolve, reject }));
    }
  }

  settlePendingClose(): void {
    this.#pendingClose.splice(0).forEach(p => p.resolve());
  }
}

export interface FakeZeroHarness {
  readonly created: FakeZero[];
  readonly construct: (opts: ZeroOptions) => Zero;
  readonly latest: () => FakeZero;
}

/** Factory for the `ZERO_CONSTRUCTOR` override: counts and records every construction. */
export function fakeZeroHarness(): FakeZeroHarness {
  const created: FakeZero[] = [];
  const construct = (opts: ZeroOptions): Zero => {
    const fake = new FakeZero(opts);
    created.push(fake);
    return fake as unknown as Zero;
  };
  return {
    created,
    construct,
    latest: () => {
      const fake = created[created.length - 1];
      if (fake === undefined) throw new Error('no FakeZero constructed yet');
      return fake;
    },
  };
}

export const NEEDS_AUTH: Extract<ConnectionState, { name: 'needs-auth' }> = {
  name: 'needs-auth',
  reason: { type: 'zero-cache', reason: 'fake token expired' },
};
