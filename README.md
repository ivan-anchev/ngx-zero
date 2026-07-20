# ngx-zero

> Signals-first, zoneless-ready Angular bindings for [Rocicorp Zero](https://zero.rocicorp.dev).

Rationale and full API contract live in [docs/DESIGN.md](docs/DESIGN.md).

## Quick look

### Provide

```ts
// app.config.ts
provideZero(() => ({
  schema,
  cacheURL: environment.zeroCache,
  userID: auth.userId(),
  auth: auth.jwt(),
}))
```

### Query

```ts
// component — one inject per use-site, fully inferred
export class IssuesList {
  readonly issues = injectQuery(() => queries.issues.open({ assignee: this.userId() }));
}
```

```html
@for (issue of issues.data(); track issue.id) {
  <app-issue [issue]="issue" />
}
```

### Mutate

```ts
export class IssuesList {
  readonly create = injectMutator(mutators.issue.create);
  readonly close = injectMutator(mutators.issue.close);
}
```

Fire-and-forget from the template, driving UI state off the signals:

```html
<button (click)="close.mutate({ id: issue.id })" [disabled]="close.pending()">
  Close
</button>

@if (close.error(); as err) {
  <p class="error">{{ err.message }}</p>
}
```

Or await the outcome — the returned promises never reject:

```ts
async addIssue(title: string) {
  const { client, server } = this.create.mutate({ id: crypto.randomUUID(), title });

  await client;                  // optimistic apply settled
  const result = await server;   // authoritative server outcome
  if (result.type === 'error') {
    // mutation was rejected and rolled back
  }
}
```

## Why

- **Signals end-to-end.** Zoneless-first, zone.js fully supported (no `NgZone.run`
  anywhere).
- **Tight inference.** Zero generics at call sites via Zero's own `DefaultTypes`
  registration.
- **Modern Zero only.** Built on the ≥1.x API: query/mutator registries,
  `zero.materialize`, `zero.connection`.

## API

### `provideZero(source, ...features)`

Registers Zero at the environment level. `source` is `ZeroOptions`, an external
`{ zero }` instance, or a thunk of either. When the thunk reads signals
(`userID`, `auth`), ngx-zero reconciles on change — rotating auth reconnects in
place, switching users recreates the instance.

```ts
provideZero(
  () => ({ schema, cacheURL: env.zeroCache, userID: auth.userId(), auth: auth.jwt() }),
  withBootstrap(zero => zero.preload(queries.issues.open())),
)
```

### `injectQuery(queryThunk, options?)`

Materializes a query and exposes it as signals. The thunk is reactive: reading a
signal inside it re-runs the query when that signal changes. Returning a falsy
value disables the query.

```ts
readonly issue = injectQuery(
  () => this.issueId() && queries.issue.byId({ id: this.issueId()! }),
  { ttl: '1m', keepPreviousData: true },
);
```

Returns a `QueryRef`:

| Member | Type | Meaning |
| --- | --- | --- |
| `data` | `Signal<TData>` | Rows (or row for `.one()` queries) |
| `status` | `Signal<QueryStatus>` | `'unknown' \| 'complete' \| 'error' \| 'disabled'` |
| `error` | `Signal<ErroredQuery \| undefined>` | Cleared on next successful emission |
| `isComplete` | `Signal<boolean>` | Shorthand for `status() === 'complete'` |
| `retry()` | method | Destroy and re-materialize |
| `updateTTL(ttl)` | method | Forward a TTL to the current view |

### `injectMutator(mutator, options?)`

Binds a registry mutator to a `mutate()` function plus lifecycle signals.
Returned promises never reject; errors land in the `error` signal.

```ts
readonly close = injectMutator(mutators.issue.close);

// clientPending() — optimistic apply in flight
// pending()       — server confirmation in flight
// clientResult() / serverResult() — outcome details
// error()         — client error, else server error (rollback)
```

### `injectConnectionState()`

The current instance's connection state as a signal — seeded synchronously and
following instance replacement. `'needs-auth'` is the cue to refresh auth: when
the refreshed token lands in `provideZero`'s thunk, Zero reconnects in place.

```ts
readonly connection = injectConnectionState();

constructor() {
  effect(() => {
    if (this.connection().name === 'needs-auth') {
      void this.auth.refreshSession();
    }
  });
}
```

```html
@if (connection().name !== 'connected') {
  <span class="badge">offline</span>
}
```

### `injectZero()`

Escape hatch: the raw `Zero` instance as a signal, for anything not covered
above.

### `provideZeroTesting(source, ...features)`

Test-friendly `provideZero`: forces a local-only instance (`cacheURL: null`,
`server: null`) with an in-memory store, for `TestBed` setups.

## Development

```sh
pnpm install
pnpm typecheck
pnpm test
pnpm build
```

## Local playground

[`examples/playground`](examples/playground) runs the library against a real
backend: Postgres in Docker, `zero-cache`, and a Hono API embedded in the Vite
dev server.

```sh
pnpm playground:db   # once: start Postgres, push the schema, seed
pnpm playground      # build ngx-zero, then run zero-cache + vite
```

Open http://localhost:5173 — create/complete/delete issues, switch users to
exercise instance rotation, rotate auth to exercise in-place reconnection, or
add a title containing "rollback" to watch a server rejection roll back an
optimistic mutation. Details in the
[playground README](examples/playground/README.md).

## License

[MIT](LICENSE)
