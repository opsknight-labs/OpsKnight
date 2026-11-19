import { beforeEach, expect, it, vi } from 'vitest';
import {
  createTestIncident,
  createTestService,
  createTestUser,
  resetDatabase,
  testPrisma as db,
} from '../helpers/test-db';

const session = vi.hoisted(() => ({ user: null as null | { id: string; role: string } }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@/lib/rbac', () => ({
  assertResponderOrAbove: vi.fn(async () => session.user),
  getCurrentUser: vi.fn(async () => session.user),
  getCurrentAuthorizationActor: vi.fn(),
  getUserPermissions: vi.fn(),
}));
import { upsertPostmortem, type PostmortemData } from '@/app/(app)/postmortems/actions';

beforeEach(async () => {
  if (!new URL(process.env.DATABASE_URL ?? '').pathname.endsWith('_test'))
    throw new Error('Dedicated test DB required');
  await resetDatabase();
});

async function setup() {
  const author = await createTestUser({ role: 'RESPONDER' });
  session.user = { id: author.id, role: 'RESPONDER' };
  const service = await createTestService('Editor service');
  const incident = await createTestIncident('Editor incident', service.id, { status: 'RESOLVED' });
  return { author, incident };
}

it('stores only editable fields and rejects unknown status values', async () => {
  const { author, incident } = await setup();
  const other = await createTestUser({ role: 'RESPONDER' });
  await upsertPostmortem(incident.id, {
    title: 'Injected',
    status: 'DRAFT',
    createdById: other.id,
    incidentId: 'someone-elses-incident',
  } as unknown as PostmortemData);
  const stored = await db.postmortem.findUniqueOrThrow({ where: { incidentId: incident.id } });
  expect(stored.createdById).toBe(author.id);

  await expect(
    upsertPostmortem(incident.id, {
      title: 'Bad status',
      status: 'HACKED',
      expectedRevision: stored.revision,
    } as unknown as PostmortemData)
  ).rejects.toThrow(/Invalid postmortem/);
});

it('refuses to overwrite action items changed after the editor loaded', async () => {
  const { incident } = await setup();
  const item = { id: 'a1', title: 'Fix disk alert', description: '', status: 'OPEN', priority: 'HIGH' } as const;
  await upsertPostmortem(incident.id, { title: 'PM', actionItems: [item] });
  const loaded = await db.postmortem.findUniqueOrThrow({ where: { incidentId: incident.id } });
  const [row] = await db.actionItem.findMany({ where: { postmortemId: loaded.id } });

  // Someone completes the item on the board, which advances the postmortem revision.
  await db.actionItem.update({ where: { id: row.id }, data: { status: 'COMPLETED' } });
  await db.postmortem.update({ where: { id: loaded.id }, data: { updatedAt: new Date() } });

  await expect(
    upsertPostmortem(incident.id, {
      title: 'PM typo fix',
      actionItems: [{ ...item, id: row.id }],
      expectedRevision: loaded.revision,
    })
  ).rejects.toThrow(/changed by someone else/);
  expect((await db.actionItem.findUniqueOrThrow({ where: { id: row.id } })).status).toBe(
    'COMPLETED'
  );

  // A create attempt over an existing postmortem is also refused.
  await expect(upsertPostmortem(incident.id, { title: 'Second create' })).rejects.toThrow(
    /already exists/
  );
});
