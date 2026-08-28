import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const canonicalRoutes = [
  'src/app/api/incidents/route.ts',
  'src/app/api/mobile/incidents/[id]/status/route.ts',
  'src/app/api/admin/generate-reset-link/route.ts',
];

describe('request correlation architecture', () => {
  it.each(canonicalRoutes)('%s enters the shared request context', route => {
    expect(readFileSync(route, 'utf8')).toContain('withRequestContext(');
  });

  it('audit events inherit the shared request context', () => {
    const source = readFileSync('src/lib/audit.ts', 'utf8');
    expect(source).toContain('getRequestContext().requestId');
  });
});
