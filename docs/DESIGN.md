# ngx-zero — Design

Signals-first, zoneless-ready Angular bindings for [Rocicorp Zero](https://zero.rocicorp.dev).
Decisions recorded 2026-07-15 against `@rocicorp/zero@1.8.0` and Angular v22 (floor v20).

## Principles

1. **Single inject per use-site.** A component touches exactly one of `injectZero`,
   `injectQuery`, `injectMutator`. Never "inject the instance, then pass it to a
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
readonly close  = injectMutator(mutators.issue.close);
```

### `injectQuery(queryThunk, options?): QueryRef<T>` — implemented

- Thunk runs in a **reactive context** (TanStack-adapter style): signals read inside
  retrack. One computed tracks both the current Zero instance and the query identity,
  coalescing their changes into one reconciliation.
- Identity is semantic rather than object identity, and Zero defines it. The thunk
  result (raw query or registry `QueryRequest`) is resolved against the instance's
  current context via `addContextToQuery` — exactly what `zero.materialize` does
  internally — so validators, context, and AST semantics all participate. The key is
  the resolved query's canonical client hash (its AST hash, the same identity Zero's
  React binding uses) plus its serialized result format, because `.one()` and
  `.limit(1)` can share an AST hash while returning different shapes. A registry
  request therefore keys equal to a semantically identical raw query, and args key
  order never matters. Resolution runs per thunk re-run — the same per-render cost
  Zero's React binding pays. A new object with an unchanged key never destroys the
  view; the resolved query itself is what gets materialized.
- Thunk may return `Falsy` to disable → typed overload where `data: Signal<T | undefined>`,
  status can be `'disabled'`. Disabling destroys the live view and resets data to
  `undefined`, status to `'disabled'`, and error to `undefined`; re-enabling materializes
  against the current instance. The always-enabled overload excludes `'disabled'` from
  its status type.
- Returns an object of signals (NOT a tuple, NOT an Angular `Resource`):
  `data`, `status: Signal<'unknown' | 'complete' | 'error' | 'disabled'>`,
  `error`, `isComplete`, `retry()`, `updateTTL()`.
- `options: { ttl?: TTL; keepPreviousData?: boolean; injector?: Injector }` — standard CIF pattern
  (`assertInInjectionContext` unless `injector` given).
- **Materializes eagerly + synchronously at call time** (local store hydrates
  synchronously through the listener → first CD pass has data). Key or instance changes
  re-materialize in an effect. Listener emissions are the only write path for the
  data/status/error triple; successful emissions clear an earlier error.
- `keepPreviousData` is opt-in and applies only to a same-instance enabled key change whose
  new initial snapshot is both empty and `'unknown'`. During that bridge, data remains the
  previous snapshot, status reflects the new view's `'unknown'`, `isComplete` is false, and
  error is cleared. The first later emission ends the bridge. Fresh local rows always win.
  Instance replacement is a hard reset regardless of this option, preventing old-user data
  from flashing after an identity change.
- `retry()` destroys and re-materializes the current enabled query against the current
  instance from any status; it is a no-op while disabled or after host destruction. During
  a bridge it performs a hard refresh and drops the bridge. `updateTTL(ttl)` forwards to the
  current view without re-materializing and does not persist to a future view; each new
  materialization reads `options.ttl` again.
- View mechanism: default `TypedView` + `addListener` → `signal.set()`. Snapshots are
  immutable with structural sharing (row identity preserved → `@for track` reuses DOM).
  A custom ViewFactory via `@rocicorp/zero/bindings` is a v2 perf project, only if
  profiling justifies it.
- **Per-call views, no ViewStore.** React's ViewStore exists for StrictMode remounts and
  render-phase materialization; Angular has neither. Zero dedupes the IVM pipeline by
  query hash anyway. Cleanup via `DestroyRef` marks the session stale, unsubscribes the
  listener, then destroys the view. Missing `provideZero` throws setup guidance at inject
  time. Reconcile is candidate-first: the new session is materialized and subscribed
  before the live one is retired, then swapped in atomically together with its initial
  snapshot. Thrown thunks and materialization/subscription failures therefore propagate
  while the prior session remains fully live — still subscribed, still updating the
  signals — and the next identity change or `retry()` reconciles normally.

### `injectMutator(mutator, options?): MutatorRef<TInput>` — implemented

Stateful ref over one registry mutator leaf (`mutators.issue.close`). Thin
reactive projection of `zero.mutate(request)` — no retries, queues, callbacks,
or cache interaction.

- `mutate(...args)` mirrors the mutator's own call signature (no-args /
  optional / required — reconstructed from Zero's `MutatorCallable` shape) and
  returns a `MutatorResult`. Zero explicit generics at call sites; inference
  flows from the `Mutator` leaf's embedded types / `DefaultTypes` augmentation;
  multi-instance apps use `defineMutatorWithType` exactly as with queries.
- **Never-reject guarantee.** The returned `client`/`server` promises always
  resolve with `MutatorResultDetails`; any underlying rejection is normalized
  to `{type:'error', error:{type:'zero', message}}`. Zero 1.8.0's own
  `MutatorProxy` already normalizes its internal rejections the same way, so
  this diverges from upstream by zero in shape and (today) zero in behavior —
  it hardens an undocumented upstream property into a library contract.
  Fire-and-forget `mutate()` calls can never produce unhandled rejections.
- Sync failures (`provideZero` missing at inject time; no instance yet or
  mutator not registered at mutate time) **throw synchronously** and leave ref
  state untouched — setup errors fail fast instead of masquerading as
  mutation outcomes.
- Signals (latest-call-wins; one atomic state snapshot, never glitchy; each
  `mutate()` return value stays independently awaitable):
  - `clientPending()` — true until the optimistic apply settles
  - `pending()` — true until the server outcome settles
  - `clientResult()` / `serverResult()` — `MutatorResultDetails | undefined`
  - `error()` — client error first, else server error (covers the rollback
    sequence client-success → server-error); cleared by the next `mutate()`
- An out-of-order settle from a superseded call is dropped via an internal
  call ticket — it never clobbers the latest call's signals. The ticket also
  leaves room for the deferred per-call tracking feature.
- **Local-only instances** (`cacheURL: null`, incl. `provideZeroTesting`):
  Zero settles `.server` only on server acks, so `pending()` stays true and
  `serverResult()` stays `undefined` forever — honest; local-only consumers
  key off `clientPending`/`clientResult`.
- **Instance replacement**: `mutate()` resolves the current instance at each
  call; ref state is *not* reset on replacement. An in-flight call on the old
  instance settles the way Zero settles it (a zero-error details object once
  the instance closes), reported truthfully; the next `mutate()` clears it.
  In-place auth rotation (`connection.connect({auth})`) never replaces the
  instance and is invisible here.
- **Destroy**: `DestroyRef` flips an internal gate; settlements after host
  destruction stop writing signals while awaited results and
  rejection-normalization keep working.
- Known upstream limitation: mutators cannot return data on success.
- `options: { injector?: Injector }` — standard CIF pattern.

### `injectZero(options?): Signal<Zero>` — implemented

- Returns the current instance as a signal so consumers follow instance replacement.
- Uses the current injection context, or an explicit `{ injector }` outside one.
- Throws with setup guidance when `provideZero(...)` is missing.

### `provideZero(source, ...features)` — implemented

- Accepts static options, a reactive factory (may read signals; runs in injection
  context so it can `inject()`), or `{ zero }` for an externally-owned instance,
  plus rest-param features such as `withBootstrap(...)`.
- One internal manager owns reconciliation. The environment initializer starts one
  effect, but first reconciles synchronously before registering it. Components can
  therefore materialize queries in field initializers; the effect tracks later source
  changes without duplicating the initial instance.

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

- `.asResource()` interop adapter (v22 `Resource` contract, `chain()` composition) —
  wait for demand. Rationale for not building on `resource({stream})`: Zero's
  `'unknown'` state has usable local data immediately; Resource's `loading/resolved/
  reloading` can't express "local data shown, server unconfirmed".
- Suspense analog: `whenComplete(): Promise` on `QueryRef` for `@defer (when ...)`.
- Multi-instance DX (`storageKey`): named injection tokens vs factory-scoped helpers.
- `debounced()`-style helpers for search-as-you-type queries.
