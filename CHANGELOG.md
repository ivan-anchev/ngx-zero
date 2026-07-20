# Changelog

All notable changes to this project are documented in this file.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and the project adheres to [Semantic Versioning](https://semver.org/).

## [0.1.1] - 2026-07-20

### Changed

- No library changes. Releases are now published via npm Trusted Publishing
  (OIDC) with provenance — no long-lived npm credentials in CI.

## [0.1.0] - 2026-07-20

### Added

- `provideZero` / `withBootstrap` — app-level provider wiring a Zero instance from a reactive config factory; auth token rotation reconnects the existing instance in place, other config changes (e.g. `userID`) close and recreate it
- `injectZero` — direct access to the current Zero instance
- `injectQuery` — signal-based query binding (`data`, `status`, result details)
- `injectMutator` — signal-based mutator binding (`pending`, `error`)
- `injectConnectionState` — connection state as a signal
- `provideZeroTesting` — test-friendly provider substitute

[0.1.1]: https://github.com/ivan-anchev/ngx-zero/releases/tag/v0.1.1
[0.1.0]: https://github.com/ivan-anchev/ngx-zero/releases/tag/v0.1.0
