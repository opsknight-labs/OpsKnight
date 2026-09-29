import { describe, expect, it } from 'vitest';
import { getAuthorizedNavItems } from '@/config/navigation';

const pageSources = import.meta.glob('../../src/app/**/page.tsx', {
  eager: true,
  import: 'default',
  query: '?raw',
}) as Record<string, string>;

const source = (path: string) => {
  const entry = Object.entries(pageSources).find(([key]) => key.endsWith(path));
  if (!entry) throw new Error(`Page source not found: ${path}`);
  return entry[1];
};

const guardedPages = [
  ['src/app/(app)/users/page.tsx', 'assertCanListUsers()'],
  ['src/app/(app)/users/[id]/page.tsx', 'assertCanViewUser(id)'],
  ['src/app/(mobile)/m/users/page.tsx', 'assertCanListUsers()'],
  ['src/app/(mobile)/m/users/[id]/page.tsx', 'assertCanViewUser(id)'],
  ['src/app/(app)/policies/page.tsx', 'assertCanListPolicies()'],
  ['src/app/(app)/policies/[id]/page.tsx', 'assertCanViewPolicy(id)'],
  ['src/app/(mobile)/m/policies/page.tsx', 'assertCanListPolicies()'],
  ['src/app/(mobile)/m/policies/[id]/page.tsx', 'assertCanViewPolicy(id)'],
  ['src/app/(mobile)/m/teams/[id]/page.tsx', 'assertCanViewTeam(id)'],
  ['src/app/(app)/services/[id]/webhooks/new/page.tsx', 'assertCanModifyService(id)'],
  [
    'src/app/(app)/services/[id]/webhooks/[webhookId]/edit/page.tsx',
    'assertCanModifyService(id)',
  ],
] as const;

describe('RBAC page guard contract', () => {
  it('hides organization-wide user and policy routes from ordinary-user navigation', () => {
    const userHrefs = getAuthorizedNavItems('USER').map(item => item.href);
    const responderHrefs = getAuthorizedNavItems('RESPONDER').map(item => item.href);

    expect(userHrefs).not.toContain('/users');
    expect(userHrefs).not.toContain('/policies');
    expect(responderHrefs).toContain('/users');
    expect(responderHrefs).toContain('/policies');
  });

  for (const [path, guard] of guardedPages) {
    it(`${path} authorizes before its first direct Prisma read`, () => {
      const page = source(path);
      expect(page).toContain(guard);
      expect(page.indexOf(guard)).toBeLessThan(page.indexOf('prisma.'));
    });
  }

  it('scopes desktop profile incidents to the actor', () => {
    const page = source('src/app/(app)/users/[id]/page.tsx');
    expect(page).toContain('where: incidentReadWhere(actor)');
  });

  it('scopes mobile profile incident rows and counts to the actor', () => {
    const page = source('src/app/(mobile)/m/users/[id]/page.tsx');
    expect(page.match(/incidentAccess/g)?.length).toBeGreaterThanOrEqual(3);
    expect(page).toContain('incidentReadWhere(context.actor)');
  });

  it('requires every non-public page with a direct Prisma read to declare authorization', () => {
    const exempt = new Set([
      // Public/bootstrap pages intentionally query before an application actor exists.
      'src/app/(public)/status/verify/[token]/page.tsx',
      'src/app/(public)/status/postmortems/[incidentId]/page.tsx',
      'src/app/login/page.tsx',
      'src/app/setup/page.tsx',
      // These pages constrain every protected query to the authenticated user's own id.
      'src/app/(app)/reports/page.tsx',
      'src/app/(app)/settings/api-keys/page.tsx',
      'src/app/(app)/settings/security/page.tsx',
      'src/app/(mobile)/m/more/page.tsx',
      // This route redirects unconditionally before its retained, unreachable implementation.
      'src/app/(app)/settings/service-objectives/page.tsx',
    ]);
    const authorizationDecision =
      /assertCan|assertCapability|getCurrentAuthorizationActor|ReadWhere\(|getViewable|assertAdmin|assertResponder|assertAuditor|permissions\.(capabilities\.includes|isAdmin|isResponderOrAbove|isAuditor)|user\.role\s*[!=]==?/;

    const unguarded = Object.entries(pageSources)
      .map(([key, page]) => ({ path: key.slice(key.indexOf('src/app/')), page }))
      .filter(({ path }) => !exempt.has(path))
      .filter(({ page }) =>
        /prisma\.[A-Za-z0-9_]+\.(findUnique|findFirst|findMany|count|groupBy|aggregate)/.test(page)
      )
      .filter(({ page }) => !authorizationDecision.test(page))
      .map(({ path }) => path);

    expect(unguarded).toEqual([]);
  });
});
