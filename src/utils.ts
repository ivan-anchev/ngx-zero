export type Result<T> = { result: T; error?: never } | { result?: never; error: Error };

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

function isThenable(value: unknown): value is PromiseLike<unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { then?: unknown }).then === 'function'
  );
}
