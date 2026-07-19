import type { Signal } from '@angular/core';
import { createBuilder, type PullRow } from '@rocicorp/zero';
import {
  injectQuery,
  type QueryStatus,
} from '../../src/index.js';
import { schema } from './default-types-augmentation.js';

type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2
    ? true
    : false;
type Expect<T extends true> = T;

type IssueRow = PullRow<'issue', typeof schema>;
const builder = createBuilder(schema);

const list = injectQuery(() => builder.issue);
export type ListDataInference = Expect<
  Equal<typeof list.data, Signal<IssueRow[]>>
>;
export type EnabledStatusExcludesDisabled = Expect<
  Equal<typeof list.status, Signal<Exclude<QueryStatus, 'disabled'>>>
>;
void list;

const one = injectQuery(() => builder.issue.one());
export type OneDataInference = Expect<
  Equal<typeof one.data, Signal<IssueRow | undefined>>
>;
void one;

declare const enabled: boolean;
const disableable = injectQuery(() => enabled && builder.issue);
export type DisableableDataWidens = Expect<
  Equal<typeof disableable.data, Signal<IssueRow[] | undefined>>
>;
export type DisableableStatusWidens = Expect<
  Equal<typeof disableable.status, Signal<QueryStatus>>
>;
void disableable;

function describeEnabledStatus(status: ReturnType<typeof list.status>): string {
  switch (status) {
    case 'unknown':
      return 'unknown';
    case 'complete':
      return 'complete';
    case 'error':
      return 'error';
  }
}
void describeEnabledStatus;

// @ts-expect-error injectQuery thunks must return a Query or QueryRequest
void injectQuery(() => ({ not: 'a query' }));
