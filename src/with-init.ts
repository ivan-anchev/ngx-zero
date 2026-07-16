import type { Zero } from '@rocicorp/zero';
import { zeroFeature, type ZeroFeature } from './features.js';
import { ZERO_INSTANCE_HOOKS } from './instance-manager.js';

/**
 * React-parity init hook — a feature, not an option (`ZeroOptions` must stay
 * exactly Zero's type; a positional param would collide with the features
 * rest-param). Runs once per OWNED construction, after `new Zero`, before the
 * signal flips; never for external `{ zero }`.
 */
export function withInit(init: (zero: Zero) => void): ZeroFeature<'init'> {
  return zeroFeature('init', [
    { provide: ZERO_INSTANCE_HOOKS, multi: true, useValue: { onInstanceCreated: init } },
  ]);
}
