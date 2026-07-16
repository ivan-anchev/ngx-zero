import type { Provider } from '@angular/core';
import { ngxZeroError } from './errors.js';

/** Closed union so duplicate detection stays honest; one-line change per new feature. */
export type ZeroFeatureKind = 'init' | 'auth-refresh';

/**
 * Marker returned by `with*()` features and accepted by `provideZero`.
 * ɵ = public type, private contract (Angular convention): users pass features,
 * never construct or introspect them.
 */
export interface ZeroFeature<K extends ZeroFeatureKind = ZeroFeatureKind> {
  readonly ɵkind: K;
  readonly ɵproviders: readonly Provider[];
}

export function zeroFeature<K extends ZeroFeatureKind>(
  kind: K,
  providers: readonly Provider[],
): ZeroFeature<K> {
  return { ɵkind: kind, ɵproviders: providers };
}

/** Throws at provide time on a duplicated feature kind (config errors beat runtime surprises). */
export function assertUniqueFeatureKinds(features: readonly ZeroFeature[]): void {
  const kinds = new Set<string>();
  for (const f of features) {
    if (kinds.has(f.ɵkind)) {
      throw ngxZeroError(`provideZero(): duplicate feature "${f.ɵkind}".`);
    }
    kinds.add(f.ɵkind);
  }
}
