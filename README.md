# ngx-zero

> Signals-first, zoneless-ready Angular bindings for [Rocicorp Zero](https://zero.rocicorp.dev).

**Status: core API implemented, not yet published to npm.** Rationale and full API
contract live in [docs/DESIGN.md](docs/DESIGN.md).

## Quick look

```ts
// app.config.ts
provideZero(() => ({
  schema,
  cacheURL: environment.zeroCache,
  userID: auth.userId(),
  auth: auth.jwt(),
}))

// component — one inject per use-site, fully inferred
export class IssuesList {
  readonly issues = injectQuery(() => queries.issues.open({ assignee: this.userId() }));
  readonly close = injectMutator(mutators.issue.close);
}
```

```html
@for (issue of issues.data(); track issue.id) {
  <button (click)="close.mutate({ id: issue.id })" [disabled]="close.pending()">
    Close
  </button>
}
```

## Why

- **Single inject.** `injectZero`, `injectQuery`, `injectMutator` — never
  "inject the instance, then pass it somewhere".
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
