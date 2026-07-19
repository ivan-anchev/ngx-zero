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

export function injectMutator<
  TInput extends ReadonlyJSONValue | undefined,
  TSchema extends Schema = DefaultSchema,
  TContext = DefaultContext,
  TWrappedTransaction = DefaultWrappedTransaction,
>(
  mutator: Mutator<TInput, TSchema, TContext, TWrappedTransaction>,
  options?: InjectMutatorOptions,
): MutatorRef<TInput>;

// Upstream's AnyMutator alias is private — take the leaf as `unknown`,
// cast once at the zero.mutate boundary.
export function injectMutator(
  mutator: unknown,
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
    // untracked: a mutate() inside an effect must not subscribe it to
    // instance changes.
    const zero = untracked(() => manager.zeroOrThrow());

    const buildRequest = mutator as (
      args?: ReadonlyJSONValue,
    ) => Parameters<typeof zero.mutate>[0];

    // begin() after zero.mutate: its sync throw (unregistered mutator) must
    // not leave a fake pending call.
    const raw = zero.mutate(buildRequest(args));
    const callId = tracker.begin();

    const client = settleSafe(raw.client);
    const server = settleSafe(raw.server);
    client.then(details => tracker.settleClient(callId, details)).catch(noop);
    server.then(details => tracker.settleServer(callId, details)).catch(noop);

    return { client, server };
  };

  return {
    mutate,
    clientPending: tracker.clientPending,
    pending: tracker.pending,
    clientResult: tracker.clientResult,
    serverResult: tracker.serverResult,
    error: tracker.error,
  };
}

/** Never-reject boundary: rejections become Zero's own error details shape. */
function settleSafe(
  promise: Promise<MutatorResultDetails>,
): Promise<MutatorResultDetails> {
  return promise.catch(
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
