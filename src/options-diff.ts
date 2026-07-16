/**
 * The equality stance for reconciling `ZeroOptions`, isolated and pure
 * (types-only imports; no Angular or Zero runtime).
 *
 * - Function-valued entries compare by PRESENCE only (fn↔fn equal regardless
 *   of identity; fn↔absent → recreate, because presence toggles Zero's
 *   built-in defaults, e.g. omitted `onUpdateNeeded` means `location.reload()`).
 *   Ignoring identity is sound because instances never capture user functions,
 *   only stable wrappers that delegate to the latest factory output.
 * - Non-function values: `Object.is` + one-level shallow fallback for plain
 *   objects/arrays (kills the inline `queryHeaders: {…}` / `context: {…}`
 *   literal footgun; deliberately not recursive).
 * - `auth` never participates in the recreate diff — 3-way semantics of its own.
 * - `onClientStateNotFound` never participates at all (the library always
 *   wraps it).
 * - No hardcoded `ZeroOptions` key list — structural over the union of own
 *   keys, so new upstream options participate automatically; a canary test is
 *   the tripwire.
 */
import type { Zero, ZeroOptions } from '@rocicorp/zero';

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
  // Union of keys: "key added" and "key removed" both seen. Absent vs explicit
  // undefined compare equal — matches Zero's `?: T | undefined` option style.
  const keys = new Set([...Object.keys(prev), ...Object.keys(next)]);
  keys.delete('auth'); // 3-way semantics below
  keys.delete('onClientStateNotFound'); // always wrapped; never diffed

  for (const key of keys) {
    const a = (prev as Record<string, unknown>)[key];
    const b = (next as Record<string, unknown>)[key];
    const aFn = typeof a === 'function';
    const bFn = typeof b === 'function';
    if (aFn || bFn) {
      if (aFn !== bFn) return 'recreate'; // presence flip
      continue; // identity ignored (stable wrappers)
    }
    if (!valueEquals(a, b)) return 'recreate';
  }

  // auth: the React provider's exact semantics.
  const prevHas = typeof prev.auth === 'string';
  const nextHas = typeof next.auth === 'string';
  if (prevHas !== nextHas) return 'recreate'; // login/logout boundary
  if (nextHas && !Object.is(prev.auth, next.auth)) return 'connect'; // rotation in place
  return 'noop';
}

/**
 * `Object.is` + one-level shallow for plain arrays/objects (proto
 * `Object.prototype` or `null`). Class-prototyped values (StoreProvider,
 * LogSink) stay identity-compared.
 */
export function valueEquals(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    return a.every((v, i) => Object.is(v, b[i]));
  }
  if (isPlainObject(a) && isPlainObject(b)) {
    const ka = Object.keys(a);
    const kb = Object.keys(b);
    if (ka.length !== kb.length) return false;
    return ka.every(
      k =>
        Object.prototype.hasOwnProperty.call(b, k) &&
        Object.is(a[k], b[k]),
    );
  }
  return false;
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  if (v === null || typeof v !== 'object') return false;
  const proto = Object.getPrototypeOf(v);
  return proto === Object.prototype || proto === null;
}
