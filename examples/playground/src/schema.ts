import {
  boolean,
  createBuilder,
  createSchema,
  defineMutatorWithType,
  defineMutators,
  number,
  string,
  table,
  type ReadonlyJSONObject,
  type Transaction,
} from '@rocicorp/zero';

const issue = table('issue')
  .columns({
    id: string(),
    title: string(),
    completed: boolean(),
    createdAt: number(),
  })
  .primaryKey('id');

export const schema = createSchema({ tables: [issue] });

declare module '@rocicorp/zero' {
  interface DefaultTypes {
    schema: typeof schema;
  }
}

export interface Issue extends ReadonlyJSONObject {
  readonly id: string;
  readonly title: string;
  readonly completed: boolean;
  readonly createdAt: number;
}

type IssueID = Pick<Issue, 'id'>;
type IssueCompletion = Pick<Issue, 'id' | 'completed'>;

export const queries = createBuilder(schema);
const defineIssueMutator = defineMutatorWithType<typeof schema>();

export const mutators = defineMutators({
  issue: {
    create: defineIssueMutator(
      async ({ tx, args }: { tx: Transaction; args: Issue }) => {
        await tx.mutate.issue.insert(args);
      },
    ),
    setCompleted: defineIssueMutator(
      async ({ tx, args }: { tx: Transaction; args: IssueCompletion }) => {
        await tx.mutate.issue.update(args);
      },
    ),
    remove: defineIssueMutator(
      async ({ tx, args }: { tx: Transaction; args: IssueID }) => {
        await tx.mutate.issue.delete(args);
      },
    ),
  },
});
