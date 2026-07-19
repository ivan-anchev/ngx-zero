import { defineMutator, defineMutators } from '@rocicorp/zero';
import { z } from 'zod';
import { requireUser } from './context';
import { zql } from './schema.gen';

const createArgs = z.object({
  id: z.string(),
  title: z.string().min(1),
  createdAt: z.number(),
});

const setCompletedArgs = z.object({
  id: z.string(),
  completed: z.boolean(),
});

const removeArgs = z.object({ id: z.string() });

export const mutators = defineMutators({
  issue: {
    create: defineMutator(createArgs, async ({ tx, args, ctx }) => {
      const userID = requireUser(ctx);
      // Server-only on purpose: demos an optimistic apply that gets rolled back.
      if (tx.location === 'server' && args.title.toLowerCase().includes('rollback')) {
        throw new Error('The server refuses titles containing "rollback".');
      }
      await tx.mutate.issue.insert({ ...args, completed: false, ownerId: userID });
    }),
    setCompleted: defineMutator(setCompletedArgs, async ({ tx, args }) => {
      await tx.mutate.issue.update(args);
    }),
    remove: defineMutator(removeArgs, async ({ tx, args, ctx }) => {
      const userID = requireUser(ctx);
      const existing = await tx.run(zql.issue.where('id', args.id).one());
      if (existing === undefined) {
        return;
      }
      if (existing.ownerId !== userID) {
        throw new Error('Only the owner can delete an issue.');
      }
      await tx.mutate.issue.delete(args);
    }),
  },
});
