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

### `injectZero(options?): Signal<Zero>` — implemented

- Returns the current instance as a signal so consumers follow instance replacement.
- Uses the current injection context, or an explicit `{ injector }` outside one.
- Throws with setup guidance when `provideZero(...)` is missing.

### `provideZero(source, ...features)` — implemented

- Accepts static options, a reactive factory (may read signals; runs in injection
  context so it can `inject()`), or `{ zero }` for an externally-owned instance,
  plus rest-param features such as `withBootstrap(...)`.
- One internal manager owns reconciliation. The environment initializer starts one
  effect; the first instance is created on that effect's initial flush.

Lifecycle verdicts (diff of previous vs next factory output):

| Transition | Verdict | Action |
|---|---|---|
| identical rerun | `noop` | nothing |
| `auth` string→string | `connect` | `zero.connection.connect({auth})` in place |
| `auth` added/removed, or another option changes | `recreate` | create the replacement and close the previous owned instance |
| `onClientStateNotFound` without a user callback | rotation | recreate with the current options |
| `onClientStateNotFound` with a user callback | user-owned | invoke the callback without automatic rotation |
| `{ zero }` external source | adopt | use it without constructing or closing it |

- **Equality stance**: every option except `auth` and
  `onClientStateNotFound` is compared at the top level with `Object.is`, matching
  React dependency semantics. Fresh object, array, and function values therefore
  recreate the instance even when structurally equivalent; callers should keep
  those references stable when they do not intend a recreate. No hardcoded
  `ZeroOptions` key list: the diff uses the union of own keys.
- `close()` is unawaited on replacement and environment destruction. External
  instances are never closed by the library.
- Constructor failures are reported through `ErrorHandler`; an existing current
  instance is preserved.
- `withBootstrap(fn)` runs after every owned construction, in injection context.
  It does not run for external instances. Duplicate feature kinds are rejected.

### `provideZeroTesting(options, ...features)` — implemented

- Fully functional **local** Zero (real IVM, real mutators, no network) for
  TestBed. Forced at type + runtime: `cacheURL: null`, `server: null`.
  Defaulted but overridable: `kvStore: 'mem'`, `logLevel: 'error'`.
- Factory form preserved — lifecycle tests drive reconciliation through the
  preset exactly like production.

### Also v1

- `injectConnectionState(): Signal<ConnectionState>` — subscribes
  `zero.connection.state`; `'needs-auth'` is the auth-refresh signal.
- Route-resolver/guard `preload` helper (`zeroPreload(queryThunk)`) — Angular-native,
  no other binding has it. Preload TTL default `'none'` per upstream guidance.
- `provideZeroTesting` — implemented; see its section above.

## SSR (v1 stance)

There is no server-specific branch yet: `provideZero` currently follows the same
lifecycle on the server. An inert or memory-store SSR strategy is deferred.

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
