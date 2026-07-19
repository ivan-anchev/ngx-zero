import type { AnyCustomQuery, AnyQuery, Zero } from '@rocicorp/zero';
import {
  addContextToQuery,
  asQueryInternals,
  queryInternalsTag,
} from '@rocicorp/zero/bindings';
import { ngxZeroError } from './errors.js';

/**
 * Widest runtime shape a query thunk may produce, derived from Zero's own
 * canonical types. The injectQuery overloads own the precise public typing.
 */
export type AnyQueryOrRequest = AnyQuery | ReturnType<AnyCustomQuery>;

export type QueryKey = string;

/** A thunk result resolved against one Zero instance's current context. */
export interface ResolvedQuery {
  readonly key: QueryKey;
  readonly query: AnyQuery;
}

/**
 * Single resolution point: a registry QueryRequest is turned into a Query
 * with the instance's current context via `addContextToQuery` — exactly what
 * `zero.materialize` does internally — so Zero's validators, context, and
 * AST semantics define identity. The key is the resolved query's canonical
 * client hash plus its serialized result format: `hash()` alone is not
 * enough because `.one()` and `.limit(1)` share an AST hash while returning
 * different shapes. The format is a fixed internal shape (never user args),
 * so plain JSON.stringify is deterministic.
 */
export function resolveQuery(
  zero: Zero,
  value: AnyQueryOrRequest,
): ResolvedQuery {
  const query = addContextToQuery(value, zero.context);

  // An uncalled registry query (`queries.issue.mine` without `()`) passes
  // through resolution untouched and carries no query internals.
  if (!(queryInternalsTag in (query as object))) {
    throw ngxZeroError(
      'injectQuery() thunk must return a Query or a QueryRequest ' +
        '(did you forget to call the registry query, e.g. `queries.issue.mine()`?).',
    );
  }

  const internals = asQueryInternals(query);
  return {
    key: `${internals.hash()}:${JSON.stringify(internals.format)}`,
    query,
  };
}
