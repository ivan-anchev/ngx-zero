# ngx-zero

> Signals-first, zoneless-ready Angular bindings for [Rocicorp Zero](https://zero.rocicorp.dev).

**Status: design phase — not yet published.** The API below is agreed and documented in
[docs/DESIGN.md](docs/DESIGN.md); implementation is in progress.

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

## Development

```sh
pnpm install
pnpm typecheck
pnpm test
pnpm build
```

## Local playground

The standalone app in [`examples/playground`](examples/playground) exercises the
current public API against a fully functional Zero backend: Postgres in Docker,
`zero-cache`, and a Hono API (login + query/mutate endpoints) embedded in the
Vite dev server.

```sh
pnpm playground:db   # once: start Postgres, push the schema, seed
pnpm playground      # build ngx-zero, then run zero-cache + vite
```

Open http://localhost:5173. Create, complete, and delete issues (synced through
the real backend), switch users to exercise instance rotation, rotate auth to
exercise in-place reconnection, or add a title containing "rollback" to watch a
server-side rejection roll back an optimistic mutation. The root package is
built first, so the playground consumes `ngx-zero` through its package exports
rather than importing library source files. See the
[playground README](examples/playground/README.md) for details.

## License

[MIT](LICENSE)
