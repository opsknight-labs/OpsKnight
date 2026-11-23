import { randomUUID } from 'node:crypto';
import { beforeEach, describe, expect, it } from 'vitest';
import { resolveUserActor } from '@/lib/authorization-actors';
import { encrypt } from '@/lib/encryption';
import { listSquireActionHistory } from '@/lib/intelligence/squire/actions/history';
import {
  createTestIncident,
  createTestService,
  createTestTeam,
  createTestUser,
  resetDatabase,
  testPrisma as db,
} from '../../helpers/test-db';

async function receipt(input: {
  userId: string;
  action: string;
  incidentId?: string;
  status?: string;
  result?: unknown;
  intent?: unknown;
  createdAt?: Date;
}) {
  return db.squireActionReceipt.create({
    data: {
      id: randomUUID(),
      userId: input.userId,
      action: input.action,
      incidentId: input.incidentId ?? null,
      status: input.status ?? 'SUCCEEDED',
      resultEncrypted: input.result ? await encrypt(JSON.stringify(input.result)) : null,
      intentEncrypted: input.intent ? await encrypt(JSON.stringify(input.intent)) : null,
      createdAt: input.createdAt ?? new Date(),
      startedAt: input.createdAt ?? new Date(),
    },
  });
}

async function world() {
  const admin = await createTestUser({ role: 'ADMIN', name: 'Ada Admin' });
  const member = await createTestUser({ role: 'USER', name: 'Uma User' });
  const ours = await createTestTeam('Ours');
  const theirs = await createTestTeam('Theirs');
  await db.teamMember.create({ data: { teamId: ours.id, userId: member.id } });
  const visible = await createTestIncident(
    'Checkout errors',
    (await createTestService('Checkout', ours.id)).id,
    { teamId: ours.id }
  );
  const hidden = await createTestIncident(
    'Secret outage',
    (await createTestService('Vault', theirs.id)).id,
    { teamId: theirs.id }
  );
  return {
    admin,
    member,
    visible,
    hidden,
    adminActor: (await resolveUserActor(admin.id))!,
    memberActor: (await resolveUserActor(member.id))!,
  };
}

beforeEach(async () => {
  if (!new URL(process.env.DATABASE_URL ?? '').pathname.endsWith('_test'))
    throw new Error('Dedicated test DB required');
  await resetDatabase();
});

describe('Squire action history', () => {
  it('shows a person their own actions, hides incidents they cannot read, and never the intent', async () => {
    const w = await world();
    await receipt({
      userId: w.member.id,
      action: 'acknowledge_incident',
      incidentId: w.visible.id,
      result: { ok: true, message: 'Acknowledged Checkout errors.', href: '/incidents/x' },
      intent: { note: 'top-secret-intent' },
      createdAt: new Date(Date.now() - 3_000),
    });
    await receipt({
      userId: w.member.id,
      action: 'resolve_incident',
      incidentId: w.hidden.id,
      result: { ok: true, message: 'Resolved Secret outage.', href: '/incidents/y' },
      createdAt: new Date(Date.now() - 2_000),
    });
    await receipt({
      userId: w.member.id,
      action: 'operation:updateService',
      status: 'FAILED',
      createdAt: new Date(Date.now() - 1_000),
    });
    await receipt({ userId: w.admin.id, action: 'add_incident_note', incidentId: w.visible.id });

    const page = (await listSquireActionHistory(w.memberActor, { scope: 'everyone' }))!;
    expect(page.scope).toBe('mine'); // not a manager: "everyone" is ignored
    expect(page.canSeeEveryone).toBe(false);
    expect(page.rows.map(row => row.action)).toEqual([
      expect.not.stringMatching(/^operation:/),
      'Acknowledge incident',
    ]);
    const [operation, ack] = page.rows;
    expect(operation.status).toBe('FAILED');
    expect(operation).not.toHaveProperty('href');
    expect(operation.action).not.toBe('updateService'); // the catalog summary, not the raw id
    expect(operation.message).toMatch(/did not complete/);
    expect(ack).toMatchObject({
      status: 'SUCCEEDED',
      message: 'Acknowledged Checkout errors.',
      href: `/incidents/${w.visible.id}`,
    });
    expect(ack.who).toBeUndefined();
    expect(JSON.stringify(page)).not.toMatch(/Secret outage|top-secret-intent/);
  });

  it('lists multi-step plan receipts (no incident) with a readable label and their outcome', async () => {
    const w = await world();
    await receipt({
      userId: w.member.id,
      action: 'plan:3 steps',
      result: { ok: true, message: 'Done: 3 of 3 steps.' },
    });
    // A receipt in no shape Squire writes stays out.
    await receipt({ userId: w.member.id, action: 'planned_thing' });
    const page = (await listSquireActionHistory(w.memberActor))!;
    expect(page.rows).toEqual([
      expect.objectContaining({
        action: 'Plan of 3 steps',
        status: 'SUCCEEDED',
        message: 'Done: 3 of 3 steps.',
      }),
    ]);
    expect(page.rows[0]).not.toHaveProperty('href');
  });

  it('lets an intelligence manager see everyone, with names, and filter by status', async () => {
    const w = await world();
    await receipt({ userId: w.member.id, action: 'acknowledge_incident', incidentId: w.hidden.id });
    await receipt({
      userId: w.admin.id,
      action: 'operation:unknownOperationId',
      status: 'RUNNING',
      createdAt: new Date(Date.now() - 600_000),
    });

    const mine = (await listSquireActionHistory(w.adminActor))!;
    expect(mine.scope).toBe('mine');
    expect(mine.rows).toHaveLength(1);

    const all = (await listSquireActionHistory(w.adminActor, { scope: 'everyone' }))!;
    expect(all.canSeeEveryone).toBe(true);
    expect(all.rows.map(row => [row.who, row.action, row.status])).toEqual([
      ['Uma User', 'Acknowledge incident', 'SUCCEEDED'],
      // A receipt stuck "running" is reported UNKNOWN; an unknown operation shows its id.
      ['Ada Admin', 'unknownOperationId', 'UNKNOWN'],
    ]);

    const unknown = (await listSquireActionHistory(w.adminActor, {
      scope: 'everyone',
      status: 'UNKNOWN',
    }))!;
    expect(unknown.rows.map(row => row.who)).toEqual(['Ada Admin']);
  });

  it('shows the stored outcome text only to the person who confirmed it', async () => {
    const w = await world();
    await receipt({
      userId: w.member.id,
      action: 'operation:updateService',
      result: { ok: true, message: 'Done: Update a service. Now: name = Secret name.', href: '/' },
    });
    const own = (await listSquireActionHistory(w.memberActor))!;
    expect(own.rows[0].message).toContain('Secret name');
    const all = (await listSquireActionHistory(w.adminActor, { scope: 'everyone' }))!;
    expect(all.rows).toHaveLength(1);
    expect(all.rows[0]).toMatchObject({ who: 'Uma User', status: 'SUCCEEDED' });
    expect(all.rows[0].message).toMatch(/^The action completed/);
    expect(JSON.stringify(all)).not.toContain('Secret name');
  });

  it('pages 50 at a time, newest first, without repeats', async () => {
    const w = await world();
    const base = Date.now() - 1_000_000;
    for (let i = 0; i < 53; i++)
      await receipt({
        userId: w.member.id,
        action: 'acknowledge_incident',
        incidentId: w.visible.id,
        createdAt: new Date(base + i * 1_000),
      });

    const first = (await listSquireActionHistory(w.memberActor))!;
    expect(first.rows).toHaveLength(50);
    expect(first.nextCursor).toBeTruthy();
    const second = (await listSquireActionHistory(w.memberActor, { cursor: first.nextCursor! }))!;
    expect(second.rows).toHaveLength(3);
    expect(second.nextCursor).toBeNull();
    const times = [...first.rows, ...second.rows].map(row => row.at);
    expect(new Set(times).size).toBe(53);
    expect([...times].sort().reverse()).toEqual(times);
  });

  it('refuses API keys and roles that cannot use Squire', async () => {
    const w = await world();
    expect(
      await listSquireActionHistory({ ...w.memberActor, apiKey: { id: 'k', scopes: [] } })
    ).toBeNull();
    const stakeholder = await createTestUser({ role: 'STAKEHOLDER' });
    const actor = (await resolveUserActor(stakeholder.id))!;
    // Stakeholders may or may not read suggestions; either way they only ever see their own.
    const page = await listSquireActionHistory(actor, { scope: 'everyone' });
    expect(page?.rows ?? []).toEqual([]);
  });
});
