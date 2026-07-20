import {
  assertInInjectionContext,
  DestroyRef,
  effect,
  inject,
  Injector,
  signal,
  untracked,
  type Signal,
} from '@angular/core';
import type { ConnectionState, Zero } from '@rocicorp/zero';
import { ngxZeroError } from './errors.js';
import { ZERO_INSTANCE } from './instance-manager.js';

export function injectConnectionState(
  options: { injector?: Injector } = {},
): Signal<ConnectionState> {
  if (options.injector === undefined) {
    assertInInjectionContext(injectConnectionState);
  }
  const injector = options.injector ?? inject(Injector);

  const manager = injector.get(ZERO_INSTANCE, null, { optional: true });
  if (!manager) {
    throw ngxZeroError(
      'injectConnectionState() could not find a Zero instance manager. ' +
        'Add provideZero(...) to your ApplicationConfig providers.',
    );
  }

  const initial = untracked(() => manager.zeroOrThrow());
  const state = signal<ConnectionState>(initial.connection.state.current);

  let subscribed: Zero | undefined;
  let unsubscribe: VoidFunction | undefined;

  // Zero's subscribe() does not replay the current value, so every (re)attach
  // seeds from `current` before listening.
  const attach = (zero: Zero): void => {
    if (zero === subscribed) {
      return;
    }
    unsubscribe?.();
    subscribed = zero;
    state.set(zero.connection.state.current);
    unsubscribe = zero.connection.state.subscribe(next => state.set(next));
  };

  attach(initial);

  effect(
    () => {
      const zero = manager.zeroOrThrow();
      untracked(() => attach(zero));
    },
    { injector },
  );

  injector.get(DestroyRef).onDestroy(() => {
    unsubscribe?.();
    unsubscribe = undefined;
    subscribed = undefined;
  });

  return state.asReadonly();
}
