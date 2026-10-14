import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { applyGeneratedSections } from '@/lib/api-v2/docs-render';

const DOC = join(process.cwd(), 'docs/v2.1.0/reference/api/v2.md');

describe('REST v2 reference documentation', () => {
  it('matches the registries it is generated from', () => {
    const current = readFileSync(DOC, 'utf8');
    const expected = applyGeneratedSections(current);
    if (process.env.UPDATE_API_DOCS === '1' && expected !== current) {
      writeFileSync(DOC, expected);
      return;
    }
    // Regenerate with: UPDATE_API_DOCS=1 npx vitest run tests/unit/api-v2-docs-sync.test.ts
    expect(current).toBe(expected);
  });

  it('does not claim capabilities that REST does not provide', () => {
    const doc = readFileSync(DOC, 'utf8');
    expect(doc).not.toMatch(/Create and edit runbook definitions/);
    expect(doc).not.toMatch(/component visibility/i);
  });
});
