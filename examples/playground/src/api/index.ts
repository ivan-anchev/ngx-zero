import 'dotenv/config';
import { mustGetMutator, mustGetQuery } from '@rocicorp/zero';
import { handleMutateRequest, handleQueryRequest } from '@rocicorp/zero/server';
import { zeroDrizzle } from '@rocicorp/zero/server/adapters/drizzle';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Hono, type Context } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { jwtVerify, SignJWT } from 'jose';
import { Pool } from 'pg';
import { type AuthContext } from '../zero/context';
import { mutators } from '../zero/mutators';
import { queries } from '../zero/queries';
import { schema } from '../zero/schema.gen';

const secret = new TextEncoder().encode(process.env['AUTH_SECRET']);
const pool = new Pool({ connectionString: process.env['ZERO_UPSTREAM_DB'] });
const dbProvider = zeroDrizzle(schema, drizzle(pool));

// No Authorization header → anonymous; a header that fails verification → 401,
// which puts Zero into `needs-auth`.
async function authContext(c: Context): Promise<AuthContext> {
  const header = c.req.header('authorization');
  if (header === undefined || !header.startsWith('Bearer ')) {
    return { userID: null };
  }
  try {
    const { payload } = await jwtVerify(header.slice('Bearer '.length), secret);
    return { userID: payload.sub ?? null };
  } catch {
    throw new HTTPException(401, { message: 'Invalid or expired token.' });
  }
}

const app = new Hono();

app.get('/api/login', async c => {
  const userID = c.req.query('user') ?? 'user1';
  const ttl = Number(c.req.query('ttl') ?? 3600);
  const token = await new SignJWT({})
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(userID)
    .setIssuedAt()
    .setExpirationTime(Math.floor(Date.now() / 1000) + ttl)
    .sign(secret);
  return c.json({ userID, token, expiresInSeconds: ttl });
});

app.post('/api/zero/query', async c => {
  const ctx = await authContext(c);
  const response = await handleQueryRequest({
    schema,
    userID: ctx.userID,
    request: c.req.raw,
    handler: (name, args) => mustGetQuery(queries, name).fn({ args, ctx }),
  });
  return c.json(response);
});

app.post('/api/zero/mutate', async c => {
  const ctx = await authContext(c);
  const response = await handleMutateRequest({
    dbProvider,
    userID: ctx.userID,
    request: c.req.raw,
    handler: transact =>
      transact((tx, name, args) => mustGetMutator(mutators, name).fn({ tx, args, ctx })),
  });
  return c.json(response);
});

export default app;
