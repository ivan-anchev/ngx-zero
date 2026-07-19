import 'dotenv/config';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { issue } from './schema';

const pool = new Pool({ connectionString: process.env['ZERO_UPSTREAM_DB'] });
const db = drizzle(pool);

const starterIssues = [
  {
    id: 'read-design',
    title: 'Read the ngx-zero design notes',
    completed: true,
    ownerId: 'user1',
    createdAt: 1,
  },
  {
    id: 'try-mutation',
    title: 'Try an optimistic mutation',
    completed: false,
    ownerId: 'user2',
    createdAt: 2,
  },
];

await db.update(issue).set({ ownerId: 'user1' }).where(eq(issue.ownerId, 'ada'));
await db.update(issue).set({ ownerId: 'user2' }).where(eq(issue.ownerId, 'grace'));
await db.insert(issue).values(starterIssues).onConflictDoNothing();
console.log(`Seeded ${starterIssues.length} starter issues and normalized demo users.`);
await pool.end();
