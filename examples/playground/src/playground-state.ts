import { signal } from '@angular/core';
import type { Zero } from '@rocicorp/zero';
import type { AuthContext } from './zero/context';

export { login, session, type Session } from './auth-session';

export const instanceCreations = signal(0);

let cachedContext: AuthContext = { userID: null };

// Kept referentially stable per user: a fresh context object would recreate
// the instance on every token rotation.
export function contextFor(userID: string): AuthContext {
  if (cachedContext.userID !== userID) {
    cachedContext = { userID };
  }
  return cachedContext;
}

export function initializeInstance(zero: Zero): void {
  instanceCreations.update(count => count + 1);
  console.log('bootstrapped zero instance', zero);
}
