import {
  inject,
  makeEnvironmentProviders,
  provideEnvironmentInitializer,
  type EnvironmentProviders,
} from '@angular/core';
import { assertUniqueFeatureKinds, type ZeroFeature } from './features.js';
import { ZERO_INSTANCE, ZeroInstanceManager } from './instance-manager.js';
import type { ZeroInstanceOptions } from './types.js';

export function provideZero(
  source: ZeroInstanceOptions,
  ...features: ZeroFeature[]
): EnvironmentProviders {
  assertUniqueFeatureKinds(features);

  return makeEnvironmentProviders([
    ...features.flatMap(f => [...f.ɵproviders]),
    { provide: ZERO_INSTANCE, useFactory: () => new ZeroInstanceManager(source) },
    provideEnvironmentInitializer(() => inject(ZERO_INSTANCE).start()),
  ]);
}
