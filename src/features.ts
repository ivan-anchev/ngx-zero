import type { Provider } from '@angular/core';
import { ngxZeroError } from './errors.js';

export type ZeroFeatureKind = 'bootstrap';

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

export function assertUniqueFeatureKinds(features: readonly ZeroFeature[]): void {
  const kinds = new Set<string>();
  for (const f of features) {
    if (kinds.has(f.ɵkind)) {
      throw ngxZeroError(`provideZero(): duplicate feature "${f.ɵkind}".`);
    }
    kinds.add(f.ɵkind);
  }
}
