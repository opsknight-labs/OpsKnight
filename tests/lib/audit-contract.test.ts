import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  auditCreate: vi.fn(),
  userFindUnique: vi.fn(),
}));

vi.mock('@/lib/prisma', () => ({
  default: {
    auditLog: { create: mocks.auditCreate },
    user: { findUnique: mocks.userFindUnique },
  },
}));

import { emitAuditEvent, logAudit } from '@/lib/audit';

describe('audit event contract', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.auditCreate.mockResolvedValue({});
    mocks.userFindUnique.mockResolvedValue({ email: 'actor@example.com', name: 'Actor' });
  });

  it('writes actor, action, target, source, timestamp, request, and change values', async () => {
    await emitAuditEvent({
      action: 'incident.lifecycle.resolve',
      source: 'API',
      target: { type: 'SYSTEM_CONFIG', id: 'incident-1' },
      actor: { type: 'USER', id: 'user-1' },
      requestId: 'request-1',
      occurredAt: new Date('2026-08-28T10:00:00.000Z'),
      oldValue: { status: 'ACKNOWLEDGED' },
      newValue: { status: 'RESOLVED' },
      metadata: { reason: 'Recovered' },
    });

    expect(mocks.auditCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: 'incident.lifecycle.resolve',
        entityType: 'SYSTEM_CONFIG',
        entityId: 'incident-1',
        actorId: 'user-1',
        actorEmail: 'actor@example.com',
        actorName: 'Actor',
        details: {
          contractVersion: 1,
          source: 'API',
          requestId: 'request-1',
          occurredAt: '2026-08-28T10:00:00.000Z',
          actor: {
            type: 'USER',
            id: 'user-1',
            email: 'actor@example.com',
            name: 'Actor',
          },
          target: { type: 'SYSTEM_CONFIG', id: 'incident-1' },
          oldValue: { status: 'ACKNOWLEDGED' },
          newValue: { status: 'RESOLVED' },
          metadata: { reason: 'Recovered' },
        },
      }),
    });
  });

  it('redacts sensitive values before persistence', async () => {
    await emitAuditEvent({
      action: 'integration.updated',
      source: 'UI',
      target: { type: 'SYSTEM_CONFIG', id: 'jira' },
      metadata: { apiToken: 'secret-token', nested: { password: 'secret-password' } },
    });

    const serialized = JSON.stringify(mocks.auditCreate.mock.calls[0]);
    expect(serialized).not.toContain('secret-token');
    expect(serialized).not.toContain('secret-password');
    expect(serialized).toContain('[REDACTED]');
  });

  it('adapts legacy logAudit calls into the versioned contract', async () => {
    await logAudit({
      action: 'USER_UPDATED',
      entityType: 'USER',
      entityId: 'user-2',
      actorId: 'user-1',
      details: { targetEmail: 'TARGET@EXAMPLE.COM', ip: '127.0.0.1' },
    });

    expect(mocks.auditCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        targetEmail: 'target@example.com',
        ip: '127.0.0.1',
        details: expect.objectContaining({
          source: 'UI',
          contractVersion: 1,
          targetEmail: 'target@example.com',
          ip: '127.0.0.1',
        }),
      }),
    });
  });

  it('rejects invalid timestamps before persistence', async () => {
    await expect(
      emitAuditEvent({
        action: 'invalid.time',
        source: 'SYSTEM',
        target: { type: 'SYSTEM_CONFIG' },
        occurredAt: new Date(Number.NaN),
      })
    ).rejects.toThrow(RangeError);
    expect(mocks.auditCreate).not.toHaveBeenCalled();
  });
});
