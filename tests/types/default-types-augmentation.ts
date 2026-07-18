/**
 * Compile-time-only proof that Zero's `DefaultTypes` module augmentation flows
 * through `injectZero` with ZERO explicit generics (hard repo constraint).
 *
 * Lives in its own tsconfig program (`tests/types/tsconfig.json`, run by
 * `pnpm typecheck`) because a `declare module '@rocicorp/zero'` augmentation
 * is global to the whole program — inside the main tsconfig it would retype
 * `Zero` for every other source and test file.
 */
import type { Signal } from '@angular/core';
import { createSchema, string, table, type Zero } from '@rocicorp/zero';
import { injectZero } from '../../src/inject-zero.js';

const issue = table('issue').columns({ id: string(), title: string() }).primaryKey('id');
export const schema = createSchema({ tables: [issue] });

declare module '@rocicorp/zero' {
  interface DefaultTypes {
    schema: typeof schema;
  }
}

type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
type Expect<T extends true> = T;

type ReturnedZero = ReturnType<typeof injectZero> extends Signal<infer Z> ? Z : never;
type ReturnedSchema = ReturnedZero extends Zero<infer S> ? S : never;

/** The schema type param of the returned Zero IS the augmented app schema. */
export type AugmentationFlowsThroughInjectZero = Expect<Equal<ReturnedSchema, typeof schema>>;

/** And the signature itself never declares generics — plain `Signal<Zero>`. */
export type SignatureStaysGenericFree = Expect<Equal<ReturnType<typeof injectZero>, Signal<Zero>>>;
