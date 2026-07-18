import {
  assertInInjectionContext,
  computed,
  DestroyRef,
  effect,
  inject,
  Injector,
  untracked,
} from '@angular/core';
import type {
  BaseDefaultContext,
  BaseDefaultSchema,
  DefaultContext,
  DefaultSchema,
  Falsy,
  HumanReadable,
  PullRow,
  QueryOrQueryRequest,
  ReadonlyJSONValue,
} from '@rocicorp/zero';
import { ngxZeroError } from './errors.js';
import { ZERO_INSTANCE } from './instance-manager.js';
import {
  queryIdentityKey,
  type AnyQueryOrRequest,
} from './query-identity.js';
import type {
  InjectQueryOptions,
  QueryRef,
  QueryStatus,
} from './query-ref.js';
import {
  DISABLED,
  QueryViewController,
  type QuerySpec,
} from './query-view-controller.js';

// The overloads mirror Zero's own useQuery generics verbatim so inference
// needs no call-site generics. Order matters: a never-falsy thunk must
// resolve to the tighter always-enabled signature.

/** Always-enabled: tight data type, status can never be 'disabled'. */
export function injectQuery<
  TTable extends keyof TSchema['tables'] & string,
  TInput extends ReadonlyJSONValue | undefined,
  TOutput extends ReadonlyJSONValue | undefined,
  TSchema extends BaseDefaultSchema = DefaultSchema,
  TReturn = PullRow<TTable, TSchema>,
  TContext extends BaseDefaultContext = DefaultContext,
>(
  queryThunk: () => QueryOrQueryRequest<
    TTable,
    TInput,
    TOutput,
    TSchema,
    TReturn,
    TContext
  >,
  options?: InjectQueryOptions,
): QueryRef<HumanReadable<TReturn>>;

/** Disableable: data widens with `| undefined`, status with 'disabled'. */
export function injectQuery<
  TTable extends keyof TSchema['tables'] & string,
  TInput extends ReadonlyJSONValue | undefined,
  TOutput extends ReadonlyJSONValue | undefined,
  TSchema extends BaseDefaultSchema = DefaultSchema,
  TReturn = PullRow<TTable, TSchema>,
  TContext extends BaseDefaultContext = DefaultContext,
>(
  queryThunk: () =>
    | QueryOrQueryRequest<
        TTable,
        TInput,
        TOutput,
        TSchema,
        TReturn,
        TContext
      >
    | Falsy,
  options?: InjectQueryOptions,
): QueryRef<HumanReadable<TReturn> | undefined, QueryStatus>;

export function injectQuery(
  queryThunk: () => AnyQueryOrRequest | Falsy,
  options: InjectQueryOptions = {},
): QueryRef<unknown, QueryStatus> {
  if (options.injector === undefined) {
    assertInInjectionContext(injectQuery);
  }
  const injector = options.injector ?? inject(Injector);

  const manager = injector.get(ZERO_INSTANCE, null, { optional: true });
  if (!manager) {
    throw ngxZeroError(
      'injectQuery() could not find a Zero instance manager. ' +
        'Add provideZero(...) to your ApplicationConfig providers.',
    );
  }

  // One computed reads both change sources (instance signal + thunk signals),
  // so "either changes -> re-materialize exactly once" falls out of signal
  // coalescing. The custom `equal` compares semantic identity: a key-equal
  // thunk re-run keeps the old reference and downstream never re-fires. A
  // throwing thunk throws here — the controller is never entered and any
  // previous view stays intact.
  const spec = computed<QuerySpec>(
    () => {
      const zero = manager.zeroOrThrow();
      const result = queryThunk();
      return result
        ? { zero, key: queryIdentityKey(result), request: result }
        : { zero, key: DISABLED, request: undefined };
    },
    { equal: (a, b) => a.zero === b.zero && a.key === b.key },
  );

  const controller = new QueryViewController({
    keepPreviousData: options.keepPreviousData ?? false,
    ttl: options.ttl,
  });

  // Cleanup is registered before the eager materialization: if it throws,
  // construction fails with nothing live to leak.
  injector.get(DestroyRef).onDestroy(() => controller.destroy());

  // Eager synchronous materialization: the first change-detection pass
  // renders real rows. The effect's first flush re-reads the same cached
  // spec object, which reconcile() treats as a no-op.
  untracked(() => controller.reconcile(spec()));

  effect(
    () => {
      const current = spec();
      untracked(() => controller.reconcile(current));
    },
    { injector },
  );

  return {
    data: controller.data,
    status: controller.status,
    error: controller.error,
    isComplete: computed(() => controller.status() === 'complete'),
    retry: () => controller.retry(spec),
    updateTTL: ttl => controller.updateTTL(ttl),
  };
}
