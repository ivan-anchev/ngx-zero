import {
  computed,
  DestroyRef,
  effect,
  EnvironmentInjector,
  ErrorHandler,
  inject,
  InjectionToken,
  PLATFORM_ID,
  runInInjectionContext,
  signal,
  untracked,
  type Signal,
} from '@angular/core';
import { Zero, type ZeroOptions } from '@rocicorp/zero';
import { diffZeroOptions, isExternalSource, type ZeroInstanceSource } from './options-diff.js';
import { ngxZeroError } from './errors.js';

/** Hooks a feature can register (multi-provider). Deliberately tiny. */
export interface ZeroInstanceHooks {
  /**
   * Once per OWNED construction, after `new Zero(...)`, before the signal
   * flips. Not called for external `{ zero }` (React `init` parity).
   */
  onInstanceCreated?(zero: Zero): void;
  /**
   * For EVERY instance that becomes current (owned + external), after the
   * signal flips. Optional detach fn is called before replacement / on destroy.
   */
  onInstanceAttached?(zero: Zero): VoidFunction | void;
}

export const ZERO_INSTANCE_HOOKS = new InjectionToken<readonly ZeroInstanceHooks[]>(
  'ngx-zero/instance-hooks',
);

export const ZERO_INSTANCE_MANAGER = new InjectionToken<ZeroInstanceManager>(
  'ngx-zero/instance-manager',
);

/**
 * Construction seam for tests: override to count constructions / capture
 * options / return fakes. Production default: `new Zero(opts)`.
 */
export const ZERO_CONSTRUCTOR = new InjectionToken<(opts: ZeroOptions) => Zero>(
  'ngx-zero/zero-constructor',
  { providedIn: 'root', factory: () => opts => new Zero(opts) },
);

/**
 * Owns the Zero instance behind `ZERO_INSTANCE_MANAGER`. Every lifecycle
 * transition (factory rerun, in-place auth connect, client-state-not-found
 * rotation, external swap) funnels through ONE synchronous reconcile function
 * driven by one effect, so no two reconciles ever interleave.
 */
export class ZeroInstanceManager {
  readonly #injector = inject(EnvironmentInjector);
  readonly #hooks = inject(ZERO_INSTANCE_HOOKS, { optional: true }) ?? [];
  readonly #construct = inject(ZERO_CONSTRUCTOR);
  readonly #errorHandler = inject(ErrorHandler);

  /**
   * isPlatformBrowser is literally `platformId === 'browser'`; @angular/common
   * is not a peer and must not become one.
   */
  readonly browser: boolean = inject(PLATFORM_ID) === 'browser';

  /**
   * Nullable internal shape — THE seam injectQuery/injectMutation consume
   * later: observe "no instance" without throwing; stay inert on the server.
   */
  readonly instance: Signal<Zero | undefined>;
  readonly #instance = signal<Zero | undefined>(undefined);

  /**
   * Public-facing read: throws at READ time (SSR contract). `computed` caches
   * the throw until deps change — deps change exactly when an instance appears.
   */
  readonly zeroOrThrow: Signal<Zero> = computed(() => {
    const z = this.#instance();
    if (z === undefined) {
      throw ngxZeroError(
        this.browser
          ? 'No Zero instance is available yet. provideZero() constructs the instance ' +
              'in an environment initializer at bootstrap — ensure provideZero(...) is in ' +
              'your ApplicationConfig providers and you are not reading from a bare ' +
              'EnvironmentInjector that skips initializers.'
          : 'The Zero instance was read during server-side rendering. ngx-zero never ' +
              'constructs Zero on the server; guard this read with a browser check, or ' +
              'use injectQuery/injectMutation which are server-inert by design.',
      );
    }
    return z;
  });

  /**
   * Monotonic auth epoch — bumped on every recreate and every factory-driven
   * connect. The auth refresher captures it before awaiting and discards stale
   * results. Plain accessor, not a signal (nothing renders from it).
   */
  #authEpochCounter = 0;
  authEpoch(): number {
    return this.#authEpochCounter;
  }

  readonly #source: () => ZeroInstanceSource;

  /**
   * Factory made reactive + injectable on every rerun (the original injection
   * context is gone by the time the effect reruns it). `computed` caching means
   * the synchronous first read in start() and the effect's first run share ONE
   * evaluation.
   */
  readonly #options = computed<ZeroInstanceSource>(() =>
    runInInjectionContext(this.#injector, this.#source),
  );

  /**
   * Latest raw factory output. Updated on EVERY reconcile including no-ops —
   * the stable wrappers delegate through it. This is what makes ignoring
   * function identity sound.
   */
  #latest: ZeroInstanceSource | undefined;

  #owned = false;

  /**
   * Rotation plumbing: `#rotationPending` collapses double rotation; any
   * recreate clears it. `#rotationGen` carries the request into the reactive
   * world — a signal write, safe from Zero's internal callbacks in both zone
   * modes.
   */
  #rotationPending = false;
  readonly #rotationGen = signal(0);

  #detach: VoidFunction[] = [];
  #destroyed = false;
  #started = false;

  constructor(source: ZeroInstanceSource | (() => ZeroInstanceSource)) {
    this.#source = typeof source === 'function' ? source : () => source;
    this.instance = this.#instance.asReadonly();
    inject(DestroyRef).onDestroy(() => this.#destroy());
  }

  /**
   * Called once from provideZero's environment initializer. Construction is
   * SYNCHRONOUS (root effects only flush with first CD — effect-only
   * construction would break the non-nullable first-render contract). A
   * factory that throws HERE fails bootstrap loudly (deliberate: broken
   * options factory = programming error; rerun throws are handled by the
   * effect instead).
   */
  start(): void {
    if (this.#started) {
      throw ngxZeroError('provideZero() was provided more than once in the same environment.');
    }
    this.#started = true;
    if (!this.browser) return; // SSR: fully inert

    const first = this.#options();
    untracked(() => this.#apply(first));

    // Rerun-throw semantics: factory throw → computed rethrows here → Angular
    // routes to ErrorHandler; #apply never runs; previous instance stays
    // current; computed re-evaluates on next dep change → self-recovers.
    effect(
      () => {
        const next = this.#options(); // tracked: every signal the factory read
        this.#rotationGen(); // tracked: rotation requests
        untracked(() => this.#apply(next));
      },
      { injector: this.#injector },
    );
  }

  /** THE single reconcile funnel — never more than one reconcile in flight. */
  #apply(next: ZeroInstanceSource): void {
    if (this.#destroyed) return;

    const prev = this.#latest;
    this.#latest = next; // wrappers now see the newest closures — even on no-op

    const rotate = this.#rotationPending;

    if (isExternalSource(next)) {
      this.#rotationPending = false;
      const current = this.#instance();
      if (current === next.zero) return;
      this.#disposeCurrent(); // closes only if owned
      this.#owned = false;
      this.#instance.set(next.zero);
      this.#attach(next.zero); // features attach to external too; withInit does not
      return;
    }

    const current = this.#instance();
    const prevWasOptions = prev !== undefined && !isExternalSource(prev);
    if (current === undefined || !prevWasOptions) {
      this.#recreate(next);
      return;
    }

    const verdict = rotate ? 'recreate' : diffZeroOptions(prev as ZeroOptions, next);
    switch (verdict) {
      case 'recreate':
        this.#recreate(next);
        break;
      case 'connect': {
        // Token rotated string→string: push in place, no recreate.
        this.#authEpochCounter++;
        void current.connection.connect({ auth: next.auth as string }).catch(err => {
          // Report instead of a bare void — only if still current.
          if (this.#instance() === current) this.#errorHandler.handleError(err);
        });
        break;
      }
      case 'noop':
        break; // strictly nothing — #latest already refreshed above
    }
  }

  #recreate(opts: ZeroOptions): void {
    // Close-then-construct (React order). close() NOT awaited: the signal must
    // never transiently hold undefined; ActiveClientsManager arbitrates
    // same-storage overlap.
    this.#disposeCurrent();

    // Filled right after construction so the CSNF wrapper can tell "my
    // instance is still current" from "I am a late fire from a superseded,
    // closing instance" (close() is unawaited — callbacks can straggle).
    const owner: { zero?: Zero } = {};
    let zero: Zero;
    try {
      zero = this.#construct(this.#toConstructorOptions(opts, owner));
    } catch (err) {
      // Never leave the already-closed predecessor visible.
      this.#errorHandler.handleError(err);
      this.#instance.set(undefined);
      this.#owned = false;
      this.#rotationPending = false;
      return; // next valid factory emission recovers
    }
    owner.zero = zero;
    this.#owned = true;
    this.#authEpochCounter++;
    this.#rotationPending = false; // any recreate satisfies a pending rotation

    for (const h of this.#hooks) {
      // withInit. Contained: a throwing init is a feature bug, not a reason to
      // leave the already-closed predecessor visible in the signal.
      try {
        h.onInstanceCreated?.(zero);
      } catch (err) {
        this.#errorHandler.handleError(err);
      }
    }
    this.#instance.set(zero);
    this.#attach(zero);
  }

  #disposeCurrent(): void {
    for (const d of this.#detach.splice(0)) {
      try {
        d();
      } catch {
        /* feature detach must never break reconcile */
      }
    }
    const current = this.#instance();
    if (current !== undefined && this.#owned) {
      void current.close().catch(() => {}); // routine recreate must never throw
    }
  }

  #attach(zero: Zero): void {
    for (const h of this.#hooks) {
      // Contained like detach: one broken feature must not break reconcile or
      // starve the remaining hooks.
      try {
        const detach = h.onInstanceAttached?.(zero);
        if (detach) this.#detach.push(detach);
      } catch (err) {
        this.#errorHandler.handleError(err);
      }
    }
  }

  /**
   * Options actually handed to `new Zero(...)`: every function-valued entry
   * becomes a stable wrapper delegating to the latest factory output;
   * `onClientStateNotFound` is ALWAYS ours (user callback wins; absent or
   * throwing → guarded rotation; no `location.reload()` — Zero's default only
   * applies when the option is absent, and ours never is).
   */
  #toConstructorOptions(opts: ZeroOptions, owner: { zero?: Zero }): ZeroOptions {
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(opts)) {
      if (key === 'onClientStateNotFound') continue;
      out[key] = typeof value === 'function' ? this.#wrapFunctionOption(key) : value;
    }
    out['onClientStateNotFound'] = () => {
      // Fires from Zero internals, outside any zone — only a signal write below.
      if (this.#destroyed || this.#rotationPending) return;
      // Stale-instance guard: a superseded instance's late CSNF (close() is
      // unawaited) must not rotate its healthy replacement. `owner.zero` is
      // only unset while `new Zero(...)` itself is still running.
      if (owner.zero !== undefined && this.#instance() !== owner.zero) return;
      const user = this.#latestOptions()?.onClientStateNotFound;
      if (user) {
        try {
          user();
          return;
        } catch {
          /* fall through to rotation (React parity) */
        }
      }
      this.#rotationPending = true;
      this.#rotationGen.update(n => n + 1); // → reconcile effect → recreate
    };
    return out as ZeroOptions;
  }

  #wrapFunctionOption(key: string): (...args: unknown[]) => unknown {
    return (...args: unknown[]) => {
      const fn = this.#latestOptions()?.[key as keyof ZeroOptions] as
        | ((...a: unknown[]) => unknown)
        | undefined;
      if (typeof fn === 'function') return fn(...args);
      // Transient window (presence flip → recreate on the same sync reconcile,
      // but Zero may call from a microtask in between). Per-key safe fallbacks:
      if (key === 'batchViewUpdates') (args[0] as () => void)(); // MUST stay synchronous
      return undefined;
    };
  }

  #latestOptions(): ZeroOptions | undefined {
    const l = this.#latest;
    return l === undefined || isExternalSource(l) ? undefined : l;
  }

  /**
   * Synchronous teardown (DestroyRef): close fired + swallowed; NOTHING may
   * throw. Zero persists continuously → unawaited close loses nothing
   * (documented). `#destroyed` makes every late async straggler a no-op.
   */
  #destroy(): void {
    if (this.#destroyed) return;
    this.#destroyed = true;
    this.#disposeCurrent();
    this.#instance.set(undefined);
    this.#owned = false;
  }
}
