// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import prisma from '@/lib/prisma';
import { reconcileOidcTeams, type OidcTeamRule } from '@/lib/oidc/team-mapping';

const suite = process.env.VITEST_USE_REAL_DB === '1' ? describe : describe.skip;
const run = randomUUID().slice(0, 8);

suite('single sign-on group to team mapping', () => {
  let userId = '';
  let platform = '';
  let payments = '';
  let rules: OidcTeamRule[] = [];

  beforeAll(async () => {
    if (!new URL(process.env.DATABASE_URL!).pathname.endsWith('/enterprise_sso_test'))
      throw new Error('Isolated enterprise_sso_test DB required.');
    userId = (
      await prisma.user.create({
        data: { name: 'Mapped', email: `mapped-${run}@example.test`, role: 'USER' },
      })
    ).id;
    platform = (await prisma.team.create({ data: { name: `Platform ${run}` } })).id;
    payments = (await prisma.team.create({ data: { name: `Payments ${run}` } })).id;
    rules = [
      { claim: 'groups', value: 'Platform-Oncall', teamId: platform, caseSensitive: false },
      { claim: 'groups', value: 'payments-oncall', teamId: payments, caseSensitive: false },
    ];
  });
  afterAll(async () => {
    await prisma.teamMember.deleteMany({ where: { teamId: { in: [platform, payments] } } });
    await prisma.team.deleteMany({ where: { id: { in: [platform, payments] } } });
    await prisma.user.deleteMany({ where: { id: userId } });
    await prisma.$disconnect();
  });

  const memberships = () =>
    prisma.teamMember.findMany({
      where: { userId },
      select: { teamId: true, role: true, oidcGrant: { select: { id: true } } },
      orderBy: { teamId: 'asc' },
    });

  it('adds mapped teams as MEMBER, records the grant and ends other sessions', async () => {
    const before = (await prisma.user.findUniqueOrThrow({ where: { id: userId } })).tokenVersion;
    const result = await reconcileOidcTeams(userId, { groups: ['platform-oncall'] }, rules);
    expect(result).toEqual({ added: [platform], removed: [], skippedRemovals: false });
    expect(await memberships()).toEqual([
      { teamId: platform, role: 'MEMBER', oidcGrant: { id: expect.any(String) } },
    ]);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: userId } })).tokenVersion).toBe(
      before + 1
    );
    // Nothing changes on an identical sign-in.
    expect(await reconcileOidcTeams(userId, { groups: ['platform-oncall'] }, rules)).toEqual({
      added: [],
      removed: [],
      skippedRemovals: false,
    });
  });

  it('never removes anything when the provider says the group list was truncated', async () => {
    const result = await reconcileOidcTeams(userId, { hasgroups: true }, rules);
    expect(result.skippedRemovals).toBe(true);
    expect((await memberships()).map(member => member.teamId)).toEqual([platform]);
  });

  it('removes only memberships it granted, and keeps manual ones', async () => {
    await prisma.teamMember.create({ data: { userId, teamId: payments, role: 'MEMBER' } });
    const result = await reconcileOidcTeams(userId, { groups: [] }, rules);
    expect(result.removed).toEqual([platform]);
    expect(await memberships()).toEqual([{ teamId: payments, role: 'MEMBER', oidcGrant: null }]);
    await prisma.teamMember.deleteMany({ where: { userId, teamId: payments } });
  });

  it('keeps a granted membership once an administrator changes its team role', async () => {
    await reconcileOidcTeams(userId, { groups: ['Platform-Oncall'] }, rules);
    await prisma.teamMember.updateMany({
      where: { userId, teamId: platform },
      data: { role: 'OWNER' },
    });
    expect((await memberships())[0].oidcGrant).toBeNull();
    const result = await reconcileOidcTeams(userId, { groups: [] }, rules);
    expect(result.removed).toEqual([]);
    expect(await memberships()).toEqual([{ teamId: platform, role: 'OWNER', oidcGrant: null }]);
  });

  it('cleans up grants after every team rule is deleted', async () => {
    await prisma.teamMember.deleteMany({ where: { userId } });
    await reconcileOidcTeams(userId, { groups: ['payments-oncall'] }, rules);
    expect((await memberships()).map(member => member.teamId)).toEqual([payments]);
    const result = await reconcileOidcTeams(userId, { groups: ['payments-oncall'] }, []);
    expect(result.removed).toEqual([payments]);
    expect(await memberships()).toEqual([]);
  });

  it('ignores rules that point at a deleted team', async () => {
    const result = await reconcileOidcTeams(userId, { groups: ['ghost'] }, [
      { claim: 'groups', value: 'ghost', teamId: 'missing-team' },
    ]);
    expect(result.added).toEqual([]);
  });
});
