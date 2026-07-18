import { beforeEach, describe, expect, it, vi } from 'vitest';
import { login, session } from '../examples/playground/src/auth-session';

interface DeferredResponse {
  readonly promise: Promise<Response>;
  readonly resolve: (response: Response) => void;
}

function deferredResponse(): DeferredResponse {
  let resolve!: (response: Response) => void;
  const promise = new Promise<Response>(done => {
    resolve = done;
  });
  return { promise, resolve };
}

function loginResponse(token: string): Response {
  return new Response(JSON.stringify({ token }), {
    headers: { 'content-type': 'application/json' },
  });
}

describe('playground login', () => {
  beforeEach(() => {
    session.set(undefined);
    vi.unstubAllGlobals();
  });

  it('ignores an older response that resolves after a newer login', async () => {
    const first = deferredResponse();
    const second = deferredResponse();
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);
    vi.stubGlobal('fetch', fetch);

    const user1Login = login('user1');
    const user2Login = login('user2');

    second.resolve(loginResponse('user2-token'));
    await expect(user2Login).resolves.toBe(true);
    first.resolve(loginResponse('user1-token'));
    await expect(user1Login).resolves.toBe(false);

    expect(session()).toEqual({ userID: 'user2', token: 'user2-token' });
  });
});
