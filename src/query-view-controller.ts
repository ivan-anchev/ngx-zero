import { signal, untracked, type Signal } from '@angular/core';
import type {
  ErroredQuery,
  ResultType,
  TTL,
  TypedView,
  Zero,
} from '@rocicorp/zero';
import type {
  AnyQueryOrRequest,
  QueryKey,
} from './query-identity.js';
import type { QueryStatus } from './query-ref.js';

export const DISABLED: unique symbol = Symbol('ngx-zero/disabled');

export interface QuerySpec {
  readonly zero: Zero;
  readonly key: QueryKey | typeof DISABLED;
  readonly request: AnyQueryOrRequest | undefined;
}

interface ViewSession {
  alive: boolean;
  view: TypedView<unknown>;
  unsubscribe: () => void;
}

export class QueryViewController {
  readonly #data = signal<unknown>(undefined);
  readonly #status = signal<QueryStatus>('disabled');
  readonly #error = signal<ErroredQuery | undefined>(undefined);

  #session: ViewSession | undefined;
  #applied: QuerySpec | undefined;
  #destroyed = false;

  readonly #keepPreviousData: boolean;
  readonly #ttl: TTL | undefined;

  constructor(options: {
    keepPreviousData: boolean;
    ttl: TTL | undefined;
  }) {
    this.#keepPreviousData = options.keepPreviousData;
    this.#ttl = options.ttl;
  }

  get data(): Signal<unknown> {
    return this.#data.asReadonly();
  }

  get status(): Signal<QueryStatus> {
    return this.#status.asReadonly();
  }

  get error(): Signal<ErroredQuery | undefined> {
    return this.#error.asReadonly();
  }

  reconcile(spec: QuerySpec, options: { force?: boolean } = {}): void {
    if (this.#destroyed) {
      return;
    }

    if (spec === this.#applied && !options.force) {
      return;
    }

    const previous = this.#applied;
    this.#applied = spec;

    const bridgeAllowed =
      this.#keepPreviousData &&
      !options.force &&
      previous !== undefined &&
      previous.key !== DISABLED &&
      spec.key !== DISABLED &&
      previous.zero === spec.zero;

    this.#teardown();

    if (spec.key === DISABLED) {
      this.#data.set(undefined);
      this.#status.set('disabled');
      this.#error.set(undefined);
      return;
    }

    this.#materialize(spec, bridgeAllowed);
  }

  #teardown(): void {
    const session = this.#session;
    if (!session) {
      return;
    }

    this.#session = undefined;
    session.alive = false;
    try {
      session.unsubscribe();
    } finally {
      session.view.destroy();
    }
  }

  #materialize(spec: QuerySpec, bridgeAllowed: boolean): void {
    const zero = spec.zero as unknown as {
      materialize(
        request: AnyQueryOrRequest,
        options?: { ttl?: TTL },
      ): TypedView<unknown>;
    };
    const view = zero.materialize(
      spec.request!,
      this.#ttl === undefined ? undefined : { ttl: this.#ttl },
    );

    const session: ViewSession = { alive: true, view, unsubscribe: noop };
    let isInitialEmission = true;
    let bridging = false;

    const listener = (
      data: unknown,
      resultType: ResultType,
      error?: ErroredQuery,
    ): void => {
      if (!session.alive) {
        return;
      }

      if (isInitialEmission) {
        isInitialEmission = false;
        if (
          bridgeAllowed &&
          resultType === 'unknown' &&
          isEmptyResult(data)
        ) {
          bridging = true;
          this.#status.set('unknown');
          this.#error.set(undefined);
          return;
        }
      } else if (bridging) {
        bridging = false;
      }

      this.#data.set(data);
      this.#status.set(resultType);
      this.#error.set(resultType === 'error' ? error : undefined);
    };

    session.unsubscribe = view.addListener(listener);
    this.#session = session;
  }

  retry(currentSpec: () => QuerySpec): void {
    if (this.#destroyed) {
      return;
    }

    untracked(() => {
      const spec = currentSpec();
      if (spec.key === DISABLED) {
        return;
      }
      this.reconcile(spec, { force: true });
    });
  }

  updateTTL(ttl: TTL): void {
    this.#session?.view.updateTTL(ttl);
  }

  destroy(): void {
    if (this.#destroyed) {
      return;
    }
    this.#destroyed = true;
    this.#teardown();
  }
}

function isEmptyResult(data: unknown): boolean {
  return data === undefined || (Array.isArray(data) && data.length === 0);
}

function noop(): void {}
