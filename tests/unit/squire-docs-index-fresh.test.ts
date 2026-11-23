import { execFileSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';

describe('Squire product-docs index', () => {
  it('matches the docs of the release in development (run node scripts/build-squire-docs-index.mjs)', () => {
    expect(() =>
      execFileSync(process.execPath, ['scripts/build-squire-docs-index.mjs', '--check'], {
        stdio: 'pipe',
      })
    ).not.toThrow();
  }, 60_000);
});
