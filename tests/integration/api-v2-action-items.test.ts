import { beforeEach, describe, expect, it } from 'vitest';
import { GET as listActionItems } from '@/app/api/v2/action-items/route';
import { createV2Credential, invokeV2 } from '../helpers/api-v2';
import {
  createTestIncident,
  createTestService,
  createTestTeam,
  resetDatabase,
  testPrisma as db,
} from '../helpers/test-db';

const scopes = ['postmortems:read', 'incidents:read'];
const DAY = 86_400_000;

beforeEach(async () => {
  if (!new URL(process.env.DATABASE_URL ?? '').pathname.endsWith('_test'))
    throw new Error('Dedicated test database required');
  await resetDatabase();
});

async function postmortem(title: string, teamId: string) {
  const service = await createTestService(title, teamId);
  const incident = await createTestIncident(title, service.id, { status: 'RESOLVED' });
  return db.postmortem.create({ data: { incidentId: incident.id, title, summary: title } });
}

let sequence = 0;
function item(
  parent: { id: string; incidentId: string },
  title: string,
  data: { ownerId?: string; status?: 'OPEN' | 'COMPLETED' | 'BLOCKED'; dueDate?: Date } = {}
) {
  return db.actionItem.create({
    data: {
      postmortemId: parent.id,
      incidentId: parent.incidentId,
      title,
      // Distinct, increasing timestamps keep the newest-first order deterministic.
      createdAt: new Date(Date.now() - 3_600_000 + ++sequence * 1000),
      ...data,
    },
  });
}

async function list(token: string, query = '') {
  const response = await invokeV2(listActionItems, token, 'GET', `/action-items${query}`, {});
  const body = await response.json();
  return {
    response,
    body,
    titles: ((body.data ?? []) as { title: string }[]).map(row => row.title),
  };
}

/** A team member with two readable postmortems' items and one team-restricted postmortem. */
async function fixture() {
  const member = await createV2Credential(scopes, 'USER');
  const admin = await createV2Credential(scopes);
  const mine = await createTestTeam('Mine');
  const theirs = await createTestTeam('Theirs');
  await db.teamMember.create({ data: { teamId: mine.id, userId: member.user.id } });
  const first = await postmortem('First', mine.id);
  const second = await postmortem('Second', mine.id);
  const restricted = await postmortem('Restricted', theirs.id);
  await item(first, 'overdue open', {
    ownerId: member.user.id,
    dueDate: new Date(Date.now() - DAY),
  });
  await item(first, 'overdue done', {
    status: 'COMPLETED',
    dueDate: new Date(Date.now() - DAY),
  });
  await item(second, 'future blocked', {
    ownerId: admin.user.id,
    status: 'BLOCKED',
    dueDate: new Date(Date.now() + DAY),
  });
  await item(second, 'undated');
  await item(restricted, 'hidden', {
    ownerId: member.user.id,
    dueDate: new Date(Date.now() - DAY),
  });
  return { member, admin, first, second, restricted };
}

describe('listActionItems', () => {
  it('lists only items of postmortems the caller may read, newest first', async () => {
    const { member, admin, first, restricted } = await fixture();
    const visible = await list(member.token);
    expect(visible.response.status).toBe(200);
    expect(visible.response.headers.get('cache-control')).toBe('private, no-store');
    expect(visible.titles).toEqual(['undated', 'future blocked', 'overdue done', 'overdue open']);
    expect((await list(admin.token)).titles).toHaveLength(5);

    // Naming the restricted parent or its incident never widens the access rule.
    expect((await list(member.token, `?postmortemId=${restricted.id}`)).titles).toEqual([]);
    expect((await list(member.token, `?incidentId=${restricted.incidentId}`)).titles).toEqual([]);
    expect((await list(member.token, `?postmortemId=${first.id}`)).titles).toEqual([
      'overdue done',
      'overdue open',
    ]);
    expect((await list(member.token, `?incidentId=${first.incidentId}`)).titles).toHaveLength(2);
  });

  it('returns the documented projection without the owner email', async () => {
    const { member, first } = await fixture();
    const { body } = await list(member.token, '?ownerId=me');
    expect(body.data).toHaveLength(1);
    const [row] = body.data;
    expect(Object.keys(row).sort()).toEqual(
      [
        'completedAt',
        'createdAt',
        'description',
        'dueDate',
        'id',
        'incident',
        'incidentId',
        'owner',
        'ownerId',
        'postmortemId',
        'priority',
        'source',
        'status',
        'title',
        'updatedAt',
      ].sort()
    );
    expect(row).toMatchObject({
      postmortemId: first.id,
      incidentId: first.incidentId,
      title: 'overdue open',
      ownerId: member.user.id,
      owner: { id: member.user.id, name: member.user.name },
      incident: { id: first.incidentId, title: 'First' },
      status: 'OPEN',
      priority: 'MEDIUM',
      source: 'POSTMORTEM',
      completedAt: null,
    });
    expect(JSON.stringify(body)).not.toContain(member.user.email);
  });

  it('filters by owner, status, priority and overdue', async () => {
    const { member, admin } = await fixture();
    expect((await list(member.token, '?ownerId=me')).titles).toEqual(['overdue open']);
    expect((await list(member.token, `?ownerId=${admin.user.id}`)).titles).toEqual([
      'future blocked',
    ]);
    // `me` is the caller, whoever that is.
    expect((await list(admin.token, '?ownerId=me')).titles).toEqual(['future blocked']);
    expect((await list(member.token, '?status=COMPLETED')).titles).toEqual(['overdue done']);
    expect((await list(member.token, '?priority=HIGH')).titles).toEqual([]);
    expect((await list(member.token, '?priority=MEDIUM')).titles).toHaveLength(4);
    expect((await list(member.token, '?overdue=true')).titles).toEqual(['overdue open']);
    expect((await list(member.token, '?overdue=false')).titles).toEqual([
      'undated',
      'future blocked',
      'overdue done',
    ]);
    expect((await list(member.token, '?overdue=true&status=COMPLETED')).titles).toEqual([]);
  });

  it('pages with a cursor without repeating or dropping items', async () => {
    const { member } = await fixture();
    const first = await list(member.token, '?limit=3');
    expect(first.titles).toEqual(['undated', 'future blocked', 'overdue done']);
    expect(first.body.pagination.hasMore).toBe(true);
    const next = await list(
      member.token,
      `?limit=3&cursor=${encodeURIComponent(first.body.pagination.nextCursor)}`
    );
    expect(next.titles).toEqual(['overdue open']);
    expect(next.body.pagination.hasMore).toBe(false);
  });

  it('refuses unknown filters, bad enum values and tokens without postmortems:read', async () => {
    const { member } = await fixture();
    for (const query of ['?status=DONE', '?overdue=yes', '?priority=URGENT', '?assigneeId=me'])
      expect((await list(member.token, query)).response.status, query).toBe(400);
    const unscoped = await createV2Credential(['incidents:read']);
    expect((await list(unscoped.token)).response.status).toBe(403);
  });
});
