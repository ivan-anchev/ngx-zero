import type { Zero } from '@rocicorp/zero';
import { zeroFeature, type ZeroFeature } from './features.js';
import { ZERO_INSTANCE_HOOKS } from './instance-manager.js';

export function withBootstrap(bootstrap: (zero: Zero) => void): ZeroFeature<'bootstrap'> {
  return zeroFeature('bootstrap', [
    { provide: ZERO_INSTANCE_HOOKS, multi: true, useValue: { onInstanceCreated: bootstrap } },
  ]);
}
