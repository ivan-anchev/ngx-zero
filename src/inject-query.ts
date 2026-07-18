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

  injector.get(DestroyRef).onDestroy(() => controller.destroy());

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
