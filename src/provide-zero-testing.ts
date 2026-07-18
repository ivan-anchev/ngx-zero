import type { EnvironmentProviders } from '@angular/core';
import type { ZeroOptions } from '@rocicorp/zero';
import { provideZero } from './provide-zero.js';
import type { ZeroFeature } from './features.js';

export type ZeroTestingOptions = Omit<ZeroOptions, 'cacheURL' | 'server'>;

export function provideZeroTesting(
  source: ZeroTestingOptions | (() => ZeroTestingOptions),
  ...features: ZeroFeature[]
): EnvironmentProviders {
  return provideZero(() => {
    const user = typeof source === 'function' ? source() : source;
    return toTestingZeroOptions(user);
  }, ...features);
}

export function toTestingZeroOptions(user: ZeroTestingOptions): ZeroOptions {
  return {
    logLevel: 'error',
    kvStore: 'mem',
    ...user,
    cacheURL: null,
    server: null,
  } as ZeroOptions;
}
