import { beforeEach, describe, expect, it } from 'vitest';
import { NextRequest } from 'next/server';
import { GET as getIntelligence } from '@/app/api/v2/incidents/[id]/intelligence/route';
import { DEFAULT_POLICY_DEFINITION, INTELLIGENCE_SETTINGS_DEFAULTS } from '@/lib/intelligence/contract';
import { indexIncident } from '@/lib/intelligence/jobs/indexer';
import { analyzeResponse } from '@/lib/intelligence/response/handler';
import { publishPolicyVersion } from '@/lib/intelligence/settings/service';
import { analyzeIncident } from '@/lib/intelligence/similarity/analyzer';
import { createV2Credential } from '../../helpers/api-v2';
import { createTestIncident, createTestService, createTestTeam, createTestUser, resetDatabase, testPrisma as db } from '../../helpers/test-db';

const settings = { ...INTELLIGENCE_SETTINGS_DEFAULTS, revision: 1 };
const MIN = 60_000;

beforeEach(async () => {
  if (!new URL(process.env.DATABASE_URL ?? '').pathname.endsWith('_test')) throw new Error('Dedicated test DB required');
  await resetDatabase();
});

const call = (token: string, id: string) =>
  getIntelligence(new NextRequest(`http://localhost/api/v2/incidents/${id}/intelligence`, { headers: { Authorization: `Bearer ${token}` } }), {
    params: Promise.resolve({ id }),
  });

async function enable(mode: 'SHADOW' | 'SUGGEST') {
  const admin = await createTestUser({ role: 'ADMIN' });
  await publishPolicyVersion({}, { mode, definition: DEFAULT_POLICY_DEFINITION, expectedHeadVersion: 0 }, { actorId: admin.id, source: 'UI' });
  await db.intelligenceSettings.create({ data: { id: 'default', ...INTELLIGENCE_SETTINGS_DEFAULTS, enabled: true } });
}

describe('GET /api/v2/incidents/{id}/intelligence', () => {
  it('returns advisory suggestions with no stored text beyond what the caller may read', async () => {
    await enable('SUGGEST');
    const service = await createTestService('API');
    const at = (minutesAgo: number) => new Date(Date.now() - minutesAgo * MIN);
    const target = await createTestIncident('Database connection errors on db-1', service.id, { createdAt: at(5) });
    const precedent = await createTestIncident('Database connection errors on db-9', service.id, { createdAt: at(600), status: 'RESOLVED', resolvedAt: at(590) });
    await db.$transaction(async tx => {
      await indexIncident(target.id, tx);
      await indexIncident(precedent.id, tx);
    });
    await analyzeIncident({ subjectKey: target.id, generation: 1 }, settings);
    await db.changeEvent.create({ data: { serviceId: service.id, source: 'ci', kind: 'DEPLOY', summary: 'api v7', occurredAt: at(15) } });
    await analyzeResponse({ subjectKey: target.id, generation: 1 }, settings);

    // Changes belong to the service, so seeing them also needs the service read scope.
    const narrow = await createV2Credential(['incidents:read']);
    expect((await (await call(narrow.token, target.id)).json()).data.possibleChanges).toEqual([]);

    const reader = await createV2Credential(['incidents:read', 'services:read']);
    const response = await call(reader.token, target.id);
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toContain('no-store');
    const { data } = await response.json();
    expect(data).toMatchObject({ incidentId: target.id, advisory: true, calibrated: false });
    expect(data.similarIncidents).toHaveLength(1);
    expect(data.similarIncidents[0]).toMatchObject({ incidentId: precedent.id, status: 'RESOLVED' });
    expect(data.possibleChanges[0]).toMatchObject({ summary: 'api v7', kind: 'DEPLOY', relation: 'SAME_SERVICE' });
    expect(data.relatedIncidents).toEqual([]);
    expect(data.runbooks).toEqual([]);
  });

  it('returns empty lists in shadow mode and for an incident with no findings', async () => {
    await enable('SHADOW');
    const service = await createTestService('API');
    const incident = await createTestIncident('Anything', service.id);
    await analyzeResponse({ subjectKey: incident.id, generation: 1 }, settings);
    const reader = await createV2Credential(['incidents:read']);
    const { data } = await (await call(reader.token, incident.id)).json();
    expect(data).toMatchObject({ similarIncidents: [], relatedIncidents: [], possibleChanges: [], upstreamIncidents: [], runbooks: [] });
  });

  it('requires the incidents:read scope and authentication', async () => {
    await enable('SUGGEST');
    const service = await createTestService('API');
    const incident = await createTestIncident('x', service.id);
    const wrongScope = await createV2Credential(['events:write']);
    expect((await call(wrongScope.token, incident.id)).status).toBe(403);
    expect((await call('not-a-real-token', incident.id)).status).toBe(401);
  });

  it('hides unreadable incidents (404) and never leaks a precedent from another team', async () => {
    await enable('SUGGEST');
    const teamA = await createTestTeam('A');
    const teamB = await createTestTeam('B');
    const serviceA = await createTestService('A', teamA.id);
    const serviceB = await createTestService('B', teamB.id);
    const target = await createTestIncident('Payment gateway timeout', serviceA.id, { teamId: teamA.id });
    const hidden = await createTestIncident('Payment gateway timeout secret customer', serviceB.id, { teamId: teamB.id });
    await db.$transaction(async tx => {
      await indexIncident(target.id, tx);
      await indexIncident(hidden.id, tx);
    });
    await analyzeIncident({ subjectKey: target.id, generation: 1 }, settings);
    expect(await db.intelligenceFinding.count({ where: { incidentId: target.id } })).toBe(1);

    const member = await createV2Credential(['incidents:read'], 'USER');
    await db.teamMember.create({ data: { userId: member.user.id, teamId: teamA.id, role: 'MEMBER' } });
    const { data } = await (await call(member.token, target.id)).json();
    expect(data.similarIncidents).toEqual([]);
    expect(JSON.stringify(data)).not.toMatch(/secret customer/);
    expect((await call(member.token, hidden.id)).status).toBe(404);
    expect((await call(member.token, 'missing')).status).toBe(404);

    const admin = await createV2Credential(['incidents:read']);
    expect((await (await call(admin.token, target.id)).json()).data.similarIncidents).toHaveLength(1);
  });
});
