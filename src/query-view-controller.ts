import { signal, untracked } from '@angular/core';
import type {
  AnyQuery,
  ErroredQuery,
  ResultType,
  TTL,
  TypedView,
  Zero,
} from '@rocicorp/zero';
import type { QueryKey } from './query-identity.js';
import type { QueryStatus } from './query-ref.js';
import { tryCatch } from './utils.js';

export const DISABLED: unique symbol = Symbol('ngx-zero/disabled');

/** Deduped on `(zero, key)` upstream — reference equality is the fast path. */
export type QuerySpec = EnabledQuerySpec | DisabledQuerySpec;

export interface EnabledQuerySpec {
  readonly zero: Zero;
  readonly key: QueryKey;
  /** Already resolved against `zero`'s context by resolveQuery(). */
  readonly query: AnyQuery;
}

export interface DisabledQuerySpec {
  readonly zero: Zero;
  readonly key: typeof DISABLED;
  readonly query: undefined;
}

/** `alive` is the stale-write guard. */
interface ViewSession {
  alive: boolean;
  view: TypedView<unknown>;
  unsubscribe: () => void;
}

interface Snapshot {
  data: unknown;
  resultType: ResultType;
  error?: ErroredQuery;
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

  readonly data = this.#data.asReadonly();
  readonly status = this.#status.asReadonly();
  readonly error = this.#error.asReadonly();

  constructor(options: {
    keepPreviousData: boolean;
    ttl: TTL | undefined;
  }) {
    this.#keepPreviousData = options.keepPreviousData;
    this.#ttl = options.ttl;
  }

  /** Candidate-first: on a throw the prior session stays fully live. */
  reconcile(spec: QuerySpec, options: { force?: boolean } = {}): void {
    if (this.#destroyed) {
      return;
    }

    if (spec === this.#applied && !options.force) {
      return;
    }

    if (spec.key === DISABLED) {
      this.#commit(spec, () => this.#write(undefined, 'disabled'));
      return;
    }

    // Never bridge a forced retry or an instance swap (no old-user flash).
    const previous = this.#applied;
    const bridgeAllowed =
      this.#keepPreviousData &&
      !options.force &&
      previous !== undefined &&
      previous.key !== DISABLED &&
      previous.zero === spec.zero;

    const candidate = this.#buildCandidate(spec);
    this.#commit(spec, () => {
      this.#session = candidate.session;
      candidate.install(bridgeAllowed);
    });
  }

  /** Applies the new state even if retirement throws; the error surfaces after. */
  #commit(spec: QuerySpec, applyNewState: () => void): void {
    this.#applied = spec;
    const retired = tryCatch(() => this.#teardown());
    applyNewState();
    if (retired.error) {
      throw retired.error;
    }
  }

  /** Never touches the public signals; the caller commits the new state. */
  #teardown(): void {
    const session = this.#session;
    if (!session) {
      return;
    }

    this.#session = undefined;
    session.alive = false; // stale-write guard first, then detach
    const unsubscribed = tryCatch(() => session.unsubscribe());
    session.view.destroy();
    if (unsubscribed.error) {
      throw unsubscribed.error;
    }
  }

  /**
   * addListener fires synchronously (zero@1.8.0); that first emission is
   * captured and applied by `install()` at commit time.
   */
  #buildCandidate(spec: EnabledQuerySpec): {
    session: ViewSession;
    install: (bridgeAllowed: boolean) => void;
  } {
    const view = this.#materializeView(spec);
    const session: ViewSession = { alive: true, view, unsubscribe: noop };

    let installed = false;
    let captured: Snapshot | undefined;

    const listener = (
      data: unknown,
      resultType: ResultType,
      error?: ErroredQuery,
    ): void => {
      if (!session.alive) {
        return;
      }
      if (!installed) {
        captured = { data, resultType, error };
        return;
      }
      this.#write(data, resultType, error);
    };

    const subscribed = tryCatch(() => view.addListener(listener));
    if (subscribed.error) {
      session.alive = false;
      view.destroy();
      throw subscribed.error;
    }
    session.unsubscribe = subscribed.result;

    const install = (bridgeAllowed: boolean): void => {
      installed = true;
      if (captured) {
        const snapshot = captured;
        captured = undefined;
        this.#applyInitialSnapshot(snapshot, bridgeAllowed);
      }
    };

    return { session, install };
  }

  #materializeView(spec: EnabledQuerySpec): TypedView<unknown> {
    return spec.zero.materialize(
      spec.query,
      this.#ttl === undefined ? undefined : { ttl: this.#ttl },
    );
  }

  /** The bridge skips this one overwrite when the new view starts empty at 'unknown'. */
  #applyInitialSnapshot(
    { data, resultType, error }: Snapshot,
    bridgeAllowed: boolean,
  ): void {
    if (bridgeAllowed && resultType === 'unknown' && isEmptyResult(data)) {
      this.#status.set('unknown');
      this.#error.set(undefined);
      return;
    }
    this.#write(data, resultType, error);
  }

  #write(data: unknown, status: QueryStatus, error?: ErroredQuery): void {
    this.#data.set(data);
    this.#status.set(status);
    this.#error.set(status === 'error' ? error : undefined);
  }

  /** `untracked` so it is callable from templates and effects without deps. */
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

/** Empty for both shapes: [] (list) or undefined (.one() miss). */
function isEmptyResult(data: unknown): boolean {
  return data === undefined || (Array.isArray(data) && data.length === 0);
}

function noop(): void {}
