import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import {
  createBuilder,
  createSchema,
  defineMutators,
  defineMutatorWithType,
  string,
  table,
  type Transaction,
} from '@rocicorp/zero';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { injectQuery } from '../src/inject-query.js';
import { ZERO_INSTANCE } from '../src/instance-manager.js';
import { provideZeroTesting } from '../src/provide-zero-testing.js';
import { provideTestChangeDetection } from './helpers.js';

const issue = table('issue')
  .columns({ id: string(), title: string() })
  .primaryKey('id');
const schema = createSchema({ tables: [issue] });
const builder = createBuilder(schema);

const defineIssueMutator = defineMutatorWithType<typeof schema>();
const mutators = defineMutators({
  issue: {
    create: defineIssueMutator(
      async ({
        tx,
        args,
      }: {
        tx: Transaction<typeof schema>;
        args: { id: string; title: string };
      }) => {
        await tx.mutate.issue.insert(args);
      },
    ),
  },
});

const QueryHost = Component({ template: '' })(
  class {
    readonly issues = injectQuery(() => builder.issue.orderBy('id', 'asc'));
  },
);

const SwitchingQueryHost = Component({ template: '' })(
  class {
    readonly onlyFirst = signal(false);
    readonly issues = injectQuery(() =>
      this.onlyFirst() ? builder.issue.where('id', 'i1') : builder.issue,
    );
  },
);

const DisableableQueryHost = Component({ template: '' })(
  class {
    readonly enabled = signal(false);
    readonly issues = injectQuery(() => this.enabled() && builder.issue);
  },
);

afterEach(() => {
  TestBed.resetTestingModule();
  vi.restoreAllMocks();
});

function setup(): void {
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  TestBed.configureTestingModule({
    providers: [
      provideTestChangeDetection(),
      provideZeroTesting({ schema, mutators, logSink: { log: () => {} } }),
    ],
  });
}

async function createIssue(id: string, title: string): Promise<void> {
  const zero = TestBed.inject(ZERO_INSTANCE).zeroOrThrow();
  await zero.mutate(mutators.issue.create({ id, title })).client;
}

describe('injectQuery', () => {
  it('hydrates a component field synchronously before any tick and stays live', async () => {
    setup();
    await createIssue('i1', 'first');

    const fixture = TestBed.createComponent(QueryHost);

    expect(fixture.componentInstance.issues.data()).toMatchObject([
      { id: 'i1', title: 'first' },
    ]);

    await createIssue('i2', 'second');
    await vi.waitFor(() =>
      expect(fixture.componentInstance.issues.data()).toMatchObject([
        { id: 'i1', title: 'first' },
        { id: 'i2', title: 'second' },
      ]),
    );
  });

  it('re-materializes once when the semantic query key changes', async () => {
    setup();
    await createIssue('i1', 'first');
    await createIssue('i2', 'second');
    const zero = TestBed.inject(ZERO_INSTANCE).zeroOrThrow();
    const materialize = vi.spyOn(zero, 'materialize');
    const fixture = TestBed.createComponent(SwitchingQueryHost);
    fixture.autoDetectChanges();
    await fixture.whenStable();

    expect(materialize).toHaveBeenCalledTimes(1);
    expect(fixture.componentInstance.issues.data()).toHaveLength(2);

    fixture.componentInstance.onlyFirst.set(true);
    await fixture.whenStable();

    expect(materialize).toHaveBeenCalledTimes(2);
    expect(fixture.componentInstance.issues.data()).toMatchObject([
      { id: 'i1', title: 'first' },
    ]);
  });

  it('resets while disabled and materializes when enabled', async () => {
    setup();
    await createIssue('i1', 'first');
    const fixture = TestBed.createComponent(DisableableQueryHost);
    fixture.autoDetectChanges();
    await fixture.whenStable();

    expect(fixture.componentInstance.issues.data()).toBeUndefined();
    expect(fixture.componentInstance.issues.status()).toBe('disabled');

    fixture.componentInstance.enabled.set(true);
    await fixture.whenStable();

    expect(fixture.componentInstance.issues.data()).toMatchObject([
      { id: 'i1', title: 'first' },
    ]);
  });

  it('throws at inject time when provideZero is missing, naming the fix', () => {
    TestBed.configureTestingModule({ providers: [provideTestChangeDetection()] });

    expect(() =>
      TestBed.runInInjectionContext(() => injectQuery(() => builder.issue)),
    ).toThrow(/\[ngx-zero\].*Add provideZero/s);
  });
});
