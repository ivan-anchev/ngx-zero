import {
  createBuilder,
  createSchema,
  defineQueriesWithType,
  defineQueryWithType,
  string,
  table,
  type ReadonlyJSONValue,
} from '@rocicorp/zero';
import { describe, expect, it } from 'vitest';
import {
  isQueryRequest,
  queryIdentityKey,
  type AnyQueryOrRequest,
  type AnyQueryRequest,
} from '../src/query-identity.js';

const issue = table('issue').columns({ id: string() }).primaryKey('id');
const schema = createSchema({ tables: [issue] });
const builder = createBuilder(schema);

const defineIssueQuery = defineQueryWithType<typeof schema>();
const defineIssueQueries = defineQueriesWithType<typeof schema>();
const queries = defineIssueQueries({
  issue: {
    all: defineIssueQuery(() => builder.issue),
  },
});

function request(
  args: ReadonlyJSONValue | undefined,
  queryName = 'issue.byID',
): AnyQueryRequest {
  return { query: { queryName }, args, '~': 'QueryRequest' };
}

describe('queryIdentityKey', () => {
  it('uses distinct identity schemes for requests and raw queries', () => {
    const queryRequest = request({ id: 'i1' });

    expect(isQueryRequest(queryRequest)).toBe(true);
    expect(queryIdentityKey(queryRequest)).toMatch(/^request:issue\.byID:/);
    expect(queryIdentityKey(builder.issue)).toMatch(/^query:/);
    expect(queryIdentityKey(queryRequest)).not.toBe(queryIdentityKey(builder.issue));
  });

  it('stably serializes request arguments and undefined', () => {
    expect(queryIdentityKey(request({ a: 1, nested: { x: true, y: false }, b: 2 }))).toBe(
      queryIdentityKey(request({ b: 2, nested: { y: false, x: true }, a: 1 })),
    );
    expect(queryIdentityKey(request(undefined))).toBe('request:issue.byID:void');
  });

  it('includes the result format in raw query identity', () => {
    expect(queryIdentityKey(builder.issue.one())).not.toBe(
      queryIdentityKey(builder.issue.limit(1)),
    );
  });

  it('guides callers who return an uncalled registry query', () => {
    expect(() =>
      queryIdentityKey(queries.issue.all as unknown as AnyQueryOrRequest),
    ).toThrow(/did you forget to call the registry query/);
  });
});
