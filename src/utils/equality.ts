/** Pure equality helpers — no Angular or Zero imports. */

/**
 * `Object.is` + one-level shallow for plain arrays/objects (proto
 * `Object.prototype` or `null`). Class-prototyped values (StoreProvider,
 * LogSink) stay identity-compared. Deliberately not recursive.
 */
export function valueEquals(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) {
    return true;
  }
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((v, i) => Object.is(v, b[i]));
  }
  if (isPlainObject(a) && isPlainObject(b)) {
    const keysA = Object.keys(a);
    const keysB = Object.keys(b);
    return (
      keysA.length === keysB.length &&
      keysA.every(k => Object.prototype.hasOwnProperty.call(b, k) && Object.is(a[k], b[k]))
    );
  }
  return false;
}

/** `{...}` literals and `Object.create(null)` only — anything class-prototyped is not "plain". */
export function isPlainObject(v: unknown): v is Record<string, unknown> {
  if (v === null || typeof v !== 'object') {
    return false;
  }
  const proto = Object.getPrototypeOf(v);
  return proto === Object.prototype || proto === null;
}
