import {
  inject,
  makeEnvironmentProviders,
  provideEnvironmentInitializer,
  type EnvironmentProviders,
} from '@angular/core';
import { ZERO_INSTANCE_MANAGER, ZeroInstanceManager } from './instance-manager.js';
import type { ZeroInstanceSource } from './options-diff.js';
import type { ZeroFeature } from './features.js';
import { ngxZeroError } from './errors.js';

/**
 * Provides the library-owned Zero instance for an environment injector.
 *
 * Accepts static options, a reactive factory (may read signals; runs in
 * injection context so it can `inject()`), or `{ zero }` for an
 * externally-owned instance. The instance is constructed eagerly in an
 * environment initializer (browser only — SSR stays fully inert) and
 * reconciled reactively when the factory's signal dependencies change.
 */
export function provideZero(
  source: ZeroInstanceSource | (() => ZeroInstanceSource),
  ...features: ZeroFeature[]
): EnvironmentProviders {
  // Duplicate-feature detection at provide time (config errors beat runtime surprises).
  const kinds = new Set<string>();
  for (const f of features) {
    if (kinds.has(f.ɵkind)) {
      throw ngxZeroError(`provideZero(): duplicate feature "${f.ɵkind}".`);
    }
    kinds.add(f.ɵkind);
  }

  return makeEnvironmentProviders([
    // Feature providers FIRST so their multi-providers exist before the manager injects them.
    ...features.flatMap(f => [...f.ɵproviders]),
    { provide: ZERO_INSTANCE_MANAGER, useFactory: () => new ZeroInstanceManager(source) },
    // The initializer — not the manager factory — triggers construction, so
    // merely injecting the manager never has side effects.
    provideEnvironmentInitializer(() => inject(ZERO_INSTANCE_MANAGER).start()),
  ]);
}
