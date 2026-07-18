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
  throwOnUnsubscribe = false;
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
      if (this.throwOnUnsubscribe) {
        throw new Error('unsubscribe boom');
      }
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
  readonly optionsSeen: Array<{ ttl?: TTL } | undefined> = [];
  failNext = false;

  constructor(readonly views: FakeTypedView[]) {}

  materialize(request: unknown, options?: { ttl?: TTL }): TypedView<unknown> {
    if (this.failNext) {
      this.failNext = false;
      throw new Error('materialize boom');
    }
    this.requests.push(request);
    this.optionsSeen.push(options);
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

  it('releases the view and keeps stale writes dead when unsubscribe throws', () => {
    const first = new FakeTypedView([{ id: 'old' }], 'complete');
    first.throwOnUnsubscribe = true;
    const second = new FakeTypedView([{ id: 'fresh' }], 'complete');
    const zero = new MaterializeHarness([second]);
    const seedZero = new MaterializeHarness([first]);
    const query = controller();

    query.reconcile(spec(seedZero, 'old'));
    expect(() => query.reconcile(spec(zero, 'new'))).toThrow(/unsubscribe boom/);

    expect(first.destroyed).toBe(true);
    first.emit([{ id: 'stale' }], 'complete');
    expect(query.data()).toEqual([{ id: 'old' }]);

    const recovery = spec(zero, 'new');
    query.retry(() => recovery);
    expect(query.data()).toEqual([{ id: 'fresh' }]);
  });

  it('destroys every intermediate view under rapid key flapping and keeps the last key', () => {
    const views = ['a', 'b', 'c', 'd', 'e'].map(
      id => new FakeTypedView([{ id }], 'complete'),
    );
    const zero = new MaterializeHarness(views);
    const query = controller();

    for (const key of ['a', 'b', 'c', 'd', 'e']) {
      query.reconcile(spec(zero, key));
    }

    expect(zero.requests).toHaveLength(5);
    for (const view of views.slice(0, -1)) {
      expect(view.unsubscribed).toBe(true);
      expect(view.destroyed).toBe(true);
    }
    expect(views[4]!.destroyed).toBe(false);
    expect(query.data()).toEqual([{ id: 'e' }]);
  });

  it('cleans up a mid-bridge destroy and ignores everything afterwards', () => {
    const first = new FakeTypedView([{ id: 'old' }], 'complete');
    const second = new FakeTypedView([], 'unknown');
    const zero = new MaterializeHarness([first, second]);
    const query = controller(true);

    query.reconcile(spec(zero, 'old'));
    query.reconcile(spec(zero, 'new'));
    expect(query.data()).toEqual([{ id: 'old' }]);

    query.destroy();

    expect(second.unsubscribed).toBe(true);
    expect(second.destroyed).toBe(true);

    second.emit([{ id: 'late' }], 'complete');
    expect(query.data()).toEqual([{ id: 'old' }]);
    expect(query.status()).toBe('unknown');

    query.reconcile(spec(zero, 'other'));
    query.destroy();
    expect(zero.requests).toHaveLength(2);
  });

  it('treats retry as a no-op while disabled and after destroy', () => {
    const view = new FakeTypedView([{ id: 'i1' }], 'complete');
    const zero = new MaterializeHarness([view]);
    const disabled: QuerySpec = {
      zero: zero as unknown as Zero,
      key: DISABLED,
      request: undefined,
    };
    const query = controller();

    query.reconcile(disabled);
    query.retry(() => disabled);
    expect(zero.requests).toHaveLength(0);
    expect(query.status()).toBe('disabled');

    const enabled = spec(zero, 'all');
    query.reconcile(enabled);
    expect(zero.requests).toHaveLength(1);

    query.destroy();
    query.retry(() => enabled);
    expect(zero.requests).toHaveLength(1);
  });

  it('hard-refreshes on retry during a bridge instead of keeping previous data', () => {
    const first = new FakeTypedView([{ id: 'old' }], 'complete');
    const second = new FakeTypedView([], 'unknown');
    const third = new FakeTypedView([], 'unknown');
    const zero = new MaterializeHarness([first, second, third]);
    const query = controller(true);

    query.reconcile(spec(zero, 'old'));
    const next = spec(zero, 'new');
    query.reconcile(next);
    expect(query.data()).toEqual([{ id: 'old' }]);

    query.retry(() => next);

    expect(second.destroyed).toBe(true);
    expect(zero.requests).toHaveLength(3);
    expect(query.data()).toEqual([]);
    expect(query.status()).toBe('unknown');
  });

  it('keeps prior signals on materialization failure and recovers via retry', () => {
    const first = new FakeTypedView([{ id: 'old' }], 'complete');
    const second = new FakeTypedView([{ id: 'fresh' }], 'complete');
    const zero = new MaterializeHarness([first, second]);
    const query = controller();

    query.reconcile(spec(zero, 'old'));

    const next = spec(zero, 'new');
    zero.failNext = true;
    expect(() => query.reconcile(next)).toThrow(/materialize boom/);

    expect(first.destroyed).toBe(true);
    expect(query.data()).toEqual([{ id: 'old' }]);
    expect(query.status()).toBe('complete');

    query.updateTTL(42);
    expect(first.ttlUpdates).toEqual([]);

    query.reconcile(next);
    expect(zero.requests).toHaveLength(1);

    query.retry(() => next);
    expect(query.data()).toEqual([{ id: 'fresh' }]);
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
