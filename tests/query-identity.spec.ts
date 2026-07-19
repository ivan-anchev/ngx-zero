import {
  createBuilder,
  createSchema,
  defineQueriesWithType,
  defineQueryWithType,
  string,
  table,
  type Zero,
} from '@rocicorp/zero';
import { describe, expect, it } from 'vitest';
import {
  resolveQuery,
  type AnyQueryOrRequest,
} from '../src/query-identity.js';

const issue = table('issue')
  .columns({ id: string(), owner: string() })
  .primaryKey('id');
const schema = createSchema({ tables: [issue] });
const builder = createBuilder(schema);

const defineIssueQuery = defineQueryWithType<typeof schema>();
const defineIssueQueries = defineQueriesWithType<typeof schema>();
const queries = defineIssueQueries({
  issue: {
    all: defineIssueQuery(() => builder.issue),
    byFilter: defineIssueQuery(
      ({ args }: { args: { id: string; owner: string } }) =>
        builder.issue.where('id', args.id).where('owner', args.owner),
    ),
  },
});

/** resolveQuery only reads `.context`; raw builder queries never touch it. */
const zero = { context: undefined } as unknown as Zero;

const key = (value: AnyQueryOrRequest): string => resolveQuery(zero, value).key;

describe('resolveQuery', () => {
  it('gives registry calls with equal args equal keys and different args different keys', () => {
    expect(key(queries.issue.byFilter({ id: 'i1', owner: 'o1' }))).toBe(
      key(queries.issue.byFilter({ id: 'i1', owner: 'o1' })),
    );
    expect(key(queries.issue.byFilter({ id: 'i1', owner: 'o1' }))).not.toBe(
      key(queries.issue.byFilter({ id: 'i2', owner: 'o1' })),
    );
  });

  it('includes the result format in the key', () => {
    expect(key(builder.issue.one())).not.toBe(key(builder.issue.limit(1)));
  });

  it('returns a context-resolved query for a registry request', () => {
    const resolved = resolveQuery(
      zero,
      queries.issue.byFilter({ id: 'i1', owner: 'o1' }),
    );
    // The resolved query re-keys to itself: it is a real Query, not a request.
    expect(resolveQuery(zero, resolved.query).key).toBe(resolved.key);
  });

  it('guides callers who return an uncalled registry query', () => {
    expect(() =>
      resolveQuery(zero, queries.issue.all as unknown as AnyQueryOrRequest),
    ).toThrow(/did you forget to call the registry query/);
  });
});
