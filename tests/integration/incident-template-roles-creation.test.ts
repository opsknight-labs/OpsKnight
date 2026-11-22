import { beforeEach, describe, expect, it } from 'vitest';
import {
  createTestService,
  createTestUser,
  resetDatabase,
  testPrisma as db,
} from '../helpers/test-db';
import { executeIdempotentIncidentCreation } from '@/lib/incidents/idempotent-commands';
import type { IncidentRoleKey } from '@/lib/incidents/roles';

beforeEach(async () => {
  if (!new URL(process.env.DATABASE_URL ?? '').pathname.endsWith('_test'))
    throw new Error('Dedicated test database required');
  await resetDatabase();
});

describe('template default roles are part of the idempotent creation transaction', () => {
  async function fixture() {
    const creator = await createTestUser({ name: 'Creator', role: 'RESPONDER' });
    const commander = await createTestUser({ name: 'Ada', role: 'RESPONDER' });
    const service = await createTestService('Payments API');
    const input = (roles: Array<{ roleKey: IncidentRoleKey; userId: string }>) => ({
      title: 'Card payments failing',
      serviceId: service.id,
      urgency: 'HIGH' as const,
      source: 'MOBILE' as const,
      actor: { id: creator.id, name: 'Creator' },
      defaultRoles: roles,
    });
    return { creator, commander, input };
  }

  it('rolls the incident back when a role write fails, and a replay creates it with roles', async () => {
    const { creator, commander, input } = await fixture();
    const context = { key: 'create-with-roles', principalId: creator.id };

    await expect(
      executeIdempotentIncidentCreation(
        input([
          { roleKey: 'COMMANDER', userId: commander.id },
          // A malformed role makes the role command throw inside the transaction.
          { roleKey: 'PILOT' as IncidentRoleKey, userId: commander.id },
        ]),
        context
      )
    ).rejects.toThrow();
    expect(await db.incident.count()).toBe(0);
    expect(await db.incidentRoleAssignment.count()).toBe(0);

    const first = await executeIdempotentIncidentCreation(
      input([{ roleKey: 'COMMANDER', userId: commander.id }]),
      context
    );
    expect(first.value.outcome).toBe('CREATED');
    const replay = await executeIdempotentIncidentCreation(
      input([{ roleKey: 'COMMANDER', userId: commander.id }]),
      context
    );
    expect(replay.replayed).toBe(true);
    expect(replay.value.id).toBe(first.value.id);
    expect(await db.incident.count()).toBe(1);
    const roles = await db.incidentRoleAssignment.findMany({
      where: { incidentId: first.value.id },
    });
    expect(roles.map(role => [role.roleKey, role.userId])).toEqual([['COMMANDER', commander.id]]);
  });

  it('skips an ineligible holder without failing the create', async () => {
    const { creator, commander, input } = await fixture();
    const gone = await createTestUser({ name: 'Gone', status: 'DISABLED' });
    const created = await executeIdempotentIncidentCreation(
      input([
        { roleKey: 'COMMANDER', userId: commander.id },
        { roleKey: 'SCRIBE', userId: gone.id },
      ]),
      { key: 'create-skip-ineligible', principalId: creator.id }
    );
    expect(created.value.outcome).toBe('CREATED');
    const roles = await db.incidentRoleAssignment.findMany({
      where: { incidentId: created.value.id },
      select: { roleKey: true },
    });
    expect(roles.map(role => role.roleKey)).toEqual(['COMMANDER']);
  });
});
