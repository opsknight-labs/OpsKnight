import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

import { resolveUserActor } from '@/lib/authorization-actors';
import {
  DEFAULT_POLICY_DEFINITION,
  INTELLIGENCE_SETTINGS_DEFAULTS,
} from '@/lib/intelligence/contract';
import { breakers, invalidateGatewayCache } from '@/lib/intelligence/ai/gateway';
import { updateAiRouting } from '@/lib/intelligence/ai/routing-settings';
import { getAiSettings, saveAiProvider, updateAiSettings } from '@/lib/intelligence/ai/settings';
import { runProactiveJob, scanProactiveWork } from '@/lib/intelligence/memory/proactive';
import { getProactiveNotesForActor } from '@/lib/intelligence/memory/proactive-view';
import {
  getSquireServicePolicy,
  updateSquireServicePolicy,
} from '@/lib/intelligence/memory/settings';
import { publishPolicyVersion } from '@/lib/intelligence/settings/service';
import { startFakeModel, type FakeServer } from '../../helpers/fake-model-server';
import {
  createTestIncident,
  createTestService,
  createTestTeam,
  createTestUser,
  resetDatabase,
  testPrisma as db,
} from '../../helpers/test-db';

type Body = { messages?: Array<{ role: string; content: unknown }> };

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
  model.script = [];
  invalidateGatewayCache();
});

const budget = { maxDbMs: 5_000 };
const MIN = 60_000;
const past = (ms: number) => new Date(Date.now() - ms);

const allText = (body: Body) =>
  (body.messages ?? [])
    .map(message =>
      typeof message.content === 'string' ? message.content : JSON.stringify(message.content ?? '')
    )
    .join('\n');

/** Planner: done straight after the fixed first reads. Diagnosis: one hypothesis citing the first handle. */
function scriptInvestigation() {
  model.script = {
    shift: () => {
      const text = allText(model.requests.at(-1)!.body as Body);
      if (text.includes('You are planning an incident investigation'))
        return { content: JSON.stringify({ thought: 'Enough', calls: [], done: true }) };
      const handle = /(?<=- )E\d+(?=:)/.exec(text.split('Evidence:')[0])?.[0];
      return {
        content: JSON.stringify({
          summary: 'The checkout release is the most likely trigger.',
          hypotheses: [
            {
              title: 'Release 42 introduced the errors',
              explanation: 'The deploy landed shortly before the incident opened.',
              confidence: 0.7,
              support: 'supported',
              evidence: handle ? [handle] : [],
            },
          ],
          nextChecks: ['Compare error rates before and after release 42'],
        }),
      };
    },
    length: 0,
  } as unknown as FakeServer['script'];
}

async function setup(options: { ai: boolean; investigationMode?: boolean }) {
  const admin = await createTestUser({ role: 'ADMIN' });
  const audit = { actorId: admin.id, source: 'UI' as const };
  await publishPolicyVersion(
    {},
    { mode: 'SUGGEST', definition: DEFAULT_POLICY_DEFINITION, expectedHeadVersion: 0 },
    audit
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
        requestsPerMinutePerUser: 200,
        dailyTokenBudget: 1_000_000,
        maxOutputTokens: 512,
        requestTimeoutMs: 10_000,
        allowedDataRegions: [],
        expectedRevision: 0,
      },
      audit
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
      audit
    );
    breakers.recordSuccess(provider.id);
    await updateAiRouting(
      {
        squireInvestigationEnabled: options.investigationMode ?? true,
        capabilityRouting: {},
        expectedRevision: (await getAiSettings()).revision,
      },
      audit
    );
    invalidateGatewayCache();
  }
  const team = await createTestTeam('Checkout team');
  const other = await createTestTeam('Other team');
  const service = await createTestService('Checkout', team.id);
  const quiet = await createTestService('Quiet', team.id);
  const member = await createTestUser({ role: 'USER' });
  await db.teamMember.create({ data: { userId: member.id, teamId: team.id, role: 'MEMBER' } });
  const outsider = await createTestUser({ role: 'USER' });
  await db.teamMember.create({ data: { userId: outsider.id, teamId: other.id, role: 'MEMBER' } });
  const high = await createTestIncident('Checkout 500s', service.id, {
    teamId: team.id,
    urgency: 'HIGH',
    createdAt: past(5 * MIN),
  });
  // The outsider may open the incident (a watcher) but not the service's changes.
  await db.incidentWatcher.create({ data: { incidentId: high.id, userId: outsider.id } });
  const low = await createTestIncident('Checkout slow', service.id, {
    teamId: team.id,
    urgency: 'LOW',
    createdAt: past(5 * MIN),
  });
  const optedOut = await createTestIncident('Quiet down', quiet.id, {
    teamId: team.id,
    urgency: 'HIGH',
    createdAt: past(5 * MIN),
  });
  await db.changeEvent.create({
    data: {
      serviceId: service.id,
      source: 'ci',
      kind: 'DEPLOY',
      summary: 'Checkout release 42',
      occurredAt: past(10 * MIN),
    },
  });
  return { admin, service, member, outsider, high, low, optedOut };
}

const enable = (serviceId: string, adminId: string, investigationEnabled = true) =>
  updateSquireServicePolicy(
    serviceId,
    {
      briefingEnabled: false,
      nudgeAfterMinutes: null,
      postmortemDraftEnabled: false,
      investigationEnabled,
      expectedRevision: 0,
    },
    adminId
  );

const queued = async () =>
  (await db.intelligenceWorkItem.findMany({ select: { subjectKey: true } }))
    .map(row => row.subjectKey)
    .sort();

describe('automatic investigations', () => {
  it('is off until the service opts in, and the setting persists with a revision check', async () => {
    const { service, admin, high } = await setup({ ai: true });
    expect(await scanProactiveWork(budget)).toBe(0);
    expect(await runProactiveJob(`INVESTIGATION:${high.id}`, 1, budget)).toBe('off');

    await enable(service.id, admin.id);
    expect(await getSquireServicePolicy(service.id)).toMatchObject({
      investigationEnabled: true,
      revision: 1,
    });
    // A stale revision is refused; omitting the switch leaves it unchanged.
    await expect(enable(service.id, admin.id, false)).rejects.toThrow();
    await updateSquireServicePolicy(
      service.id,
      {
        briefingEnabled: true,
        nudgeAfterMinutes: null,
        postmortemDraftEnabled: false,
        expectedRevision: 1,
      },
      admin.id
    );
    expect(await getSquireServicePolicy(service.id)).toMatchObject({
      investigationEnabled: true,
      briefingEnabled: true,
      revision: 2,
    });
  });

  it('picks only high-urgency incidents on opted-in services, investigates once, as the owning team', async () => {
    const { service, admin, member, outsider, high } = await setup({ ai: true });
    await enable(service.id, admin.id);
    await scanProactiveWork(budget);
    // Not the low-urgency one, not the opted-out service's.
    expect(await queued()).toEqual([`INVESTIGATION:${high.id}`]);

    scriptInvestigation();
    expect(await runProactiveJob(`INVESTIGATION:${high.id}`, 1, budget)).toBe('written');
    const note = await db.squireProactiveNote.findUniqueOrThrow({
      where: { incidentId_kind: { incidentId: high.id, kind: 'INVESTIGATION' } },
    });
    const content = note.content as {
      answer: string;
      teamId: string;
      sources: Array<{ kind: string; id: string }>;
    };
    expect(note.mode).toBe('AI');
    expect(content.answer).toContain('Release 42');
    expect(content.teamId).toBe(service.teamId);
    expect(content.sources).toContainEqual({ kind: 'incident', id: high.id });
    expect(content.sources.some(source => source.kind === 'change')).toBe(true);
    const calls = model.requests.length;
    expect(calls).toBeGreaterThan(0);

    // Once: a later pass neither runs again nor is enqueued again.
    expect(await runProactiveJob(`INVESTIGATION:${high.id}`, 2, budget)).toBe('skipped');
    expect(model.requests).toHaveLength(calls);
    await db.intelligenceWorkItem.deleteMany();
    await scanProactiveWork(budget);
    expect(await queued()).toEqual([]);

    // The team member sees the diagnosis; the outsider can open the incident but not the change it read.
    const forMember = await getProactiveNotesForActor(
      high.id,
      (await resolveUserActor(member.id))!
    );
    expect(forMember?.investigation?.answer).toContain('Release 42');
    const forOutsider = await getProactiveNotesForActor(
      high.id,
      (await resolveUserActor(outsider.id))!
    );
    expect(forOutsider?.investigation).toMatchObject({ answer: null, citations: [] });
  });

  it('writes nothing and calls no model when AI is off', async () => {
    const { service, admin, high } = await setup({ ai: false });
    await enable(service.id, admin.id);
    expect(await scanProactiveWork(budget)).toBe(0);
    expect(await runProactiveJob(`INVESTIGATION:${high.id}`, 1, budget)).toBe('skipped');
    expect(await db.squireProactiveNote.count()).toBe(0);
    expect(model.requests).toHaveLength(0);
  });

  it('writes nothing while the administrator has investigation mode off', async () => {
    const { service, admin, high } = await setup({ ai: true, investigationMode: false });
    await enable(service.id, admin.id);
    expect(await scanProactiveWork(budget)).toBe(0);
    expect(await runProactiveJob(`INVESTIGATION:${high.id}`, 1, budget)).toBe('skipped');
    expect(await db.squireProactiveNote.count()).toBe(0);
    expect(model.requests).toHaveLength(0);
  });

  it('never investigates a private incident (the owning team cannot read it)', async () => {
    const { service, admin, high } = await setup({ ai: true });
    await enable(service.id, admin.id);
    await db.incident.update({ where: { id: high.id }, data: { visibility: 'PRIVATE' } });
    expect(await scanProactiveWork(budget)).toBe(0);
    expect(await runProactiveJob(`INVESTIGATION:${high.id}`, 1, budget)).toBe('skipped');
    expect(model.requests).toHaveLength(0);
  });
});
