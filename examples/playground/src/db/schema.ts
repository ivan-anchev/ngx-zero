import { boolean, doublePrecision, pgTable, text } from 'drizzle-orm/pg-core';

// Column names deliberately match the Zero schema exactly (camelCase in
// Postgres) so drizzle-zero needs no server-name mapping.
export const issue = pgTable('issue', {
  id: text('id').primaryKey(),
  title: text('title').notNull(),
  completed: boolean('completed').notNull().default(false),
  ownerId: text('ownerId').notNull(),
  createdAt: doublePrecision('createdAt').notNull(),
});
