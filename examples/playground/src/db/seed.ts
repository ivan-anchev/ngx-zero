import 'dotenv/config';
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
    ownerId: 'ada',
    createdAt: 1,
  },
  {
    id: 'try-mutation',
    title: 'Try an optimistic mutation',
    completed: false,
    ownerId: 'grace',
    createdAt: 2,
  },
];

await db.insert(issue).values(starterIssues).onConflictDoNothing();
console.log(`Seeded ${starterIssues.length} starter issues (existing rows kept).`);
await pool.end();
