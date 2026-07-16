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

### `provideZero(source, ...features)` — implemented

- Accepts static options, a reactive factory (may read signals; runs in injection
  context so it can `inject()`), or `{ zero }` for an externally-owned instance,
  plus rest-param **features** (`withInit(...)`, ship-gated `withAuthRefresh(...)`).
- Architecture: one internal `ZeroInstanceManager` behind an `InjectionToken`
  (never exported) owns the instance. Every lifecycle transition funnels through
  **one synchronous reconcile function driven by one effect**, so no two
  reconciles ever interleave. Construction is eager and synchronous in an
  environment initializer (root effects only flush with first CD — effect-only
  construction would break the non-nullable first-read contract).

Lifecycle verdicts (diff of previous vs next factory output):

| Transition | Verdict | Action |
|---|---|---|
| identical rerun / only fn identity changed | `noop` | strictly nothing (latest closures still captured) |
| `auth` string→string | `connect` | `zero.connection.connect({auth})` in place; auth epoch bumped |
| `auth` added/removed (login/logout), any other option change | `recreate` | `close()` (unawaited) + `new Zero(...)` |
| `onClientStateNotFound` fires (no user callback, or user callback throws) | rotation | in-place recreate with same options — no `location.reload()`; a late CSNF from a superseded (closing) instance is ignored — it never rotates the healthy replacement |
| `{ zero }` external source | adopt | never closed by the library; features still attach |

- **Equality stance**: function-valued options compare by *presence only* —
  sound because instances never capture user functions, only stable wrappers
  that delegate to the latest factory output (so fresh inline closures cause
  zero churn but still run the newest code). Non-function values use
  `Object.is` plus a one-level shallow fallback for plain object/array literals
  (inline `queryHeaders: {…}` is not a footgun); deliberately not recursive.
  No hardcoded key list — the diff is structural over the union of own keys,
  with a `Required<ZeroOptions>` canary test as the upstream-addition tripwire.
- **Auth epoch**: a monotonic counter bumped on every recreate and every
  factory-driven connect. Async consumers (the auth refresher) capture it
  before awaiting and discard stale results — a timing-independent barrier.
- **Unawaited close**: `close()` is fired and swallowed on recreate/destroy;
  the instance signal never transiently holds `undefined`, and Zero's
  `ActiveClientsManager` arbitrates same-storage overlap. Zero persists
  continuously, so an unawaited close loses nothing.
- **Constructor failure**: never re-expose the already-closed predecessor —
  the signal goes `undefined`, the error is reported via `ErrorHandler`, and
  the next valid factory emission recovers. A factory that throws at bootstrap
  fails bootstrap loudly (programming error); a throw on rerun retains the
  previous instance and self-recovers.
- **Features pattern**: `with*()` returns an opaque `ZeroFeature` (ɵ-prefixed
  internals); duplicate kinds are rejected at provide time. Features register
  `ZERO_INSTANCE_HOOKS` multi-providers: `onInstanceCreated` (owned
  constructions only — React `init` parity) and `onInstanceAttached` (every
  current instance, returns a detach fn). Hook throws (create, attach, detach)
  are contained — reported via `ErrorHandler`, reconcile continues — so one
  broken feature can never leave a closed predecessor visible or starve the
  remaining hooks.
- `close()` on `EnvironmentInjector` destroy; teardown never throws.
- **Browser-only construction**: SSR is fully inert — `injectZero()` *call*
  succeeds on the server, the factory never runs, *reading* the signal throws
  an actionable message (see SSR below).

### `provideZeroTesting(options, ...features)` — implemented

- Fully functional **local** Zero (real IVM, real mutators, no network) for
  TestBed. Forced at type + runtime: `cacheURL: null`, `server: null`.
  Defaulted but overridable: `kvStore: 'mem'`, `logLevel: 'error'`.
- Factory form preserved — lifecycle tests drive reconciliation through the
  preset exactly like production.

### `withAuthRefresh(refreshFn, options?)` — implemented, SHIP-GATED

Code and tests land, but the export stays commented in `src/index.ts` until the
feature is cleared to ship. Upstream caution: Zero deliberately *removed*
`auth: () => Promise<string>` in favor of explicit string + `connect()`; this
re-adds that convenience at the binding layer, so each semantic is a hard
invariant:

- **Refresh trigger**: `'needs-auth'` connection state only (`'error'` is
  deliberately not handled — auto-connect would mask fatal non-auth failures).
  Subscribe does NOT replay in Zero 1.8, so attach explicitly checks
  `state.current` (instance already in needs-auth at attach must kick).
- **Dedup**: one service-level in-flight latch — dedups across rapid emissions
  and across instance rotation.
- **Budget**: attempts count since last *successful connection* (`'connected'`
  resets — token accepted, not merely produced). Not reset per instance or
  episode, so a server that keeps rejecting freshly-minted tokens converges to
  give-up instead of looping.
- **Give-up**: after `maxAttempts` (default 3) or a null-like resolve (no token
  exists — retrying can't mint a session): optional `onGiveUp` fires once; the
  terminal `'needs-auth'` stays observable on `zero.connection.state`
  (upstream-native surface, no parallel observable). `'connected'` re-arms.
- **Backoff**: rejection → `backoffMs(attempt)` (default `min(1000·2ⁿ, 30s)`,
  no jitter), then a re-check — if the options factory fixed auth meanwhile,
  no retry happens at all. A throwing user `backoffMs` is contained and falls
  back to the default schedule (it must never wedge the in-flight latch).
- **Stale-push safety**, three guards before `connect({auth})`: instance is
  still current, auth epoch unchanged, state still `'needs-auth'` — the
  reactive options factory wins every race by construction.

### Also v1

- `injectConnectionState(): Signal<ConnectionState>` — subscribes
  `zero.connection.state`; `'needs-auth'` is the auth-refresh signal.
- Route-resolver/guard `preload` helper (`zeroPreload(queryThunk)`) — Angular-native,
  no other binding has it. Preload TTL default `'none'` per upstream guidance.
- `provideZeroTesting` — implemented; see its section above.

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
- `withAuthRefresh` ship gate: the feature is implemented with answers for
  concurrent-refresh dedup, refresh-failure backoff, and give-up (see its
  section above), but the public export stays commented in `src/index.ts` until
  it is cleared to ship against real-world `needs-auth` behavior.
