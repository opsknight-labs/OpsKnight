import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
const published = vi.hoisted(() => ({ calls: [] as Array<{ kind: string; markdown: string }> }));
vi.mock('@/lib/chatops/squire/publish', () => ({
  publishSquireUpdate: vi.fn(async (update: { kind: string; markdown: string }) => {
    published.calls.push(update);
  }),
}));

import { resolveUserActor } from '@/lib/authorization-actors';
import {
  DEFAULT_POLICY_DEFINITION,
  INTELLIGENCE_SETTINGS_DEFAULTS,
} from '@/lib/intelligence/contract';
import { breakers, invalidateGatewayCache } from '@/lib/intelligence/ai/gateway';
import { updateAiRouting } from '@/lib/intelligence/ai/routing-settings';
import { getAiSettings, saveAiProvider, updateAiSettings } from '@/lib/intelligence/ai/settings';
import { PROACTIVE_LIMITS } from '@/lib/intelligence/memory/contract';
import { investigationContentSchema } from '@/lib/intelligence/memory/proactive-content';
import { findReassessCandidates } from '@/lib/intelligence/memory/proactive-live';
import { runProactiveJob, scanProactiveWork } from '@/lib/intelligence/memory/proactive';
import { getProactiveNotesForActor } from '@/lib/intelligence/memory/proactive-view';
import { updateSquireServicePolicy } from '@/lib/intelligence/memory/settings';
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
  published.calls.length = 0;
  diagnosis.fail = false;
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

type Hypothesis = { title: string; confidence: number; support: string };
const diagnosis = {
  hypotheses: [] as Hypothesis[],
  nextChecks: [] as string[],
  /** The diagnosis model returns nothing usable: the run ends partial. */
  fail: false,
};

/** Planner: done after the fixed first reads. Diagnosis: the current `diagnosis`, citing the first handle. */
function scriptInvestigation() {
  model.script = {
    shift: () => {
      const text = allText(model.requests.at(-1)!.body as Body);
      if (text.includes('You are planning an incident investigation'))
        return { content: JSON.stringify({ thought: 'Enough', calls: [], done: true }) };
      if (diagnosis.fail) return { content: 'not a diagnosis' };
      // The first evidence handle (the re-run question also quotes the previous answer's "Evidence:" lines).
      const handle = /(?:^|\n)- (E\d+):/.exec(text)?.[1];
      return {
        content: JSON.stringify({
          summary: 'Summary of the evidence.',
          hypotheses: diagnosis.hypotheses.map(h => ({
            ...h,
            explanation: 'From the evidence read.',
            evidence: handle ? [handle] : [],
          })),
          nextChecks: diagnosis.nextChecks,
        }),
      };
    },
    length: 0,
  } as unknown as FakeServer['script'];
}

async function setup() {
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
  await updateAiSettings(
    {
      enabled: true,
      squireEnabled: true,
      squireName: 'Pip',
      allowExternalFallback: false,
      requestsPerMinutePerUser: 500,
      dailyTokenBudget: 2_000_000,
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
      squireInvestigationEnabled: true,
      capabilityRouting: {},
      expectedRevision: (await getAiSettings()).revision,
    },
    audit
  );
  invalidateGatewayCache();
  const team = await createTestTeam('Checkout team');
  const other = await createTestTeam('Other team');
  const service = await createTestService('Checkout', team.id);
  const member = await createTestUser({ role: 'USER' });
  await db.teamMember.create({ data: { userId: member.id, teamId: team.id, role: 'MEMBER' } });
  const outsider = await createTestUser({ role: 'USER' });
  await db.teamMember.create({ data: { userId: outsider.id, teamId: other.id, role: 'MEMBER' } });
  const high = await createTestIncident('Checkout 500s', service.id, {
    teamId: team.id,
    urgency: 'HIGH',
    createdAt: past(5 * MIN),
  });
  await db.incidentWatcher.create({ data: { incidentId: high.id, userId: outsider.id } });
  await db.changeEvent.create({
    data: {
      serviceId: service.id,
      source: 'ci',
      kind: 'DEPLOY',
      summary: 'Checkout release 42',
      occurredAt: past(10 * MIN),
      // Learned before any investigation ran, so it is never a new signal here.
      createdAt: past(60 * MIN),
    },
  });
  await updateSquireServicePolicy(
    service.id,
    {
      briefingEnabled: false,
      nudgeAfterMinutes: null,
      postmortemDraftEnabled: false,
      investigationEnabled: true,
      expectedRevision: 0,
    },
    admin.id
  );
  return { admin, service, member, outsider, high };
}

const queued = async () =>
  (await db.intelligenceWorkItem.findMany({ select: { subjectKey: true } }))
    .map(row => row.subjectKey)
    .sort();

/** Moves the note's last write and last evidence read back in time, as if `minutes` had passed. */
const age = (incidentId: string, minutes: number) =>
  db.$executeRaw`
    UPDATE "SquireProactiveNote"
    SET "updatedAt" = now() - (${minutes} * interval '1 minute'),
        "content" = jsonb_set("content", '{assessedAt}',
          to_jsonb(to_char((now() - (${minutes} * interval '1 minute')) AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')))
    WHERE "incidentId" = ${incidentId} AND "kind" = 'INVESTIGATION'`;

const noteOf = async (incidentId: string) =>
  db.squireProactiveNote.findUniqueOrThrow({
    where: { incidentId_kind: { incidentId, kind: 'INVESTIGATION' } },
  });

const addAlert = (serviceId: string, incidentId: string) =>
  db.alert.create({
    data: { serviceId, incidentId, payload: {}, dedupKey: 'checkout-500' },
  });

describe('live updates of an automatic investigation', () => {
  it('re-assesses only on new signals, debounced, as the next generation with a "What changed" digest', async () => {
    const { service, member, outsider, high } = await setup();
    const subject = `INVESTIGATION:${high.id}`;
    diagnosis.hypotheses = [
      { title: 'Release 42 introduced the errors', confidence: 0.7, support: 'supported' },
      { title: 'Database saturation', confidence: 0.45, support: 'supported' },
    ];
    diagnosis.nextChecks = ['Compare error rates before and after release 42'];
    scriptInvestigation();
    await scanProactiveWork(budget);
    expect(await queued()).toEqual([subject]);
    expect(await runProactiveJob(subject, 1, budget)).toBe('written');
    const first = (await noteOf(high.id)).content as { revision: number; assessedAt: string };
    expect(first.revision).toBe(1);
    expect(Date.parse(first.assessedAt)).not.toBeNaN();
    expect(published.calls.map(call => call.kind)).toEqual(['INVESTIGATION']);
    await db.intelligenceWorkItem.deleteMany();

    // Nothing new: not enqueued, and a stray job never runs the model (it only records the attempt).
    await age(high.id, 20);
    await scanProactiveWork(budget);
    expect(await queued()).toEqual([]);
    let calls = model.requests.length;
    expect(await runProactiveJob(subject, 2, budget)).toBe('skipped');
    expect(model.requests).toHaveLength(calls);

    // A new alert is a signal; while the last run is recent, it waits for the debounce.
    await addAlert(service.id, high.id);
    await age(high.id, 5);
    await scanProactiveWork(budget);
    expect(await queued()).toEqual([]);
    expect(await runProactiveJob(subject, 3, budget)).toBe('waiting');
    expect(model.requests).toHaveLength(calls);

    await age(high.id, 11);
    await scanProactiveWork(budget);
    expect(await queued()).toEqual([subject]);
    diagnosis.hypotheses = [
      { title: 'Cache eviction storm', confidence: 0.8, support: 'supported' },
      { title: 'Release 42 introduced the errors', confidence: 0.4, support: 'supported' },
      { title: 'Database saturation', confidence: 0.2, support: 'contradicted' },
    ];
    diagnosis.nextChecks = ['Check the cache hit rate'];
    published.calls.length = 0;
    expect(await runProactiveJob(subject, 4, budget)).toBe('written');
    // The model saw the previous conclusion and what is new.
    const sent = model.requests.slice(calls).map(request => allText(request.body as Body));
    expect(sent.some(text => text.includes('Previous conclusion'))).toBe(true);
    expect(sent.some(text => text.includes('1 new alert'))).toBe(true);
    const note = await noteOf(high.id);
    expect(note.generation).toBe(4);
    const content = note.content as {
      revision: number;
      answer: string;
      updates: Array<Record<string, unknown>>;
    };
    expect(content.revision).toBe(2);
    expect(content.answer).toContain('Cache eviction storm');
    expect(content.updates).toHaveLength(1);
    expect(content.updates[0]).toMatchObject({
      revision: 2,
      signals: ['1 new alert'],
      leading: 'Cache eviction storm',
      added: ['Cache eviction storm (80%)'],
      down: ['Release 42 introduced the errors (70% → 40%)'],
      ruledOut: ['Database saturation'],
      nextChecks: ['Check the cache hit rate'],
    });
    // Conclusion edited in place, digest threaded under it.
    expect(published.calls.map(call => call.kind)).toEqual(['INVESTIGATION', 'DIGEST']);
    expect(published.calls[1].markdown).toContain(
      'Leading hypothesis is now:** Cache eviction storm'
    );

    // Idempotent: the same or an older generation never writes again.
    calls = model.requests.length;
    expect(await runProactiveJob(subject, 4, budget)).toBe('stale');
    expect(await runProactiveJob(subject, 3, budget)).toBe('stale');
    expect(model.requests).toHaveLength(calls);

    // The member sees the conclusion and its history; the outsider cannot open the change it read.
    const forMember = await getProactiveNotesForActor(
      high.id,
      (await resolveUserActor(member.id))!
    );
    expect(forMember?.investigation).toMatchObject({ revision: 2 });
    expect(forMember?.investigation?.updates[0]).toMatchObject({ leading: 'Cache eviction storm' });
    expect(forMember?.investigation?.updates[0]).not.toHaveProperty('sources');
    const forOutsider = await getProactiveNotesForActor(
      high.id,
      (await resolveUserActor(outsider.id))!
    );
    expect(forOutsider?.investigation).toMatchObject({ answer: null, updates: [] });
  });

  it('is capped per incident per day, and stops when the incident is resolved', async () => {
    const { service, high } = await setup();
    const subject = `INVESTIGATION:${high.id}`;
    diagnosis.hypotheses = [
      { title: 'Release 42 introduced the errors', confidence: 0.7, support: 'supported' },
    ];
    diagnosis.nextChecks = [];
    scriptInvestigation();
    expect(await runProactiveJob(subject, 1, budget)).toBe('written');
    await db.intelligenceWorkItem.deleteMany();
    const note = await noteOf(high.id);
    const recent = Array.from({ length: PROACTIVE_LIMITS.reassessPerIncidentDaily }, (_, index) =>
      new Date(Date.now() - (index + 1) * 20 * MIN).toISOString()
    ).reverse();
    await db.squireProactiveNote.update({
      where: { id: note.id },
      data: { content: { ...(note.content as object), reassessedAt: recent } },
    });
    await addAlert(service.id, high.id);
    await age(high.id, 30);
    await scanProactiveWork(budget);
    expect(await queued()).toEqual([]);
    const calls = model.requests.length;
    expect(await runProactiveJob(subject, 2, budget)).toBe('skipped');
    expect(model.requests).toHaveLength(calls);

    // Under the cap again, but resolved: never re-assessed.
    await db.squireProactiveNote.update({
      where: { id: note.id },
      data: { content: { ...(note.content as object), reassessedAt: [] } },
    });
    await age(high.id, 30);
    await scanProactiveWork(budget);
    expect(await queued()).toEqual([subject]);
    await db.intelligenceWorkItem.deleteMany();
    await db.incident.update({
      where: { id: high.id },
      data: { status: 'RESOLVED', resolvedAt: new Date() },
    });
    await scanProactiveWork(budget);
    expect(await queued()).toEqual([]);
    expect(await runProactiveJob(subject, 3, budget)).toBe('skipped');
    expect(model.requests).toHaveLength(calls);
  });

  it('records a failed re-run as an attempt, so it is retried at the debounce and not every scan', async () => {
    const { service, high } = await setup();
    const subject = `INVESTIGATION:${high.id}`;
    diagnosis.hypotheses = [
      { title: 'Release 42 introduced the errors', confidence: 0.7, support: 'supported' },
    ];
    diagnosis.nextChecks = [];
    scriptInvestigation();
    expect(await runProactiveJob(subject, 1, budget)).toBe('written');
    await db.intelligenceWorkItem.deleteMany();
    await addAlert(service.id, high.id);
    await age(high.id, 15);
    // AI switched off between runs: the run produces nothing.
    await db.aiSettings.update({
      where: { id: 'default' },
      data: { squireInvestigationEnabled: false },
    });
    expect(await runProactiveJob(subject, 2, budget)).toBe('skipped');
    const note = await noteOf(high.id);
    expect(note.generation).toBe(2);
    expect(
      (note.content as { reassessedAt: string[]; revision: number }).reassessedAt
    ).toHaveLength(1);
    expect((note.content as { revision: number }).revision).toBe(1);
    expect(Date.now() - note.updatedAt.getTime()).toBeLessThan(MIN);
  });
});

describe('partial runs and scan robustness', () => {
  const firstRun = async () => {
    const { service, high } = await setup();
    const subject = `INVESTIGATION:${high.id}`;
    diagnosis.hypotheses = [
      { title: 'Release 42 introduced the errors', confidence: 0.7, support: 'supported' },
    ];
    diagnosis.nextChecks = [];
    scriptInvestigation();
    return { service, high, subject };
  };

  it('never writes or publishes a partial first run, and retries it on a later scan', async () => {
    const { high, subject } = await firstRun();
    diagnosis.fail = true;
    expect(await runProactiveJob(subject, 1, budget)).toBe('skipped');
    expect(await db.squireProactiveNote.count()).toBe(0);
    expect(published.calls).toEqual([]);
    // Each incident's proactive AI calls get their own per-minute bucket.
    const buckets = await db.rateLimit.findMany({
      where: { key: { startsWith: 'ai:user:squire:proactive' } },
      select: { key: true },
    });
    expect(buckets.length).toBeGreaterThan(0);
    expect(buckets.every(row => row.key.startsWith(`ai:user:squire:proactive:${high.id}:`))).toBe(
      true
    );
    await scanProactiveWork(budget);
    expect(await queued()).toEqual([subject]);
  });

  it('keeps the previous conclusion on a partial re-run: attempt recorded, nothing published', async () => {
    const { service, high, subject } = await firstRun();
    expect(await runProactiveJob(subject, 1, budget)).toBe('written');
    const before = (await noteOf(high.id)).content as { answer: string; revision: number };
    published.calls.length = 0;
    await addAlert(service.id, high.id);
    await age(high.id, 15);
    diagnosis.fail = true;
    expect(await runProactiveJob(subject, 2, budget)).toBe('skipped');
    const after = (await noteOf(high.id)).content as {
      answer: string;
      revision: number;
      reassessedAt: string[];
      updates?: unknown[];
    };
    expect(after.answer).toBe(before.answer);
    expect(after.revision).toBe(1);
    expect(after.reassessedAt).toHaveLength(1);
    expect(after.updates ?? []).toEqual([]);
    expect(published.calls).toEqual([]);
  });

  it('records an attempt for a candidate rejected here, and never re-assesses an incident older than a day', async () => {
    const { service, high, subject } = await firstRun();
    expect(await runProactiveJob(subject, 1, budget)).toBe('written');
    await db.intelligenceWorkItem.deleteMany();
    await addAlert(service.id, high.id);
    await db.incident.update({ where: { id: high.id }, data: { createdAt: past(25 * 60 * MIN) } });
    await age(high.id, 15);
    await scanProactiveWork(budget);
    expect(await queued()).toEqual([]);
    // A stray job (picked before the window closed) runs no model, but moves the debounce.
    const calls = model.requests.length;
    expect(await runProactiveJob(subject, 2, budget)).toBe('skipped');
    expect(model.requests).toHaveLength(calls);
    const note = await noteOf(high.id);
    expect((note.content as { reassessedAt: string[] }).reassessedAt).toHaveLength(1);
    expect(Date.now() - note.updatedAt.getTime()).toBeLessThan(MIN);
  });

  it('survives malformed stored times, compares in UTC in any session time zone, and caps per scan', async () => {
    const { service, high, subject } = await firstRun();
    expect(await runProactiveJob(subject, 1, budget)).toBe('written');
    await db.intelligenceWorkItem.deleteMany();
    await addAlert(service.id, high.id);
    await age(high.id, 15);
    // A malformed time on another note must not abort the scan for everyone.
    const broken = await createTestIncident('Broken note', service.id, {
      teamId: service.teamId,
      urgency: 'HIGH',
      createdAt: past(5 * MIN),
    });
    const valid = (await noteOf(high.id)).content as object;
    await db.squireProactiveNote.create({
      data: {
        incidentId: broken.id,
        kind: 'INVESTIGATION',
        mode: 'AI',
        generation: 1,
        content: {
          ...valid,
          assessedAt: '2026-02-30T99:00:00Z',
          reassessedAt: 'not-an-array',
        },
        createdAt: past(30 * MIN),
        updatedAt: past(30 * MIN),
      },
    });
    await addAlert(service.id, broken.id);
    await scanProactiveWork(budget);
    expect(await queued()).toEqual([subject, `INVESTIGATION:${broken.id}`].sort());

    // Same answer when the database session is not in UTC.
    const now = new Date();
    const ids = await db.$transaction(async tx => {
      await tx.$executeRawUnsafe(`SET LOCAL TIME ZONE 'Asia/Kolkata'`);
      return findReassessCandidates(tx, [service.id], now);
    });
    expect(ids.sort()).toEqual([high.id, broken.id].sort());
    // An alert from before the last read is not news, in any session time zone.
    await db.alert.deleteMany({ where: { incidentId: high.id } });
    await db.alert.create({
      data: { serviceId: service.id, incidentId: high.id, payload: {}, createdAt: past(20 * MIN) },
    });
    const later = await db.$transaction(async tx => {
      await tx.$executeRawUnsafe(`SET LOCAL TIME ZONE 'America/Los_Angeles'`);
      return findReassessCandidates(tx, [service.id], now);
    });
    expect(later).toEqual([broken.id]);

    // The job for the malformed note records an attempt instead of looping on every scan.
    expect(await runProactiveJob(`INVESTIGATION:${broken.id}`, 2, budget)).toBe('skipped');
    const touched = await noteOf(broken.id);
    expect(Date.now() - touched.updatedAt.getTime()).toBeLessThan(MIN);

    // New writes only carry strict ISO times.
    expect(
      investigationContentSchema.safeParse({ ...valid, assessedAt: 'yesterday' }).success
    ).toBe(false);

    // Globally capped per scan.
    for (let index = 0; index < PROACTIVE_LIMITS.reassessPerScan + 1; index += 1) {
      const incident = await createTestIncident(`Busy ${index}`, service.id, {
        teamId: service.teamId,
        createdAt: past(5 * MIN),
      });
      await db.squireProactiveNote.create({
        data: {
          incidentId: incident.id,
          kind: 'INVESTIGATION',
          mode: 'AI',
          generation: 1,
          content: { ...valid, assessedAt: past(30 * MIN).toISOString() },
          updatedAt: past(30 * MIN),
        },
      });
      await addAlert(service.id, incident.id);
    }
    const capped = await db.$transaction(tx =>
      findReassessCandidates(tx, [service.id], new Date())
    );
    expect(capped).toHaveLength(PROACTIVE_LIMITS.reassessPerScan);
  });

  it('never pulls a backing-off item forward on the next scan', async () => {
    const { subject } = await firstRun();
    const retryAt = new Date(Date.now() + 10 * MIN);
    await db.intelligenceWorkItem.create({
      data: {
        kind: 'SQUIRE_PROACTIVE',
        subjectKey: subject,
        priority: 32,
        generation: 1,
        attempts: 1,
        scheduledAt: retryAt,
      },
    });
    await scanProactiveWork(budget);
    const item = await db.intelligenceWorkItem.findFirstOrThrow({ where: { subjectKey: subject } });
    expect(item.scheduledAt.getTime()).toBe(retryAt.getTime());
  });
});

describe('briefing in the incident channel', () => {
  it('publishes the briefing as the SUMMARY when it is written', async () => {
    const { admin, service } = await setup();
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
    await db.aiSettings.update({ where: { id: 'default' }, data: { enabled: false } });
    const incident = await createTestIncident('Checkout slow', service.id, {
      teamId: service.teamId,
      createdAt: past(10 * MIN),
    });
    expect(await runProactiveJob(`BRIEFING:${incident.id}`, 1, budget)).toBe('written');
    expect(published.calls).toHaveLength(1);
    expect(published.calls[0]).toMatchObject({ kind: 'SUMMARY', incidentId: incident.id });
    expect(published.calls[0].markdown).toContain('Checkout slow');
  });

  it('posts only the incident headline and a link, never the AI-written briefing', async () => {
    const { admin, service } = await setup();
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
    const incident = await createTestIncident('Checkout slow', service.id, {
      teamId: service.teamId,
      createdAt: past(10 * MIN),
    });
    model.script.push({
      content: JSON.stringify({
        headline: 'AI headline about the outage',
        currentState: 'Secret AI prose about customers',
        impact: 'Some checkouts are slow.',
        keyEvents: ['Alert fired'],
        possibleCauses: ['A cause'],
        nextSteps: ['Restart the payments cluster'],
      }),
    });
    expect(await runProactiveJob(`BRIEFING:${incident.id}`, 1, budget)).toBe('written');
    const note = await db.squireProactiveNote.findUniqueOrThrow({
      where: { incidentId_kind: { incidentId: incident.id, kind: 'BRIEFING' } },
    });
    expect(note.mode).toBe('AI');
    expect(published.calls).toHaveLength(1);
    expect(published.calls[0].markdown).toBe(
      `**Checkout slow (${service.name})**\n_Briefing: [open the incident in OpsKnight](/incidents/${incident.id})._`
    );
  });
});
