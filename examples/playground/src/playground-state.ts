import { signal } from '@angular/core';
import type { Zero } from '@rocicorp/zero';
import { mutators, queries, type Issue } from './schema';

export const activeUserID = signal('ada');
export const auth = signal('xxxx-xxxx-xxxx-xxxx')
export const instanceCreations = signal(0);

const starterIssues: readonly Issue[] = [
  {
    id: 'read-design',
    title: 'Read the ngx-zero design notes',
    completed: true,
    createdAt: 1,
  },
  {
    id: 'try-mutation',
    title: 'Try an optimistic mutation',
    completed: false,
    createdAt: 2,
  },
];

export function initializeInstance(zero: Zero): void {
  instanceCreations.update(count => count + 1);
  console.log('bootstraping zero instance', zero);
  void seedEmptyInstance(zero);
}

async function seedEmptyInstance(zero: Zero): Promise<void> {
  const existing = await zero.run(queries.issue, { type: 'unknown' });
  if (existing.length > 0) {
    return;
  }

  await Promise.all(
    starterIssues.map(issue => zero.mutate(mutators.issue.create(issue)).client),
  );
}
