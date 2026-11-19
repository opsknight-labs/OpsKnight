import { beforeEach, expect, it } from 'vitest';
import { PATCH as patchService } from '@/app/api/v2/services/[id]/route';
import { PATCH as patchSettings } from '@/app/api/v2/services/[id]/notification-settings/route';
import type { NextRouteHandler } from '@/lib/api-v2/endpoint';
import { createV2Credential, invokeV2 } from '../helpers/api-v2';
import {
  createTestEscalationPolicy,
  createTestService,
  createTestTeam,
  resetDatabase,
  testPrisma,
} from '../helpers/test-db';

const PATCH = patchService as unknown as NextRouteHandler;
const PATCH_SETTINGS = patchSettings as unknown as NextRouteHandler;

beforeEach(async () => {
  if (!new URL(process.env.DATABASE_URL ?? '').pathname.endsWith('_test')) {
    throw new Error('Dedicated test DB required');
  }
  await resetDatabase();
});

async function responderInTeamA() {
  const credential = await createV2Credential(['services:write', 'services:read'], 'RESPONDER');
  const teamA = await createTestTeam('A');
  const teamB = await createTestTeam('B');
  await testPrisma.teamMember.create({ data: { teamId: teamA.id, userId: credential.user.id } });
  return { credential, teamA, teamB };
}

const revision = async (id: string) =>
  (await testPrisma.service.findUniqueOrThrow({ where: { id }, select: { revision: true } }))
    .revision;

it('lets a responder update only services of their own teams', async () => {
  const { credential, teamA, teamB } = await responderInTeamA();
  const own = await createTestService('own', teamA.id);
  const other = await createTestService('other', teamB.id);
  const patch = (id: string, body: unknown) =>
    invokeV2(PATCH, credential.token, 'PATCH', `/services/${id}`, { id }, body);

  expect((await patch(other.id, { description: 'hijack' })).status).toBe(403);
  expect((await patch(own.id, { teamId: teamB.id })).status).toBe(403);
  expect((await patch(own.id, { description: 'mine' })).status).toBe(200);

  const settings = await invokeV2(
    PATCH_SETTINGS,
    credential.token,
    'PATCH',
    `/services/${other.id}/notification-settings`,
    { id: other.id },
    { serviceNotifyOnTriggered: false },
    { 'If-Match': `"${await revision(other.id)}"`, 'Idempotency-Key': 'other-team' }
  );
  expect(settings.status).toBe(403);
});

it('refuses to attach an archived escalation policy', async () => {
  const admin = await createV2Credential(['services:write']);
  const service = await createTestService('policy');
  const policy = await createTestEscalationPolicy('archived', []);
  await testPrisma.escalationPolicy.update({
    where: { id: policy.id },
    data: { archivedAt: new Date() },
  });
  const response = await invokeV2(
    PATCH,
    admin.token,
    'PATCH',
    `/services/${service.id}`,
    { id: service.id },
    { escalationPolicyId: policy.id }
  );
  expect(response.status).toBe(409);
});
