import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const canonicalRoutes = [
  ['src/app/api/incidents/route.ts', readFileSync('src/app/api/incidents/route.ts', 'utf8')],
  [
    'src/app/api/mobile/incidents/[id]/status/route.ts',
    readFileSync('src/app/api/mobile/incidents/[id]/status/route.ts', 'utf8'),
  ],
  [
    'src/app/api/admin/generate-reset-link/route.ts',
    readFileSync('src/app/api/admin/generate-reset-link/route.ts', 'utf8'),
  ],
] as const;

describe('request correlation architecture', () => {
  it.each(canonicalRoutes)('%s enters the shared request context', (_route, source) => {
    expect(source).toContain('withRequestContext(');
  });

  it('audit events inherit the shared request context', () => {
    const source = readFileSync('src/lib/audit.ts', 'utf8');
    expect(source).toContain('getRequestContext().requestId');
  });
});
