import { defineQueries, defineQuery } from '@rocicorp/zero';
import { zql } from './schema.gen';

export const queries = defineQueries({
  issue: {
    all: defineQuery(() => zql.issue.orderBy('createdAt', 'desc')),
    mine: defineQuery(({ ctx }) =>
      zql.issue.where('ownerId', ctx.userID ?? '').orderBy('createdAt', 'desc'),
    ),
  },
});
