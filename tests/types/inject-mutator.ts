import type { Signal } from '@angular/core';
import {
  createSchema,
  defineMutators,
  defineMutatorWithType,
  string,
  table,
  type MutatorResult,
  type MutatorResultDetails,
  type Transaction,
} from '@rocicorp/zero';
import {
  injectMutator,
  type MutatorError,
  type MutatorRef,
} from '../../src/index.js';
import { schema } from './default-types-augmentation.js';

type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2
    ? true
    : false;
type Expect<T extends true> = T;
type IsAny<T> = 0 extends 1 & T ? true : false;

const defineIssueMutator = defineMutatorWithType<typeof schema>();
const mutators = defineMutators({
  issue: {
    update: defineIssueMutator(
      async ({
        args,
      }: {
        tx: Transaction<typeof schema>;
        args: { id: string; title: string };
      }) => {
        void args;
      },
    ),
    touch: defineIssueMutator(
      async ({ args }: { tx: Transaction<typeof schema>; args: undefined }) => {
        void args;
      },
    ),
    poke: defineIssueMutator(
      async ({
        args,
      }: {
        tx: Transaction<typeof schema>;
        args: { note: string } | undefined;
      }) => {
        void args;
      },
    ),
  },
});

// --- required-args mutator -------------------------------------------------

const update = injectMutator(mutators.issue.update);
export type UpdateRefInference = Expect<
  Equal<typeof update, MutatorRef<{ id: string; title: string }>>
>;
export type UpdateArgsTuple = Expect<
  Equal<Parameters<typeof update.mutate>, [args: { id: string; title: string }]>
>;
export type UpdateReturnsMutatorResult = Expect<
  Equal<ReturnType<typeof update.mutate>, MutatorResult>
>;
void update.mutate({ id: 'i1', title: 'ok' });
// @ts-expect-error required args cannot be omitted
void update.mutate();
// @ts-expect-error wrong argument shape is rejected
void update.mutate({ id: 'i1' });

// --- no-args mutator -------------------------------------------------------

const touch = injectMutator(mutators.issue.touch);
export type TouchArgsTuple = Expect<Equal<Parameters<typeof touch.mutate>, []>>;
void touch.mutate();
// @ts-expect-error a no-args mutator accepts no argument, not even undefined
void touch.mutate(undefined);
// @ts-expect-error a no-args mutator accepts no argument
void touch.mutate({});

// --- optional-args mutator -------------------------------------------------

const poke = injectMutator(mutators.issue.poke);
export type PokeArgsTuple = Expect<
  Equal<Parameters<typeof poke.mutate>, [args?: { note: string } | undefined]>
>;
void poke.mutate();
void poke.mutate(undefined);
void poke.mutate({ note: 'hi' });
// @ts-expect-error wrong optional argument shape is rejected
void poke.mutate({ note: 1 });

// --- signal surface --------------------------------------------------------

export type ClientPendingIsBooleanSignal = Expect<
  Equal<typeof update.clientPending, Signal<boolean>>
>;
export type PendingIsBooleanSignal = Expect<
  Equal<typeof update.pending, Signal<boolean>>
>;
export type ClientResultIsDetailsSignal = Expect<
  Equal<typeof update.clientResult, Signal<MutatorResultDetails | undefined>>
>;
export type ServerResultIsDetailsSignal = Expect<
  Equal<typeof update.serverResult, Signal<MutatorResultDetails | undefined>>
>;
export type ErrorIsMutatorErrorSignal = Expect<
  Equal<typeof update.error, Signal<MutatorError | undefined>>
>;
// @ts-expect-error ref signals are readonly properties
update.pending = update.clientPending;
// @ts-expect-error lifecycle signals are read-only Signals without set()
update.error.set(undefined);

// --- leaf-only acceptance --------------------------------------------------

// @ts-expect-error a registry namespace is not a mutator leaf
void injectMutator(mutators.issue);
// @ts-expect-error a MutateRequest is not a mutator leaf
void injectMutator(mutators.issue.update({ id: 'i1', title: 'no' }));
// @ts-expect-error an arbitrary function is not a mutator leaf
void injectMutator(() => undefined);

// --- multi-instance defineMutatorWithType registry -------------------------

const account = table('account').columns({ id: string(), name: string() }).primaryKey('id');
const otherSchema = createSchema({ tables: [account] });
void otherSchema;
interface OtherContext {
  readonly role: 'admin' | 'user';
}

const defineAccountMutator = defineMutatorWithType<typeof otherSchema, OtherContext>();
const otherMutators = defineMutators({
  account: {
    rename: defineAccountMutator(
      async ({
        args,
      }: {
        tx: Transaction<typeof otherSchema>;
        args: { id: string; name: string };
      }) => {
        void args;
      },
    ),
  },
});

/** Compiles with ZERO explicit generics despite the DefaultTypes augmentation. */
const rename = injectMutator(otherMutators.account.rename);
export type OtherRegistryArgsTuple = Expect<
  Equal<Parameters<typeof rename.mutate>, [args: { id: string; name: string }]>
>;
void rename;

// --- no `any` leaks --------------------------------------------------------

export type NoAnyInUpdateArgs = Expect<
  Equal<IsAny<Parameters<typeof update.mutate>[0]>, false>
>;
export type NoAnyInMutateReturn = Expect<
  Equal<IsAny<ReturnType<typeof update.mutate>>, false>
>;
export type NoAnyInClientResult = Expect<
  Equal<IsAny<ReturnType<typeof update.clientResult>>, false>
>;
export type NoAnyInError = Expect<
  Equal<IsAny<ReturnType<typeof update.error>>, false>
>;
