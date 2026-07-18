import type { Injector, Signal } from '@angular/core';
import type { ErroredQuery, TTL } from '@rocicorp/zero';

/**
 * 'unknown' | 'complete' | 'error' mirror Zero's ResultType verbatim;
 * 'disabled' is the one added state, for a thunk that returned falsy.
 */
export type QueryStatus = 'unknown' | 'complete' | 'error' | 'disabled';

/**
 * Plain object of signals. TStatus lets the always-enabled overload exclude
 * 'disabled' so an exhaustive switch on `status()` needs no dead branch.
 */
export interface QueryRef<
  TData,
  TStatus extends QueryStatus = Exclude<QueryStatus, 'disabled'>,
> {
  /** List queries: Row[]. `.one()` queries: Row | undefined. */
  readonly data: Signal<TData>;
  readonly status: Signal<TStatus>;
  /** Cleared on any later successful emission or re-materialization. */
  readonly error: Signal<ErroredQuery | undefined>;
  /** Convenience for `status() === 'complete'`. */
  readonly isComplete: Signal<boolean>;
  /**
   * Destroy the current view and re-materialize against the current
   * instance (doubles as manual refresh). No-op while disabled or after
   * host destroy; during a keepPreviousData bridge it is a hard refresh.
   */
  retry(): void;
  /** Forward a TTL to the current view only — never re-materializes. */
  updateTTL(ttl: TTL): void;
}

export interface InjectQueryOptions {
  /** Passed to `zero.materialize(request, { ttl })` once per materialization. */
  ttl?: TTL;
  /** Keep previous data across an empty, unknown same-instance query change. */
  keepPreviousData?: boolean;
  /** Resolve dependencies from an explicit injection context. */
  injector?: Injector;
}
