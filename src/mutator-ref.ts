import type { Injector, Signal } from '@angular/core';
import type {
  MutatorResult,
  MutatorResultDetails,
  MutatorResultErrorDetails,
  ReadonlyJSONValue,
} from '@rocicorp/zero';

/**
 * Error payload of a failed mutation phase. Derived from Zero's own
 * MutatorResultErrorDetails so upstream shape changes surface as type errors.
 */
export type MutatorError = MutatorResultErrorDetails['error'];

/**
 * Reconstruction of Zero's (unexported) MutatorCallable parameter shape as a
 * tuple: TInput = undefined → mutate(); undefined ∈ TInput → mutate(args?);
 * else mutate(args). `[TInput] extends [undefined]` (non-distributive) is
 * copied verbatim from upstream's conditional.
 */
export type MutatorArgs<TInput extends ReadonlyJSONValue | undefined> =
  [TInput] extends [undefined]
    ? []
    : undefined extends TInput
      ? [args?: TInput]
      : [args: TInput];

/**
 * Stateful ref over one registry mutator: bound mutate() plus readonly signals
 * projecting the LATEST call's lifecycle (latest-call-wins; earlier calls'
 * awaited results unaffected). Only TInput is generic — MutatorResult is
 * schema-untyped upstream, extra generics would be dead weight.
 */
export interface MutatorRef<TInput extends ReadonlyJSONValue | undefined> {
  /**
   * Execute against the CURRENT Zero instance (resolved at call time).
   * Returns a MutatorResult whose client/server promises are GUARANTEED to
   * resolve — rejections are normalized to
   * {type:'error', error:{type:'zero', message}}. Fire-and-forget can never
   * produce unhandled rejections. Throws synchronously (state untouched) for
   * setup errors: no instance yet, or mutator not registered.
   * Implemented as a captured closure — safe to destructure.
   */
  mutate(...args: MutatorArgs<TInput>): MutatorResult;

  /** True from mutate() until the latest call's optimistic apply settles. */
  readonly clientPending: Signal<boolean>;
  /**
   * True from mutate() until the latest call's server outcome settles.
   * NOTE: on a local-only instance (cacheURL: null / provideZeroTesting) the
   * server promise never settles, so this stays true — honest; local-only
   * consumers key off clientPending/clientResult.
   */
  readonly pending: Signal<boolean>;
  /** Latest call's optimistic outcome; undefined while idle or in flight. */
  readonly clientResult: Signal<MutatorResultDetails | undefined>;
  /** Latest call's authoritative outcome; undefined while idle or unconfirmed. */
  readonly serverResult: Signal<MutatorResultDetails | undefined>;
  /**
   * Client error if the optimistic phase failed, else the server error
   * (rollback case: client success → server error). Cleared by next mutate().
   */
  readonly error: Signal<MutatorError | undefined>;
}

export interface InjectMutatorOptions {
  /** Resolve dependencies from an explicit injection context. */
  injector?: Injector;
}
