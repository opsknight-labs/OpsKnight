import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('next-auth', () => ({ getServerSession: vi.fn(async () => null) }));
vi.mock('@/lib/auth', () => ({ getAuthOptions: vi.fn(async () => ({})) }));

import { resolveUserActor } from '@/lib/authorization-actors';
import { resolvePageContext } from '@/lib/intelligence/squire/deterministic';
import {
  createTestEscalationPolicy,
  createTestIncident,
  createTestService,
  createTestTeam,
  createTestUser,
  resetDatabase,
  testPrisma as db,
} from '../../helpers/test-db';

beforeEach(async () => {
  await resetDatabase();
});

async function world() {
  const team = await createTestTeam('Checkout');
  const other = await createTestTeam('Elsewhere');
  const admin = await createTestUser({ role: 'ADMIN' });
  const responder = await createTestUser({ role: 'RESPONDER' });
  const member = await createTestUser({ role: 'USER' });
  const outsider = await createTestUser({ role: 'USER' });
  await db.teamMember.createMany({
    data: [
      { teamId: team.id, userId: member.id, role: 'MEMBER' },
      { teamId: other.id, userId: outsider.id, role: 'MEMBER' },
    ] as never,
  });
  const service = await createTestService('Checkout API', team.id);
  const incident = await createTestIncident('Checkout 500s', service.id);
  const actor = async (id: string) => (await resolveUserActor(id))!;
  return {
    incident,
    admin: await actor(admin.id),
    responder: await actor(responder.id),
    member: await actor(member.id),
    outsider: await actor(outsider.id),
  };
}

describe('Squire page context: postmortem, escalation policy, status page', () => {
  it('resolves a postmortem by its id or its incident id, scoped to the incident', async () => {
    const w = await world();
    const pm = await db.postmortem.create({
      data: {
        incidentId: w.incident.id,
        title: 'Checkout outage review',
        status: 'PUBLISHED',
        createdById: (await db.user.findFirstOrThrow({ where: { role: 'ADMIN' } })).id,
      } as never,
    });
    for (const id of [pm.id, w.incident.id]) {
      expect(await resolvePageContext(w.member, { kind: 'postmortem', id })).toMatchObject({
        kind: 'postmortem',
        id: pm.id,
        name: 'Checkout outage review',
        incidentId: w.incident.id,
      });
    }
    expect(await resolvePageContext(w.outsider, { kind: 'postmortem', id: pm.id })).toBeNull();

    await db.postmortem.update({ where: { id: pm.id }, data: { status: 'DRAFT' } });
    expect(await resolvePageContext(w.member, { kind: 'postmortem', id: pm.id })).toBeNull();
    expect(await resolvePageContext(w.responder, { kind: 'postmortem', id: pm.id })).not.toBeNull();
  });

  it('resolves an escalation policy only for people who may read policies', async () => {
    const w = await world();
    const policy = await createTestEscalationPolicy('Checkout primary', []);
    expect(
      await resolvePageContext(w.responder, { kind: 'escalation_policy', id: policy.id })
    ).toMatchObject({ kind: 'escalation_policy', id: policy.id, name: policy.name });
    expect(
      await resolvePageContext(w.member, { kind: 'escalation_policy', id: policy.id })
    ).toBeNull();
  });

  it('resolves a status page only for administrators', async () => {
    const w = await world();
    const page = await db.statusPage.create({ data: { name: 'Public status' } as never });
    expect(await resolvePageContext(w.admin, { kind: 'status_page', id: page.id })).toMatchObject({
      kind: 'status_page',
      id: page.id,
      name: 'Public status',
    });
    expect(await resolvePageContext(w.responder, { kind: 'status_page', id: page.id })).toBeNull();
    expect(await resolvePageContext(w.admin, { kind: 'status_page', id: 'missing' })).toBeNull();
  });
});
