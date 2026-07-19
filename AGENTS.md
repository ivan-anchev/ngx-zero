# ngx-zero

Signals-first, zoneless-ready Angular bindings for Rocicorp Zero.

## Ground rules

- `docs/DESIGN.md` is the source of truth for the public API and its rationale.
  Change it in the same PR as any API change.
- Single-inject principle: users touch exactly one of `injectZero` / `injectQuery` /
  `injectMutator` per use-site. Never design an API that requires injecting the
  instance and passing it to another inject.
- Only modern Zero (≥1.x) APIs: `zero.materialize(queryOrRequest, opts)`,
  `QueryOrQueryRequest`, `defineQueries`/`defineMutators` registries,
  `zero.connection`. Never `zero.query.*`, `query.materialize()`, or other
  deprecated surface.
- Zoneless-first, but zone.js is a hard support requirement — no `NgZone` usage in
  library code (hybrid scheduler handles CD); both modes must be tested.
- Type inference is a feature: no explicit generics at call sites, no `any` leaks.
  Lean on Zero's `DefaultTypes` module augmentation.
- No ng-packagr — plain tsc ESM build. Do not add components/directives/pipes
  without revisiting packaging (would require APF + ng-packagr).

## Commands

- `pnpm typecheck` / `pnpm test` / `pnpm build`
- `pnpm check:package` — publint + arethetypeswrong against the built package

## Git conventions

- Use Conventional Commit-style messages: `type(scope): summary`. The scope is
  optional; keep the summary imperative, lowercase, and concise.
- Allowed commit types:
  - `feat` — add or change user-facing functionality.
  - `fix` — correct a bug or regression.
  - `test` — add or update tests without changing production behavior.
  - `refactor` — restructure production code without changing behavior.
  - `chore` — maintenance, tooling, dependencies, or repository housekeeping.
