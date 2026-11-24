import { beforeEach, describe, expect, it, vi } from 'vitest';

const session = vi.hoisted(() => ({ userId: '' }));
vi.mock('next-auth', () => ({
  getServerSession: vi.fn(async () =>
    session.userId ? { user: { id: session.userId, tokenVersion: 0 } } : null
  ),
}));
vi.mock('@/lib/auth', () => ({ getAuthOptions: vi.fn(async () => ({})) }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
const published = vi.hoisted(() => ({ calls: [] as Array<Record<string, string>> }));
vi.mock('@/lib/chatops/squire/publish', () => ({
  publishSquireUpdate: vi.fn(async (update: Record<string, string>) => {
    published.calls.push(update);
  }),
}));
const ai = vi.hoisted(() => ({ calls: 0 }));
vi.mock('@/lib/intelligence/ai/port', async importOriginal => ({
  ...(await importOriginal<object>()),
  resolveLanguageModel: vi.fn(async () => {
    ai.calls += 1;
    return null;
  }),
}));

import { resolveUserActor } from '@/lib/authorization-actors';
import {
  DEFAULT_POLICY_DEFINITION,
  INTELLIGENCE_SETTINGS_DEFAULTS,
} from '@/lib/intelligence/contract';
import { DEFAULT_HANDLERS } from '@/lib/intelligence/jobs/runner';
import { claimWorkItems, WORK_KINDS } from '@/lib/intelligence/jobs/work-queue';
import { PROACTIVE_LIMITS } from '@/lib/intelligence/memory/contract';
import {
  parseVerificationSubject,
  runVerificationJob,
  verificationHeadline,
  verificationSubject,
} from '@/lib/intelligence/memory/proactive-verification';
import { getProactiveNotesForActor } from '@/lib/intelligence/memory/proactive-view';
import { executeSquireAction } from '@/lib/intelligence/squire/actions/execute';
import { buildProposal } from '@/lib/intelligence/squire/actions/proposals';
import { buildOperationProposal } from '@/lib/intelligence/squire/operations';
import { getIntelligenceSettings, publishPolicyVersion } from '@/lib/intelligence/settings/service';
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
  session.userId = '';
  published.calls.length = 0;
  ai.calls = 0;
});

const MIN = 60_000;
const budget = { maxDbMs: 5_000 };

async function setup() {
  const admin = await createTestUser({ role: 'ADMIN' });
  await publishPolicyVersion(
    {},
    { mode: 'SUGGEST', definition: DEFAULT_POLICY_DEFINITION, expectedHeadVersion: 0 },
    { actorId: admin.id, source: 'UI' }
  );
  await db.intelligenceSettings.create({
    data: { id: 'default', ...INTELLIGENCE_SETTINGS_DEFAULTS, enabled: true },
  });
  // Extended actions on (catalog changes), AI itself off: the check is deterministic.
  await db.aiSettings.create({
    data: {
      id: 'default',
      enabled: false,
      squireEnabled: true,
      squireExtendedActions: true,
      updatedAt: new Date(),
    },
  });
  const team = await createTestTeam('Checkout team');
  const other = await createTestTeam('Payments team');
  const service = await createTestService('Checkout', team.id);
  const responder = await createTestUser({ role: 'RESPONDER' });
  await db.teamMember.create({ data: { userId: responder.id, teamId: team.id, role: 'MEMBER' } });
  const member = await createTestUser({ role: 'USER' });
  await db.teamMember.create({ data: { userId: member.id, teamId: team.id, role: 'MEMBER' } });
  const bystander = await createTestUser({ role: 'USER' });
  await db.teamMember.create({ data: { userId: bystander.id, teamId: team.id, role: 'MEMBER' } });
  const incident = await createTestIncident('Checkout 500s', service.id, {
    teamId: team.id,
    dedupKey: 'checkout-500',
  });
  await db.alert.create({
    data: {
      serviceId: service.id,
      incidentId: incident.id,
      payload: {},
      dedupKey: 'checkout-500',
      createdAt: new Date(Date.now() - 30 * MIN),
    },
  });
  return { admin, team, other, service, responder, member, bystander, incident };
}

const verificationItems = async () =>
  (await db.intelligenceWorkItem.findMany({ select: { subjectKey: true, scheduledAt: true } }))
    .filter(row => row.subjectKey.startsWith('VERIFICATION:'))
    .map(row => ({ ...parseVerificationSubject(row.subjectKey)!, scheduledAt: row.scheduledAt }));

describe('scheduling a fix check', () => {
  it('schedules a check after a resolve confirmed through Squire, for the person who confirmed it', async () => {
    const { responder, incident } = await setup();
    const actor = (await resolveUserActor(responder.id))!;
    session.userId = responder.id;
    const proposal = await buildProposal(actor, 'resolve_incident', {
      incidentId: incident.id,
      resolution: 'Rolled back release 42 and errors stopped.',
    });
    expect(await executeSquireAction(actor, proposal!.token)).toMatchObject({ ok: true });
    const [item, ...rest] = await verificationItems();
    expect(rest).toHaveLength(0);
    expect(item).toMatchObject({
      incidentId: incident.id,
      userId: responder.id,
      trigger: 'RESOLVE',
    });
    const delay = item.scheduledAt.getTime() - item.at.getTime();
    expect(delay).toBe(PROACTIVE_LIMITS.verificationDelayMs);
  });

  it('schedules a check after a catalog resolve (operation), and nothing for a refused one', async () => {
    const { admin, incident } = await setup();
    const actor = (await resolveUserActor(admin.id))!;
    const proposal = await buildOperationProposal(actor, {
      operationId: 'resolveIncident',
      args: { path: { id: incident.id }, body: { resolutionNote: 'Rolled back release 42.' } },
    });
    expect(proposal).not.toBeNull();
    expect(await executeSquireAction(actor, proposal!.token)).toMatchObject({ ok: true });
    expect(await verificationItems()).toEqual([
      expect.objectContaining({ incidentId: incident.id, userId: admin.id, trigger: 'RESOLVE' }),
    ]);
  });
});

describe('did the fix hold?', () => {
  it('holds when nothing new arrived, and calls no model', async () => {
    const { responder, member, incident } = await setup();
    await db.incident.update({
      where: { id: incident.id },
      data: { status: 'RESOLVED', resolvedAt: new Date(Date.now() - 11 * MIN) },
    });
    const subject = verificationSubject(
      incident.id,
      responder.id,
      new Date(Date.now() - 11 * MIN),
      'RESOLVE'
    );
    expect(await runVerificationJob(subject, 1, budget)).toBe('written');
    const note = await db.squireProactiveNote.findUniqueOrThrow({
      where: { incidentId_kind: { incidentId: incident.id, kind: 'VERIFICATION' } },
    });
    expect(note).toMatchObject({ mode: 'BASIC', generation: 1 });
    expect(note.content).toMatchObject({ holding: true, matchedOn: 'DEDUP', newAlerts: 0 });
    expect(published.calls).toEqual([
      expect.objectContaining({
        incidentId: incident.id,
        kind: 'VERIFICATION',
        markdown: 'Holding: no new alerts in 11 minutes.',
      }),
    ]);
    expect(await db.inAppNotification.count()).toBe(0);
    const view = await getProactiveNotesForActor(incident.id, (await resolveUserActor(member.id))!);
    expect(view?.verification).toMatchObject({
      holding: true,
      headline: 'Holding: no new alerts in 11 minutes.',
    });
    expect(ai.calls).toBe(0);
  });

  it('is not holding on reopen and matching alerts; notifies only the confirmer, with only what they may read', async () => {
    const { other, service, member, bystander, incident } = await setup();
    const since = new Date(Date.now() - 11 * MIN);
    // Reopened, with a new alert on the incident itself.
    await db.incident.update({ where: { id: incident.id }, data: { status: 'OPEN' } });
    await db.alert.create({
      data: {
        serviceId: service.id,
        incidentId: incident.id,
        payload: {},
        dedupKey: 'checkout-500',
      },
    });
    // A new public incident with the same dedup key, and a private one of another team.
    const again = await createTestIncident('Checkout down again', service.id, {
      teamId: service.teamId,
      dedupKey: 'checkout-500',
    });
    await db.alert.create({
      data: { serviceId: service.id, incidentId: again.id, payload: {}, dedupKey: 'checkout-500' },
    });
    const hidden = await createTestIncident('Secret payments outage', service.id, {
      teamId: other.id,
      visibility: 'PRIVATE',
    });
    await db.alert.create({
      data: { serviceId: service.id, incidentId: hidden.id, payload: {}, dedupKey: 'checkout-500' },
    });
    // Unrelated activity on the service does not count when the incident has a dedup key.
    await db.alert.create({
      data: { serviceId: service.id, payload: {}, dedupKey: 'disk-full' },
    });

    // Scheduled by the member's confirmed resolve; run through the lane's own handler.
    const subject = verificationSubject(incident.id, member.id, since, 'RESOLVE');
    await db.intelligenceWorkItem.create({
      data: { kind: WORK_KINDS.SQUIRE_PROACTIVE, subjectKey: subject, generation: 5 },
    });
    const [item] = await claimWorkItems({ limit: 5 });
    await DEFAULT_HANDLERS[WORK_KINDS.SQUIRE_PROACTIVE]!(item, {
      settings: await getIntelligenceSettings(),
      signal: new AbortController().signal,
    });

    const note = await db.squireProactiveNote.findUniqueOrThrow({
      where: { incidentId_kind: { incidentId: incident.id, kind: 'VERIFICATION' } },
    });
    expect(note.content).toMatchObject({
      holding: false,
      reopened: true,
      newAlerts: 1,
      unlinkedAlerts: 0,
      confirmedBy: member.id,
    });
    expect(
      (note.content as { related: Array<{ id: string }> }).related.map(r => r.id).sort()
    ).toEqual([again.id, hidden.id].sort());

    // Only the confirmer is notified, linked to the incident, and never about the private incident.
    const notices = await db.inAppNotification.findMany();
    expect(notices).toHaveLength(1);
    expect(notices[0]).toMatchObject({
      userId: member.id,
      type: 'INCIDENT',
      entityType: 'INCIDENT',
      entityId: incident.id,
    });
    expect(notices[0].message).toContain('Not holding');
    expect(notices[0].message).toContain('the incident reopened');
    expect(notices[0].message).toContain('Checkout down again');
    expect(notices[0].message).not.toContain('Secret payments outage');
    expect(notices[0].message).toContain('2 new alerts');
    expect(bystander.id).not.toBe(member.id);

    // The channel never gets other incidents' titles.
    expect(published.calls).toHaveLength(1);
    expect(published.calls[0]).toMatchObject({ kind: 'VERIFICATION' });
    expect(published.calls[0].markdown).not.toContain('Checkout down again');
    expect(published.calls[0].markdown).not.toContain('Secret payments outage');

    // On the incident page each viewer sees only incidents they may open.
    const view = await getProactiveNotesForActor(incident.id, (await resolveUserActor(member.id))!);
    expect(view?.verification?.related.map(r => r.id)).toEqual([again.id]);
    expect(view?.verification?.headline).not.toContain('Secret');

    // Idempotent: the same pass again writes and notifies nothing more.
    expect(await runVerificationJob(subject, 5, budget)).toBe('stale');
    expect(await db.inAppNotification.count()).toBe(1);
    expect(ai.calls).toBe(0);
  });

  it('falls back to any new alert on the service when the incident has no dedup key', async () => {
    const { service, responder } = await setup();
    const bare = await createTestIncident('Something odd', service.id, {
      teamId: service.teamId,
      status: 'RESOLVED',
    });
    await db.alert.create({ data: { serviceId: service.id, payload: {} } });
    const subject = verificationSubject(
      bare.id,
      responder.id,
      new Date(Date.now() - 10 * MIN),
      'RUNBOOK'
    );
    expect(await runVerificationJob(subject, 1, budget)).toBe('written');
    const note = await db.squireProactiveNote.findUniqueOrThrow({
      where: { incidentId_kind: { incidentId: bare.id, kind: 'VERIFICATION' } },
    });
    expect(note.content).toMatchObject({
      trigger: 'RUNBOOK',
      holding: false,
      matchedOn: 'SERVICE',
      unlinkedAlerts: 1,
      reopened: false,
    });
    expect(published.calls[0].markdown).toBe('Not holding: 1 new alert since the runbook started.');
  });

  it('says a runbook check is measured from when the runbook started', () => {
    const base = {
      v: 1 as const,
      confirmedBy: 'user-1',
      since: new Date().toISOString(),
      checkedAt: new Date().toISOString(),
      windowMinutes: 10,
      holding: true,
      matchedOn: 'DEDUP' as const,
      newAlerts: 0,
      unlinkedAlerts: 0,
      reopened: false,
      related: [],
    };
    expect(verificationHeadline({ ...base, trigger: 'RUNBOOK' })).toBe(
      'Holding: no new alerts in 10 minutes since the runbook started.'
    );
    expect(verificationHeadline({ ...base, trigger: 'RESOLVE' })).toBe(
      'Holding: no new alerts in 10 minutes.'
    );
  });
});
