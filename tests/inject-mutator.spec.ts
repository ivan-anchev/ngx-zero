import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import {
  createBuilder,
  createSchema,
  defineMutators,
  defineMutatorWithType,
  string,
  table,
  type MutatorResultDetails,
  type Transaction,
  type Zero,
} from '@rocicorp/zero';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { injectMutator } from '../src/inject-mutator.js';
import { ZERO_INSTANCE } from '../src/instance-manager.js';
import { provideZero } from '../src/provide-zero.js';
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

const MutatorHost = Component({ template: '' })(
  class {
    readonly createIssue = injectMutator(mutators.issue.create);
  },
);

function deferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason: unknown) => void;
} {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

afterEach(() => {
  TestBed.resetTestingModule();
  vi.restoreAllMocks();
});

describe('injectMutator', () => {
  it('runs a registry mutator and projects its optimistic lifecycle', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    TestBed.configureTestingModule({
      providers: [
        provideTestChangeDetection(),
        provideZeroTesting({
          schema,
          mutators,
          logSink: { log: () => {} },
        }),
      ],
    });
    const fixture = TestBed.createComponent(MutatorHost);
    const ref = fixture.componentInstance.createIssue;

    expect(ref.clientPending()).toBe(false);
    expect(ref.pending()).toBe(false);
    expect(ref.clientResult()).toBeUndefined();
    expect(ref.serverResult()).toBeUndefined();
    expect(ref.error()).toBeUndefined();

    const result = ref.mutate({ id: 'i1', title: 'hello' });
    expect(ref.clientPending()).toBe(true);
    expect(ref.pending()).toBe(true);

    await expect(result.client).resolves.toEqual({ type: 'success' });
    expect(ref.clientPending()).toBe(false);
    expect(ref.pending()).toBe(true);
    expect(ref.clientResult()).toEqual({ type: 'success' });
    expect(ref.serverResult()).toBeUndefined();
    expect(ref.error()).toBeUndefined();

    const zero = TestBed.inject(ZERO_INSTANCE).zeroOrThrow();
    const view = zero.materialize(builder.issue);
    expect(view.data).toMatchObject([{ id: 'i1', title: 'hello' }]);
    view.destroy();
  });

  it('normalizes rejected mutation promises into Zero error details', async () => {
    const client = deferred<MutatorResultDetails>();
    const server = deferred<MutatorResultDetails>();
    const requests: unknown[] = [];
    const zero = {
      mutate: (request: unknown) => {
        requests.push(request);
        return { client: client.promise, server: server.promise };
      },
    } as unknown as Zero;
    TestBed.configureTestingModule({
      providers: [provideTestChangeDetection(), provideZero({ zero })],
    });
    const fixture = TestBed.createComponent(MutatorHost);
    const ref = fixture.componentInstance.createIssue;

    const result = ref.mutate({ id: 'i1', title: 'hello' });
    const request = requests[0] as {
      mutator: { readonly mutatorName: string };
      args: unknown;
    };
    expect(request.mutator.mutatorName).toBe('issue.create');
    expect(request.args).toEqual({ id: 'i1', title: 'hello' });

    client.reject(new Error('client offline'));
    server.reject('server offline');

    await expect(result.client).resolves.toEqual({
      type: 'error',
      error: { type: 'zero', message: 'client offline' },
    });
    await expect(result.server).resolves.toEqual({
      type: 'error',
      error: { type: 'zero', message: 'server offline' },
    });
    expect(ref.clientPending()).toBe(false);
    expect(ref.pending()).toBe(false);
    expect(ref.error()).toEqual({ type: 'zero', message: 'client offline' });
  });
});
