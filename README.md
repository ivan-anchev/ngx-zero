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
  readonly close = injectMutation(mutators.issue.close);
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

- **Single inject.** `injectZero`, `injectQuery`, `injectMutation` — never
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

## License

[MIT](LICENSE)
