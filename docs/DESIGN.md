# ngx-zero — Design

Signals-first, zoneless-ready Angular bindings for [Rocicorp Zero](https://zero.rocicorp.dev).
Decisions recorded 2026-07-15 against `@rocicorp/zero@1.8.0` and Angular v22 (floor v20).

## Principles

1. **Single inject per use-site.** A component touches exactly one of `injectZero`,
   `injectQuery`, `injectMutation`. Never "inject the instance, then pass it to a
   second inject". Zero ≥1.x makes this natural: queries (`createBuilder`/`defineQueries`)
   and mutators (`defineMutators`) are built without the instance; the instance is only
   needed at materialize/mutate time, and the library resolves it from DI internally.
2. **Zoneless + signals first, zone.js fully supported.** Signal writes trigger CD in
   both worlds via the hybrid scheduler (v18+). No `NgZone.run` anywhere in the library.
   Both modes are covered in the test matrix — zone.js support is a hard requirement.
3. **Super tight inference.** Zero generics at call sites. We inherit Zero's own
   `DefaultTypes` module augmentation (`declare module '@rocicorp/zero' { interface
   DefaultTypes { schema; context } }`) instead of inventing a Register pattern.
   Multi-instance apps fall back to Zero's `*WithType` helpers + explicit generics.
4. **Track the modern Zero API only.** `zero.materialize(queryOrRequest, opts)`,
   `QueryOrQueryRequest` (registry + raw ZQL), `defineMutators`, `zero.mutate(request)`,
   `cacheURL`, `zero.connection`. None of the deprecated pre-1.0 surface
   (`zero.query.*`, `query.materialize()`, `onOnlineChange`, …).

## Public API

```ts
// app.config.ts — options factory runs reactively; the library owns the instance
provideZero(() => ({
  schema,
  cacheURL: env.zeroCache,
  userID: auth.userId(),  // change → close + recreate (mirrors official providers)
  auth: auth.jwt(),       // string→string rotation → connection.connect({auth}) in place
}))

// component
readonly issues = injectQuery(() => queries.issues.open({ assignee: this.userId() }));
readonly close  = injectMutation(mutators.issue.close);
```

### `injectQuery(queryThunk, options?): QueryRef<T>`

- Thunk runs in a **reactive context** (TanStack-adapter style): signals read inside
  retrack; re-materialization is keyed on `asQueryInternals(q).hash()` so a new query
  object with an unchanged hash never destroys the view.
- Thunk may return `Falsy` to disable → typed overload where `data: Signal<T | undefined>`,
  status `'disabled'`.
- Returns an object of signals (NOT a tuple, NOT an Angular `Resource`):
  `data`, `status: Signal<'unknown' | 'complete' | 'error' | 'disabled'>`,
  `error`, `isComplete`, `retry()`, `updateTTL()`.
- `options: { ttl?: TTL; injector?: Injector }` — standard CIF pattern
  (`assertInInjectionContext` unless `injector` given).
- **Materializes eagerly + synchronously at call time** (local store hydrates
  synchronously → first CD pass has data). Hash-change re-materialization runs in an
  effect; TTL changes call `updateTTL` without re-materializing.
- View mechanism: default `TypedView` + `addListener` → `signal.set()`. Snapshots are
  immutable with structural sharing (row identity preserved → `@for track` reuses DOM).
  A custom ViewFactory via `@rocicorp/zero/bindings` is a v2 perf project, only if
  profiling justifies it.
- **Per-call views, no ViewStore.** React's ViewStore exists for StrictMode remounts and
  render-phase materialization; Angular has neither. Zero dedupes the IVM pipeline by
  query hash anyway. Cleanup via `DestroyRef`.

### `injectMutation(mutator, options?): MutationRef`

- Stateful ref over one registry mutator. `MutatorResult.client/server` **resolve, never
  reject**, with `{type: 'success' | 'error'}` — the ref maps both symmetrically:
  - `mutate(args)` — returns the underlying `MutatorResult` (still awaitable)
  - `pending()` — true until server settles
  - `clientPending()` — true until optimistic commit settles
  - `clientResult()` / `serverResult()` — `MutatorResultDetails | undefined` (symmetric)
  - `error()` — first error from either promise
- Concurrent calls: latest-call-wins for the signals; each `mutate()` return value is
  still independently awaitable. (Revisit if per-call tracking is needed.)
- Known upstream limitation: mutators cannot return data on success (documented).

### `injectZero(): Signal<Zero<S, MD, C>>`

- Returns a **Signal**, not a raw instance: the instance is recreated on login/logout/
  userID change, and a captured raw reference throws after `close()`. Solid's `useZero`
  is an accessor for the same reason. Escape hatch for `z().preload(...)`, inspector, etc.

### `provideZero(optionsOrFactory)`

- Accepts static options, a reactive factory (may read signals; runs in injection
  context so it can `inject()`), or `{ zero }` for an externally-owned instance.
- Instance lifecycle mirrors the official React/Solid providers:
  - any option change **except** `auth` string rotation → `close()` + recreate
  - `auth` string→string → `zero.connection.connect({auth})` in place
  - auth added/removed or `userID` change → recreate
  - wraps `onClientStateNotFound` → in-place instance rotation (no `location.reload()`)
- `close()` on `EnvironmentInjector` destroy.
- **Browser-only construction** (SSR: see below).

### Also v1

- `injectConnectionState(): Signal<ConnectionState>` — subscribes
  `zero.connection.state`; `'needs-auth'` is the auth-refresh signal.
- Route-resolver/guard `preload` helper (`zeroPreload(queryThunk)`) — Angular-native,
  no other binding has it. Preload TTL default `'none'` per upstream guidance.
- `provideZeroTesting(partialOptions?)` — `cacheURL: null` + `kvStore: 'mem'` gives a
  fully functional local Zero in unit tests, no server.

## SSR (v1 stance)

Server render: do **not** construct Zero; refs hold defaults (`[]`/`undefined`, status
`'unknown'`). Never hold a `PendingTasks` task open for a live view (never settles →
SSR hangs). v1.1: evaluate zero-vue's mem-store-on-server pattern + `TransferState`.

## Packaging

- No ng-packagr: pure functions, nothing for the Angular compiler to compile. Plain
  `tsc` (ESM + d.ts), `exports` map, `sideEffects: false` — same as TanStack's Angular
  adapter. Revisit only if components/directives are ever added (→ APF + ng-packagr).
- Peers: `@angular/core >=20 <23`, `@rocicorp/zero >=1.8 <2`.
- Dev/typecheck against the **floor** (`@angular/core@20`) to guarantee floor compat;
  CI matrix covers newer majors.

## Upstream-churn guardrails

Zero ships monthly minors with heavy deprecation churn (no hard breaks since 1.0).
Scheduled CI (`zero-canary.yml`) tests against `@rocicorp/zero@latest` and `@canary`
twice a week so upstream changes page us, not users.

## Open questions (next spar)

- `injectQuery` list-DX sugar: `keepPreviousData` option when hash changes (avoid
  flash-of-empty during re-materialization)?
- `.asResource()` interop adapter (v22 `Resource` contract, `chain()` composition) —
  wait for demand. Rationale for not building on `resource({stream})`: Zero's
  `'unknown'` state has usable local data immediately; Resource's `loading/resolved/
  reloading` can't express "local data shown, server unconfirmed".
- Suspense analog: `whenComplete(): Promise` on `QueryRef` for `@defer (when ...)`.
- Multi-instance DX (`storageKey`): named injection tokens vs factory-scoped helpers.
- `debounced()`-style helpers for search-as-you-type queries.
