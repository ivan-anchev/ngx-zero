/**
 * One-liner in its own module so every user-facing error is greppable and
 * assertable via `expect(...).toThrow(/\[ngx-zero\]/)`. No error-code registry
 * yet — the `[ngx-zero]` prefix suffices at this surface size.
 */
export function ngxZeroError(message: string): Error {
  return new Error(`[ngx-zero] ${message}`);
}
