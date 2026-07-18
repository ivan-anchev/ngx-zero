import type {
  AnyQuery,
  ReadonlyJSONValue,
  TTL,
  TypedView,
  Zero,
} from '@rocicorp/zero';
import { asQueryInternals, queryInternalsTag } from '@rocicorp/zero/bindings';
import { ngxZeroError } from './errors.js';

/** Loose runtime shape of a QueryRequest that does not leak into public typing. */
export interface AnyQueryRequest {
  readonly query: { readonly queryName: string };
  readonly args: ReadonlyJSONValue | undefined;
  readonly '~': string;
}

export type AnyQueryOrRequest = AnyQuery | AnyQueryRequest;
export type QueryKey = string;

export function isQueryRequest(value: AnyQueryOrRequest): value is AnyQueryRequest {
  return (value as { '~'?: unknown })['~'] === 'QueryRequest';
}

export function queryIdentityKey(value: AnyQueryOrRequest): QueryKey {
  if (isQueryRequest(value)) {
    return `request:${value.query.queryName}:${stableStringify(value.args)}`;
  }

  if (!(queryInternalsTag in (value as object))) {
    throw ngxZeroError(
      'injectQuery() thunk must return a Query or a QueryRequest ' +
        '(did you forget to call the registry query, e.g. `queries.issue.mine()`?).',
    );
  }

  const internals = asQueryInternals(value);
  return `query:${internals.hash()}:${stableStringify(
    internals.format as ReadonlyJSONValue,
  )}`;
}

/**
 * Runtime boundary for materialization: `AnyQueryOrRequest` carries only the
 * runtime identity fields, while `zero.materialize` demands Zero's fully
 * branded query generics. This is the one deliberate cast bridging the two.
 */
export function materializeQuery(
  zero: Zero,
  request: AnyQueryOrRequest,
  options?: { ttl?: TTL },
): TypedView<unknown> {
  const looselyTypedZero = zero as unknown as {
    materialize(
      request: AnyQueryOrRequest,
      options?: { ttl?: TTL },
    ): TypedView<unknown>;
  };
  return looselyTypedZero.materialize(request, options);
}

function stableStringify(value: ReadonlyJSONValue | undefined): string {
  if (value === undefined) {
    return 'void';
  }
  return JSON.stringify(sortKeysDeep(value));
}

function sortKeysDeep(value: ReadonlyJSONValue): ReadonlyJSONValue {
  if (Array.isArray(value)) {
    return value.map(item => sortKeysDeep(item));
  }

  if (value !== null && typeof value === 'object') {
    const object = value as Readonly<
      Record<string, ReadonlyJSONValue | undefined>
    >;
    const sorted: Record<string, ReadonlyJSONValue | undefined> = {};
    for (const key of Object.keys(object).sort()) {
      const item = object[key];
      sorted[key] = item === undefined ? undefined : sortKeysDeep(item);
    }
    return sorted;
  }

  return value;
}
