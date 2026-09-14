import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const mobilePostmortems = readFileSync('src/app/(mobile)/m/postmortems/page.tsx', 'utf8');
const mobilePostmortemDetail = readFileSync(
  'src/app/(mobile)/m/postmortems/[id]/page.tsx',
  'utf8'
);
const pushSubscriptionRoute = readFileSync(
  'src/app/api/user/push-subscription/route.ts',
  'utf8'
);
const pushStatusRoute = readFileSync(
  'src/app/api/user/push-subscription/status/route.ts',
  'utf8'
);
const rootLayout = readFileSync('src/app/layout.tsx', 'utf8');
const legalSourceNotice = readFileSync('src/components/LegalSourceNotice.tsx', 'utf8');

describe('mobile production hardening contract', () => {
  it('actor-scopes mobile postmortem list and detail reads', () => {
    for (const source of [mobilePostmortems, mobilePostmortemDetail]) {
      expect(source).toContain('getRequestActorContext()');
      expect(source).toContain('postmortemReadWhere(context.actor)');
    }

    expect(mobilePostmortems).toContain("{ status: 'PUBLISHED' }");
    expect(mobilePostmortemDetail).toContain("{ status: 'PUBLISHED' as const }");
    expect(mobilePostmortemDetail).toContain('prisma.postmortem.findFirst');
    expect(mobilePostmortemDetail).not.toContain('prisma.postmortem.findUnique');
  });

  it('keeps Push endpoint capabilities out of query strings', () => {
    expect(pushSubscriptionRoute).not.toContain('export const GET');
    expect(pushSubscriptionRoute).not.toContain('searchParams.get');
    expect(pushSubscriptionRoute).not.toContain('getSubscriptionStatus');
    expect(pushStatusRoute).toContain('export const POST');
    expect(pushStatusRoute).toContain('await req.json()');
  });

  it('keeps a persistent corresponding-source affordance in the root application shell', () => {
    expect(rootLayout).toContain("import LegalSourceNotice from '@/components/LegalSourceNotice'");
    expect(rootLayout).toContain('<LegalSourceNotice />');
    expect(legalSourceNotice).toContain('NEXT_PUBLIC_SOURCE_CODE_URL');
    expect(legalSourceNotice).toContain('https://github.com/opsknight-labs/OpsKnight');
    expect(legalSourceNotice).toContain('AGPL-3.0-only');
    expect(legalSourceNotice).toContain('Source code');
  });
});
