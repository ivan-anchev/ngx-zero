import {
  computed,
  DestroyRef,
  effect,
  EnvironmentInjector,
  ErrorHandler,
  inject,
  InjectionToken,
  runInInjectionContext,
  signal,
  untracked,
} from '@angular/core';
import { Zero, type ZeroOptions } from '@rocicorp/zero';
import { ngxZeroError } from './errors.js';
import { diffZeroOptions, isExternalSource } from './options-diff.js';
import type {
  ZeroInstanceHooks,
  ZeroInstanceOptions,
  ZeroOptionsOrExternalSource,
  ZeroSourceFactory,
} from './types.js';
import { tryCatch } from './utils.js';

export const ZERO_INSTANCE = new InjectionToken<ZeroInstanceManager>(
  'ngx-zero/instance-manager',
);

export const ZERO_CONSTRUCTOR = new InjectionToken<(options: ZeroOptions) => Zero>(
  'ngx-zero/zero-constructor',
  { providedIn: 'root', factory: () => options => new Zero(options) },
);

export const ZERO_INSTANCE_HOOKS = new InjectionToken<readonly ZeroInstanceHooks[]>(
  'ngx-zero/instance-hooks',
);

function resolveSourceFactory(source: ZeroInstanceOptions): ZeroSourceFactory {
  return typeof source === 'function' ? source : () => source;
}

export class ZeroInstanceManager {
  readonly #injector = inject(EnvironmentInjector);
  readonly #constructZero = inject(ZERO_CONSTRUCTOR);
  readonly #featureHooks = inject(ZERO_INSTANCE_HOOKS, { optional: true }) ?? [];
  readonly #errorHandler = inject(ErrorHandler);

  readonly #sourceFactory: ZeroSourceFactory;

  readonly #source = computed<ZeroOptionsOrExternalSource>(() =>
    runInInjectionContext(this.#injector, this.#sourceFactory),
  );

  readonly #zeroInstance = signal<Zero | undefined>(undefined);

  readonly zeroOrThrow = computed(() => {
    const zero = this.#zeroInstance();

    if (zero === undefined) {
      throw ngxZeroError('Zero instance not found. Call `start()` first.');
    }

    return zero;
  });

  #started = false;

  #rotationPending = false;

  readonly #rotationGeneration = signal(0);

  #detach: VoidFunction | undefined;

  constructor(source: ZeroInstanceOptions) {
    this.#sourceFactory = resolveSourceFactory(source);

    inject(DestroyRef).onDestroy(() => this.#destroy());
  }

  start(): void {
    if (this.#started) {
      throw ngxZeroError('Zero instance manager already started.');
    }

    this.#started = true;

    // Environment initializers run before component construction and outside
    // any reactive context. Reconcile once synchronously so field initializers
    // can use the Zero instance, then track the last reconciled source so the
    // effect only reacts to changes made after this point (or to rotations).
    let previousSource = this.#source();
    this.#reconcile(previousSource, undefined);

    effect(
      () => {
        const source = this.#source();

        this.#rotationGeneration();

        if (source === previousSource && !this.#rotationPending) {
          return;
        }

        const previous = previousSource;
        previousSource = source;

        untracked(() => this.#reconcile(source, previous));
      },
      { injector: this.#injector },
    );
  }

  #connect({ auth }: ZeroOptions): void {
    const zero = this.#zeroInstance();

    if (!zero || !auth) {
      return;
    }

    void zero.connection.connect({ auth });
  }

  #reconcile(
    next: ZeroOptionsOrExternalSource,
    previous: ZeroOptionsOrExternalSource | undefined,
  ): void {
    const instance = this.#zeroInstance();

    if (isExternalSource(next)) {
      this.#rotationPending = false;

      if (instance !== next.zero) {
        this.#setInstance(next.zero, { isExternal: true });
      }

      return;
    }

    if (
      instance === undefined ||
      previous === undefined ||
      isExternalSource(previous) ||
      this.#rotationPending
    ) {
      return this.#createInstance(next);
    }

    const verdict = diffZeroOptions(previous, next);

    if (verdict === 'recreate') {
      return this.#createInstance(next);
    }

    if (verdict === 'connect') {
      return this.#connect(next);
    }
  }

  #runInstanceCreatedHooks(zero: Zero): void {
    for (const hook of this.#featureHooks) {
      runInInjectionContext(this.#injector, () => hook.onInstanceCreated?.(zero));
    }
  }

  #createInstance(options: ZeroOptions): void {
    const zeroOptions = this.#prepareZeroOptions(options);
    const { result: zero, error } = tryCatch(() => this.#constructZero(zeroOptions));

    if (error) {
      return this.#errorHandler.handleError(error);
    }

    this.#setInstance(zero);
  }

  #setInstance(zero: Zero, options: { isExternal?: boolean } = {}): void {
    const { isExternal = false } = options;

    this.#destroy();
    this.#zeroInstance.set(zero);
    this.#rotationPending = false;

    if (!isExternal) {
      this.#detach = () => {
        void zero.close();
      };

      this.#runInstanceCreatedHooks(zero);
    }
  }

  #prepareZeroOptions(options: ZeroOptions): ZeroOptions {
    return {
      ...options,
      onClientStateNotFound: this.#onClientStateNotFound(options),
    };
  }

  #onClientStateNotFound(options: ZeroOptions): VoidFunction {
    return () => {
      if (this.#rotationPending) {
        return;
      }

      if (options.onClientStateNotFound) {
        tryCatch(() => options.onClientStateNotFound?.());
        return;
      }

      this.#scheduleRotation();
    };
  }

  #scheduleRotation(): void {
    if (this.#rotationPending) {
      return;
    }

    this.#rotationPending = true;
    this.#rotationGeneration.update(generation => generation + 1);
  }

  #destroy(): void {
    this.#detach?.();
    this.#detach = undefined;
  }
}
