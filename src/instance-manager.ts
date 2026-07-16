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
import { wrapOptionFunction } from './utils.js';

/** Hooks a feature can register (multi-provider). */
export interface ZeroInstanceHooks {
  /**
   * Called once per OWNED construction, after `new Zero(...)`, before the
   * instance signal flips. Not called for external `{ zero }`.
   */
  onInstanceCreated?(zero: Zero): void;
  /**
   * Called for every instance that becomes current (owned and external), after
   * the signal flips. The returned detach fn runs before replacement / on destroy.
   */
  onInstanceAttached?(zero: Zero): VoidFunction | void;
}

export const ZERO_INSTANCE_HOOKS = new InjectionToken<readonly ZeroInstanceHooks[]>(
  'ngx-zero/instance-hooks',
);

export const ZERO_INSTANCE_MANAGER = new InjectionToken<ZeroInstanceManager>(
  'ngx-zero/instance-manager',
);

/** Construction seam for tests: override to count constructions or return fakes. */
export const ZERO_CONSTRUCTOR = new InjectionToken<(options: ZeroOptions) => Zero>(
  'ngx-zero/zero-constructor',
  { providedIn: 'root', factory: () => options => new Zero(options) },
);

/**
 * Ties constructor callbacks to the instance they were created for; `zero` is
 * filled in right after `new Zero(...)` returns. Needed because `close()` is
 * not awaited, so a superseded instance can still fire callbacks late.
 */
type InstanceRef = { zero?: Zero };

/**
 * Owns the Zero instance behind `ZERO_INSTANCE_MANAGER`. Every lifecycle
 * transition (factory rerun, in-place auth connect, client-state-not-found
 * rotation, external swap) funnels through `#reconcile`, driven by one effect,
 * so no two reconciles ever interleave.
 */
export class ZeroInstanceManager {
  readonly #environmentInjector = inject(EnvironmentInjector);
  readonly #featureHooks = inject(ZERO_INSTANCE_HOOKS, { optional: true }) ?? [];
  readonly #constructZero = inject(ZERO_CONSTRUCTOR);
  readonly #errorHandler = inject(ErrorHandler);

  /** `isPlatformBrowser` without depending on `@angular/common` (not a peer). */
  readonly isBrowser: boolean = inject(PLATFORM_ID) === 'browser';

  /**
   * `undefined` until constructed and always on the server — the non-throwing
   * seam injectQuery/injectMutation consume.
   */
  readonly #currentInstance = signal<Zero | undefined>(undefined);

  readonly instance: Signal<Zero | undefined> = this.#currentInstance.asReadonly();

  /** Public-facing read: throws at READ time until an instance exists (SSR contract). */
  readonly zeroOrThrow: Signal<Zero> = computed(() => {
    const zero = this.#currentInstance();
    if (zero === undefined) {
      throw ngxZeroError(
        this.isBrowser
          ? 'No Zero instance is available yet. provideZero() constructs the instance ' +
              'in an environment initializer at bootstrap — ensure provideZero(...) is in ' +
              'your ApplicationConfig providers and you are not reading from a bare ' +
              'EnvironmentInjector that skips initializers.'
          : 'The Zero instance was read during server-side rendering. ngx-zero never ' +
              'constructs Zero on the server; guard this read with a browser check, or ' +
              'use injectQuery/injectMutation which are server-inert by design.',
      );
    }
    return zero;
  });

  /**
   * Monotonic epoch, bumped on every recreate and every in-place connect. The
   * auth refresher captures it before awaiting and discards stale tokens.
   */
  #authEpochCounter = 0;
  authEpoch(): number {
    return this.#authEpochCounter;
  }

  readonly #sourceFactory: () => ZeroInstanceSource;

  /**
   * The user's factory, reactive and re-runnable in injection context.
   * `computed` caching lets the synchronous first read in `start()` and the
   * effect's first run share one evaluation.
   */
  readonly #reactiveSource = computed<ZeroInstanceSource>(() =>
    runInInjectionContext(this.#environmentInjector, this.#sourceFactory),
  );

  /**
   * Most recent factory output, refreshed on every reconcile including no-ops.
   * The stable option wrappers delegate through it — that is what makes
   * ignoring function identity in the diff sound.
   */
  #currentSource: ZeroInstanceSource | undefined;

  #ownsInstance = false;

  /**
   * A client-state-not-found rotation request: the signal write carries it
   * into the reconcile effect (safe from Zero callbacks in both zone modes);
   * the pending flag collapses double fires until a recreate lands.
   */
  #rotationPending = false;
  readonly #rotationGeneration = signal(0);

  #detachCallbacks: VoidFunction[] = [];
  #started = false;

  constructor(source: ZeroInstanceSource | (() => ZeroInstanceSource)) {
    this.#sourceFactory = typeof source === 'function' ? source : () => source;    
    inject(DestroyRef).onDestroy(() => this.#destroy());
  }

  /** Called once from provideZero's environment initializer. */
  start(): void {
    if (this.#started) {
      throw ngxZeroError('provideZero() was provided more than once in the same environment.');
    }
    this.#started = true;
    if (!this.isBrowser) {
      return; // SSR: fully inert
    }

    // Effects only flush with change detection; the first construction must be
    // synchronous so the instance exists before anything can read it. A factory
    // that throws here fails bootstrap loudly (broken options = programming error).
    this.#reconcile(this.#reactiveSource());

    // A factory that throws on a RERUN surfaces here instead: Angular reports
    // it, the previous instance stays current, and the next valid emission
    // recovers.
    effect(
      () => {
        const nextSource = this.#reactiveSource(); // tracked: every signal the factory read
        this.#rotationGeneration(); // tracked: rotation requests
        // Untracked so the effect's dependencies stay exactly the two reads
        // above — #reconcile reads #currentInstance, which it also writes.
        untracked(() => this.#reconcile(nextSource));
      },
      { injector: this.#environmentInjector },
    );
  }

  /** THE single reconcile funnel — never more than one reconcile in flight. */
  #reconcile(nextSource: ZeroInstanceSource): void {
    const previousSource = this.#currentSource;
    this.#currentSource = nextSource; // wrappers now see the newest closures — even on no-op
    const rotationRequested = this.#rotationPending;

    if (isExternalSource(nextSource)) {
      this.#rotationPending = false;
      if (this.#currentInstance() === nextSource.zero) {
        return;
      }
      this.#detachAndCloseCurrent(); // closes only if owned
      this.#ownsInstance = false;
      this.#currentInstance.set(nextSource.zero);
      this.#attachFeatureHooks(nextSource.zero); // features attach to external too; withInit does not
      return;
    }

    // First construction, recovery from a failed one, or a switch away from an
    // external source — nothing meaningful to diff against.
    const currentInstance = this.#currentInstance();
    if (
      currentInstance === undefined ||
      previousSource === undefined ||
      isExternalSource(previousSource)
    ) {
      this.#recreateInstance(nextSource);
      return;
    }

    const verdict = rotationRequested ? 'recreate' : diffZeroOptions(previousSource, nextSource);
    switch (verdict) {
      case 'recreate':
        this.#recreateInstance(nextSource);
        break;
      case 'connect': {
        // Auth token rotated string→string: push in place, no recreate.
        this.#authEpochCounter++;
        void currentInstance.connection.connect({ auth: nextSource.auth as string }).catch(err => {
          if (this.#currentInstance() === currentInstance) {
            this.#errorHandler.handleError(err);
          }
        });
        break;
      }
      case 'noop':
        break;
    }
  }

  #recreateInstance(options: ZeroOptions): void {
    // Close-then-construct, close NOT awaited: the signal must never
    // transiently hold undefined; Zero's ActiveClientsManager arbitrates
    // same-storage overlap.
    this.#detachAndCloseCurrent();

    const instanceRef: InstanceRef = {};
    let zero: Zero;
    try {
      zero = this.#constructZero(this.#prepareConstructorOptions(options, instanceRef));
    } catch (err) {
      // Never leave the already-closed predecessor visible in the signal.
      this.#errorHandler.handleError(err);
      this.#currentInstance.set(undefined);
      this.#ownsInstance = false;
      this.#rotationPending = false;
      return; // the next valid factory emission recovers
    }
    instanceRef.zero = zero;
    this.#ownsInstance = true;
    this.#authEpochCounter++;
    this.#rotationPending = false; // any recreate satisfies a pending rotation

    for (const hook of this.#featureHooks) {
      try {
        hook.onInstanceCreated?.(zero); // withInit
      } catch (err) {
        // Contained: a throwing init hook must not block publishing the instance.
        this.#errorHandler.handleError(err);
      }
    }
    this.#currentInstance.set(zero);
    this.#attachFeatureHooks(zero);
  }

  #detachAndCloseCurrent(): void {
    for (const detach of this.#detachCallbacks.splice(0)) {
      try {
        detach();
      } catch {
        // A broken feature must not break reconcile.
      }
    }
    const currentInstance = this.#currentInstance();
    if (currentInstance !== undefined && this.#ownsInstance) {
      void currentInstance.close().catch(() => {}); // a routine recreate must never throw
    }
  }

  #attachFeatureHooks(zero: Zero): void {
    for (const hook of this.#featureHooks) {
      try {
        const detach = hook.onInstanceAttached?.(zero);
        if (detach) {
          this.#detachCallbacks.push(detach);
        }
      } catch (err) {
        // Contained: one broken feature must not starve the remaining hooks.
        this.#errorHandler.handleError(err);
      }
    }
  }

  /**
   * The options actually handed to `new Zero(...)`: every function-valued
   * entry becomes a reference-stable wrapper delegating to the latest factory
   * output, and `onClientStateNotFound` is always the library's own handler.
   */
  #prepareConstructorOptions(options: ZeroOptions, instanceRef: InstanceRef): ZeroOptions {
    const prepared: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(options)) {
      if (key === 'onClientStateNotFound') {
        continue;
      }
      prepared[key] =
        typeof value === 'function' ? wrapOptionFunction(key, () => this.#currentOptions()) : value;
    }
    prepared['onClientStateNotFound'] = this.#clientStateNotFoundHandler(instanceRef);
    return prepared as ZeroOptions;
  }

  /**
   * Client-state-not-found policy: the user callback wins; absent or throwing
   * → rotate to a fresh instance (never `location.reload()`). Fires from Zero
   * internals outside any zone, so the only reactive act is a signal write.
   */
  #clientStateNotFoundHandler(instanceRef: InstanceRef): () => void {
    return () => {
      if (this.#rotationPending) {
        return;
      }
      // A late fire from a superseded, closing instance must not rotate its
      // healthy replacement.
      if (instanceRef.zero !== undefined && this.#currentInstance() !== instanceRef.zero) {
        return;
      }
      const userCallback = this.#currentOptions()?.onClientStateNotFound;
      if (userCallback) {
        try {
          userCallback();
          return;
        } catch {
          // Fall through to rotation — the client is closed either way.
        }
      }
      this.#rotationPending = true;
      this.#rotationGeneration.update(generation => generation + 1);
    };
  }

  #currentOptions(): ZeroOptions | undefined {
    const source = this.#currentSource;
    return source === undefined || isExternalSource(source) ? undefined : source;
  }

  /**
   * Synchronous teardown (DestroyRef): nothing here may throw. Close is
   * fire-and-forget — Zero persists continuously, so an unawaited close loses
   * nothing.
   */
  #destroy(): void {
    this.#detachAndCloseCurrent();
    this.#currentInstance.set(undefined);
    this.#ownsInstance = false;
  }
}
