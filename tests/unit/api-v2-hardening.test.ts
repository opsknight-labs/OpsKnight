/* eslint-disable @typescript-eslint/no-explicit-any */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import prisma from '@/lib/prisma';
import { IncidentAssignV2Schema } from '@/lib/api-v2/validation';
import { runV2AuditedMutation } from '@/lib/api-v2/audit';
import { authorize, AUTHORIZATION_ACTIONS, type AuthorizationActor } from '@/lib/authorization-policy';
import { NextRequest } from 'next/server';
import { GET as listNotifications } from '@/app/api/v2/notifications/route';

const auditMocks = vi.hoisted(() => ({ logAudit: vi.fn() }));
vi.mock('@/lib/audit', () => ({ logAudit: auditMocks.logAudit }));

const routeActor = vi.hoisted(() => ({ current: null as unknown }));
vi.mock('@/lib/rate-limit', () => ({
  checkRateLimit: vi.fn().mockResolvedValue({
    allowed: true,
    remaining: 119,
    resetAt: Date.now() + 60_000,
    count: 1,
  }),
  incrementSharedCounter: vi.fn().mockResolvedValue({ count: 1, resetAt: Date.now() + 60_000 }),
}));
vi.mock('@/lib/api-v2/auth', async importOriginal => {
  const actual = await importOriginal<typeof import('@/lib/api-v2/auth')>();
  return {
    ...actual,
    authenticateV2Request: vi.fn(async () => ({
      apiKey: { id: 'k', scopes: ['notifications:read'] },
      actor: routeActor.current,
    })),
  };
});

describe('IncidentAssignV2Schema', () => {
  it('rejects assigning to a user and a team at once', () => {
    expect(() => IncidentAssignV2Schema.parse({ assigneeId: 'u1', teamId: 't1' })).toThrow(
      /either a user or a team/
    );
  });

  it('rejects an empty body instead of silently unassigning', () => {
    expect(() => IncidentAssignV2Schema.parse({})).toThrow(/assigneeId or teamId/);
  });

  it('accepts a single target and an explicit null unassign', () => {
    expect(IncidentAssignV2Schema.parse({ assigneeId: 'u1' }).assigneeId).toBe('u1');
    expect(IncidentAssignV2Schema.parse({ teamId: 't1' }).teamId).toBe('t1');
    expect(IncidentAssignV2Schema.parse({ assigneeId: null }).assigneeId).toBeNull();
    expect(IncidentAssignV2Schema.parse({ assigneeId: null, teamId: null })).toBeDefined();
  });
});

describe('runV2AuditedMutation', () => {
  const tx = { marker: 'tx' } as any;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(prisma.$transaction as any).mockImplementation(async (fn: any) => fn(tx));
    auditMocks.logAudit.mockResolvedValue(undefined);
  });

  it('writes the audit record on the same transaction client as the mutation', async () => {
    const mutate = vi.fn().mockResolvedValue({ id: 'x1' });
    const result = await runV2AuditedMutation(mutate, (r: { id: string }) => ({
      action: 'thing.created',
      entityType: 'TEAM',
      entityId: r.id,
      actorId: 'usr_1',
      apiKeyId: 'key_1',
    }));

    expect(result).toEqual({ id: 'x1' });
    expect(mutate).toHaveBeenCalledWith(tx);
    expect(auditMocks.logAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'thing.created', entityId: 'x1', source: 'API' }),
      tx
    );
  });

  it('fails the whole mutation when the audit write fails, so nothing commits without its record', async () => {
    auditMocks.logAudit.mockRejectedValue(new Error('audit insert failed'));
    const mutate = vi.fn().mockResolvedValue({ id: 'x2' });

    await expect(
      runV2AuditedMutation(mutate, () => ({
        action: 'thing.created',
        entityType: 'TEAM',
        actorId: 'usr_1',
      }))
    ).rejects.toThrow('audit insert failed');
  });

  it('joins an existing transaction instead of opening another', async () => {
    const outer = { marker: 'outer' } as any;
    const mutate = vi.fn().mockResolvedValue({ id: 'x3' });
    await runV2AuditedMutation(
      mutate,
      () => ({ action: 'a', entityType: 'TEAM', actorId: 'u' }),
      outer
    );
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(mutate).toHaveBeenCalledWith(outer);
  });
});

describe('notification read policy', () => {
  const actor = (role: AuthorizationActor['role']): AuthorizationActor => ({
    id: 'u1',
    role,
    status: 'ACTIVE',
    teamIds: [],
    apiKey: { id: 'k', scopes: ['notifications:read'] },
  });
  const decide = (role: AuthorizationActor['role']) =>
    authorize({ actor: actor(role), action: AUTHORIZATION_ACTIONS.NOTIFICATION_READ });

  it('lets ADMIN and RESPONDER through the global gate and AUDITOR through the scoped one', () => {
    expect(decide('ADMIN')).toMatchObject({ allowed: true, scope: 'global' });
    expect(decide('RESPONDER')).toMatchObject({ allowed: true, scope: 'global' });
    expect(decide('AUDITOR')).toMatchObject({ allowed: true, scope: 'resource' });
  });

  it('denies USER entirely', () => {
    expect(decide('USER')).toMatchObject({ allowed: false });
  });

  // The gate above only decides who may list. Who sees message bodies and addresses is the
  // route's rule: ADMIN for everyone, anyone else for their own notifications only.
  describe('delivery detail', () => {
    const notification = (id: string, userId: string | null) => ({
      id,
      channel: 'EMAIL',
      status: 'SENT',
      recipientId: `${id}@example.com`,
      recipientDisplay: `Recipient ${id}`,
      message: `secret body ${id}`,
      incidentId: 'inc-1',
      userId,
      createdAt: new Date('2026-11-01T10:00:00.000Z'),
      incident: { id: 'inc-1', title: 'Outage' },
      user: userId ? { id: userId, name: `Name ${userId}`, email: `${userId}@example.com` } : null,
    });

    async function listAs(role: AuthorizationActor['role']) {
      routeActor.current = actor(role);
      vi.mocked(prisma.notification.findMany).mockResolvedValue([
        notification('n-own', 'u1'),
        notification('n-other', 'u2'),
        notification('n-system', null),
      ] as any);
      const res = await listNotifications(new NextRequest('http://localhost:3000/api/v2/notifications'));
      expect(res.status).toBe(200);
      const body = (await res.json()) as { data: Array<Record<string, any>> };
      const byId = new Map(body.data.map(row => [row.id as string, row]));
      return (id: string): Record<string, any> => byId.get(id) ?? {};
    }

    it('shows ADMIN every notification in full', async () => {
      const row = await listAs('ADMIN');
      for (const id of ['n-own', 'n-other', 'n-system']) {
        expect(row(id)).toMatchObject({ message: `secret body ${id}`, recipientId: `${id}@example.com` });
      }
      expect(row('n-other').user.email).toBe('u2@example.com');
    });

    it.each(['RESPONDER', 'AUDITOR'] as const)(
      'shows %s only their own notification in full and metadata for everyone else',
      async role => {
        const row = await listAs(role);
        expect(row('n-own')).toMatchObject({ message: 'secret body n-own', recipientId: 'n-own@example.com' });
        expect(row('n-own').user.email).toBe('u1@example.com');
        for (const id of ['n-other', 'n-system']) {
          expect(row(id)).not.toHaveProperty('message');
          expect(row(id)).not.toHaveProperty('recipientId');
          expect(row(id)).not.toHaveProperty('recipientDisplay');
          expect(row(id)).toMatchObject({ id, channel: 'EMAIL', status: 'SENT', incidentId: 'inc-1' });
        }
        expect(row('n-other').user).toEqual({ id: 'u2', name: 'Name u2' });
        expect(row('n-system').user).toBeNull();
      }
    );
  });
});
