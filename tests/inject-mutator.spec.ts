import { Component, ErrorHandler, Injector, signal } from '@angular/core';
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
import { ZERO_CONSTRUCTOR, ZERO_INSTANCE } from '../src/instance-manager.js';
import { provideZero } from '../src/provide-zero.js';
import { provideZeroTesting } from '../src/provide-zero-testing.js';
import { provideTestChangeDetection, zeroOptions } from './helpers.js';

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
    fail: defineIssueMutator(
      async ({ args }: { tx: Transaction<typeof schema>; args: { reason: string } }) => {
        throw new Error(args.reason);
      },
    ),
  },
});

/** Deliberately NOT registered with any Zero instance in this suite. */
const orphanMutators = defineMutators({
  issue: {
    remove: defineIssueMutator(
      async ({ tx, args }: { tx: Transaction<typeof schema>; args: { id: string } }) => {
        await tx.mutate.issue.delete(args);
      },
    ),
  },
});

const TemplateHost = Component({
  template:
    '{{ createIssue.pending() ? "pending" : "idle" }}:{{ createIssue.error()?.message ?? "none" }}',
})(
  class {
    readonly createIssue = injectMutator(mutators.issue.create);
  },
);

const MutatorHost = Component({ template: '' })(
  class {
    readonly createIssue = injectMutator(mutators.issue.create);
    readonly failIssue = injectMutator(mutators.issue.fail);
    readonly orphanRemove = injectMutator(orphanMutators.issue.remove);
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

interface ControlledCall {
  readonly client: ReturnType<typeof deferred<MutatorResultDetails>>;
  readonly server: ReturnType<typeof deferred<MutatorResultDetails>>;
}

interface ControlledZero {
  readonly zero: Zero;
  readonly calls: readonly ControlledCall[];
  readonly requests: unknown[];
}

/** Minimal external Zero whose per-call client/server promises settle manually. */
function controlledZero(expectedCalls: number): ControlledZero {
  const calls = Array.from({ length: expectedCalls }, () => ({
    client: deferred<MutatorResultDetails>(),
    server: deferred<MutatorResultDetails>(),
  }));
  const requests: unknown[] = [];
  const zero = {
    mutate: (request: unknown) => {
      const call = calls[requests.length];
      if (call === undefined) {
        throw new Error('controlledZero: unexpected extra mutate() call');
      }
      requests.push(request);
      return { client: call.client.promise, server: call.server.promise };
    },
  } as unknown as Zero;
  return { zero, calls, requests };
}

const serverRejection = {
  type: 'error',
  error: { type: 'app', message: 'server said no', details: undefined },
} as const satisfies MutatorResultDetails;

afterEach(() => {
  TestBed.resetTestingModule();
  vi.restoreAllMocks();
});

function setupRealZero(): void {
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  TestBed.configureTestingModule({
    providers: [
      provideTestChangeDetection(),
      provideZeroTesting({ schema, mutators, logSink: { log: () => {} } }),
    ],
  });
}

describe('injectMutator', () => {
  it('runs a registry mutator and projects its optimistic lifecycle', async () => {
    setupRealZero();
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

  it('resolves a throwing recipe to an app error instead of rejecting', async () => {
    setupRealZero();
    const fixture = TestBed.createComponent(MutatorHost);
    const ref = fixture.componentInstance.failIssue;

    const result = ref.mutate({ reason: 'recipe boom' });

    await expect(result.client).resolves.toMatchObject({
      type: 'error',
      error: { type: 'app', message: 'recipe boom' },
    });
    expect(ref.clientPending()).toBe(false);
    expect(ref.clientResult()).toMatchObject({ type: 'error' });
    expect(ref.error()).toMatchObject({ type: 'app', message: 'recipe boom' });
  });

  it('atomically clears the previous error when the next call begins', async () => {
    setupRealZero();
    const fixture = TestBed.createComponent(MutatorHost);

    await fixture.componentInstance.failIssue.mutate({ reason: 'first boom' }).client;
    expect(fixture.componentInstance.failIssue.error()).toBeDefined();

    const ref = fixture.componentInstance.failIssue;
    const result = ref.mutate({ reason: 'second boom' });
    expect(ref.clientPending()).toBe(true);
    expect(ref.pending()).toBe(true);
    expect(ref.clientResult()).toBeUndefined();
    expect(ref.serverResult()).toBeUndefined();
    expect(ref.error()).toBeUndefined();

    await expect(result.client).resolves.toMatchObject({
      type: 'error',
      error: { message: 'second boom' },
    });
  });

  it('throws synchronously for an unregistered mutator and leaves state untouched', () => {
    setupRealZero();
    const fixture = TestBed.createComponent(MutatorHost);
    const ref = fixture.componentInstance.orphanRemove;

    expect(() => ref.mutate({ id: 'i1' })).toThrow(/not registered/);

    expect(ref.clientPending()).toBe(false);
    expect(ref.pending()).toBe(false);
    expect(ref.clientResult()).toBeUndefined();
    expect(ref.serverResult()).toBeUndefined();
    expect(ref.error()).toBeUndefined();
  });

  it('works outside an injection context with an explicit { injector }', async () => {
    setupRealZero();

    const ref = injectMutator(mutators.issue.create, {
      injector: TestBed.inject(Injector),
    });

    await expect(ref.mutate({ id: 'i1', title: 'explicit' }).client).resolves.toEqual({
      type: 'success',
    });
    expect(ref.clientResult()).toEqual({ type: 'success' });
  });

  it('throws the CIF assertion outside an injection context without { injector }', () => {
    setupRealZero();
    expect(() => injectMutator(mutators.issue.create)).toThrow(/injection context/);
  });

  it('throws at inject time when provideZero is missing, naming the fix', () => {
    TestBed.configureTestingModule({ providers: [provideTestChangeDetection()] });

    expect(() =>
      TestBed.runInInjectionContext(() => injectMutator(mutators.issue.create)),
    ).toThrow(/\[ngx-zero\].*Add provideZero/s);
  });

  it('throws at mutate time when instance construction failed, leaving state idle', () => {
    const errors: unknown[] = [];
    TestBed.configureTestingModule({
      providers: [
        provideTestChangeDetection(),
        provideZero(zeroOptions()),
        {
          provide: ZERO_CONSTRUCTOR,
          useValue: () => {
            throw new Error('constructor boom');
          },
        },
        {
          provide: ErrorHandler,
          useValue: { handleError: (error: unknown) => errors.push(error) },
        },
      ],
    });
    const fixture = TestBed.createComponent(MutatorHost);
    const ref = fixture.componentInstance.createIssue;
    expect(errors.some(error => /constructor boom/.test(String(error)))).toBe(true);

    expect(() => ref.mutate({ id: 'i1', title: 'no instance' })).toThrow(
      /Zero instance not found/,
    );
    expect(ref.clientPending()).toBe(false);
    expect(ref.pending()).toBe(false);
    expect(ref.error()).toBeUndefined();
  });

  it('normalizes rejected mutation promises into Zero error details', async () => {
    const controlled = controlledZero(1);
    TestBed.configureTestingModule({
      providers: [provideTestChangeDetection(), provideZero({ zero: controlled.zero })],
    });
    const fixture = TestBed.createComponent(MutatorHost);
    const ref = fixture.componentInstance.createIssue;

    const result = ref.mutate({ id: 'i1', title: 'hello' });
    const request = controlled.requests[0] as {
      mutator: { readonly mutatorName: string };
      args: unknown;
    };
    expect(request.mutator.mutatorName).toBe('issue.create');
    expect(request.args).toEqual({ id: 'i1', title: 'hello' });

    controlled.calls[0].client.reject(new Error('client offline'));
    controlled.calls[0].server.reject('server offline');

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

  it('projects a client success followed by a server rollback in order', async () => {
    const controlled = controlledZero(1);
    TestBed.configureTestingModule({
      providers: [provideTestChangeDetection(), provideZero({ zero: controlled.zero })],
    });
    const fixture = TestBed.createComponent(MutatorHost);
    const ref = fixture.componentInstance.createIssue;

    const result = ref.mutate({ id: 'i1', title: 'rollback' });

    controlled.calls[0].client.resolve({ type: 'success' });
    await expect(result.client).resolves.toEqual({ type: 'success' });
    expect(ref.clientPending()).toBe(false);
    expect(ref.clientResult()).toEqual({ type: 'success' });
    expect(ref.pending()).toBe(true);
    expect(ref.serverResult()).toBeUndefined();
    expect(ref.error()).toBeUndefined();

    controlled.calls[0].server.resolve(serverRejection);
    await expect(result.server).resolves.toEqual(serverRejection);
    expect(ref.pending()).toBe(false);
    expect(ref.serverResult()).toEqual(serverRejection);
    expect(ref.error()).toEqual(serverRejection.error);
  });

  it('keeps signals on the latest call while a superseded call settles late', async () => {
    const controlled = controlledZero(2);
    TestBed.configureTestingModule({
      providers: [provideTestChangeDetection(), provideZero({ zero: controlled.zero })],
    });
    const fixture = TestBed.createComponent(MutatorHost);
    const ref = fixture.componentInstance.createIssue;

    const first = ref.mutate({ id: 'i1', title: 'first' });
    const second = ref.mutate({ id: 'i2', title: 'second' });

    controlled.calls[0].client.resolve({ type: 'success' });
    controlled.calls[0].server.resolve(serverRejection);
    await expect(first.client).resolves.toEqual({ type: 'success' });
    await expect(first.server).resolves.toEqual(serverRejection);

    expect(ref.clientPending()).toBe(true);
    expect(ref.pending()).toBe(true);
    expect(ref.clientResult()).toBeUndefined();
    expect(ref.serverResult()).toBeUndefined();
    expect(ref.error()).toBeUndefined();

    controlled.calls[1].client.resolve({ type: 'success' });
    await expect(second.client).resolves.toEqual({ type: 'success' });
    expect(ref.clientPending()).toBe(false);
    expect(ref.clientResult()).toEqual({ type: 'success' });
    expect(ref.pending()).toBe(true);
  });

  it('routes each call to the current instance across rotation while in-flight settles land', async () => {
    const first = controlledZero(1);
    const second = controlledZero(1);
    const current = signal(first.zero);
    TestBed.configureTestingModule({
      providers: [
        provideTestChangeDetection(),
        provideZero(() => ({ zero: current() })),
      ],
    });
    const fixture = TestBed.createComponent(MutatorHost);
    fixture.autoDetectChanges();
    await fixture.whenStable();
    const ref = fixture.componentInstance.createIssue;

    const inFlight = ref.mutate({ id: 'i1', title: 'on first' });
    expect(first.requests).toHaveLength(1);

    current.set(second.zero);
    await fixture.whenStable();

    first.calls[0].client.resolve({ type: 'success' });
    await expect(inFlight.client).resolves.toEqual({ type: 'success' });
    expect(ref.clientResult()).toEqual({ type: 'success' });

    const next = ref.mutate({ id: 'i2', title: 'on second' });
    expect(second.requests).toHaveLength(1);
    expect(first.requests).toHaveLength(1);
    expect(ref.clientPending()).toBe(true);
    expect(ref.clientResult()).toBeUndefined();

    second.calls[0].client.resolve({ type: 'success' });
    await expect(next.client).resolves.toEqual({ type: 'success' });
    expect(ref.clientResult()).toEqual({ type: 'success' });
  });

  it('freezes signals after host destroy while awaited results still resolve', async () => {
    const controlled = controlledZero(2);
    TestBed.configureTestingModule({
      providers: [provideTestChangeDetection(), provideZero({ zero: controlled.zero })],
    });
    const fixture = TestBed.createComponent(MutatorHost);
    const ref = fixture.componentInstance.createIssue;

    const result = ref.mutate({ id: 'i1', title: 'in flight' });
    fixture.destroy();

    controlled.calls[0].client.resolve({ type: 'success' });
    controlled.calls[0].server.resolve(serverRejection);
    await expect(result.client).resolves.toEqual({ type: 'success' });
    await expect(result.server).resolves.toEqual(serverRejection);

    expect(ref.clientPending()).toBe(true);
    expect(ref.pending()).toBe(true);
    expect(ref.clientResult()).toBeUndefined();
    expect(ref.serverResult()).toBeUndefined();
    expect(ref.error()).toBeUndefined();

    const late = ref.mutate({ id: 'i2', title: 'after destroy' });
    expect(controlled.requests).toHaveLength(2);
    controlled.calls[1].client.reject(new Error('late failure'));
    await expect(late.client).resolves.toEqual({
      type: 'error',
      error: { type: 'zero', message: 'late failure' },
    });
    expect(ref.clientPending()).toBe(true);
    expect(ref.clientResult()).toBeUndefined();
  });

  it('re-renders a host template from mutation lifecycle signal writes', async () => {
    const controlled = controlledZero(1);
    TestBed.configureTestingModule({
      providers: [provideTestChangeDetection(), provideZero({ zero: controlled.zero })],
    });
    const fixture = TestBed.createComponent(TemplateHost);
    fixture.autoDetectChanges();
    await fixture.whenStable();
    const text = (): string | null =>
      (fixture.nativeElement as HTMLElement).textContent;
    expect(text()).toBe('idle:none');

    fixture.componentInstance.createIssue.mutate({ id: 'i1', title: 'render' });
    await fixture.whenStable();
    expect(text()).toBe('pending:none');

    controlled.calls[0].client.resolve({ type: 'success' });
    controlled.calls[0].server.resolve(serverRejection);
    await vi.waitFor(() => expect(text()).toBe('idle:server said no'));
  });

  it('never leaks unhandled rejections from ignored mutate() results', async () => {
    const leaks: unknown[] = [];
    const onLeak = (reason: unknown): void => {
      leaks.push(reason);
    };
    process.on('unhandledRejection', onLeak);
    try {
      const controlled = controlledZero(1);
      TestBed.configureTestingModule({
        providers: [provideTestChangeDetection(), provideZero({ zero: controlled.zero })],
      });
      const fixture = TestBed.createComponent(MutatorHost);

      fixture.componentInstance.createIssue.mutate({ id: 'i1', title: 'ignored' });
      controlled.calls[0].client.reject(new Error('client leak'));
      controlled.calls[0].server.reject(new Error('server leak'));
      await new Promise(resolve => setTimeout(resolve, 10));

      expect(leaks).toEqual([]);
      expect(fixture.componentInstance.createIssue.error()).toEqual({
        type: 'zero',
        message: 'client leak',
      });
    } finally {
      process.off('unhandledRejection', onLeak);
    }
  });
});
