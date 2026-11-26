/* eslint-disable @typescript-eslint/no-explicit-any -- tool results are untyped JSON in these assertions */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { resolveUserActor } from '@/lib/authorization-actors';
import { incidentRef } from '@/lib/intelligence/incident-ux/explain';
import { buildSquireTools } from '@/lib/intelligence/squire/tools';
import { buildIncidentTools } from '@/lib/intelligence/squire/tools-incident';
import { buildOperationProposal } from '@/lib/intelligence/squire/operations';
import { buildRunbookPublishProposal } from '@/lib/intelligence/squire/plans';
import {
  createTestIncident,
  createTestService,
  createTestTeam,
  createTestUser,
  resetDatabase,
  testPrisma as db,
} from '../../helpers/test-db';

async function world() {
  await resetDatabase();
  await db.aiSettings.create({
    data: {
      id: 'default',
      enabled: true,
      squireEnabled: true,
      squireExtendedActions: true,
      updatedAt: new Date(),
    },
  });
  const admin = await createTestUser({ role: 'ADMIN', name: 'Gap Admin' });
  const team = await createTestTeam('Gap Ops');
  const service = await createTestService('Gap Checkout', team.id);
  const actor = (await resolveUserActor(admin.id))!;
  return { admin, team, service, actor };
}
const run = (actor: Awaited<ReturnType<typeof world>>['actor'], name: string, input: unknown) =>
  buildSquireTools(actor, { personal: true }).find(tool => tool.name === name)!.execute!(
    input
  ) as Promise<any>;

vi.setConfig({ testTimeout: 120_000 });
beforeEach(() => {
  if (!new URL(process.env.DATABASE_URL ?? '').pathname.endsWith('_test'))
    throw new Error('Dedicated test DB required');
});

describe('Squire numbers and ids come from tools', () => {
  it('returns a ready shortId, the assignee, and an unassigned filter with its own total', async () => {
    const { admin, service, actor } = await world();
    const mine = await createTestIncident('Assigned one', service.id, { assigneeId: admin.id });
    const loose = await createTestIncident('Nobody owns this', service.id);
    const all = await run(actor, 'search_incidents', { status: 'unresolved' });
    expect(all.total).toBe(2);
    expect(all.items.find((i: any) => i.id === mine.id)).toMatchObject({
      shortId: incidentRef(mine.id),
      assignee: 'Gap Admin',
    });
    const none = await run(actor, 'search_incidents', { unassigned: true });
    expect(none).toMatchObject({ total: 1, items: [{ id: loose.id, assignee: null }] });
    expect((await run(actor, 'get_incident', { id: mine.id })).shortId).toBe(incidentRef(mine.id));
  });

  it('reads an earlier period of analytics and older changes around a time', async () => {
    const { actor, service, team } = await world();
    const when = new Date(Date.now() - 20 * 24 * 3_600_000);
    await createTestIncident('Old one', service.id, { teamId: team.id, createdAt: when });
    await db.changeEvent.create({
      data: {
        serviceId: service.id,
        source: 'ci',
        kind: 'DEPLOY',
        summary: 'Old deploy',
        occurredAt: new Date(when.getTime() - 3_600_000),
      },
    });
    const analytics = buildIncidentTools(actor, { personal: true }).find(
      tool => tool.name === 'incident_analytics'
    )!;
    const now = (await analytics.execute!({ hours: 168 })) as any;
    const before = (await analytics.execute!({
      hours: 720,
      endingAt: new Date(Date.now() - 168 * 3_600_000).toISOString(),
    })) as any;
    expect([now.total, before.total]).toEqual([0, 1]);
    expect(await run(actor, 'get_recent_changes', {})).toEqual([]);
    const around = await run(actor, 'get_recent_changes', {
      around: when.toISOString(),
      windowHours: 6,
    });
    expect(around.map((c: any) => c.summary)).toEqual(['Old deploy']);
  });
});

describe('Squire cards in plain words', () => {
  it('titles incident state changes humanly and hides plumbing fields', async () => {
    const { actor, service, team } = await world();
    const incident = await createTestIncident('Card words', service.id, { teamId: team.id });
    await db.incident.update({ where: { id: incident.id }, data: { status: 'ACKNOWLEDGED' } });
    const card = await buildOperationProposal(actor, {
      operationId: 'unacknowledgeIncident',
      args: { path: { id: incident.id }, body: { expectedStatus: 'ACKNOWLEDGED' } },
    });
    expect(card!.title).toBe('Remove acknowledgement');
    expect(JSON.stringify(card!.preview ?? [])).not.toMatch(/expectedStatus|Expected status/i);
  });

  it('shows a snooze time in the person zone, not UTC', async () => {
    const { admin, actor, service, team } = await world();
    await db.user.update({ where: { id: admin.id }, data: { timeZone: 'Asia/Kolkata' } });
    const incident = await createTestIncident('Snooze me', service.id, { teamId: team.id });
    const { buildProposal } = await import('@/lib/intelligence/squire/actions/proposals');
    const card = await buildProposal(actor, 'snooze_incident', {
      incidentId: incident.id,
      minutes: 60,
    });
    const until = card!.preview!.find(row => row.label === 'Until about')!.value;
    expect(until).not.toContain('UTC');
    expect(until).toMatch(/GMT\+5:30|IST/);
  });
});

describe('Squire publish proposal', () => {
  it('prepares a readable publish card through publishRunbookDraft and publishes on confirm', async () => {
    const { actor } = await world();
    const runbook = await db.runbook.create({ data: { name: 'Pool reset', slug: 'pool-reset' } });
    const draft = await db.runbookVersion.create({
      data: {
        runbookId: runbook.id,
        version: 1,
        state: 'DRAFT',
        checksum: 'x',
        draftRevision: 2,
        definition: {
          steps: [
            { key: 's1', name: 'Open it', type: 'MANUAL', riskClass: 'READ_ONLY', config: {} },
          ],
        },
      },
    });
    await db.runbook.update({ where: { id: runbook.id }, data: { draftVersionId: draft.id } });
    const card = await buildRunbookPublishProposal(actor, { runbookId: runbook.id });
    expect(card).toMatchObject({ title: 'Publish “Pool reset”', confirmLabel: 'Publish runbook' });
    await db.runbook.update({ where: { id: runbook.id }, data: { draftVersionId: null } });
    expect(await buildRunbookPublishProposal(actor, { runbookId: runbook.id })).toEqual({
      refusal: expect.stringContaining('no unpublished draft'),
    });
  });
});
