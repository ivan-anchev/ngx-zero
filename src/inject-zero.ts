import { assertInInjectionContext, inject, Injector, type Signal } from '@angular/core';
import type { Zero } from '@rocicorp/zero';
import { ngxZeroError } from './errors.js';
import { ZERO_INSTANCE } from './instance-manager.js';

export function injectZero(options?: { injector?: Injector }): Signal<Zero> {
  if (options?.injector === undefined) {
    assertInInjectionContext(injectZero);
  }
  const injector = options?.injector ?? inject(Injector);

  const manager = injector.get(ZERO_INSTANCE, null, { optional: true });

  if (!manager) {
    throw ngxZeroError(
      'injectZero() could not find a Zero instance manager. ' +
      'Add provideZero(...) to your ApplicationConfig providers.',
    );
  }
  return manager.zeroOrThrow;
}
