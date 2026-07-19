import { signal, untracked, type Signal } from '@angular/core';
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

export const DISABLED: unique symbol = Symbol('ngx-zero/disabled');

/**
 * Produced by the spec computed in inject-query.ts. That computed's custom
 * `equal` on `(zero, key)` hands `reconcile()` a new reference exactly when
 * the semantic identity changed — so reference comparison IS the fast path.
 */
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

/** One materialization = one session. `alive` is the stale-write guard. */
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

  /**
   * Called eagerly at injectQuery() time, from the tracking effect on every
   * identity change, and from retry() with force. A throwing thunk throws in
   * the spec computed before this runs, so a live view is never torn down
   * for an error. The candidate session is built (materialize + subscribe)
   * BEFORE any live state is touched: if either throws, `#applied` does not
   * advance and the prior session stays fully live — still subscribed, still
   * updating the signals — so the next identity change or retry() reconciles
   * normally. Two live views on the same query may briefly coexist during the
   * build; Zero dedupes the IVM pipeline by query hash.
   */
  reconcile(spec: QuerySpec, options: { force?: boolean } = {}): void {
    if (this.#destroyed) {
      return;
    }

    if (spec === this.#applied && !options.force) {
      return;
    }

    if (spec.key === DISABLED) {
      // Nothing failure-prone here: retire first, then reset the signals.
      this.#applied = spec;
      this.#teardown();
      this.#data.set(undefined);
      this.#status.set('disabled');
      this.#error.set(undefined);
      return;
    }

    // Bridge only a same-instance enabled->enabled key change, never a
    // forced retry and never an instance swap (no old-user data flash).
    const previous = this.#applied;
    const bridgeAllowed =
      this.#keepPreviousData &&
      !options.force &&
      previous !== undefined &&
      previous.key !== DISABLED &&
      previous.zero === spec.zero;

    // All failure-prone work happens here, before the swap below.
    const candidate = this.#buildCandidate(spec);

    // Atomic swap. The finally installs the candidate even if retiring the
    // old session throws (unsubscribe failure): the applied spec and the
    // installed session must never diverge.
    this.#applied = spec;
    try {
      this.#teardown();
    } finally {
      this.#session = candidate.session;
      candidate.install(bridgeAllowed);
    }
  }

  /**
   * Never touches the public signals: enabled->enabled applies the candidate's
   * captured snapshot right after this in the same reconcile step, and
   * enabled->disabled resets explicitly in reconcile().
   */
  #teardown(): void {
    const session = this.#session;
    if (!session) {
      return;
    }

    this.#session = undefined;
    session.alive = false; // stale-write guard first, then detach
    try {
      session.unsubscribe();
    } finally {
      session.view.destroy(); // release the IVM view even if unsubscribe threw
    }
  }

  /**
   * Materializes and subscribes a candidate session without touching any live
   * state. addListener fires synchronously with the current (data, resultType,
   * error) — verified in zero@1.8.0 — but the old session is still live here,
   * so that emission is captured instead of written; `install()` applies it
   * during the atomic swap. After install, emissions write directly.
   */
  #buildCandidate(spec: EnabledQuerySpec): {
    session: ViewSession;
    install: (bridgeAllowed: boolean) => void;
  } {
    // spec.query is already context-resolved, so Zero's public materialize
    // signature accepts it as-is; the annotation pins the erased row type.
    const view: TypedView<unknown> = spec.zero.materialize(
      spec.query,
      this.#ttl === undefined ? undefined : { ttl: this.#ttl },
    );

    const session: ViewSession = { alive: true, view, unsubscribe: noop };
    let installed = false;
    let captured:
      | { data: unknown; resultType: ResultType; error?: ErroredQuery }
      | undefined;

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

    try {
      session.unsubscribe = view.addListener(listener);
    } catch (cause) {
      // Failed candidates leave nothing behind: release the view and let the
      // error propagate with the prior session untouched.
      session.alive = false;
      view.destroy();
      throw cause;
    }

    const install = (bridgeAllowed: boolean): void => {
      installed = true;
      if (!captured) {
        return;
      }
      const { data, resultType, error } = captured;
      captured = undefined;
      // The bridge is skipping this initial overwrite: only when the new
      // view would otherwise flash empty at 'unknown'. Data keeps the
      // previous key's rows; status honestly belongs to the new view.
      if (bridgeAllowed && resultType === 'unknown' && isEmptyResult(data)) {
        this.#status.set('unknown');
        this.#error.set(undefined);
        return;
      }
      this.#write(data, resultType, error);
    };

    return { session, install };
  }

  /** Single write path: observers only ever see a consistent triple. */
  #write(data: unknown, resultType: ResultType, error?: ErroredQuery): void {
    this.#data.set(data);
    this.#status.set(resultType);
    this.#error.set(resultType === 'error' ? error : undefined);
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
    // Signals stay as-is: the host is gone, resetting would only trigger a
    // pointless change-detection notification during teardown.
  }
}

/** Empty for both shapes: [] (list) or undefined (.one() miss). */
function isEmptyResult(data: unknown): boolean {
  return data === undefined || (Array.isArray(data) && data.length === 0);
}

function noop(): void {}
