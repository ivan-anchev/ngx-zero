import { signal } from '@angular/core';
import type { Zero } from '@rocicorp/zero';

export const activeUserID = signal('ada');
export const auth = signal<string | undefined>(undefined);
export const instanceCreations = signal(0);

export function initializeInstance(zero: Zero): void {
  instanceCreations.update(count => count + 1);
  console.log('bootstrapping zero instance', zero);
}
