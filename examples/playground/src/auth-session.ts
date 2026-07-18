import { signal } from '@angular/core';

export interface Session {
  readonly userID: string;
  readonly token: string;
}

export const session = signal<Session | undefined>(undefined);

let loginGeneration = 0;

export async function login(userID: string, ttlSeconds = 3600): Promise<boolean> {
  const generation = ++loginGeneration;
  const params = new URLSearchParams({ user: userID, ttl: String(ttlSeconds) });
  const response = await fetch(`/api/login?${params}`);
  if (!response.ok) {
    throw new Error(`Login failed with status ${response.status}`);
  }
  const { token } = (await response.json()) as { token: string };

  if (generation !== loginGeneration) {
    return false;
  }

  session.set({ userID, token });
  return true;
}
