/**
 * ngx-zero — signals-first, zoneless-ready Angular bindings for Rocicorp Zero.
 *
 * The public API surface and its rationale live in docs/DESIGN.md.
 */
export { provideZero } from './provide-zero.js';
export { injectZero, type InjectZeroOptions } from './inject-zero.js';
export { provideZeroTesting, type ZeroTestingOptions } from './provide-zero-testing.js';
export { withInit } from './with-init.js';
export type { ZeroFeature, ZeroFeatureKind } from './features.js';
export type { ZeroInstanceSource, ExternalZeroSource } from './options-diff.js';
// SHIP GATE: uncomment when tests/with-auth-refresh.spec.ts is green and the
// feature is cleared to ship (see docs/DESIGN.md).
// export {withAuthRefresh, type ZeroAuthRefreshFn, type ZeroAuthRefreshOptions}
//   from './with-auth-refresh.js';
