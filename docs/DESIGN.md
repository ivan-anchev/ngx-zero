# ngx-zero — Design

Signals-first, zoneless-ready Angular bindings for [Rocicorp Zero](https://zero.rocicorp.dev).
Recorded against `@rocicorp/zero@1.8.0`; Angular floor v20 (peers `>=20 <23`).
Everything below is implemented unless listed under **Planned**.

## Principles

1. **Single inject per use-site** — exactly one of `injectZero` / `injectQuery` /
   `injectMutator` / `injectConnectionState`. Queries and mutators are built without
   the instance (`createBuilder` / `defineQueries` / `defineMutators`); the library
   resolves the instance from DI at materialize/mutate time.
2. **Zoneless-first, zone.js fully supported.** Signal writes are the only CD trigger
   (hybrid scheduler); no `NgZone` in library code. Both modes are in the test matrix.
3. **Tight inference.** No generics at call sites; types flow from Zero's
   `DefaultTypes` augmentation. Multi-instance apps use Zero's `*WithType` helpers.
4. **Modern Zero (≥1.x) only**: `zero.materialize`, `QueryOrQueryRequest`,
   `defineMutators`, `zero.mutate(request)`, `cacheURL`, `zero.connection`. Never
   `zero.query.*`, `query.materialize()`, `onOnlineChange`.

## Public API

```ts
// app.config.ts — reactive options factory; the library owns the instance
provideZero(() => ({
  schema,
  cacheURL: env.zeroCache,
  userID: auth.userId(),  // change → close + recreate
  auth: auth.jwt(),       // string→string → connection.connect({auth}) in place
}))

// component
readonly issues = injectQuery(() => queries.issues.open({ assignee: this.userId() }));
readonly close  = injectMutator(mutators.issue.close);
```

Every inject follows the standard CIF pattern (`assertInInjectionContext` unless
`{ injector }` is passed) and throws setup guidance when `provideZero` is missing.

### `injectQuery(queryThunk, options?): QueryRef<T>`

- Thunk runs in a reactive context; one computed tracks instance + query identity and
  coalesces both into a single reconciliation.
- **Identity is semantic, defined by Zero**: the thunk result is resolved via
  `addContextToQuery` (what `zero.materialize` does internally) and keyed by canonical
  AST hash + result format (`.one()` vs `.limit(1)` differ). An unchanged key never
  destroys the view; args key order never matters.
- Thunk may return `Falsy` to disable — that overload widens `data` with `| undefined`
  and status with `'disabled'`. Disabling destroys the view and resets
  data/status/error; re-enabling materializes against the current instance.
- Returns signals `data`, `status: 'unknown' | 'complete' | 'error' | 'disabled'`,
  `error`, `isComplete`, plus `retry()` / `updateTTL()`. Not a tuple, not an Angular
  `Resource`.
- `options: { ttl?, keepPreviousData?, injector? }`.
- **Materializes eagerly + synchronously at call time** — the first CD pass has local
  data. Key/instance changes re-materialize in an effect. Listener emissions are the
  only write path; a successful emission clears an earlier error.
- `keepPreviousData` (opt-in) bridges only a same-instance key change whose initial
  snapshot is empty + `'unknown'`: data keeps the previous snapshot, status/isComplete
  reflect the new view, error is cleared; the first emission ends the bridge. Instance
  replacement is always a hard reset (no old-user data flash).
- `retry()` re-materializes from any status; no-op while disabled or destroyed; drops
  a bridge. `updateTTL(ttl)` forwards to the current view only; each materialization
  re-reads `options.ttl`.
- Default `TypedView` + `addListener` → `signal.set()`; snapshots share structure so
  `@for track` reuses DOM. A custom ViewFactory is a v2 perf project.
- **Per-call views, no ViewStore** (React needs one for StrictMode; Angular doesn't;
  Zero dedupes the IVM pipeline by hash). Reconcile is candidate-first: the new
  session materializes and subscribes before the old retires, so failures propagate
  while the prior session stays live. Cleanup via `DestroyRef`.

### `injectMutator(mutator, options?): MutatorRef<TInput>`

Stateful ref over one registry mutator leaf; thin projection of `zero.mutate` — no
retries, queues, callbacks, or cache interaction.

- `mutate(...args)` mirrors the mutator's own call signature (reconstructed from
  Zero's `MutatorCallable` shape) and returns a `MutatorResult`.
- **Never-reject guarantee**: `client`/`server` always resolve with
  `MutatorResultDetails`; rejections normalize to
  `{type:'error', error:{type:'zero', message}}`. Hardens Zero 1.8's own
  (undocumented) normalization into a library contract.
- Setup failures (`provideZero` missing; no instance; unregistered mutator) throw
  synchronously and leave ref state untouched.
- Signals — latest-call-wins, atomic snapshots, each `mutate()` result independently
  awaitable: `clientPending`, `pending`, `clientResult` / `serverResult`, `error`
  (client error first, else server — covers rollback; cleared by the next `mutate()`).
  Out-of-order settles from superseded calls are dropped via an internal call ticket.
- **Local-only instances** (`cacheURL: null`, incl. `provideZeroTesting`): `.server`
  never settles → `pending()` stays true forever; key off `clientPending` /
  `clientResult`.
- **Instance replacement**: resolved per call; ref state is not reset. In-flight calls
  on a closed instance settle as Zero settles them, reported truthfully. In-place auth
  rotation is invisible here.
- **Destroy** gates signal writes; awaited results and normalization keep working.
- Upstream limitation: mutators cannot return data on success.

### `injectConnectionState(options?): Signal<ConnectionState>`

- Subscribes `zero.connection.state`; `'needs-auth'` is the auth-refresh signal.
- Seeds synchronously from `state.current` (Zero's `subscribe` does not replay), so
  the first CD pass reads the real state; emissions are the only other write path.
- Follows instance replacement — an effect re-seeds and re-subscribes; may truthfully
  read the old instance's `'closed'` until the effect flushes. `DestroyRef`
  unsubscribes; the signal keeps its last value after destruction.

### `injectZero(options?): Signal<Zero>`

Escape hatch: the current instance as a signal, following replacement.

### `provideZero(source, ...features)`

- `source`: static options, a reactive factory (runs in injection context; may read
  signals and `inject()`), or `{ zero }` for an externally-owned instance. Features
  via rest params, e.g. `withBootstrap(...)`.
- One manager reconciles: synchronously at startup (component field initializers can
  materialize immediately), then via a single effect.

| Transition | Verdict | Action |
|---|---|---|
| identical rerun | `noop` | nothing |
| `auth` string→string | `connect` | `connection.connect({auth})` in place |
| `auth` added/removed, or any other option change | `recreate` | create replacement, close previous owned instance |
| `onClientStateNotFound`, no user callback | rotation | recreate with current options |
| `onClientStateNotFound`, user callback | user-owned | invoke callback, no automatic rotation |
| `{ zero }` external source | adopt | never construct or close it |

- **Equality**: top-level `Object.is` per key (union of own keys, no hardcoded list),
  except `auth` / `onClientStateNotFound`. Fresh object/array/function values
  recreate — keep those references stable.
- `close()` is unawaited on replacement and destruction. External instances are never
  closed.
- Constructor failures go to `ErrorHandler`; an existing instance is preserved.
- `withBootstrap(fn)` runs after every owned construction, in injection context; never
  for external instances. Duplicate feature kinds are rejected.

### `provideZeroTesting(source, ...features)`

Fully functional local Zero (real IVM, real mutators, no network) for TestBed.
Forced at type + runtime: `cacheURL: null`, `server: null`. Defaulted, overridable:
`kvStore: 'mem'`, `logLevel: 'error'`. Factory form preserved — lifecycle tests
reconcile through the preset exactly like production.

## Planned

- `zeroPreload(queryThunk)` route-resolver/guard preload helper — Angular-native, no
  other binding has it. Preload TTL default `'none'` per upstream guidance.

## SSR (v1 stance)

No server-specific branch: `provideZero` runs the same lifecycle on the server. An
inert or memory-store SSR strategy is deferred.

## Packaging

- No ng-packagr — plain `tsc` (ESM + d.ts), `exports` map, `sideEffects: false`.
  Revisit only if components/directives are ever added (→ APF + ng-packagr).
- Peers: `@angular/core >=20 <23`, `@rocicorp/zero >=1.8 <2`. Dev/typecheck on the
  floor (v20); CI matrix covers newer majors.

## Upstream-churn guardrails

`zero-canary.yml` runs the suite against `@rocicorp/zero@latest` and `@canary` twice
a week (Mon/Thu) — upstream deprecation churn pages us, not users.

## Open questions

- `.asResource()` interop adapter — wait for demand; `Resource`'s
  `loading/resolved/reloading` can't express "local data shown, server unconfirmed".
- Suspense analog: `whenComplete(): Promise` on `QueryRef` for `@defer (when ...)`.
- Multi-instance DX (`storageKey`): named injection tokens vs factory-scoped helpers.
- `debounced()`-style helpers for search-as-you-type queries.
