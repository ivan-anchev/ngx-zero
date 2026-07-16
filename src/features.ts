import type { Provider } from '@angular/core';

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
