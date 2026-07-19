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

/** One listener emission, captured verbatim. */
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
      this.#commit(spec, () => this.#write(undefined, 'disabled'));
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

    // All failure-prone work (materialize + subscribe) happens here, before
    // the commit below.
    const candidate = this.#buildCandidate(spec);
    this.#commit(spec, () => {
      this.#session = candidate.session;
      candidate.install(bridgeAllowed);
    });
  }

  /**
   * Atomically applies a spec: advances `#applied`, retires the old session,
   * and applies the new state even if retirement throws (unsubscribe
   * failure) — the applied spec, installed session, and signals must never
   * diverge. The retirement error surfaces only after the commit completes.
   */
  #commit(spec: QuerySpec, applyNewState: () => void): void {
    this.#applied = spec;
    const retired = tryCatch(() => this.#teardown());
    applyNewState();
    if (retired.error) {
      throw retired.error;
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
    const unsubscribed = tryCatch(() => session.unsubscribe());
    session.view.destroy(); // release the IVM view even if unsubscribe threw
    if (unsubscribed.error) {
      throw unsubscribed.error;
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
      // Failed candidates leave nothing behind: release the view and let the
      // error propagate with the prior session untouched.
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
    // spec.query is already context-resolved, so Zero's public materialize
    // signature accepts it as-is; the return type pins the erased row type.
    return spec.zero.materialize(
      spec.query,
      this.#ttl === undefined ? undefined : { ttl: this.#ttl },
    );
  }

  /**
   * The keepPreviousData bridge is precisely the skip of this one initial
   * overwrite — only when the new view would otherwise flash empty at
   * 'unknown'. Data keeps the previous key's rows; status honestly belongs
   * to the new view.
   */
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

  /** Single write path: observers only ever see a consistent triple. */
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
    // Signals stay as-is: the host is gone, resetting would only trigger a
    // pointless change-detection notification during teardown.
  }
}

/** Empty for both shapes: [] (list) or undefined (.one() miss). */
function isEmptyResult(data: unknown): boolean {
  return data === undefined || (Array.isArray(data) && data.length === 0);
}

function noop(): void {}
