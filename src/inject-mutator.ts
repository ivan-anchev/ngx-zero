import {
  assertInInjectionContext,
  DestroyRef,
  inject,
  Injector,
  untracked,
} from '@angular/core';
import type {
  DefaultContext,
  DefaultSchema,
  DefaultWrappedTransaction,
  MutateRequest,
  Mutator,
  MutatorResult,
  MutatorResultDetails,
  ReadonlyJSONValue,
  Schema,
} from '@rocicorp/zero';
import { ngxZeroError } from './errors.js';
import { ZERO_INSTANCE } from './instance-manager.js';
import { MutatorCallTracker } from './mutator-call-tracker.js';
import type { InjectMutatorOptions, MutatorRef } from './mutator-ref.js';

// Internal-only loose aliases preserve the public overload's exact inference.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyMutatorLeaf = Mutator<ReadonlyJSONValue | undefined, any, any, any>;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyRequest = MutateRequest<any, any, any, any>;

export function injectMutator<
  TInput extends ReadonlyJSONValue | undefined,
  TSchema extends Schema = DefaultSchema,
  TContext = DefaultContext,
  TWrappedTransaction = DefaultWrappedTransaction,
>(
  mutator: Mutator<TInput, TSchema, TContext, TWrappedTransaction>,
  options?: InjectMutatorOptions,
): MutatorRef<TInput>;

export function injectMutator(
  mutator: AnyMutatorLeaf,
  options: InjectMutatorOptions = {},
): MutatorRef<ReadonlyJSONValue | undefined> {
  if (options.injector === undefined) {
    assertInInjectionContext(injectMutator);
  }
  const injector = options.injector ?? inject(Injector);

  const manager = injector.get(ZERO_INSTANCE, null, { optional: true });
  if (!manager) {
    throw ngxZeroError(
      'injectMutator() could not find a Zero instance manager. ' +
        'Add provideZero(...) to your ApplicationConfig providers.',
    );
  }

  const tracker = new MutatorCallTracker();
  injector.get(DestroyRef).onDestroy(() => tracker.destroy());

  const mutate = (args?: ReadonlyJSONValue): MutatorResult => {
    const zero = untracked(() => manager.zeroOrThrow());
    const request = (mutator as (a?: ReadonlyJSONValue) => AnyRequest)(args);
    const raw = zero.mutate(request as Parameters<typeof zero.mutate>[0]);

    const callId = tracker.begin();
    const client = settleSafe(raw.client);
    const server = settleSafe(raw.server);

    client.then(details => tracker.settleClient(callId, details)).catch(noop);
    server.then(details => tracker.settleServer(callId, details)).catch(noop);

    return { client, server };
  };

  return {
    mutate: mutate as MutatorRef<ReadonlyJSONValue | undefined>['mutate'],
    clientPending: tracker.clientPending,
    pending: tracker.pending,
    clientResult: tracker.clientResult,
    serverResult: tracker.serverResult,
    error: tracker.error,
  };
}

function settleSafe(
  promise: Promise<MutatorResultDetails>,
): Promise<MutatorResultDetails> {
  return promise.then(
    details => details,
    (reason: unknown): MutatorResultDetails => ({
      type: 'error',
      error: {
        type: 'zero',
        message: reason instanceof Error ? reason.message : String(reason),
      },
    }),
  );
}

function noop(): void {}
