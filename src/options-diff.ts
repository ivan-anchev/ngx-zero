/**
 * The equality stance for reconciling `ZeroOptions`, isolated and pure
 * (types-only imports; no Angular or Zero runtime).
 *
 * The policy, top to bottom:
 * 1. Every option except `auth` and `onClientStateNotFound` is compared with
 *    `optionEquals`; any difference → 'recreate'.
 * 2. `auth` alone decides between 'connect' and 'noop' (`diffAuth`).
 *
 * No hardcoded `ZeroOptions` key list — the diff walks the union of both
 * objects' own keys, so new upstream options participate automatically; the
 * canary test in tests/options-diff.spec.ts is the tripwire.
 */
import type { Zero, ZeroOptions } from '@rocicorp/zero';
import { optionEquals } from './utils.js';

/** `{ zero }` — externally-owned instance mode: adopted as-is, never closed. */
export interface ExternalZeroSource {
  readonly zero: Zero;
}

export type ZeroInstanceSource = ZeroOptions | ExternalZeroSource;

export function isExternalSource(s: ZeroInstanceSource): s is ExternalZeroSource {
  return 'zero' in s; // a key named `zero` cannot appear in ZeroOptions — unambiguous
}

/** 'noop' — don't touch; 'connect' — auth rotated in place; 'recreate' — close + new. */
export type ZeroReconcileVerdict = 'noop' | 'connect' | 'recreate';

export function diffZeroOptions(prev: ZeroOptions, next: ZeroOptions): ZeroReconcileVerdict {
  for (const key of diffableKeys(prev, next)) {
    const a = (prev as Record<string, unknown>)[key];
    const b = (next as Record<string, unknown>)[key];
    if (!optionEquals(a, b)) {
      return 'recreate';
    }
  }
  return diffAuth(prev.auth, next.auth);
}

/**
 * Union of both objects' own keys — "key added" and "key removed" are both
 * seen, and absent vs explicit `undefined` compare equal (matches Zero's
 * `?: T | undefined` option style) — minus the two keys with policies of
 * their own: `auth` (3-way, see `diffAuth`) and `onClientStateNotFound`
 * (always wrapped by the library; never diffed).
 */
function diffableKeys(prev: ZeroOptions, next: ZeroOptions): Set<string> {
  const keys = new Set([...Object.keys(prev), ...Object.keys(next)]);
  keys.delete('auth');
  keys.delete('onClientStateNotFound');
  return keys;
}

/**
 * `auth` 3-way — the React provider's exact semantics: crossing the
 * login/logout boundary (string ↔ non-string) recreates the instance; a
 * string→string change rotates the token in place via `connect`; anything
 * else (same token, or non-string → non-string like `null` → `undefined`)
 * is a no-op.
 */
function diffAuth(prev: ZeroOptions['auth'], next: ZeroOptions['auth']): ZeroReconcileVerdict {
  const prevIsString = typeof prev === 'string';
  const nextIsString = typeof next === 'string';
  if (prevIsString !== nextIsString) {
    return 'recreate';
  }
  if (nextIsString && !Object.is(prev, next)) {
    return 'connect';
  }
  return 'noop';
}
