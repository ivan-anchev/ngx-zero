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

// The public overload above owns all typing; upstream keeps its loose
// `AnyMutator` alias private, so the implementation takes the leaf as
// `unknown` and casts it once at the zero.mutate boundary.
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
    // Resolve the CURRENT instance at each call (it is replaceable).
    // `untracked` so a mutate() inside an effect never subscribes it to
    // instance changes.
    const zero = untracked(() => manager.zeroOrThrow());

    // Calling the leaf only builds the request zero.mutate executes.
    const buildRequest = mutator as (
      args?: ReadonlyJSONValue,
    ) => Parameters<typeof zero.mutate>[0];

    // zero.mutate throws synchronously for an unregistered mutator; begin()
    // comes after so a setup error never masquerades as a pending call.
    const raw = zero.mutate(buildRequest(args));
    const callId = tracker.begin();

    // Never-reject boundary. The signals ride the SAME normalized promises
    // the caller receives, so the awaited view and the signal view can never
    // disagree; catch(noop) keeps a hypothetical tracker throw from becoming
    // an unhandled rejection.
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

/** Pass resolved details through; map any rejection into Zero's own
 *  zero-error details shape (one vocabulary regardless of failing layer). */
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
