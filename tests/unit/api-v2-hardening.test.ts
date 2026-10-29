/* eslint-disable @typescript-eslint/no-explicit-any */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import prisma from '@/lib/prisma';
import { IncidentAssignV2Schema } from '@/lib/api-v2/validation';
import { runV2AuditedMutation } from '@/lib/api-v2/audit';
import { authorize, AUTHORIZATION_ACTIONS, type AuthorizationActor } from '@/lib/authorization-policy';

const auditMocks = vi.hoisted(() => ({ logAudit: vi.fn() }));
vi.mock('@/lib/audit', () => ({ logAudit: auditMocks.logAudit }));

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

  it('grants global (detail) access to ADMIN and RESPONDER', () => {
    expect(decide('ADMIN')).toMatchObject({ allowed: true, scope: 'global' });
    expect(decide('RESPONDER')).toMatchObject({ allowed: true, scope: 'global' });
  });

  it('gives AUDITOR resource-scoped access only, which the route projects to metadata', () => {
    expect(decide('AUDITOR')).toMatchObject({ allowed: true, scope: 'resource' });
  });

  it('denies USER entirely, so no own-notifications branch is reachable', () => {
    expect(decide('USER')).toMatchObject({ allowed: false });
  });
});
