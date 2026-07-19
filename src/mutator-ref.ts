import type { Injector, Signal } from '@angular/core';
import type {
  MutatorResult,
  MutatorResultDetails,
  MutatorResultErrorDetails,
  ReadonlyJSONValue,
} from '@rocicorp/zero';

/** Error payload of a failed mutation phase. */
export type MutatorError = MutatorResultErrorDetails['error'];

/** Zero's (unexported) MutatorCallable parameter shape as a tuple. */
export type MutatorArgs<TInput extends ReadonlyJSONValue | undefined> =
  [TInput] extends [undefined]
    ? []
    : undefined extends TInput
      ? [args?: TInput]
      : [args: TInput];

/** Bound mutate() plus signals projecting the latest call's lifecycle. */
export interface MutatorRef<TInput extends ReadonlyJSONValue | undefined> {
  /**
   * Returned client/server promises never reject — rejections normalize to
   * {type:'error', error:{type:'zero', message}}. Throws synchronously
   * (state untouched) for setup errors. Safe to destructure.
   */
  mutate(...args: MutatorArgs<TInput>): MutatorResult;

  /** True from mutate() until the latest call's optimistic apply settles. */
  readonly clientPending: Signal<boolean>;
  /**
   * True from mutate() until the latest call's server outcome settles.
   * Never settles on a local-only instance (cacheURL: null).
   */
  readonly pending: Signal<boolean>;
  /** Latest call's optimistic outcome; undefined while idle or in flight. */
  readonly clientResult: Signal<MutatorResultDetails | undefined>;
  /** Latest call's authoritative outcome; undefined while idle or unconfirmed. */
  readonly serverResult: Signal<MutatorResultDetails | undefined>;
  /** Client error, else server error (rollback); cleared by next mutate(). */
  readonly error: Signal<MutatorError | undefined>;
}

export interface InjectMutatorOptions {
  /** Resolve dependencies from an explicit injection context. */
  injector?: Injector;
}
