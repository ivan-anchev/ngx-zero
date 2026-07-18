import type { ZeroOptions } from '@rocicorp/zero';
import type {
  ExternalZeroSource,
  ZeroOptionsOrExternalSource,
  ZeroReconcileVerdict,
} from './types.js';

export function isExternalSource(s: ZeroOptionsOrExternalSource): s is ExternalZeroSource {
  return 'zero' in s;
}

export function diffZeroOptions(prev: ZeroOptions, next: ZeroOptions): ZeroReconcileVerdict {
  for (const key of diffableKeys(prev, next)) {
    const a = (prev as Record<string, unknown>)[key];
    const b = (next as Record<string, unknown>)[key];

    if (!Object.is(a, b)) {
      return 'recreate';
    }
  }

  return diffAuth(prev.auth, next.auth);
}

function diffableKeys(prev: ZeroOptions, next: ZeroOptions): Set<string> {
  const keys = new Set([...Object.keys(prev), ...Object.keys(next)]);

  keys.delete('auth');
  keys.delete('onClientStateNotFound');

  return keys;
}

export function diffAuth(prev: ZeroOptions['auth'], next: ZeroOptions['auth']): ZeroReconcileVerdict {
  const prevIsString = typeof prev === 'string';
  const nextIsString = typeof next === 'string';

  if (prevIsString !== nextIsString) {
    return 'recreate';
  }

  if (nextIsString && !Object.is(prev, next)) {
    return 'connect';
  }

  return 'noop';
}
