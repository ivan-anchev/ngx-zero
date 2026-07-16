import { assertInInjectionContext, inject, Injector, type Signal } from '@angular/core';
import type { Zero } from '@rocicorp/zero';
import { ZERO_INSTANCE_MANAGER } from './instance-manager.js';
import { ngxZeroError } from './errors.js';

export interface InjectZeroOptions {
  /** Standard CIF escape hatch. */
  injector?: Injector;
}

/**
 * Returns a Signal — never a raw instance — because the library rotates the
 * instance and a captured raw reference throws after `close()`. SSR: CALLING
 * succeeds; READING throws. Generics come from Zero's `DefaultTypes`
 * augmentation — no type params declared here.
 */
export function injectZero(options?: InjectZeroOptions): Signal<Zero> {
  if (options?.injector === undefined) assertInInjectionContext(injectZero);
  const injector = options?.injector ?? inject(Injector);

  const manager = injector.get(ZERO_INSTANCE_MANAGER, null, { optional: true });
  if (manager === null) {
    throw ngxZeroError(
      'injectZero() could not find a Zero instance manager. ' +
        'Add provideZero(...) to your ApplicationConfig providers.',
    );
  }
  return manager.zeroOrThrow; // one shared throwing computed for all call sites
}
