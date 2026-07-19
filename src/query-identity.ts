import type { AnyCustomQuery, AnyQuery, Zero } from '@rocicorp/zero';
import {
  addContextToQuery,
  asQueryInternals,
  queryInternalsTag,
} from '@rocicorp/zero/bindings';
import { ngxZeroError } from './errors.js';

/** Widest thunk result; the injectQuery overloads own the precise typing. */
export type AnyQueryOrRequest = AnyQuery | ReturnType<AnyCustomQuery>;

export type QueryKey = string;

/** A thunk result resolved against one Zero instance's current context. */
export interface ResolvedQuery {
  readonly key: QueryKey;
  readonly query: AnyQuery;
}

/**
 * Resolves like `zero.materialize` does internally, so Zero's validators,
 * context, and AST semantics define identity. The key includes the result
 * format because `.one()` and `.limit(1)` share an AST hash while returning
 * different shapes.
 */
export function resolveQuery(
  zero: Zero,
  value: AnyQueryOrRequest,
): ResolvedQuery {
  const query = addContextToQuery(value, zero.context);

  // An uncalled registry query (`queries.issue.mine` without `()`) passes
  // through resolution untouched.
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
