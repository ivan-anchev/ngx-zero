/** Pure backoff schedule — no Angular or Zero imports. */

/**
 * Exponential backoff, no jitter (deterministic and testable; a single client
 * is not a retry herd): `min(base * 2^attempt, cap)` for a 0-based attempt.
 */
export function expBackoffMs(attempt: number, base = 1000, cap = 30_000): number {
  return Math.min(base * 2 ** attempt, cap);
}
