import { signal } from '@angular/core';
import type { Zero } from '@rocicorp/zero';
import type { AuthContext } from './zero/context';

export interface Session {
  readonly userID: string;
  readonly token: string;
}

export const session = signal<Session | undefined>(undefined);
export const instanceCreations = signal(0);

export async function login(userID: string, ttlSeconds = 3600): Promise<void> {
  const params = new URLSearchParams({ user: userID, ttl: String(ttlSeconds) });
  const response = await fetch(`/api/login?${params}`);
  if (!response.ok) {
    throw new Error(`Login failed with status ${response.status}`);
  }
  const { token } = (await response.json()) as { token: string };
  session.set({ userID, token });
}

let cachedContext: AuthContext = { userID: null };

/**
 * The provideZero factory reruns on every session change; a fresh context
 * object would recreate the instance even for a pure token rotation, so the
 * reference is kept stable per user.
 */
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
