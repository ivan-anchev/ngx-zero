import type { EnvironmentProviders } from '@angular/core';
import type { ZeroOptions } from '@rocicorp/zero';
import { provideZero } from './provide-zero.js';
import type { ZeroFeature } from './features.js';

/** `ZeroOptions` minus the keys the preset owns. Structural Omit — tracks upstream. */
export type ZeroTestingOptions = Omit<ZeroOptions, 'cacheURL' | 'server'>;

/**
 * Fully functional LOCAL Zero (real IVM, real mutators, no network) for
 * TestBed. FORCED (type + runtime): `cacheURL: null`, `server: null`.
 * DEFAULTED-overridable: `kvStore: 'mem'`, `logLevel: 'error'`. Factory form
 * preserved — lifecycle tests drive reconciliation through the preset just
 * like production.
 */
export function provideZeroTesting(
  source: ZeroTestingOptions | (() => ZeroTestingOptions),
  ...features: ZeroFeature[]
): EnvironmentProviders {
  return provideZero(() => {
    const user = typeof source === 'function' ? source() : source;
    return {
      logLevel: 'error',
      kvStore: 'mem',
      ...user, // user wins for defaulted keys…
      cacheURL: null, // …never for forced ones
      server: null,
    } as ZeroOptions;
  }, ...features);
}
