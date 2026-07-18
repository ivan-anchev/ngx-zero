# ngx-zero playground

A fully functional integration harness for the `ngx-zero` public API against a
real Zero backend: Postgres (Docker) → `zero-cache` → an embedded Hono API →
this Angular app. The app imports only from the package entry point.

## Architecture

```
┌────────────────────────────┐      ┌───────────────┐      ┌──────────────────┐
│ Vite :5173                 │      │ zero-cache    │      │ Postgres :5430   │
│  ├─ Angular playground     │◄────►│ :4848         │◄────►│ (docker,         │
│  └─ Hono /api/*            │      │               │ WAL  │  wal_level=      │
│      /api/login            │      │ forwards      │      │  logical)        │
│      /api/zero/query   ◄───┼──────┤ query/mutate  │      └──────────────────┘
│      /api/zero/mutate  ◄───┼──────┘               │
└────────────────────────────┘      └───────────────┘
```

- **Drizzle is the source of truth** for the database schema
  (`src/db/schema.ts`). `pnpm generate` regenerates the Zero schema
  (`src/zero/schema.gen.ts`) via `drizzle-zero`.
- **Queries and mutators are shared registries** (`src/zero/queries.ts`,
  `src/zero/mutators.ts`) — the same code runs optimistically in the browser
  and authoritatively in the API server.
- **Auth is a fake token flow**: `/api/login` mints an HS256 JWT for any user
  name; the query/mutate endpoints verify it and build the `ctx` passed to
  queries and mutators.

## Running it

From the repository root (requires Docker):

```sh
pnpm playground:db   # once: start Postgres, push the schema, seed
pnpm playground      # build ngx-zero, then run zero-cache + vite
```

Open http://localhost:5173.

## What to try

- **Add / complete / delete issues** — optimistic mutations synced through the
  real backend. Open two windows to watch them converge.
- **Add a title containing “rollback”** — a server-only rule rejects it after
  the optimistic apply succeeds; watch the row appear and roll back.
- **Delete someone else's issue** — the owner check fails during the
  optimistic apply, before the server is ever involved.
- **Switch user** — `userID` (and context) change, so `provideZero` closes and
  recreates the instance (watch the instance counter).
- **Rotate auth** — a same-user token rotation reconnects in place via
  `zero.connection.connect({auth})`; the instance counter must not move.
- **15s token** — a short-lived token; after it expires the API returns 401
  and Zero enters `needs-auth` (the `withAuthRefresh` open question in
  `docs/DESIGN.md`).
- **Show only mine** — swaps the materialized query to `queries.issue.mine`,
  whose filter is applied server-side from the verified JWT context.

## Housekeeping

- `pnpm --filter ngx-zero-playground db:setup` re-runs push + seed.
- `docker compose down -v` (in this directory) resets the database.
- `.env` is checked in on purpose; nothing in it is secret.
