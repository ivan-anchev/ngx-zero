import { computed } from '@angular/core';
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

export function pairwiseComputed<T>(computation: () => T) {
  const source = computed(computation);

  let state: { previous: T | undefined; current: T | undefined; first: boolean } = {
    previous: undefined,
    current: undefined,
    first: true,
  };

  const previous = computed(() => {
    const current = source();

    if (state.first) {
      state = {
        previous: current,
        current: current,
        first: false,
      };
    }

    state.previous = state.current;
    state.current = current;

    return state.previous;
  });

  return { current: source, previous };
}
