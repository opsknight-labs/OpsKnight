import { beforeEach, describe, expect, it } from 'vitest';
import { listViews } from '@/lib/intelligence/dependencies/insights/views';
import { createTestUser, resetDatabase, testPrisma as db } from '../helpers/test-db';

beforeEach(async () => {
  if (!new URL(process.env.DATABASE_URL ?? '').pathname.endsWith('_test'))
    throw new Error('Dedicated test DB required');
  await resetDatabase();
});

describe('saved graph view listing (P12)', () => {
  it('keeps the caller own views when many ORG views sort ahead of them', async () => {
    const admin = await createTestUser({ role: 'ADMIN' });
    const user = await createTestUser({ role: 'USER' });
    await db.savedGraphView.createMany({
      data: Array.from({ length: 205 }, (_, index) => ({
        name: `a-org-${String(index).padStart(3, '0')}`,
        ownerId: admin.id,
        visibility: 'ORG' as const,
        config: {},
      })),
    });
    await db.savedGraphView.create({
      data: { name: 'zz-mine', ownerId: user.id, visibility: 'PRIVATE', config: {} },
    });
    const views = await listViews({ id: user.id, role: 'USER', status: 'ACTIVE', teamIds: [] });
    expect(views.map(view => view.name)).toContain('zz-mine');
  });
});
