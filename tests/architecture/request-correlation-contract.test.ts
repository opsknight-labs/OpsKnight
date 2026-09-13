import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const directRoutes = [
  ['src/app/api/incidents/route.ts', readFileSync('src/app/api/incidents/route.ts', 'utf8')],
  [
    'src/app/api/admin/generate-reset-link/route.ts',
    readFileSync('src/app/api/admin/generate-reset-link/route.ts', 'utf8'),
  ],
] as const;

const canonicalStatusRoute = readFileSync('src/app/api/incidents/[id]/status/route.ts', 'utf8');
const legacyMobileStatusRoute = readFileSync(
  'src/app/api/mobile/incidents/[id]/status/route.ts',
  'utf8'
);
const sharedStatusHttp = readFileSync('src/lib/incidents/status-http.ts', 'utf8');

describe('request correlation architecture', () => {
  it.each(directRoutes)('%s enters the shared request context', (_route, source) => {
    expect(source).toContain('withRequestContext(');
  });

  it('centralizes canonical and compatibility incident-status request correlation', () => {
    expect(canonicalStatusRoute).toContain('createIncidentStatusRoute(');
    expect(legacyMobileStatusRoute).toContain('createIncidentStatusRoute(');
    expect(sharedStatusHttp).toContain('withRequestContext(');
    expect(sharedStatusHttp).toContain('requestContextName');
  });

  it('audit events inherit the shared request context', () => {
    const source = readFileSync('src/lib/audit.ts', 'utf8');
    expect(source).toContain('getRequestContext().requestId');
  });
});
