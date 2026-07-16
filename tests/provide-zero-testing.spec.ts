import { afterEach, describe, expect, it, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import {
  createBuilder,
  createSchema,
  defineMutators,
  defineMutatorWithType,
  string,
  table,
  Zero,
  type Transaction,
} from '@rocicorp/zero';
import { injectZero } from '../src/inject-zero.js';
import { provideZeroTesting } from '../src/provide-zero-testing.js';
import { ZERO_CONSTRUCTOR, ZERO_INSTANCE_MANAGER } from '../src/instance-manager.js';
import { fakeZeroHarness, provideTestChangeDetection } from './helpers.js';

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

afterEach(() => TestBed.resetTestingModule());

describe('provideZeroTesting', () => {
  it('smoke: real in-mem Zero, mutation + materialize round-trip, closed on reset', async () => {
    TestBed.configureTestingModule({
      providers: [provideTestChangeDetection(), provideZeroTesting({ schema, mutators })],
    });
    const zero = TestBed.runInInjectionContext(() => injectZero());
    const z = zero();
    expect(z).toBeInstanceOf(Zero);

    await z.mutate(mutators.issue.create({ id: 'i1', title: 'hello' })).client;
    const view = z.materialize(builder.issue);
    // toMatchObject: Zero snapshot rows carry an internal refcount symbol.
    expect(view.data).toMatchObject([{ id: 'i1', title: 'hello' }]);
    view.destroy();

    TestBed.resetTestingModule();
    // close() is fired unawaited on destroy; `closed` flips asynchronously.
    await vi.waitFor(() => expect(z.closed).toBe(true));
  });

  it('forces cacheURL/server to null even when smuggled past the type', () => {
    const harness = fakeZeroHarness();
    TestBed.configureTestingModule({
      providers: [
        provideTestChangeDetection(),
        { provide: ZERO_CONSTRUCTOR, useValue: harness.construct },
        provideZeroTesting({
          schema,
          cacheURL: 'http://smuggled',
          server: 'http://smuggled',
        } as never),
      ],
    });
    TestBed.inject(ZERO_INSTANCE_MANAGER);
    expect(harness.latest().options.cacheURL).toBeNull();
    expect(harness.latest().options.server).toBeNull();
  });

  it('defaults kvStore/logLevel but lets the user override them', () => {
    const harness = fakeZeroHarness();
    TestBed.configureTestingModule({
      providers: [
        provideTestChangeDetection(),
        { provide: ZERO_CONSTRUCTOR, useValue: harness.construct },
        provideZeroTesting({ schema, logLevel: 'debug' }),
      ],
    });
    TestBed.inject(ZERO_INSTANCE_MANAGER);
    expect(harness.latest().options.kvStore).toBe('mem'); // defaulted
    expect(harness.latest().options.logLevel).toBe('debug'); // user wins
  });

  it('rejects the forced keys at the type level', () => {
    // @ts-expect-error cacheURL is owned by the preset
    void (() => provideZeroTesting({ schema, cacheURL: 'http://x' }));
    // @ts-expect-error server is owned by the preset
    void (() => provideZeroTesting({ schema, server: 'http://x' }));
  });
});
