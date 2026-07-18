import { boolean, doublePrecision, pgTable, text } from 'drizzle-orm/pg-core';

// camelCase column names on purpose: drizzle-zero then needs no server-name mapping.
export const issue = pgTable('issue', {
  id: text('id').primaryKey(),
  title: text('title').notNull(),
  completed: boolean('completed').notNull(),
  ownerId: text('ownerId').notNull(),
  createdAt: doublePrecision('createdAt').notNull(),
});
