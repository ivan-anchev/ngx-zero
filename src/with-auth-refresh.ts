import { DestroyRef, inject, InjectionToken, Injector } from '@angular/core';
import type { ConnectionState, Zero } from '@rocicorp/zero';
import { zeroFeature, type ZeroFeature } from './features.js';
import { expBackoffMs, sleep, tryCatch } from './utils.js';
import {
  ZERO_INSTANCE_HOOKS,
  ZERO_INSTANCE_MANAGER,
  type ZeroInstanceManager,
} from './instance-manager.js';

/**
 * SHIP-GATED: not exported from the public entry until its suite is green and
 * the feature is cleared to ship (see docs/DESIGN.md).
 *
 * Upstream caution: Zero deliberately REMOVED `auth: () => Promise<string>` in
 * favor of explicit string + `connect()`; this re-adds that convenience at the
 * binding layer, so every semantic below (dedup, backoff, give-up, epoch) is a
 * hard invariant.
 *
 * RESOLVE string → push via connect. RESOLVE null-like → deliberate give-up
 * (no amount of backoff logs a user back in). REJECT → transient; retry with
 * backoff.
 */
export type ZeroAuthRefreshFn = () => Promise<string | null | undefined | false>;

type NeedsAuthState = Extract<ConnectionState, { name: 'needs-auth' }>;

export interface ZeroAuthRefreshOptions {
  /** Total attempts between successful connections. Default 3. */
  maxAttempts?: number;
  /** Delay before retry n (0-based). Default: min(1000 * 2^n, 30_000). */
  backoffMs?: (attempt: number) => number;
  /**
   * Called once on give-up. The terminal 'needs-auth' additionally stays
   * observable on `zero.connection.state` (the upstream-native surface — no
   * parallel observable).
   */
  onGiveUp?: (state: NeedsAuthState) => void;
}

export function withAuthRefresh(
  refreshFn: ZeroAuthRefreshFn,
  options?: ZeroAuthRefreshOptions,
): ZeroFeature<'auth-refresh'> {
  return zeroFeature('auth-refresh', [
    { provide: ZERO_AUTH_REFRESH_CONFIG, useValue: { refreshFn, ...options } },
    // Plain-tsc build: no Angular decorators available, so the refresher is
    // provided via factory (the constructor's inject() calls resolve in the
    // factory's injection context).
    { provide: ZeroAuthRefresher, useFactory: () => new ZeroAuthRefresher() },
    {
      provide: ZERO_INSTANCE_HOOKS,
      multi: true,
      useFactory: () => {
        const refresher = inject(ZeroAuthRefresher);
        // onInstanceAttached fires per instance (owned AND external); its
        // return is called on detach — "re-attach on rotation" falls out of
        // the hook shape.
        return { onInstanceAttached: (zero: Zero) => refresher.attach(zero) };
      },
    },
  ]);
}

const ZERO_AUTH_REFRESH_CONFIG = new InjectionToken<
  ZeroAuthRefreshOptions & { refreshFn: ZeroAuthRefreshFn }
>('ngx-zero/auth-refresh-config');

/**
 * One refresher per provideZero environment. State that must SPAN rotations
 * (in-flight latch, attempt budget, give-up latch) lives here, not per-instance.
 */
export class ZeroAuthRefresher {
  readonly #config = inject(ZERO_AUTH_REFRESH_CONFIG);

  /**
   * Resolved LAZILY: the refresher is constructed while the manager token is
   * still hydrating (manager → hooks → refresher), so a direct inject() here
   * is a DI cycle. Every use happens strictly after construction.
   */
  readonly #injector = inject(Injector);
  #managerCache: ZeroInstanceManager | undefined;
  get #manager(): ZeroInstanceManager {
    return (this.#managerCache ??= this.#injector.get(ZERO_INSTANCE_MANAGER));
  }

  /**
   * DEDUP: single in-flight latch, service level → dedups across rapid
   * emissions AND across rotation.
   */
  #inflight = false;

  /**
   * BUDGET: attempts since last successful connection. NOT reset per
   * instance/episode (that would allow an infinite rotate-refresh loop). Only
   * 'connected' resets it — success means token ACCEPTED, not token produced.
   */
  #attempts = 0;

  /**
   * GIVE-UP LATCH: once set, dormant until a 'connected' re-arms. "Must not
   * spin forever" is structural: no code path calls refreshFn while set.
   */
  #givenUp = false;

  #destroyed = false;
  readonly #destroyAbort = new AbortController();

  constructor() {
    inject(DestroyRef).onDestroy(() => {
      this.#destroyed = true; // late resolutions checked against this
      this.#destroyAbort.abort(); // pending backoff sleep resolves and its timer clears
    });
  }

  /** Hook entry: called by the manager for each instance; returns detach. */
  attach(zero: Zero): VoidFunction {
    const onState = (state: ConnectionState) => {
      switch (state.name) {
        case 'connected':
          this.#attempts = 0;
          this.#givenUp = false; // healthy again — re-arm
          break;
        case 'needs-auth':
          this.#kick(state);
          break;
        // 'error' deliberately NOT handled: fatal non-auth failure;
        // auto-connect would mask real errors.
      }
    };
    const unsubscribe = zero.connection.state.subscribe(onState);

    // Zero 1.8's Subscribable does NOT replay the current value on subscribe
    // (verified in shared/src/subscribable.ts) — an instance ALREADY in
    // needs-auth at attach (expired token at construction; rotation during
    // needs-auth) must be checked explicitly or the feature deadlocks.
    const current = zero.connection.state.current;
    if (current.name === 'needs-auth') {
      this.#kick(current);
    }

    return unsubscribe;
  }

  #kick(state: NeedsAuthState): void {
    if (this.#destroyed || this.#givenUp || this.#inflight) {
      return;
    }
    if (this.#attempts >= (this.#config.maxAttempts ?? 3)) {
      this.#giveUp(state);
      return;
    }
    this.#inflight = true;
    void this.#run(state);
  }

  // NO try/finally releasing #inflight: the backoff branch releases it and
  // #recheck() may legitimately START a new run — a trailing finally would
  // release the NEW run's latch. Every branch releases exactly once.
  async #run(state: NeedsAuthState): Promise<void> {
    this.#attempts++;
    const epoch = this.#manager.authEpoch(); // capture before awaiting

    const refreshed = await tryCatch(this.#config.refreshFn);

    if (this.#destroyed) {
      this.#inflight = false;
      return;
    }

    if (refreshed.error) {
      // Transient → backoff, release latch, then RE-CHECK current state (if
      // the factory fixed auth meanwhile, no retry happens at all).
      await sleep(this.#backoffDelay(this.#attempts - 1), this.#destroyAbort.signal);
      this.#inflight = false;
      if (!this.#destroyed) {
        this.#recheck();
      }
      return;
    }

    this.#inflight = false;

    if (typeof refreshed.result === 'string') {
      // "Refresh produced a token" ≠ "server accepted it". If rejected,
      // needs-auth fires again → next kick → #attempts still counting →
      // converges to give-up.
      this.#push(refreshed.result, epoch);
      return;
    }
    this.#giveUp(state); // null-like: no token exists — retrying can't mint a session
  }

  /**
   * STALE-PUSH SAFETY, three guards: current instance only + epoch unchanged
   * (a factory-driven auth change already superseded this token, even if the
   * state transition hasn't landed yet) + still needs-auth (the factory wins
   * every race by construction).
   */
  #push(token: string, epoch: number): void {
    const zero = this.#manager.instance();
    if (this.#destroyed || zero === undefined || zero.closed) {
      return;
    }
    if (this.#manager.authEpoch() !== epoch) {
      return;
    }
    if (zero.connection.state.current.name !== 'needs-auth') {
      return;
    }
    void zero.connection.connect({ auth: token }).catch(() => {});
  }

  /**
   * User `backoffMs` is contained: `#run` is fired via `void`, so a throw here
   * would be an unhandled rejection AND would wedge the in-flight latch
   * forever. Fall back to the default schedule instead.
   */
  #backoffDelay(attempt: number): number {
    const delay = tryCatch(() => this.#config.backoffMs?.(attempt));
    return delay.error ? expBackoffMs(attempt) : (delay.result ?? expBackoffMs(attempt));
  }

  #recheck(): void {
    const zero = this.#manager.instance();
    if (this.#destroyed || zero === undefined || zero.closed) {
      return;
    }
    const state = zero.connection.state.current;
    if (state.name === 'needs-auth') {
      this.#kick(state);
    }
  }

  #giveUp(state: NeedsAuthState): void {
    if (this.#givenUp) {
      return;
    }
    this.#givenUp = true;
    tryCatch(() => this.#config.onGiveUp?.(state)); // user callback contained
  }
}
