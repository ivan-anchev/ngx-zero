import { describe, expect, it } from 'vitest';
import { VERSION } from '../src/index.js';

describe('ngx-zero', () => {
  it('exports a version', () => {
    expect(VERSION).toBeTypeOf('string');
  });
});
