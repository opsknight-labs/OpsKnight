import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuthorizationActor, AuthorizationResource } from '@/lib/authorization-policy';
import {
  parseDefaultRoles,
  parseIncidentRoleKey,
  roleContributorIds,
  roleOperatorIds,
  summarizeIncidentRoles,
} from '@/lib/incidents/roles';
import { canChangeIncidentRole } from '@/lib/incidents/role-authorization';

vi.mock('server-only', () => ({}));
vi.mock('@/lib/prisma', () => ({ default: { $transaction: vi.fn() } }));
const outbox = vi.hoisted(() => ({
  enqueueIncidentUpdateSideEffects: vi.fn(),
  enqueueWarRoomSideEffects: vi.fn(),
}));
vi.mock('@/lib/event-outbox', () => outbox);
const audit = vi.hoisted(() => ({ emitAuditEvent: vi.fn() }));
vi.mock('@/lib/audit', () => audit);

import { assignIncidentRoleCommand } from '@/lib/incidents/roles-command';

type IncidentResource = Extract<AuthorizationResource, { type: 'incident' }>;
const actor = (role: AuthorizationActor['role'], id = 'u-1'): AuthorizationActor => ({
  id,
  role,
  status: 'ACTIVE',
  teamIds: ['team-a'],
});
const resource = (overrides: Partial<IncidentResource> = {}): IncidentResource => ({
  type: 'incident',
  id: 'inc-1',
  assigneeId: null,
  visibility: 'PUBLIC',
  serviceTeamId: 'team-z',
  ...overrides,
});

describe('incident role catalog', () => {
  it('parses user-typed role names and aliases', () => {
    expect(parseIncidentRoleKey('commander')).toBe('COMMANDER');
    expect(parseIncidentRoleKey('ops-lead')).toBe('OPS_LEAD');
    expect(parseIncidentRoleKey('Comms lead')).toBe('COMMS_LEAD');
    expect(parseIncidentRoleKey('IC')).toBe('COMMANDER');
    expect(parseIncidentRoleKey('pilot')).toBeNull();
  });

  it('splits holders into operator and contributor rights', () => {
    const holders = [
      { roleKey: 'COMMANDER', userId: 'a' },
      { roleKey: 'OPS_LEAD', userId: 'b' },
      { roleKey: 'COMMS_LEAD', userId: 'c' },
      { roleKey: 'SCRIBE', userId: 'd' },
      { roleKey: 'UNKNOWN', userId: 'e' },
    ];
    expect(roleOperatorIds(holders)).toEqual(['a', 'b']);
    expect(roleContributorIds(holders)).toEqual(['c', 'd']);
  });

  it('summarizes holders in catalog order and drops unknown template keys', () => {
    expect(
      summarizeIncidentRoles([
        { roleKey: 'SCRIBE', user: { name: 'Sam' } },
        { roleKey: 'COMMANDER', user: { name: 'Ada' } },
      ]).map(role => role.name)
    ).toEqual(['Ada', 'Sam']);
    expect(parseDefaultRoles({ COMMANDER: 'u1', PILOT: 'u2', SCRIBE: '' })).toEqual([
      { roleKey: 'COMMANDER', userId: 'u1' },
    ]);
    expect(parseDefaultRoles(['nope'])).toEqual([]);
  });
});

describe('canChangeIncidentRole', () => {
  const base = { currentHolderId: null, commanderId: null };

  it('lets responders and admins set any role', () => {
    expect(
      canChangeIncidentRole({
        ...base,
        actor: actor('RESPONDER'),
        resource: resource(),
        targetUserId: 'someone',
      })
    ).toBe(true);
  });

  it('lets an operator take a role but not hand one to someone else', () => {
    const r = resource({ assigneeId: 'u-1' });
    expect(
      canChangeIncidentRole({ ...base, actor: actor('USER'), resource: r, targetUserId: 'u-1' })
    ).toBe(true);
    expect(
      canChangeIncidentRole({ ...base, actor: actor('USER'), resource: r, targetUserId: 'u-2' })
    ).toBe(false);
  });

  it('lets the commander delegate roles, even on a private incident', () => {
    const r = resource({ roleOperatorIds: ['u-1'], visibility: 'PRIVATE' });
    expect(
      canChangeIncidentRole({
        actor: actor('USER'),
        resource: r,
        targetUserId: 'u-2',
        currentHolderId: null,
        commanderId: 'u-1',
      })
    ).toBe(true);
  });

  it('lets a holder step down but not an unrelated user take a role', () => {
    expect(
      canChangeIncidentRole({
        actor: actor('USER'),
        resource: resource({ roleContributorIds: ['u-1'] }),
        targetUserId: null,
        currentHolderId: 'u-1',
        commanderId: null,
      })
    ).toBe(true);
    expect(
      canChangeIncidentRole({
        ...base,
        actor: actor('USER'),
        resource: resource(),
        targetUserId: 'u-1',
      })
    ).toBe(false);
  });
});

function fakeTx(existing: { userId: string; user: { name: string } } | null) {
  return {
    incident: { findUnique: vi.fn().mockResolvedValue({ id: 'inc-1' }) },
    user: { findFirst: vi.fn().mockResolvedValue({ id: 'u-2', name: 'Grace' }) },
    incidentRoleAssignment: {
      findUnique: vi.fn().mockResolvedValue(existing),
      upsert: vi.fn(),
      delete: vi.fn(),
    },
    incidentWatcher: { upsert: vi.fn() },
    incidentEvent: { create: vi.fn() },
  };
}

describe('assignIncidentRoleCommand', () => {
  beforeEach(() => vi.clearAllMocks());

  it('assigns, follows, records the timeline and invites in one transaction', async () => {
    const tx = fakeTx(null);
    const result = await assignIncidentRoleCommand(
      {
        incidentId: 'inc-1',
        roleKey: 'COMMANDER',
        userId: 'u-2',
        actor: { id: 'u-1', name: 'Ada' },
      },
      tx as never
    );
    expect(result).toMatchObject({ changed: true, userId: 'u-2', userName: 'Grace' });
    expect(tx.incidentRoleAssignment.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { incidentId_roleKey: { incidentId: 'inc-1', roleKey: 'COMMANDER' } },
      })
    );
    expect(tx.incidentWatcher.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ update: {}, create: expect.objectContaining({ role: 'FOLLOWER' }) })
    );
    expect(tx.incidentEvent.create).toHaveBeenCalledWith({
      data: {
        incidentId: 'inc-1',
        type: 'ROLE_ASSIGNED',
        message: 'Grace is now incident commander by Ada',
      },
    });
    expect(audit.emitAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'incident.role_assigned' }),
      tx
    );
    expect(outbox.enqueueWarRoomSideEffects).toHaveBeenCalledWith(tx, 'inc-1', [
      expect.objectContaining({ effect: 'WAR_ROOM_MESSAGE' }),
      { effect: 'WAR_ROOM_INVITE_USER', userId: 'u-2' },
      { effect: 'WAR_ROOM_TOPIC' },
    ]);
  });

  it('is a no-op when the holder is unchanged', async () => {
    const tx = fakeTx({ userId: 'u-2', user: { name: 'Grace' } });
    const result = await assignIncidentRoleCommand(
      { incidentId: 'inc-1', roleKey: 'COMMANDER', userId: 'u-2', actor: { id: 'u-1' } },
      tx as never
    );
    expect(result.changed).toBe(false);
    expect(tx.incidentEvent.create).not.toHaveBeenCalled();
  });

  it('clears a role with a ROLE_UNASSIGNED event', async () => {
    const tx = fakeTx({ userId: 'u-2', user: { name: 'Grace' } });
    const result = await assignIncidentRoleCommand(
      { incidentId: 'inc-1', roleKey: 'SCRIBE', userId: null, actor: { id: 'u-1' } },
      tx as never
    );
    expect(result).toMatchObject({ changed: true, userId: null, previousUserId: 'u-2' });
    expect(tx.incidentRoleAssignment.delete).toHaveBeenCalled();
    expect(tx.incidentEvent.create).toHaveBeenCalledWith({
      data: { incidentId: 'inc-1', type: 'ROLE_UNASSIGNED', message: 'Grace is no longer scribe' },
    });
  });

  it('rejects unknown roles and inactive holders', async () => {
    await expect(
      assignIncidentRoleCommand(
        { incidentId: 'inc-1', roleKey: 'PILOT' as never, userId: 'u-2', actor: { id: 'u-1' } },
        fakeTx(null) as never
      )
    ).rejects.toThrow();
    const tx = fakeTx(null);
    tx.user.findFirst.mockResolvedValue(null);
    await expect(
      assignIncidentRoleCommand(
        { incidentId: 'inc-1', roleKey: 'OPS_LEAD', userId: 'gone', actor: { id: 'u-1' } },
        tx as never
      )
    ).rejects.toMatchObject({ code: 'RESOURCE_NOT_FOUND' });
  });
});
