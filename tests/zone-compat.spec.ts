import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { effect, Injector, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import type { ZeroOptions } from '@rocicorp/zero';
import { provideZero } from '../src/provide-zero.js';
import { ZERO_CONSTRUCTOR, ZERO_INSTANCE_MANAGER } from '../src/instance-manager.js';
import { fakeZeroHarness, provideTestChangeDetection } from './helpers.js';

const SCHEMA = { tables: {}, relationships: {} } as unknown as ZeroOptions['schema'];

afterEach(() => TestBed.resetTestingModule());

describe('zone compatibility', () => {
  it('no library source references NgZone (hard repo constraint)', () => {
    const srcDir = join(import.meta.dirname, '..', 'src');
    for (const file of readdirSync(srcDir)) {
      const content = readFileSync(join(srcDir, file), 'utf8');
      expect.soft(content, `${file} must not use NgZone`).not.toMatch(/\bNgZone\b/);
    }
  });

  it(`reconciles from a callback fired outside any zone/context (mode: ${
    (globalThis as Record<string, unknown>)['Zone'] === undefined ? 'zoneless' : 'zone'
  })`, async () => {
    const harness = fakeZeroHarness();
    const auth = signal('t1');
    TestBed.configureTestingModule({
      providers: [
        provideTestChangeDetection(),
        { provide: ZERO_CONSTRUCTOR, useValue: harness.construct },
        provideZero(() => ({ schema: SCHEMA, cacheURL: 'http://c', auth: auth() }) as ZeroOptions),
      ],
    });
    const manager = TestBed.inject(ZERO_INSTANCE_MANAGER);

    // Observe rotations the way user code would: through an effect.
    const seen: string[] = [];
    effect(
      () => {
        const z = manager.instance();
        if (z) seen.push((z as unknown as { options: ZeroOptions }).options.userID ?? 'none');
      },
      { injector: TestBed.inject(Injector) },
    );

    // Zero-style callback: fires from a plain macrotask, no zone, no injection
    // context — the signal write is the only CD trigger, in BOTH modes.
    await new Promise<void>(resolve =>
      setTimeout(() => {
        auth.set('t2'); // string→string rotation → connect in place
        resolve();
      }),
    );
    TestBed.tick();
    expect(harness.latest().connectCalls).toEqual([{ auth: 't2' }]);
    expect(seen.length).toBeGreaterThan(0);
  });
});
