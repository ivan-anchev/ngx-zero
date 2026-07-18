import type {
  ErroredQuery,
  ResultType,
  TTL,
  TypedView,
  Zero,
} from '@rocicorp/zero';
import { describe, expect, it } from 'vitest';
import type { AnyQueryRequest } from '../src/query-identity.js';
import {
  DISABLED,
  QueryViewController,
  type QuerySpec,
} from '../src/query-view-controller.js';

class FakeTypedView {
  listener:
    | ((data: unknown, resultType: ResultType, error?: ErroredQuery) => void)
    | undefined;
  unsubscribed = false;
  destroyed = false;
  readonly ttlUpdates: TTL[] = [];

  constructor(
    readonly data: unknown,
    readonly initialStatus: ResultType,
  ) {}

  addListener(
    listener: (
      data: unknown,
      resultType: ResultType,
      error?: ErroredQuery,
    ) => void,
  ): () => void {
    this.listener = listener;
    listener(this.data, this.initialStatus);
    return () => {
      this.unsubscribed = true;
    };
  }

  emit(data: unknown, resultType: ResultType, error?: ErroredQuery): void {
    this.listener?.(data, resultType, error);
  }

  destroy(): void {
    this.destroyed = true;
  }

  updateTTL(ttl: TTL): void {
    this.ttlUpdates.push(ttl);
  }
}

class MaterializeHarness {
  readonly requests: unknown[] = [];

  constructor(readonly views: FakeTypedView[]) {}

  materialize(request: unknown): TypedView<unknown> {
    this.requests.push(request);
    const view = this.views[this.requests.length - 1];
    if (!view) {
      throw new Error('no fake view configured');
    }
    return view as unknown as TypedView<unknown>;
  }
}

const request = (name: string): AnyQueryRequest => ({
  query: { queryName: name },
  args: undefined,
  '~': 'QueryRequest',
});

const spec = (
  zero: MaterializeHarness,
  key: string,
): QuerySpec => ({
  zero: zero as unknown as Zero,
  key,
  request: request(key),
});

const controller = (keepPreviousData = false): QueryViewController =>
  new QueryViewController({ keepPreviousData, ttl: undefined });

describe('QueryViewController', () => {
  it('materializes and seeds its signals synchronously', () => {
    const view = new FakeTypedView([{ id: 'i1' }], 'complete');
    const zero = new MaterializeHarness([view]);
    const query = controller();

    query.reconcile(spec(zero, 'all'));

    expect(query.data()).toEqual([{ id: 'i1' }]);
    expect(query.status()).toBe('complete');
    expect(query.error()).toBeUndefined();
    expect(zero.requests).toHaveLength(1);
  });

  it('tears down the prior session and drops stale writes on a key change', () => {
    const first = new FakeTypedView([{ id: 'old' }], 'complete');
    const second = new FakeTypedView([{ id: 'new' }], 'complete');
    const zero = new MaterializeHarness([first, second]);
    const query = controller();

    query.reconcile(spec(zero, 'old'));
    query.reconcile(spec(zero, 'new'));

    expect(first.unsubscribed).toBe(true);
    expect(first.destroyed).toBe(true);
    expect(query.data()).toEqual([{ id: 'new' }]);

    first.emit([{ id: 'stale' }], 'complete');
    expect(query.data()).toEqual([{ id: 'new' }]);
  });

  it('bridges empty unknown data until the new view emits', () => {
    const first = new FakeTypedView([{ id: 'old' }], 'complete');
    const second = new FakeTypedView([], 'unknown');
    const zero = new MaterializeHarness([first, second]);
    const query = controller(true);

    query.reconcile(spec(zero, 'old'));
    query.reconcile(spec(zero, 'new'));

    expect(query.data()).toEqual([{ id: 'old' }]);
    expect(query.status()).toBe('unknown');

    second.emit([{ id: 'new' }], 'complete');
    expect(query.data()).toEqual([{ id: 'new' }]);
    expect(query.status()).toBe('complete');
  });

  it('retries, forwards TTL, disables, and destroys the live session', () => {
    const first = new FakeTypedView([{ id: 'old' }], 'complete');
    const second = new FakeTypedView([{ id: 'fresh' }], 'complete');
    const zero = new MaterializeHarness([first, second]);
    const current = spec(zero, 'all');
    const query = controller();

    query.reconcile(current);
    query.retry(() => current);

    expect(first.destroyed).toBe(true);
    expect(query.data()).toEqual([{ id: 'fresh' }]);

    query.updateTTL(42);
    expect(second.ttlUpdates).toEqual([42]);

    query.reconcile({ zero: current.zero, key: DISABLED, request: undefined });
    expect(second.destroyed).toBe(true);
    expect(query.data()).toBeUndefined();
    expect(query.status()).toBe('disabled');

    query.destroy();
  });
});
