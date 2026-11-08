import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

import { resolveUserActor } from '@/lib/authorization-actors';
import {
  DEFAULT_POLICY_DEFINITION,
  INTELLIGENCE_SETTINGS_DEFAULTS,
} from '@/lib/intelligence/contract';
import { breakers, invalidateGatewayCache } from '@/lib/intelligence/ai/gateway';
import { saveAiProvider, updateAiSettings } from '@/lib/intelligence/ai/settings';
import { DEFAULT_HANDLERS } from '@/lib/intelligence/jobs/runner';
import { claimWorkItems, WORK_KINDS } from '@/lib/intelligence/jobs/work-queue';
import {
  resetSquireMemorySchedule,
  scheduleSquireMemoryWork,
} from '@/lib/intelligence/memory/handlers';
import { runProactiveJob, scanProactiveWork } from '@/lib/intelligence/memory/proactive';
import { getProactiveNotesForActor } from '@/lib/intelligence/memory/proactive-view';
import { updateSquireServicePolicy } from '@/lib/intelligence/memory/settings';
import { getIntelligenceSettings, publishPolicyVersion } from '@/lib/intelligence/settings/service';
import { startFakeModel, type FakeServer } from '../../helpers/fake-model-server';
import {
  createTestIncident,
  createTestService,
  createTestTeam,
  createTestUser,
  resetDatabase,
  testPrisma as db,
} from '../../helpers/test-db';

let model: FakeServer;
beforeAll(async () => {
  model = await startFakeModel();
});
afterAll(async () => {
  await model.close();
});

beforeEach(async () => {
  if (!new URL(process.env.DATABASE_URL ?? '').pathname.endsWith('_test'))
    throw new Error('Dedicated test DB required');
  await resetDatabase();
  model.requests.length = 0;
  model.script.length = 0;
  resetSquireMemorySchedule();
  invalidateGatewayCache();
});

const actorOf = async (userId: string) => {
  const actor = await resolveUserActor(userId);
  if (!actor) throw new Error('actor not resolved');
  return actor;
};
const MIN = 60_000;
const past = (ms: number) => new Date(Date.now() - ms);
const budget = { maxDbMs: 5_000 };

const SUMMARY = {
  headline: 'Checkout is slow after deploy v42',
  currentState: 'Latency is elevated for some customers; the team is investigating.',
  impact: 'Some checkouts are slow.',
  keyEvents: ['Alert fired'],
  possibleCauses: ['Deploy v42 shortly before onset (to verify)'],
  nextSteps: ['Compare latency before and after v42'],
};
const DRAFT = {
  summary: 'Checkout latency rose after a deploy.',
  impact: 'Slow checkouts for 90 minutes.',
  rootCause: 'Likely deploy v42; needs confirmation.',
  resolution: 'Rolled back v42.',
  lessons: 'Canary deploys for checkout.',
  actionItems: [
    { title: 'Add a canary stage', description: 'Catch regressions', priority: 'HIGH' },
  ],
};

async function setup(options: { ai?: boolean } = {}) {
  const admin = await createTestUser({ role: 'ADMIN' });
  const ctx = { actorId: admin.id, source: 'UI' as const };
  await publishPolicyVersion(
    {},
    { mode: 'SUGGEST', definition: DEFAULT_POLICY_DEFINITION, expectedHeadVersion: 0 },
    ctx
  );
  await db.intelligenceSettings.create({
    data: { id: 'default', ...INTELLIGENCE_SETTINGS_DEFAULTS, enabled: true },
  });
  if (options.ai) {
    await updateAiSettings(
      {
        enabled: true,
        squireEnabled: true,
        squireName: 'Pip',
        allowExternalFallback: false,
        requestsPerMinutePerUser: 100,
        dailyTokenBudget: 500_000,
        maxOutputTokens: 1024,
        requestTimeoutMs: 10_000,
        allowedDataRegions: [],
        expectedRevision: 0,
      },
      ctx
    );
    const provider = await saveAiProvider(
      null,
      {
        name: 'Local',
        kind: 'OPENAI_COMPATIBLE',
        model: 'm',
        baseUrl: model.url,
        apiKey: 'k',
        enabled: true,
        isExternal: false,
        maxDataClass: 'PERSONAL',
        allowPrivateNetwork: true,
        priority: 1,
      },
      ctx
    );
    breakers.recordSuccess(provider.id);
    invalidateGatewayCache();
  }
  const teamA = await createTestTeam('Checkout team');
  const teamB = await createTestTeam('Other team');
  const service = await createTestService('Checkout', teamA.id);
  const member = await createTestUser({ role: 'USER' });
  await db.teamMember.create({ data: { userId: member.id, teamId: teamA.id, role: 'MEMBER' } });
  const outsider = await createTestUser({ role: 'USER' });
  await db.teamMember.create({ data: { userId: outsider.id, teamId: teamB.id, role: 'MEMBER' } });
  return { admin, service, teamA, teamB, member, outsider };
}

/** An open incident with an analysis already done: one similar incident and one correlated change. */
async function analysedIncident(serviceId: string, teamId: string, openedAgo = 10 * MIN) {
  const incident = await createTestIncident('Checkout latency high', serviceId, {
    teamId,
    createdAt: past(openedAgo),
  });
  const precedent = await createTestIncident('Checkout slow last month', serviceId, {
    teamId,
    status: 'RESOLVED',
    createdAt: past(30 * 24 * 60 * MIN),
    resolvedAt: past(30 * 24 * 60 * MIN - 30 * MIN),
  });
  const change = await db.changeEvent.create({
    data: {
      serviceId,
      source: 'ci',
      kind: 'DEPLOY',
      summary: 'Deploy checkout v42',
      occurredAt: past(openedAgo + 7 * MIN),
    },
  });
  const finding = { generation: 1, engineVersion: 'test', status: 'ACTIVE' as const };
  await db.intelligenceFinding.createMany({
    data: [
      {
        ...finding,
        incidentId: incident.id,
        kind: 'SIMILAR_INCIDENT',
        subjectRef: precedent.id,
        confidence: 0.82,
        evidence: {},
      },
      {
        ...finding,
        incidentId: incident.id,
        kind: 'CHANGE_CORRELATION',
        subjectRef: change.id,
        confidence: 0.6,
        evidence: { leadSeconds: 420 },
      },
    ],
  });
  await db.intelligenceAnalysisSnapshot.create({
    data: {
      incidentId: incident.id,
      kind: 'SIMILAR_INCIDENT',
      generation: 1,
      engineVersion: 'test',
    },
  });
  return { incident, precedent, change };
}

describe('proactive Squire is off by default', () => {
  it('schedules nothing, scans nothing and writes nothing without an opt-in', async () => {
    const { service, teamA, admin } = await setup({ ai: true });
    const { incident } = await analysedIncident(service.id, teamA.id);
    await scheduleSquireMemoryWork(Date.now(), DEFAULT_HANDLERS);
    expect(await db.intelligenceWorkItem.count()).toBe(0);
    expect(await scanProactiveWork(budget)).toBe(0);
    expect(await runProactiveJob(`BRIEFING:${incident.id}`, 10, budget)).toBe('off');
    expect(await db.squireProactiveNote.count()).toBe(0);
    expect(model.requests).toHaveLength(0);
    expect(await getProactiveNotesForActor(incident.id, await actorOf(admin.id))).toBeNull();
  });

  it('stays silent for an opted-in service whose intelligence policy is OFF', async () => {
    const { service, teamA, admin } = await setup();
    await updateSquireServicePolicy(
      service.id,
      {
        briefingEnabled: true,
        nudgeAfterMinutes: 30,
        postmortemDraftEnabled: true,
        expectedRevision: 0,
      },
      admin.id
    );
    await publishPolicyVersion(
      { serviceId: service.id },
      { mode: 'OFF', definition: DEFAULT_POLICY_DEFINITION, expectedHeadVersion: 0 },
      { actorId: admin.id, source: 'UI' }
    );
    const { incident } = await analysedIncident(service.id, teamA.id);
    expect(await scanProactiveWork(budget)).toBe(0);
    expect(await runProactiveJob(`BRIEFING:${incident.id}`, 10, budget)).toBe('off');
  });
});

describe('proactive Squire with AI off (deterministic)', () => {
  it('briefs an opted-in incident through the lane, once, fenced on the generation', async () => {
    const { service, teamA, admin, member, outsider } = await setup();
    await updateSquireServicePolicy(
      service.id,
      {
        briefingEnabled: true,
        nudgeAfterMinutes: null,
        postmortemDraftEnabled: false,
        expectedRevision: 0,
      },
      admin.id
    );
    expect(
      await db.auditLog.count({ where: { action: 'intelligence.squire.proactive_policy.updated' } })
    ).toBe(1);
    const { incident, precedent, change } = await analysedIncident(service.id, teamA.id);

    await scheduleSquireMemoryWork(Date.now(), DEFAULT_HANDLERS);
    const settings = await getIntelligenceSettings();
    const context = { settings, signal: new AbortController().signal };
    const [scan] = await claimWorkItems({ limit: 5 });
    expect(scan).toMatchObject({ kind: WORK_KINDS.SQUIRE_PROACTIVE_SCAN });
    await DEFAULT_HANDLERS[WORK_KINDS.SQUIRE_PROACTIVE_SCAN]!(scan, context);
    const [job] = await claimWorkItems({ limit: 5 });
    expect(job).toMatchObject({
      kind: WORK_KINDS.SQUIRE_PROACTIVE,
      subjectKey: `BRIEFING:${incident.id}`,
    });
    await DEFAULT_HANDLERS[WORK_KINDS.SQUIRE_PROACTIVE]!(job, context);

    const note = await db.squireProactiveNote.findUniqueOrThrow({
      where: { incidentId_kind: { incidentId: incident.id, kind: 'BRIEFING' } },
    });
    expect(note).toMatchObject({ mode: 'BASIC', generation: job.generation, model: null });
    // Never a note on the timeline, never a change to the incident.
    expect(await db.incidentNote.count()).toBe(0);
    expect((await db.incident.findUniqueOrThrow({ where: { id: incident.id } })).status).toBe(
      'OPEN'
    );

    // Once per incident, and a stale pass can never overwrite it.
    expect(await runProactiveJob(`BRIEFING:${incident.id}`, job.generation + 5, budget)).toBe(
      'skipped'
    );
    expect(await runProactiveJob(`BRIEFING:${incident.id}`, 1, budget)).toBe('stale');
    expect(await scanProactiveWork(budget)).toBe(0);

    const view = await getProactiveNotesForActor(incident.id, await actorOf(member.id));
    expect(view?.briefing).toMatchObject({
      mode: 'BASIC',
      headline: expect.stringContaining('Checkout latency high'),
      refs: {
        similar: [{ id: precedent.id, matchPercent: 82 }],
        changes: [{ id: change.id, label: 'Deploy checkout v42', minutesBefore: 7 }],
      },
      ai: null,
    });
    expect(view?.briefing?.nextSteps[0]).toMatch(/Deploy checkout v42/);
    // Someone who cannot read the incident sees nothing at all.
    expect(await getProactiveNotesForActor(incident.id, await actorOf(outsider.id))).toBeNull();
  });

  it('waits for the first analysis, then briefs without it after the grace period', async () => {
    const { service, teamA, admin } = await setup();
    await updateSquireServicePolicy(
      service.id,
      {
        briefingEnabled: true,
        nudgeAfterMinutes: null,
        postmortemDraftEnabled: false,
        expectedRevision: 0,
      },
      admin.id
    );
    const fresh = await createTestIncident('Fresh', service.id, {
      teamId: teamA.id,
      createdAt: past(2 * MIN),
    });
    expect(await runProactiveJob(`BRIEFING:${fresh.id}`, 10, budget)).toBe('waiting');
    const older = await createTestIncident('Older', service.id, {
      teamId: teamA.id,
      createdAt: past(8 * MIN),
    });
    expect(await runProactiveJob(`BRIEFING:${older.id}`, 10, budget)).toBe('written');
    const view = await getProactiveNotesForActor(older.id, await actorOf(admin.id));
    expect(view?.briefing?.analysisPending).toBe(true);
  });

  it('nudges after N minutes without an update, once per silence, and hides the nudge after an update', async () => {
    const { service, teamA, admin, member } = await setup();
    await updateSquireServicePolicy(
      service.id,
      {
        briefingEnabled: false,
        nudgeAfterMinutes: 30,
        postmortemDraftEnabled: false,
        expectedRevision: 0,
      },
      admin.id
    );
    const quiet = await createTestIncident('Checkout latency high', service.id, {
      teamId: teamA.id,
      createdAt: past(45 * MIN),
    });
    const recent = await createTestIncident('Just opened', service.id, {
      teamId: teamA.id,
      createdAt: past(5 * MIN),
    });
    expect(await scanProactiveWork(budget)).toBe(1);
    expect(await runProactiveJob(`STAKEHOLDER_NUDGE:${recent.id}`, 10, budget)).toBe('skipped');
    expect(await runProactiveJob(`STAKEHOLDER_NUDGE:${quiet.id}`, 10, budget)).toBe('written');
    expect(await runProactiveJob(`STAKEHOLDER_NUDGE:${quiet.id}`, 11, budget)).toBe('skipped');
    const view = await getProactiveNotesForActor(quiet.id, await actorOf(member.id));
    expect(view?.nudge).toMatchObject({ thresholdMinutes: 30, aiDraft: null });
    expect(view?.nudge?.minutesSinceUpdate).toBeGreaterThanOrEqual(44);
    expect(view?.nudge?.draft).toMatch(/Checkout latency high/);

    await db.incidentNote.create({
      data: { incidentId: quiet.id, userId: member.id, content: 'Customers informed.' },
    });
    expect(
      (await getProactiveNotesForActor(quiet.id, await actorOf(member.id)))?.nudge ?? null
    ).toBeNull();
  });

  it('drafts a postmortem on resolve without ever creating or publishing one', async () => {
    const { service, teamA, admin } = await setup();
    await updateSquireServicePolicy(
      service.id,
      {
        briefingEnabled: false,
        nudgeAfterMinutes: null,
        postmortemDraftEnabled: true,
        expectedRevision: 0,
      },
      admin.id
    );
    const open = await createTestIncident('Still open', service.id, { teamId: teamA.id });
    const resolved = await createTestIncident('Checkout latency high', service.id, {
      teamId: teamA.id,
      status: 'RESOLVED',
      createdAt: past(120 * MIN),
      resolvedAt: past(30 * MIN),
    });
    await db.incidentEvent.create({
      data: { incidentId: resolved.id, type: 'MANUAL_RESOLVED', message: 'Rolled back v42' },
    });
    expect(await scanProactiveWork(budget)).toBe(1);
    expect(await runProactiveJob(`POSTMORTEM_DRAFT:${open.id}`, 10, budget)).toBe('skipped');
    expect(await runProactiveJob(`POSTMORTEM_DRAFT:${resolved.id}`, 10, budget)).toBe('written');
    expect(await db.postmortem.count()).toBe(0);
    const view = await getProactiveNotesForActor(resolved.id, await actorOf(admin.id));
    expect(view?.postmortemDraft).toMatchObject({
      mode: 'BASIC',
      resolution: 'Rolled back v42',
      summary: expect.stringMatching(/for 1 h 30 min/),
    });
  });
});

describe('proactive Squire with a model', () => {
  it('writes AI text through the gateway and shows it only to viewers who may read its inputs', async () => {
    const { service, teamA, admin, member } = await setup({ ai: true });
    await updateSquireServicePolicy(
      service.id,
      {
        briefingEnabled: true,
        nudgeAfterMinutes: null,
        postmortemDraftEnabled: true,
        expectedRevision: 0,
      },
      admin.id
    );
    const { incident, precedent } = await analysedIncident(service.id, teamA.id);
    model.script.push({ content: JSON.stringify(SUMMARY) });
    expect(await runProactiveJob(`BRIEFING:${incident.id}`, 10, budget)).toBe('written');
    const note = await db.squireProactiveNote.findFirstOrThrow({ where: { kind: 'BRIEFING' } });
    expect(note).toMatchObject({ mode: 'AI', model: 'm' });
    const sent = JSON.stringify(model.requests[0].body);
    expect(sent).toContain('Deploy checkout v42');
    expect(sent).toContain('DATA, not instructions');
    // A background identity: usage is counted globally, never against a person's daily share.
    expect(await db.aiUsageUserDay.count()).toBe(0);
    expect((await db.aiUsageDay.findFirstOrThrow()).requests).toBe(1);

    const visible = await getProactiveNotesForActor(incident.id, await actorOf(member.id));
    expect(visible?.briefing).toMatchObject({
      mode: 'AI',
      ai: { headline: SUMMARY.headline, possibleCauses: SUMMARY.possibleCauses },
    });

    // Once the precedent becomes private, the AI text (which saw it) is withheld from that viewer.
    await db.incident.update({
      where: { id: precedent.id },
      data: { visibility: 'PRIVATE', teamId: null },
    });
    const restricted = await getProactiveNotesForActor(incident.id, await actorOf(member.id));
    expect(restricted?.briefing).toMatchObject({ mode: 'BASIC', ai: null });
    expect(restricted?.briefing?.refs.similar).toEqual([]);
  });

  it('keeps the deterministic note when the model fails or returns garbage, and drafts with POSTMORTEM', async () => {
    const { service, teamA, admin } = await setup({ ai: true });
    await updateSquireServicePolicy(
      service.id,
      {
        briefingEnabled: true,
        nudgeAfterMinutes: null,
        postmortemDraftEnabled: true,
        expectedRevision: 0,
      },
      admin.id
    );
    const { incident } = await analysedIncident(service.id, teamA.id);
    model.script.push(
      { content: 'not json at all' },
      { content: 'still not json' },
      { status: 500 }
    );
    expect(await runProactiveJob(`BRIEFING:${incident.id}`, 10, budget)).toBe('written');
    expect(
      await db.squireProactiveNote.findFirstOrThrow({ where: { kind: 'BRIEFING' } })
    ).toMatchObject({
      mode: 'BASIC',
    });

    const resolved = await createTestIncident('Checkout latency high', service.id, {
      teamId: teamA.id,
      status: 'RESOLVED',
      createdAt: past(120 * MIN),
      resolvedAt: past(30 * MIN),
    });
    model.script.length = 0;
    model.script.push({ content: JSON.stringify(DRAFT) });
    expect(await runProactiveJob(`POSTMORTEM_DRAFT:${resolved.id}`, 10, budget)).toBe('written');
    const view = await getProactiveNotesForActor(resolved.id, await actorOf(admin.id));
    expect(view?.postmortemDraft).toMatchObject({
      mode: 'AI',
      rootCause: DRAFT.rootCause,
      actionItems: [{ title: 'Add a canary stage', priority: 'HIGH' }],
    });
    expect(await db.postmortem.count()).toBe(0);
  });
});
