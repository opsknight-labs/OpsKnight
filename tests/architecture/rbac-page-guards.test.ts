/* eslint-disable security/detect-non-literal-fs-filename */
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8');

function pageFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) return pageFiles(path);
    return entry.name === 'page.tsx' ? [path] : [];
  });
}

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
    const appRoot = resolve(process.cwd(), 'src/app');
    const exempt = new Set([
      resolve(appRoot, '(public)/status/verify/[token]/page.tsx'),
      resolve(appRoot, 'setup/page.tsx'),
      // This route redirects unconditionally before its retained, unreachable implementation.
      resolve(appRoot, '(app)/settings/service-objectives/page.tsx'),
    ]);
    const authorizationDecision =
      /assertCan|assertCapability|getCurrentAuthorizationActor|getRequestActorContext|ReadWhere\(|getViewable|assertAdmin|assertResponder|assertAuditor|getCurrentUser|getServerSession|getUserPermissions/;

    const unguarded = pageFiles(appRoot)
      .filter(path => !exempt.has(path))
      .filter(path => /prisma\.[A-Za-z0-9_]+\.(findUnique|findFirst|findMany|count|groupBy|aggregate)/.test(source(path)))
      .filter(path => !authorizationDecision.test(source(path)))
      .map(path => path.slice(process.cwd().length + 1));

    expect(unguarded).toEqual([]);
  });
});
