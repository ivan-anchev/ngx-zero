/** Shared pure helpers. No Angular imports; Zero types only. */
import type { ZeroOptions } from '@rocicorp/zero';

/**
 * Outcome of a `tryCatch` call. Checking `error` narrows: when it is defined,
 * `result` is `never`, and vice versa.
 */
export type Result<T> = { result: T; error?: never } | { result?: never; error: Error };

/**
 * Runs a function and returns its outcome as a `Result` instead of throwing.
 * The result type is inferred from the function; an async function (or one
 * returning a promise) yields a `Promise<Result<T>>` whose rejection is
 * captured the same way — `await tryCatch(...)` never throws. Non-Error throws
 * are wrapped in an `Error` (original value on `cause`) so `error` stays a
 * narrowable, concrete type.
 */
export function tryCatch(fn: () => never): Result<never>;
export function tryCatch<T>(fn: () => Promise<T>): Promise<Result<T>>;
export function tryCatch<T>(fn: () => T): Result<T>;
export function tryCatch<T>(fn: () => T | Promise<T>): Result<T> | Promise<Result<T>> {
  try {
    const value = fn();
    
    if (isThenable(value)) {
      return Promise.resolve(value).then(
        result => ({ result }),
        thrown => ({ error: toError(thrown) }),
      );
    }
    return { result: value };
  } catch (thrown) {
    return { error: toError(thrown) };
  }
}

function toError(thrown: unknown): Error {
  return thrown instanceof Error ? thrown : new Error(String(thrown), { cause: thrown });
}

/**
 * Duck-typed on purpose: `instanceof Promise` misses native promises when
 * zone.js has replaced the global `Promise` with `ZoneAwarePromise`.
 */
function isThenable(value: unknown): value is PromiseLike<unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { then?: unknown }).then === 'function'
  );
}

/**
 * `Object.is` plus one-level shallow comparison for plain arrays/objects
 * (prototype `Object.prototype` or `null`). Class-prototyped values
 * (StoreProvider, LogSink) stay identity-compared. Deliberately not recursive.
 */
export function valueEquals(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) {
    return true;
  }
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((value, i) => Object.is(value, b[i]));
  }
  if (isPlainObject(a) && isPlainObject(b)) {
    const keysA = Object.keys(a);
    const keysB = Object.keys(b);
    return (
      keysA.length === keysB.length &&
      keysA.every(key => Object.prototype.hasOwnProperty.call(b, key) && Object.is(a[key], b[key]))
    );
  }
  return false;
}

/** `{...}` literals and `Object.create(null)` only — class-prototyped values are not "plain". */
export function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object') {
    return false;
  }
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

/**
 * Equality for a single `ZeroOptions` entry. Function-valued entries compare
 * by PRESENCE only: fn↔fn is equal regardless of identity (instances never
 * capture user functions, only stable wrappers delegating to the latest
 * factory output — see `wrapOptionFunction`), while fn↔absent differs
 * (presence toggles Zero's built-in defaults, e.g. omitted `onUpdateNeeded`
 * means `location.reload()`). Everything else compares with `valueEquals`.
 */
export function optionEquals(a: unknown, b: unknown): boolean {
  const aIsFunction = typeof a === 'function';
  const bIsFunction = typeof b === 'function';
  if (aIsFunction || bIsFunction) {
    return aIsFunction === bIsFunction;
  }
  return valueEquals(a, b);
}

/**
 * Reference-stable stand-in for a function-valued `ZeroOptions` entry: the
 * Zero instance captures this wrapper instead of the user's closure, so a
 * factory rerun can swap callbacks without recreating the instance.
 */
export function wrapOptionFunction(
  key: string,
  currentOptions: () => ZeroOptions | undefined,
): (...args: unknown[]) => unknown {
  return (...args: unknown[]) => {
    const current = currentOptions()?.[key as keyof ZeroOptions];
    if (typeof current === 'function') {
      return (current as (...callArgs: unknown[]) => unknown)(...args);
    }
    // The callback was removed from the options and the recreate hasn't landed
    // yet; batchViewUpdates must still apply the updates, synchronously.
    if (key === 'batchViewUpdates') {
      (args[0] as () => void)();
    }
    return undefined;
  };
}

/**
 * Exponential backoff, no jitter (deterministic and testable; a single client
 * is not a retry herd): `min(base * 2^attempt, cap)` for a 0-based attempt.
 */
export function expBackoffMs(attempt: number, base = 1000, cap = 30_000): number {
  return Math.min(base * 2 ** attempt, cap);
}

/**
 * Timer-based delay. An aborted signal RESOLVES the promise early (never
 * rejects) and clears the timer — callers decide what abort means by
 * re-checking their own state after the await.
 */
export function sleep(ms: number, abort?: AbortSignal): Promise<void> {
  return new Promise(resolve => {
    if (abort?.aborted) {
      resolve();
      return;
    }
    const done = (): void => {
      clearTimeout(timer);
      abort?.removeEventListener('abort', done);
      resolve();
    };
    const timer = setTimeout(done, ms);
    abort?.addEventListener('abort', done, { once: true });
  });
}
