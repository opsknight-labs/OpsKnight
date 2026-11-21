import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppRole } from '@/lib/authorization';
import {
  createTestTeam,
  createTestUser,
  resetDatabase,
  testPrisma as db,
} from '../../helpers/test-db';

// Only the session is replaced; the actions, the connector service and the database are real.
const session = vi.hoisted(() => ({ user: null as { id: string; role: string } | null }));
vi.mock('@/lib/rbac', async () => {
  const authorization = await import('@/lib/authorization');
  return {
    assertCapability: async (capability: string) => {
      const user = session.user;
      if (!user || !authorization.hasCapability(user.role as AppRole, capability as never)) {
        throw new authorization.AuthorizationError('Unauthorized.', capability as never);
      }
      return user;
    },
  };
});
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

import {
  deleteConnectionAction,
  saveConnectionAction,
  testConnectionAction,
} from '@/app/(app)/settings/intelligence/connections/actions';

const initial = { message: '', ok: false };

function form(values: Record<string, string | boolean | string[]>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(values)) {
    if (Array.isArray(value)) value.forEach(item => data.append(key, item));
    else if (value === true) data.set(key, 'on');
    else if (value !== false) data.set(key, value);
  }
  return data;
}

async function signIn(role: AppRole) {
  const user = await createTestUser({ role });
  session.user = { id: user.id, role };
  return user;
}

beforeEach(async () => {
  if (!new URL(process.env.DATABASE_URL ?? '').pathname.endsWith('_test'))
    throw new Error('Dedicated test DB required');
  await resetDatabase();
  session.user = null;
});

describe('connection settings actions', () => {
  it('lets an administrator add, test and remove a connection', async () => {
    await signIn('ADMIN');
    const team = await createTestTeam('Payments');
    // A consented private address keeps this test off the public network; nothing listens on port 1.
    const saved = await saveConnectionAction(
      initial,
      form({
        name: 'Loki',
        kind: 'LOKI',
        baseUrl: 'http://127.0.0.1:1',
        secret: 'loki-token-value',
        allowedTeamIds: [team.id],
        allowPrivateNetwork: true,
        enabled: true,
        timeoutMs: '5000',
      })
    );
    expect(saved).toEqual({ ok: true, message: 'Connection added.' });
    const row = await db.observabilityConnection.findFirstOrThrow();
    expect(row).toMatchObject({
      baseUrl: 'http://127.0.0.1:1',
      allowedTeamIds: [team.id],
      enabled: true,
      allowPrivateNetwork: true,
      timeoutMs: 5000,
    });

    const tested = await testConnectionAction(initial, form({ id: row.id }));
    expect(tested).toEqual({
      ok: false,
      message: 'Could not reach the endpoint. Check the address and network access.',
    });

    const removed = await deleteConnectionAction(initial, form({ id: row.id }));
    expect(removed).toEqual({ ok: true, message: 'Connection removed.' });
    expect(await db.observabilityConnection.count()).toBe(0);
  });

  it('reports validation failures with the field', async () => {
    await signIn('ADMIN');
    const result = await saveConnectionAction(
      initial,
      form({ name: 'Logs', kind: 'LOKI', baseUrl: 'https://10.0.0.8', enabled: true })
    );
    expect(result.ok).toBe(false);
    expect(result.message).toContain('baseUrl');
    expect(await db.observabilityConnection.count()).toBe(0);
  });

  it('refuses people without the intelligence management permission', async () => {
    await signIn('USER');
    for (const outcome of [
      await saveConnectionAction(
        initial,
        form({ name: 'X', kind: 'GITHUB', baseUrl: '', enabled: true })
      ),
      await deleteConnectionAction(initial, form({ id: 'x' })),
      await testConnectionAction(initial, form({ id: 'x' })),
    ])
      expect(outcome.ok).toBe(false);
    expect(await db.observabilityConnection.count()).toBe(0);
    expect(
      await db.auditLog.count({ where: { action: { startsWith: 'intelligence.connector' } } })
    ).toBe(0);
  });
});
