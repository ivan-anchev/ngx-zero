import { afterEach, describe, expect, it, vi } from 'vitest';
import { signal } from '@angular/core';
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
  type ZeroOptions,
} from '@rocicorp/zero';
import { injectZero } from '../src/inject-zero.js';
import { provideZeroTesting } from '../src/provide-zero-testing.js';
import { ZERO_CONSTRUCTOR, ZERO_INSTANCE } from '../src/instance-manager.js';
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

afterEach(() => {
  TestBed.resetTestingModule();
  vi.restoreAllMocks();
});

describe('provideZeroTesting', () => {
  it('smoke: real in-mem Zero, mutation + materialize round-trip, closed on reset', async () => {
    // Noise control, both expected and harmless here: Zero console.warns
    // "starting up with no server URL" (raw console, bypasses logSink) and
    // logs an error when close() settles the mutation's never-resolving
    // .server promise. Spy restored by afterEach.
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const logSink = { log: () => {} };
    TestBed.configureTestingModule({
      providers: [provideTestChangeDetection(), provideZeroTesting({ schema, mutators, logSink })],
    });
    const zero = TestBed.runInInjectionContext(() => injectZero());
    TestBed.tick();
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
    TestBed.inject(ZERO_INSTANCE);
    TestBed.tick();
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
    TestBed.inject(ZERO_INSTANCE);
    TestBed.tick();
    expect(harness.latest().options.kvStore).toBe('mem'); // defaulted
    expect(harness.latest().options.logLevel).toBe('debug'); // user wins
  });

  it('honors a custom kvStore StoreProvider (passed through by identity)', () => {
    const harness = fakeZeroHarness();
    const customStore = {
      create: () => {
        throw new Error('unused in this test');
      },
      drop: () => Promise.resolve(),
    } as unknown as NonNullable<ZeroOptions['kvStore']>;
    TestBed.configureTestingModule({
      providers: [
        provideTestChangeDetection(),
        { provide: ZERO_CONSTRUCTOR, useValue: harness.construct },
        provideZeroTesting({ schema, kvStore: customStore }),
      ],
    });
    TestBed.inject(ZERO_INSTANCE);
    TestBed.tick();
    expect(harness.latest().options.kvStore).toBe(customStore); // user wins over 'mem'
  });

  it('preserves factory reactivity: a signal change reconciles through the preset', () => {
    const harness = fakeZeroHarness();
    const userID = signal('u1');
    TestBed.configureTestingModule({
      providers: [
        provideTestChangeDetection(),
        { provide: ZERO_CONSTRUCTOR, useValue: harness.construct },
        provideZeroTesting(() => ({ schema, userID: userID() })),
      ],
    });
    TestBed.inject(ZERO_INSTANCE);
    TestBed.tick();
    expect(harness.created).toHaveLength(1);

    userID.set('u2');
    TestBed.tick();
    expect(harness.created).toHaveLength(2);
    expect(harness.latest().options.userID).toBe('u2');
    expect(harness.latest().options.cacheURL).toBeNull(); // forced keys survive reruns
  });

  it('rejects the forced keys at the type level', () => {
    // @ts-expect-error cacheURL is owned by the preset
    void (() => provideZeroTesting({ schema, cacheURL: 'http://x' }));
    // @ts-expect-error server is owned by the preset
    void (() => provideZeroTesting({ schema, server: 'http://x' }));
  });
});
