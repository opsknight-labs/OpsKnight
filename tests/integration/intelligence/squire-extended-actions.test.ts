import type { Prisma } from '@prisma/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const session = vi.hoisted(() => ({ userId: '' }));
vi.mock('next-auth', () => ({
  getServerSession: vi.fn(async () =>
    session.userId ? { user: { id: session.userId, tokenVersion: 0 } } : null
  ),
}));
vi.mock('@/lib/auth', () => ({ getAuthOptions: vi.fn(async () => ({})) }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
// Jira is an outbound HTTP integration; the boundary under test is Squire → the app's Jira action, so the
// network client is replaced by one that records the durable link exactly like the real one does.
const jira = vi.hoisted(() => ({ calls: 0 }));
vi.mock('@/lib/jira-sync', async importOriginal => {
  const original = await importOriginal<typeof import('@/lib/jira-sync')>();
  const { default: prisma } = await import('@/lib/prisma');
  return {
    ...original,
    createJiraIssueAndLink: vi.fn(async (params: { incidentId: string; projectKey: string }) => {
      jira.calls += 1;
      const key = `${params.projectKey}-${jira.calls}`;
      const link = await prisma.externalIssueLink.create({
        data: {
          incidentId: params.incidentId,
          externalId: `jira-${jira.calls}`,
          externalKey: key,
          externalUrl: `https://jira.example.test/browse/${key}`,
        },
      });
      return { issue: { id: link.externalId, key, url: link.externalUrl }, link };
    }),
  };
});

import { resolveUserActor } from '@/lib/authorization-actors';
import { computeDefinitionChecksum, parseRunbookDefinition } from '@/lib/runbooks/definition';
import { executeSquireAction } from '@/lib/intelligence/squire/actions/execute';
import { buildProposal, PROPOSAL_TTL_MS } from '@/lib/intelligence/squire/actions/proposals';
import { readSquireActionOutcome } from '@/lib/intelligence/squire/actions/outcomes';
import { buildSquireTools } from '@/lib/intelligence/squire/tools';
import { streamSquire } from '@/lib/intelligence/squire/chat';
import type { SquireEvent } from '@/lib/intelligence/squire/contract';
import {
  createTestEscalationPolicy,
  createTestIncident,
  createTestService,
  createTestStatusPage,
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
  jira.calls = 0;
});

const actorOf = async (userId: string) => {
  const actor = await resolveUserActor(userId);
  if (!actor) throw new Error('actor not resolved');
  return actor;
};

async function world(options: { extended?: boolean } = {}) {
  await db.aiSettings.create({
    data: {
      id: 'default',
      squireEnabled: true,
      squireExtendedActions: options.extended ?? true,
    },
  });
  const team = await createTestTeam('Payments');
  const admin = await createTestUser({ role: 'ADMIN', name: 'Ada Admin' });
  const responder = await createTestUser({ role: 'RESPONDER', name: 'Rae Responder' });
  const member = await createTestUser({ role: 'USER', name: 'Max Member' });
  const colleague = await createTestUser({ role: 'RESPONDER', name: 'Cole Colleague' });
  for (const user of [admin, responder, member, colleague])
    await db.teamMember.create({ data: { userId: user.id, teamId: team.id, role: 'MEMBER' } });
  const policy = await createTestEscalationPolicy('Payments escalation', [
    { stepOrder: 0, delayMinutes: 5, targetType: 'USER', targetUserId: responder.id },
    { stepOrder: 1, delayMinutes: 10, targetType: 'USER', targetUserId: admin.id },
  ]);
  const service = await createTestService('Checkout', team.id, { escalationPolicyId: policy.id });
  const incident = await createTestIncident('Checkout errors', service.id, {
    teamId: team.id,
    urgency: 'HIGH',
  });
  const other = await createTestIncident('Checkout latency', service.id, { teamId: team.id });
  return { team, admin, responder, member, colleague, policy, service, incident, other };
}

/** Builds a proposal for a person and confirms it in their own session. */
async function propose(userId: string, action: string, input: Record<string, unknown>, now?: Date) {
  return buildProposal(await actorOf(userId), action, input, now);
}
async function confirm(userId: string, token: string) {
  session.userId = userId;
  return executeSquireAction(await actorOf(userId), token);
}
const demote = (userId: string, role: 'USER' | 'RESPONDER' | 'AUDITOR') =>
  db.user.update({ where: { id: userId }, data: { role } });
const receipts = (status?: string) =>
  db.squireActionReceipt.count({ where: status ? { status } : {} });

async function expectExpiredRefused(
  userId: string,
  action: string,
  input: Record<string, unknown>
) {
  const stale = await propose(
    userId,
    action,
    input,
    new Date(Date.now() - PROPOSAL_TTL_MS - 1_000)
  );
  expect(stale).not.toBeNull();
  expect(await confirm(userId, stale!.token)).toEqual({
    ok: false,
    message: 'This suggestion has expired. Ask again for a fresh one.',
  });
  expect(await receipts()).toBe(0);
}

async function expectChanged(userId: string, token: string) {
  const result = await confirm(userId, token);
  expect(result).toMatchObject({ ok: false });
  expect(result.message).toMatch(/changed after this suggestion was prepared/);
  expect(await receipts('FAILED')).toBe(1);
}

describe('extended Squire actions are opt-in', () => {
  it('offers, proposes and executes none of them while the switch is off', async () => {
    const { responder, incident } = await world({ extended: false });
    const actor = await actorOf(responder.id);
    const names = buildSquireTools(actor, { personal: true }).map(tool => tool.name);
    expect(names).not.toContain('propose_escalate_incident');
    expect(names).not.toContain('propose_snooze_incident');
    expect(
      await propose(responder.id, 'snooze_incident', { incidentId: incident.id, minutes: 30 })
    ).toBeNull();

    // A card made while it was on is withdrawn when it is turned off again.
    await db.aiSettings.update({ where: { id: 'default' }, data: { squireExtendedActions: true } });
    const proposal = await propose(responder.id, 'snooze_incident', {
      incidentId: incident.id,
      minutes: 30,
    });
    expect(proposal).not.toBeNull();
    await db.aiSettings.update({
      where: { id: 'default' },
      data: { squireExtendedActions: false },
    });
    expect(await confirm(responder.id, proposal!.token)).toMatchObject({
      ok: false,
      message: expect.stringMatching(/turned off/),
    });
    expect((await db.incident.findUniqueOrThrow({ where: { id: incident.id } })).status).toBe(
      'OPEN'
    );
  });

  it('declares the new proposal tools when on, but never the publish follow-up', async () => {
    const { responder } = await world();
    const actor = await actorOf(responder.id);
    const names = buildSquireTools(actor, { personal: true, extendedActions: true }).map(
      tool => tool.name
    );
    for (const name of [
      'escalate_incident',
      'change_urgency',
      'snooze_incident',
      'unlink_related_incident',
      'add_responder',
      'create_jira_issue',
      'draft_status_update',
      'run_runbook',
    ])
      expect(names).toContain(`propose_${name}`);
    expect(names).not.toContain('propose_publish_status_update');
    // Naming a person needs Personal clearance, like reassigning.
    expect(
      buildSquireTools(actor, { personal: false, extendedActions: true }).map(tool => tool.name)
    ).not.toContain('propose_add_responder');
  });

  it('refuses API keys when proposing and when confirming', async () => {
    const { responder, incident } = await world();
    const actor = await actorOf(responder.id);
    const keyed = { ...actor, apiKey: { id: 'key-1', scopes: ['incidents:write'] } };
    expect(await buildProposal(keyed, 'escalate_incident', { incidentId: incident.id })).toBeNull();
    const proposal = await propose(responder.id, 'escalate_incident', { incidentId: incident.id });
    session.userId = responder.id;
    expect(await executeSquireAction(keyed, proposal!.token)).toEqual({
      ok: false,
      message: 'Sign in to confirm this action.',
    });
    expect(await receipts()).toBe(0);
  });

  it('binds a proposal to the person it was made for', async () => {
    const { responder, colleague, incident } = await world();
    const proposal = await propose(responder.id, 'change_urgency', {
      incidentId: incident.id,
      urgency: 'LOW',
    });
    expect(await confirm(colleague.id, proposal!.token)).toMatchObject({
      ok: false,
      message: expect.stringMatching(/expired/),
    });
    expect((await db.incident.findUniqueOrThrow({ where: { id: incident.id } })).urgency).toBe(
      'HIGH'
    );
  });
});

describe('escalate_incident', () => {
  it('previews the next level, pages it once through the escalation service, and replays the receipt', async () => {
    const { responder, incident } = await world();
    const proposal = await propose(responder.id, 'escalate_incident', { incidentId: incident.id });
    expect(proposal).toMatchObject({
      action: 'escalate_incident',
      title: 'Escalate now',
      confirmLabel: 'Escalate',
      impact: 'PAGES_PEOPLE',
    });
    expect(proposal!.detail).toContain('level 1 of 2');
    expect(proposal!.preview).toContainEqual({ label: 'Pages', value: 'person “Rae Responder”' });

    const first = await confirm(responder.id, proposal!.token);
    expect(first).toMatchObject({ ok: true });
    expect(
      await db.incidentEvent.count({
        where: {
          incidentId: incident.id,
          type: 'ESCALATED',
          message: { contains: 'Manual escalation' },
        },
      })
    ).toBe(1);
    expect(await confirm(responder.id, proposal!.token)).toEqual(first);
    expect(
      await db.incidentEvent.count({
        where: {
          incidentId: incident.id,
          type: 'ESCALATED',
          message: { contains: 'Manual escalation' },
        },
      })
    ).toBe(1);
    expect(
      await db.auditLog.count({
        where: { action: 'intelligence.squire.action', entityId: incident.id },
      })
    ).toBe(1);
  });

  it('refuses a chat confirmation before the receipt, so the card can still be confirmed in OpsKnight', async () => {
    const { responder, incident } = await world();
    const proposal = await propose(responder.id, 'escalate_incident', { incidentId: incident.id });
    const fromChat = await executeSquireAction(await actorOf(responder.id), proposal!.token, {
      provider: 'SLACK',
      actorName: 'Rae Responder',
    });
    expect(fromChat).toEqual({ ok: false, message: 'Open OpsKnight to confirm this suggestion.' });
    expect(await receipts()).toBe(0);
    expect(
      await db.auditLog.count({
        where: { action: 'intelligence.squire.action', entityId: incident.id },
      })
    ).toBe(0);

    expect(await confirm(responder.id, proposal!.token)).toMatchObject({ ok: true });
    expect(await receipts('SUCCEEDED')).toBe(1);
  });

  it('is not offered for an incident that is not open, nor to someone who may not escalate it', async () => {
    const { responder, member, incident, service } = await world();
    const acked = await createTestIncident('Already handled', service.id, {
      status: 'ACKNOWLEDGED',
    });
    expect(await propose(responder.id, 'escalate_incident', { incidentId: acked.id })).toBeNull();
    const hidden = await createTestIncident('Other team', service.id, {
      teamId: (await createTestTeam('Other')).id,
      visibility: 'PRIVATE',
    });
    expect(await propose(member.id, 'escalate_incident', { incidentId: hidden.id })).toBeNull();
    // Permission withdrawn between proposing and confirming: the escalation service refuses.
    const proposal = await propose(responder.id, 'escalate_incident', { incidentId: incident.id });
    await demote(responder.id, 'AUDITOR');
    expect(await confirm(responder.id, proposal!.token)).toMatchObject({ ok: false });
    expect(
      await db.incidentEvent.count({ where: { incidentId: incident.id, type: 'ESCALATED' } })
    ).toBe(0);
  });

  it('refuses an expired proposal', async () => {
    const { responder, incident } = await world();
    await expectExpiredRefused(responder.id, 'escalate_incident', { incidentId: incident.id });
  });

  it('refuses when the incident was acknowledged after the card was shown', async () => {
    const { responder, incident } = await world();
    const proposal = await propose(responder.id, 'escalate_incident', { incidentId: incident.id });
    await db.incident.update({ where: { id: incident.id }, data: { status: 'ACKNOWLEDGED' } });
    await expectChanged(responder.id, proposal!.token);
    expect(
      await db.incidentEvent.count({ where: { incidentId: incident.id, type: 'ESCALATED' } })
    ).toBe(0);
  });
});

describe('change_urgency', () => {
  it('changes urgency through the incident command once', async () => {
    const { responder, incident } = await world();
    const proposal = await propose(responder.id, 'change_urgency', {
      incidentId: incident.id,
      urgency: 'LOW',
    });
    expect(proposal?.preview).toEqual([
      { label: 'From', value: 'HIGH' },
      { label: 'To', value: 'LOW' },
    ]);
    const result = await confirm(responder.id, proposal!.token);
    expect(result).toMatchObject({ ok: true, message: 'Urgency changed to LOW.' });
    expect((await db.incident.findUniqueOrThrow({ where: { id: incident.id } })).urgency).toBe(
      'LOW'
    );
    expect(await confirm(responder.id, proposal!.token)).toEqual(result);
    expect(
      await db.incidentEvent.count({
        where: { incidentId: incident.id, message: 'Urgency updated to LOW' },
      })
    ).toBe(1);
    // Asking for the urgency it already has proposes nothing.
    expect(
      await propose(responder.id, 'change_urgency', { incidentId: incident.id, urgency: 'LOW' })
    ).toBeNull();
  });

  it('applies the same responder check as the urgency control', async () => {
    const { responder, member, incident } = await world();
    expect(
      await propose(member.id, 'change_urgency', { incidentId: incident.id, urgency: 'LOW' })
    ).toBeNull();
    const proposal = await propose(responder.id, 'change_urgency', {
      incidentId: incident.id,
      urgency: 'LOW',
    });
    await demote(responder.id, 'USER');
    expect(await confirm(responder.id, proposal!.token)).toMatchObject({ ok: false });
    expect((await db.incident.findUniqueOrThrow({ where: { id: incident.id } })).urgency).toBe(
      'HIGH'
    );
  });

  it('refuses an expired proposal', async () => {
    const { responder, incident } = await world();
    await expectExpiredRefused(responder.id, 'change_urgency', {
      incidentId: incident.id,
      urgency: 'MEDIUM',
    });
  });

  it('refuses when someone else changed the urgency first', async () => {
    const { responder, incident } = await world();
    const proposal = await propose(responder.id, 'change_urgency', {
      incidentId: incident.id,
      urgency: 'LOW',
    });
    await db.incident.update({ where: { id: incident.id }, data: { urgency: 'MEDIUM' } });
    await expectChanged(responder.id, proposal!.token);
    expect((await db.incident.findUniqueOrThrow({ where: { id: incident.id } })).urgency).toBe(
      'MEDIUM'
    );
  });
});

describe('snooze_incident', () => {
  it('snoozes for a bounded duration through the lifecycle engine', async () => {
    const { responder, incident } = await world();
    expect(
      await propose(responder.id, 'snooze_incident', { incidentId: incident.id, minutes: 2_000 })
    ).toBeNull();
    const proposal = await propose(responder.id, 'snooze_incident', {
      incidentId: incident.id,
      minutes: 120,
      reason: 'waiting for the vendor',
    });
    expect(proposal?.preview?.[0]).toEqual({ label: 'For', value: '2 hours' });
    const before = Date.now();
    const result = await confirm(responder.id, proposal!.token);
    expect(result).toMatchObject({ ok: true });
    const snoozed = await db.incident.findUniqueOrThrow({ where: { id: incident.id } });
    expect(snoozed.status).toBe('SNOOZED');
    expect(snoozed.snoozeReason).toBe('waiting for the vendor');
    expect(snoozed.snoozedUntil!.getTime()).toBeGreaterThanOrEqual(before + 120 * 60_000 - 1_000);
    expect(snoozed.snoozedUntil!.getTime()).toBeLessThanOrEqual(Date.now() + 120 * 60_000 + 1_000);
    expect(await confirm(responder.id, proposal!.token)).toEqual(result);
  });

  it('applies the same responder check as the snooze control', async () => {
    const { responder, incident } = await world();
    const proposal = await propose(responder.id, 'snooze_incident', {
      incidentId: incident.id,
      minutes: 30,
    });
    await demote(responder.id, 'USER');
    expect(await confirm(responder.id, proposal!.token)).toMatchObject({ ok: false });
    expect((await db.incident.findUniqueOrThrow({ where: { id: incident.id } })).status).toBe(
      'OPEN'
    );
  });

  it('refuses an expired proposal', async () => {
    const { responder, incident } = await world();
    await expectExpiredRefused(responder.id, 'snooze_incident', {
      incidentId: incident.id,
      minutes: 30,
    });
  });

  it('refuses when the lifecycle moved on', async () => {
    const { responder, incident } = await world();
    const proposal = await propose(responder.id, 'snooze_incident', {
      incidentId: incident.id,
      minutes: 30,
    });
    await db.incident.update({
      where: { id: incident.id },
      data: { status: 'ACKNOWLEDGED', escalationGeneration: { increment: 1 } },
    });
    await expectChanged(responder.id, proposal!.token);
  });
});

describe('unlink_related_incident', () => {
  async function linked() {
    const w = await world();
    const [source, target] = [w.incident.id, w.other.id].sort();
    const link = await db.incidentRelationship.create({
      data: {
        sourceIncidentId: source,
        targetIncidentId: target,
        type: 'RELATED',
        origin: 'HUMAN',
        decision: 'ACCEPTED',
        score: 1,
        evidence: { type: 'manual' },
        engineVersion: 'test',
      },
    });
    return { ...w, link };
  }

  it('reverts an accepted link through the correlation command', async () => {
    const { responder, incident, other, link } = await linked();
    const proposal = await propose(responder.id, 'unlink_related_incident', {
      incidentId: incident.id,
      otherIncidentId: other.id,
    });
    expect(proposal?.title).toBe('Remove related link');
    const result = await confirm(responder.id, proposal!.token);
    expect(result).toMatchObject({ ok: true, message: 'Related link removed.' });
    expect(
      (await db.incidentRelationship.findUniqueOrThrow({ where: { id: link.id } })).decision
    ).toBe('REVERTED');
    expect(await confirm(responder.id, proposal!.token)).toEqual(result);
    expect(await db.incidentRelationshipEvent.count({ where: { relationshipId: link.id } })).toBe(
      1
    );
    // Nothing left to remove.
    expect(
      await propose(responder.id, 'unlink_related_incident', {
        incidentId: incident.id,
        otherIncidentId: other.id,
      })
    ).toBeNull();
  });

  it('refuses someone without permission to change links', async () => {
    const { responder, incident, other, link } = await linked();
    const proposal = await propose(responder.id, 'unlink_related_incident', {
      incidentId: incident.id,
      otherIncidentId: other.id,
    });
    await demote(responder.id, 'AUDITOR');
    expect(await confirm(responder.id, proposal!.token)).toMatchObject({ ok: false });
    expect(
      (await db.incidentRelationship.findUniqueOrThrow({ where: { id: link.id } })).decision
    ).toBe('ACCEPTED');
  });

  it('refuses an expired proposal', async () => {
    const { responder, incident, other } = await linked();
    await expectExpiredRefused(responder.id, 'unlink_related_incident', {
      incidentId: incident.id,
      otherIncidentId: other.id,
    });
  });

  it('refuses when the link changed after the card was shown', async () => {
    const { responder, incident, other, link } = await linked();
    const proposal = await propose(responder.id, 'unlink_related_incident', {
      incidentId: incident.id,
      otherIncidentId: other.id,
    });
    await db.incidentRelationship.update({
      where: { id: link.id },
      data: { decision: 'REJECTED' },
    });
    await expectChanged(responder.id, proposal!.token);
  });
});

describe('add_responder', () => {
  it('adds a watcher through the incident watcher command', async () => {
    const { responder, colleague, incident } = await world();
    const proposal = await propose(responder.id, 'add_responder', {
      incidentId: incident.id,
      userId: colleague.id,
      role: 'STAKEHOLDER',
    });
    expect(proposal?.preview).toEqual([
      { label: 'Person', value: 'Cole Colleague' },
      { label: 'Role', value: 'STAKEHOLDER' },
    ]);
    const result = await confirm(responder.id, proposal!.token);
    expect(result).toMatchObject({ ok: true });
    expect(
      await db.incidentWatcher.findUniqueOrThrow({
        where: { incidentId_userId: { incidentId: incident.id, userId: colleague.id } },
      })
    ).toMatchObject({ role: 'STAKEHOLDER' });
    expect(await confirm(responder.id, proposal!.token)).toEqual(result);
  });

  it('lets a scoped user follow themselves only, like the incident page', async () => {
    const { member, colleague, responder, incident } = await world();
    expect(
      await propose(member.id, 'add_responder', {
        incidentId: incident.id,
        userId: colleague.id,
        role: 'FOLLOWER',
      })
    ).toBeNull();
    const self = await propose(member.id, 'add_responder', {
      incidentId: incident.id,
      userId: member.id,
    });
    expect(await confirm(member.id, self!.token)).toMatchObject({ ok: true });
    // A responder demoted before confirming may no longer add someone else.
    const other = await propose(responder.id, 'add_responder', {
      incidentId: incident.id,
      userId: colleague.id,
      role: 'EXEC',
    });
    await demote(responder.id, 'USER');
    expect(await confirm(responder.id, other!.token)).toMatchObject({
      ok: false,
      message: 'You may only subscribe yourself as a follower.',
    });
  });

  it('refuses an expired proposal', async () => {
    const { responder, colleague, incident } = await world();
    await expectExpiredRefused(responder.id, 'add_responder', {
      incidentId: incident.id,
      userId: colleague.id,
    });
  });

  it('refuses when the person was added with another role meanwhile', async () => {
    const { responder, colleague, incident } = await world();
    const proposal = await propose(responder.id, 'add_responder', {
      incidentId: incident.id,
      userId: colleague.id,
      role: 'EXEC',
    });
    await db.incidentWatcher.create({
      data: { incidentId: incident.id, userId: colleague.id, role: 'FOLLOWER' },
    });
    await expectChanged(responder.id, proposal!.token);
  });
});

describe('create_jira_issue', () => {
  async function withJira() {
    const w = await world();
    await db.jiraConfig.create({
      data: {
        baseUrl: 'https://jira.example.test',
        userEmail: 'bot@example.test',
        apiTokenEncrypted: 'sealed',
        enabled: true,
        updatedBy: w.admin.id,
      },
    });
    await db.jiraServiceMapping.create({
      data: {
        serviceId: w.service.id,
        projectKey: 'PAY',
        incidentIssueType: 'Incident',
        actionItemIssueType: 'Task',
      },
    });
    return w;
  }

  it('is not offered when Jira is not configured', async () => {
    const { responder, incident } = await world();
    expect(
      await propose(responder.id, 'create_jira_issue', { incidentId: incident.id })
    ).toBeNull();
  });

  it('creates and links one issue through the Jira integration', async () => {
    const { responder, incident } = await withJira();
    const proposal = await propose(responder.id, 'create_jira_issue', { incidentId: incident.id });
    expect(proposal).toMatchObject({ impact: 'EXTERNAL_SYSTEM', confirmLabel: 'Create issue' });
    expect(proposal?.preview).toContainEqual({ label: 'Project', value: 'PAY' });
    const result = await confirm(responder.id, proposal!.token);
    expect(result).toMatchObject({ ok: true, message: 'Jira issue PAY-1 created and linked.' });
    expect(await confirm(responder.id, proposal!.token)).toEqual(result);
    expect(jira.calls).toBe(1);
    expect(await db.externalIssueLink.count({ where: { incidentId: incident.id } })).toBe(1);
    // Already linked: not offered again.
    expect(
      await propose(responder.id, 'create_jira_issue', { incidentId: incident.id })
    ).toBeNull();
  });

  it('applies the same responder check as the Jira button', async () => {
    const { responder, incident } = await withJira();
    const proposal = await propose(responder.id, 'create_jira_issue', { incidentId: incident.id });
    await demote(responder.id, 'USER');
    expect(await confirm(responder.id, proposal!.token)).toMatchObject({ ok: false });
    expect(jira.calls).toBe(0);
  });

  it('refuses an expired proposal', async () => {
    const { responder, incident } = await withJira();
    await expectExpiredRefused(responder.id, 'create_jira_issue', { incidentId: incident.id });
  });

  it('refuses when an issue was linked meanwhile', async () => {
    const { responder, incident } = await withJira();
    const proposal = await propose(responder.id, 'create_jira_issue', { incidentId: incident.id });
    await db.externalIssueLink.create({
      data: {
        incidentId: incident.id,
        externalId: 'manual-1',
        externalKey: 'PAY-99',
        externalUrl: 'https://jira.example.test/browse/PAY-99',
      },
    });
    await expectChanged(responder.id, proposal!.token);
    expect(jira.calls).toBe(0);
  });
});

describe('draft_status_update and publish_status_update', () => {
  const draftInput = (incidentId: string, statusPageId?: string) => ({
    incidentId,
    ...(statusPageId ? { statusPageId } : {}),
    title: 'Checkout degraded',
    message: 'Some card payments are failing. We are investigating.',
    type: 'INCIDENT',
  });

  it('creates an unpublished draft, then publishes only on a second, separate confirmation', async () => {
    const { admin, incident } = await world();
    const page = await createTestStatusPage({ name: 'Public status', isDefault: true });
    const draft = await propose(admin.id, 'draft_status_update', draftInput(incident.id));
    expect(draft).toMatchObject({ step: 'Step 1 of 2', confirmLabel: 'Create draft' });
    expect(draft?.detail).toContain('“Public status”');
    const created = await confirm(admin.id, draft!.token);
    expect(created).toMatchObject({ ok: true });
    const announcement = await db.statusPageAnnouncement.findFirstOrThrow({
      where: { statusPageId: page.id },
    });
    expect(announcement).toMatchObject({ isActive: false, notificationTiming: 'NONE' });
    expect(
      await db.backgroundJob.count({
        where: { payload: { path: ['announcementId'], equals: announcement.id } },
      })
    ).toBe(0);

    // The publish step is a sealed follow-up card, never published by the first confirmation.
    if (!created.ok || !created.followUp) throw new Error('follow-up expected');
    expect(created.followUp).toMatchObject({
      action: 'publish_status_update',
      step: 'Step 2 of 2',
      confirmLabel: 'Publish',
      impact: 'PUBLIC',
    });
    // Replaying the draft confirmation returns the same receipt and creates nothing new.
    expect(await confirm(admin.id, draft!.token)).toMatchObject({ ok: true });
    expect(await db.statusPageAnnouncement.count()).toBe(1);
    // The recovered outcome carries the follow-up too, so a reloaded card can still offer it.
    const outcome = await readSquireActionOutcome(await actorOf(admin.id), draft!.receiptId!);
    expect(outcome?.result).toMatchObject({ followUp: { action: 'publish_status_update' } });

    const published = await confirm(admin.id, created.followUp.token);
    expect(published).toMatchObject({ ok: true, message: 'Status update published.' });
    expect(
      (await db.statusPageAnnouncement.findUniqueOrThrow({ where: { id: announcement.id } }))
        .isActive
    ).toBe(true);
    expect(await confirm(admin.id, created.followUp.token)).toEqual(published);
  });

  it('never lets the model propose publishing directly', async () => {
    const { admin, incident } = await world();
    const page = await createTestStatusPage({ isDefault: true });
    const announcement = await db.statusPageAnnouncement.create({
      data: {
        statusPageId: page.id,
        title: 'Hidden',
        message: 'Not yet',
        startDate: new Date(),
        isActive: false,
      },
    });
    expect(
      await propose(admin.id, 'publish_status_update', {
        incidentId: incident.id,
        statusPageId: page.id,
        announcementId: announcement.id,
      })
    ).toBeNull();
  });

  it('requires status page administration, as the status page settings do', async () => {
    const { admin, responder, incident } = await world();
    await createTestStatusPage({ isDefault: true });
    expect(await propose(responder.id, 'draft_status_update', draftInput(incident.id))).toBeNull();
    const draft = await propose(admin.id, 'draft_status_update', draftInput(incident.id));
    await demote(admin.id, 'RESPONDER');
    expect(await confirm(admin.id, draft!.token)).toMatchObject({ ok: false });
    expect(await db.statusPageAnnouncement.count()).toBe(0);
  });

  it('refuses an expired proposal', async () => {
    const { admin, incident } = await world();
    await createTestStatusPage({ isDefault: true });
    await expectExpiredRefused(admin.id, 'draft_status_update', draftInput(incident.id));
  });

  it('refuses publishing a draft that was edited after the card was shown', async () => {
    const { admin, incident } = await world();
    const page = await createTestStatusPage({ isDefault: true });
    const created = await confirm(
      admin.id,
      (await propose(admin.id, 'draft_status_update', draftInput(incident.id, page.id)))!.token
    );
    if (!created.ok || !created.followUp) throw new Error('follow-up expected');
    const announcement = await db.statusPageAnnouncement.findFirstOrThrow();
    await new Promise(resolve => setTimeout(resolve, 5));
    await db.statusPageAnnouncement.update({
      where: { id: announcement.id },
      data: { message: 'Edited by a person' },
    });
    const result = await confirm(admin.id, created.followUp.token);
    expect(result).toMatchObject({ ok: false });
    expect(result.message).toMatch(/changed after this suggestion was prepared/);
    expect(
      (await db.statusPageAnnouncement.findUniqueOrThrow({ where: { id: announcement.id } }))
        .isActive
    ).toBe(false);
  });
});

describe('run_runbook', () => {
  async function withRunbook() {
    const w = await world();
    const definition = parseRunbookDefinition({
      steps: [
        {
          key: 'wait',
          name: 'Wait',
          type: 'WAIT',
          riskClass: 'READ_ONLY',
          config: { durationSeconds: 0 },
        },
      ],
    });
    const runbook = await db.runbook.create({
      data: { name: 'Restart checkout', slug: `restart-${crypto.randomUUID()}` },
    });
    const version = await db.runbookVersion.create({
      data: {
        runbookId: runbook.id,
        version: 1,
        state: 'DRAFT',
        definition: definition as unknown as Prisma.InputJsonValue,
        checksum: computeDefinitionChecksum(definition),
      },
    });
    await db.runbookVersion.update({
      where: { id: version.id },
      data: { state: 'PUBLISHED', publishedAt: new Date() },
    });
    await db.runbook.update({
      where: { id: runbook.id },
      data: { publishedVersionId: version.id },
    });
    const binding = await db.serviceAutomationRule.create({
      data: { runbookId: runbook.id, serviceId: w.service.id, versionStrategy: 'LATEST_PUBLISHED' },
    });
    return { ...w, runbook, version, binding };
  }

  it('starts one execution through the runbook engine from the binding on the incident service', async () => {
    const { responder, incident, runbook } = await withRunbook();
    const proposal = await propose(responder.id, 'run_runbook', {
      incidentId: incident.id,
      runbookId: runbook.id,
    });
    expect(proposal).toMatchObject({ impact: 'AUTOMATION', confirmLabel: 'Run runbook' });
    expect(proposal?.preview).toContainEqual({ label: 'Steps', value: '1' });
    const result = await confirm(responder.id, proposal!.token);
    expect(result).toMatchObject({ ok: true });
    expect(await confirm(responder.id, proposal!.token)).toEqual(result);
    const executions = await db.runbookExecution.findMany({ where: { incidentId: incident.id } });
    expect(executions).toHaveLength(1);
    expect(executions[0].triggeredByUserId).toBe(responder.id);
  });

  it('is not offered for a runbook that is not bound to the service, nor to someone who may not run runbooks', async () => {
    const { responder, member, incident, runbook } = await withRunbook();
    const unbound = await db.runbook.create({
      data: { name: 'Unbound', slug: `u-${crypto.randomUUID()}` },
    });
    expect(
      await propose(responder.id, 'run_runbook', { incidentId: incident.id, runbookId: unbound.id })
    ).toBeNull();
    expect(
      await propose(member.id, 'run_runbook', { incidentId: incident.id, runbookId: runbook.id })
    ).toBeNull();
    const proposal = await propose(responder.id, 'run_runbook', {
      incidentId: incident.id,
      runbookId: runbook.id,
    });
    await demote(responder.id, 'USER');
    expect(await confirm(responder.id, proposal!.token)).toMatchObject({ ok: false });
    expect(await db.runbookExecution.count()).toBe(0);
  });

  it('refuses an expired proposal', async () => {
    const { responder, incident, runbook } = await withRunbook();
    await expectExpiredRefused(responder.id, 'run_runbook', {
      incidentId: incident.id,
      runbookId: runbook.id,
    });
  });

  it('refuses when the binding was reconfigured after the card was shown', async () => {
    const { responder, incident, runbook, binding } = await withRunbook();
    const proposal = await propose(responder.id, 'run_runbook', {
      incidentId: incident.id,
      runbookId: runbook.id,
    });
    await db.serviceAutomationRule.update({
      where: { id: binding.id },
      data: { configurationRevision: { increment: 1 } },
    });
    await expectChanged(responder.id, proposal!.token);
    expect(await db.runbookExecution.count()).toBe(0);
  });
});

describe('basic mode', () => {
  async function ask(userId: string, message: string, incidentId: string) {
    const events: SquireEvent[] = [];
    for await (const event of streamSquire(await actorOf(userId), {
      message,
      history: [],
      incidentId,
    }))
      events.push(event);
    return {
      text: events
        .filter((e): e is Extract<SquireEvent, { type: 'delta' }> => e.type === 'delta')
        .map(e => e.text)
        .join(''),
      proposals: events.flatMap(e => (e.type === 'proposal' ? [e.proposal] : [])),
    };
  }

  it('offers escalate, urgency and snooze cards for an explicit request on the incident', async () => {
    const { responder, incident } = await world();
    expect((await ask(responder.id, 'escalate this', incident.id)).proposals).toEqual([
      expect.objectContaining({ action: 'escalate_incident' }),
    ]);
    expect((await ask(responder.id, 'set urgency to low', incident.id)).proposals).toEqual([
      expect.objectContaining({ action: 'change_urgency', title: 'Change urgency' }),
    ]);
    const snooze = await ask(responder.id, 'snooze this for 2 hours', incident.id);
    expect(snooze.proposals).toEqual([expect.objectContaining({ action: 'snooze_incident' })]);
    expect(snooze.proposals[0].preview?.[0]).toEqual({ label: 'For', value: '2 hours' });
    expect((await db.incident.findUniqueOrThrow({ where: { id: incident.id } })).status).toBe(
      'OPEN'
    );
  });

  it('keeps the plain guidance when extended actions are off', async () => {
    const { responder, incident } = await world({ extended: false });
    const reply = await ask(responder.id, 'snooze this for 2 hours', incident.id);
    expect(reply.proposals).toEqual([]);
    expect(reply.text).toContain('Snoozing is done from the incident page');
  });
});
