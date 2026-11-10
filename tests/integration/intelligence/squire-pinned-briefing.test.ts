import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

import { resolveUserActor } from '@/lib/authorization-actors';
import {
  DEFAULT_POLICY_DEFINITION,
  INTELLIGENCE_SETTINGS_DEFAULTS,
} from '@/lib/intelligence/contract';
import { updateAiSettings } from '@/lib/intelligence/ai/settings';
import { declareDependency } from '@/lib/intelligence/dependencies/service';
import { indexIncident } from '@/lib/intelligence/jobs/indexer';
import { analyzeResponse } from '@/lib/intelligence/response/handler';
import { publishPolicyVersion } from '@/lib/intelligence/settings/service';
import { analyzeIncident } from '@/lib/intelligence/similarity/analyzer';
import {
  getPinnedBriefingForActor,
  PINNED_BRIEFING_ROWS,
} from '@/lib/intelligence/squire/briefing-view';
import {
  createTestIncident,
  createTestService,
  createTestTeam,
  createTestUser,
  resetDatabase,
  testPrisma as db,
} from '../../helpers/test-db';

beforeEach(async () => {
  if (!new URL(process.env.DATABASE_URL ?? '').pathname.endsWith('_test'))
    throw new Error('Dedicated test DB required');
  await resetDatabase();
});

const settings = { ...INTELLIGENCE_SETTINGS_DEFAULTS, revision: 1 };
const MIN = 60_000;

const actorOf = async (userId: string) => {
  const actor = await resolveUserActor(userId);
  if (!actor) throw new Error('actor not resolved');
  return actor;
};

async function setup(mode: 'OFF' | 'SHADOW' | 'SUGGEST' = 'SUGGEST', squire = true) {
  const admin = await createTestUser({ role: 'ADMIN' });
  await publishPolicyVersion(
    {},
    { mode, definition: DEFAULT_POLICY_DEFINITION, expectedHeadVersion: 0 },
    { actorId: admin.id, source: 'UI' }
  );
  await db.intelligenceSettings.create({
    data: { id: 'default', ...INTELLIGENCE_SETTINGS_DEFAULTS, enabled: true },
  });
  await updateAiSettings(
    {
      enabled: false,
      squireEnabled: squire,
      squireName: 'Pip',
      allowExternalFallback: false,
      requestsPerMinutePerUser: 50,
      dailyTokenBudget: 500_000,
      maxOutputTokens: 512,
      requestTimeoutMs: 10_000,
      expectedRevision: 0,
    },
    { actorId: admin.id, source: 'UI' }
  );
  return admin;
}

async function indexed(title: string, serviceId: string, teamId: string, resolved = false) {
  const incident = await createTestIncident(title, serviceId, {
    createdAt: new Date(Date.now() - 3_600_000),
    teamId,
    ...(resolved ? { status: 'RESOLVED', resolvedAt: new Date() } : {}),
  });
  await db.$transaction(tx => indexIncident(incident.id, tx));
  return incident;
}

const deploy = (serviceId: string, summary: string, at: Date) =>
  db.changeEvent.create({
    data: { serviceId, source: 'ci', kind: 'DEPLOY', summary, occurredAt: at },
  });

/** Two teams; an incident on team A's service with a precedent, an own deploy and a hidden one. */
async function world(mode: 'OFF' | 'SHADOW' | 'SUGGEST' = 'SUGGEST', squire = true) {
  const admin = await setup(mode, squire);
  const teamA = await createTestTeam('Team A');
  const teamB = await createTestTeam('Team B');
  const web = await createTestService('Web', teamA.id);
  const precedent = await indexed(
    'Database connection errors on db-primary-7',
    web.id,
    teamA.id,
    true
  );
  const incident = await indexed('Database connection errors on db-primary-1', web.id, teamA.id);
  const onset = incident.createdAt;
  const own = await deploy(web.id, 'own deploy', new Date(onset.getTime() - 5 * MIN));
  await analyzeIncident({ subjectKey: incident.id, generation: 1 }, settings);
  await analyzeResponse({ subjectKey: incident.id, generation: 1 }, settings);
  const member = await createTestUser({ role: 'USER' });
  await db.teamMember.create({ data: { userId: member.id, teamId: teamA.id, role: 'MEMBER' } });
  const outsider = await createTestUser({ role: 'USER' });
  await db.teamMember.create({ data: { userId: outsider.id, teamId: teamB.id, role: 'MEMBER' } });
  return { admin, teamA, teamB, web, precedent, incident, own, member, outsider, onset };
}

describe('pinned Squire briefing for an incident', () => {
  it('carries the similar incident and the likely change with the finding ids their anchors use', async () => {
    const w = await world();
    const briefing = await getPinnedBriefingForActor(await actorOf(w.admin.id), w.incident.id);
    expect(briefing).not.toBeNull();
    expect(briefing!.incidentId).toBe(w.incident.id);
    expect(briefing!.similar).toEqual([
      expect.objectContaining({
        incidentId: w.precedent.id,
        title: 'Database connection errors on db-primary-7',
        status: 'RESOLVED',
      }),
    ]);
    expect(briefing!.changes).toEqual([
      expect.objectContaining({
        changeId: w.own.id,
        summary: 'own deploy',
        kind: 'DEPLOY',
        leadMinutes: 5,
      }),
    ]);
    expect(briefing!.runbooks).toEqual([]);
    const findings = await db.intelligenceFinding.findMany({
      where: { incidentId: w.incident.id, status: 'ACTIVE' },
      select: { id: true, kind: true },
    });
    const idOf = (kind: string) => findings.find(row => row.kind === kind)?.id;
    expect(briefing!.similar[0].findingId).toBe(idOf('SIMILAR_INCIDENT'));
    expect(briefing!.changes[0].findingId).toBe(idOf('CHANGE_CORRELATION'));
  });

  it('gives a team member the same briefing and an outsider nothing', async () => {
    const w = await world();
    const mine = await getPinnedBriefingForActor(await actorOf(w.member.id), w.incident.id);
    expect(mine?.changes.map(change => change.summary)).toEqual(['own deploy']);
    expect(mine?.similar.map(similar => similar.incidentId)).toEqual([w.precedent.id]);
    expect(await getPinnedBriefingForActor(await actorOf(w.outsider.id), w.incident.id)).toBeNull();
  });

  it('never carries a change on a service the viewer cannot read', async () => {
    const w = await world();
    const secretApi = await createTestService('Secret API', w.teamB.id);
    await declareDependency(
      { upstreamServiceId: secretApi.id, downstreamServiceId: w.web.id },
      { actorId: w.admin.id, source: 'UI' }
    );
    await deploy(secretApi.id, 'secret deploy', new Date(w.onset.getTime() - 4 * MIN));
    await analyzeResponse({ subjectKey: w.incident.id, generation: 2 }, settings);

    const adminView = await getPinnedBriefingForActor(await actorOf(w.admin.id), w.incident.id);
    expect(adminView!.changes.map(change => change.summary).sort()).toEqual([
      'own deploy',
      'secret deploy',
    ]);
    const memberView = await getPinnedBriefingForActor(await actorOf(w.member.id), w.incident.id);
    expect(memberView!.changes.map(change => change.summary)).toEqual(['own deploy']);
    expect(JSON.stringify(memberView)).not.toMatch(/secret/i);
  });

  it(`keeps at most ${PINNED_BRIEFING_ROWS} rows of each kind`, async () => {
    const w = await world();
    for (let index = 0; index < 5; index += 1)
      await deploy(w.web.id, `deploy ${index}`, new Date(w.onset.getTime() - (6 + index) * MIN));
    await analyzeResponse({ subjectKey: w.incident.id, generation: 2 }, settings);
    const briefing = await getPinnedBriefingForActor(await actorOf(w.admin.id), w.incident.id);
    expect(briefing!.changes).toHaveLength(PINNED_BRIEFING_ROWS);
  });

  it.each(['OFF', 'SHADOW'] as const)(
    'is silent while the service mode is %s, even for an administrator',
    async mode => {
      const w = await world(mode);
      expect(await getPinnedBriefingForActor(await actorOf(w.admin.id), w.incident.id)).toBeNull();
    }
  );

  it('goes silent when intelligence is switched OFF after findings were recorded', async () => {
    const w = await world();
    const admin = await actorOf(w.admin.id);
    expect(await getPinnedBriefingForActor(admin, w.incident.id, db)).not.toBeNull();
    await publishPolicyVersion(
      {},
      { mode: 'OFF', definition: DEFAULT_POLICY_DEFINITION, expectedHeadVersion: 1 },
      { actorId: w.admin.id, source: 'UI' }
    );
    expect(
      await db.intelligenceFinding.count({ where: { incidentId: w.incident.id } })
    ).toBeGreaterThan(0);
    expect(await getPinnedBriefingForActor(admin, w.incident.id, db)).toBeNull();
  });

  it('is silent while the assistant is turned off', async () => {
    const w = await world('SUGGEST', false);
    expect(await getPinnedBriefingForActor(await actorOf(w.admin.id), w.incident.id)).toBeNull();
  });

  it('is silent for API keys, inactive users, unknown incidents and incidents without findings', async () => {
    const w = await world();
    const admin = await actorOf(w.admin.id);
    expect(
      await getPinnedBriefingForActor(
        { ...admin, apiKey: { id: 'key' } } as typeof admin,
        w.incident.id
      )
    ).toBeNull();
    expect(
      await getPinnedBriefingForActor(
        { ...admin, status: 'DISABLED' } as typeof admin,
        w.incident.id
      )
    ).toBeNull();
    expect(await getPinnedBriefingForActor(admin, 'does-not-exist')).toBeNull();
    const quiet = await createTestIncident('Nothing known yet', w.web.id, { teamId: w.teamA.id });
    expect(await getPinnedBriefingForActor(admin, quiet.id)).toBeNull();
  });
});
