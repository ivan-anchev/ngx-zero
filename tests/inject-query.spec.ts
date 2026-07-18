import { Component, ErrorHandler, Injector, signal } from '@angular/core';
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

const UnrelatedSignalHost = Component({ template: '' })(
  class {
    readonly pulse = signal(0);
    readonly issues = injectQuery(() => {
      this.pulse();
      return builder.issue.orderBy('id', 'asc');
    });
  },
);

const OneMissHost = Component({ template: '' })(
  class {
    readonly issue = injectQuery(() => builder.issue.where('id', 'missing').one());
  },
);

const BridgingQueryHost = Component({ template: '' })(
  class {
    readonly issues = injectQuery(() => builder.issue.orderBy('id', 'asc'), {
      keepPreviousData: true,
    });
  },
);

const ThrowingThunkHost = Component({ template: '' })(
  class {
    readonly explode = signal(false);
    readonly issues = injectQuery(() => {
      if (this.explode()) {
        throw new Error('thunk boom');
      }
      return builder.issue.orderBy('id', 'asc');
    });
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

function setupWithUser(): { user: ReturnType<typeof signal<string>> } {
  const user = signal('u1');
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  TestBed.configureTestingModule({
    providers: [
      provideTestChangeDetection(),
      provideZeroTesting(() => ({
        schema,
        mutators,
        userID: user(),
        logSink: { log: () => {} },
      })),
    ],
  });
  return { user };
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

  it('does not re-materialize when an unrelated signal reruns a key-equivalent thunk', async () => {
    setup();
    await createIssue('i1', 'first');
    const zero = TestBed.inject(ZERO_INSTANCE).zeroOrThrow();
    const materialize = vi.spyOn(zero, 'materialize');
    const fixture = TestBed.createComponent(UnrelatedSignalHost);
    fixture.autoDetectChanges();
    await fixture.whenStable();

    expect(materialize).toHaveBeenCalledTimes(1);

    fixture.componentInstance.pulse.set(1);
    await fixture.whenStable();

    expect(materialize).toHaveBeenCalledTimes(1);
    expect(fixture.componentInstance.issues.data()).toMatchObject([{ id: 'i1' }]);
  });

  it('distinguishes a one() miss from a disabled query by status', async () => {
    setup();
    await createIssue('i1', 'first');
    const missFixture = TestBed.createComponent(OneMissHost);
    missFixture.autoDetectChanges();
    await missFixture.whenStable();

    // Local-only Zero never receives the server's got-confirmation, so a miss
    // reports 'unknown'; the 'complete' miss is pinned in the controller spec.
    expect(missFixture.componentInstance.issue.data()).toBeUndefined();
    expect(missFixture.componentInstance.issue.status()).toBe('unknown');

    const disabledFixture = TestBed.createComponent(DisableableQueryHost);
    disabledFixture.autoDetectChanges();
    await disabledFixture.whenStable();

    expect(disabledFixture.componentInstance.issues.data()).toBeUndefined();
    expect(disabledFixture.componentInstance.issues.status()).toBe('disabled');
  });

  it('hard-resets on instance swap and never serves the old user rows despite keepPreviousData', async () => {
    const { user } = setupWithUser();
    await createIssue('i1', 'first');
    const firstZero = TestBed.inject(ZERO_INSTANCE).zeroOrThrow();
    const fixture = TestBed.createComponent(BridgingQueryHost);
    fixture.autoDetectChanges();
    await fixture.whenStable();
    expect(fixture.componentInstance.issues.data()).toMatchObject([{ id: 'i1' }]);

    user.set('u2');
    await fixture.whenStable();

    expect(TestBed.inject(ZERO_INSTANCE).zeroOrThrow()).not.toBe(firstZero);
    expect(fixture.componentInstance.issues.data()).toEqual([]);

    await createIssue('i2', 'second');
    await vi.waitFor(() =>
      expect(fixture.componentInstance.issues.data()).toMatchObject([{ id: 'i2' }]),
    );
  });

  it('stays disabled across an instance swap and enables against the current instance', async () => {
    const { user } = setupWithUser();
    await createIssue('i1', 'first');
    const fixture = TestBed.createComponent(DisableableQueryHost);
    fixture.autoDetectChanges();
    await fixture.whenStable();
    expect(fixture.componentInstance.issues.status()).toBe('disabled');

    user.set('u2');
    await fixture.whenStable();
    expect(fixture.componentInstance.issues.status()).toBe('disabled');
    expect(fixture.componentInstance.issues.data()).toBeUndefined();

    await createIssue('i2', 'second');
    fixture.componentInstance.enabled.set(true);
    await fixture.whenStable();

    expect(fixture.componentInstance.issues.data()).toMatchObject([{ id: 'i2' }]);
  });

  it('propagates an initial thunk throw without leaving a live view behind', async () => {
    setup();
    await createIssue('i1', 'first');
    const zero = TestBed.inject(ZERO_INSTANCE).zeroOrThrow();
    const materialize = vi.spyOn(zero, 'materialize');

    expect(() =>
      TestBed.runInInjectionContext(() =>
        injectQuery((): ReturnType<typeof builder.issue.one> => {
          throw new Error('thunk boom');
        }),
      ),
    ).toThrow(/thunk boom/);
    expect(materialize).not.toHaveBeenCalled();
  });

  it('routes a later thunk throw to ErrorHandler and keeps the prior view alive', async () => {
    const errors: unknown[] = [];
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    TestBed.configureTestingModule({
      rethrowApplicationErrors: false,
      providers: [
        provideTestChangeDetection(),
        provideZeroTesting({ schema, mutators, logSink: { log: () => {} } }),
        {
          provide: ErrorHandler,
          useValue: { handleError: (error: unknown) => errors.push(error) },
        },
      ],
    });
    await createIssue('i1', 'first');
    const fixture = TestBed.createComponent(ThrowingThunkHost);
    fixture.autoDetectChanges();
    await fixture.whenStable();
    expect(fixture.componentInstance.issues.data()).toMatchObject([{ id: 'i1' }]);

    fixture.componentInstance.explode.set(true);
    await fixture.whenStable();

    expect(errors.some(error => /thunk boom/.test(String(error)))).toBe(true);
    expect(fixture.componentInstance.issues.data()).toMatchObject([{ id: 'i1' }]);

    await createIssue('i2', 'second');
    await vi.waitFor(() =>
      expect(fixture.componentInstance.issues.data()).toHaveLength(2),
    );
  });

  it('works outside an injection context with an explicit { injector }', async () => {
    setup();
    await createIssue('i1', 'first');

    const issues = injectQuery(() => builder.issue.orderBy('id', 'asc'), {
      injector: TestBed.inject(Injector),
    });

    expect(issues.data()).toMatchObject([{ id: 'i1' }]);
  });

  it('throws the CIF assertion outside an injection context without { injector }', () => {
    setup();
    expect(() => injectQuery(() => builder.issue)).toThrow(/injection context/);
  });

  it('makes captured ref methods safe no-ops after host destruction', async () => {
    setup();
    await createIssue('i1', 'first');
    const zero = TestBed.inject(ZERO_INSTANCE).zeroOrThrow();
    const fixture = TestBed.createComponent(QueryHost);
    fixture.autoDetectChanges();
    await fixture.whenStable();
    const issues = fixture.componentInstance.issues;
    const materialize = vi.spyOn(zero, 'materialize');

    fixture.destroy();

    expect(() => {
      issues.retry();
      issues.updateTTL(60);
    }).not.toThrow();
    expect(materialize).not.toHaveBeenCalled();
    expect(issues.data()).toMatchObject([{ id: 'i1' }]);
  });

  it('throws at inject time when provideZero is missing, naming the fix', () => {
    TestBed.configureTestingModule({ providers: [provideTestChangeDetection()] });

    expect(() =>
      TestBed.runInInjectionContext(() => injectQuery(() => builder.issue)),
    ).toThrow(/\[ngx-zero\].*Add provideZero/s);
  });
});
