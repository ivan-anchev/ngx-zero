import type { Injector, Signal } from '@angular/core';
import type { ErroredQuery, TTL } from '@rocicorp/zero';

export type QueryStatus = 'unknown' | 'complete' | 'error' | 'disabled';

export interface QueryRef<
  TData,
  TStatus extends QueryStatus = Exclude<QueryStatus, 'disabled'>,
> {
  readonly data: Signal<TData>;
  readonly status: Signal<TStatus>;
  readonly error: Signal<ErroredQuery | undefined>;
  readonly isComplete: Signal<boolean>;
  retry(): void;
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
