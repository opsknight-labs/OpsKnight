// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import prisma from '@/lib/prisma';
import { discoverSubjectData } from '@/lib/privacy/discovery';

describe('subject data discovery', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns only aggregate counts for explicit user relations', async () => {
    vi.mocked(prisma.user.count).mockResolvedValueOnce(1);
    vi.mocked(prisma.oidcIdentity.count).mockResolvedValueOnce(2);
    vi.mocked(prisma.incident.count).mockResolvedValueOnce(14);
    vi.mocked(prisma.incidentNote.count).mockResolvedValueOnce(3);
    vi.mocked(prisma.notification.count).mockResolvedValueOnce(86);
    vi.mocked(prisma.auditLog.count).mockResolvedValueOnce(41);

    const result = await discoverSubjectData({
      userId: 'clw8q8z48000008l6c5f14abc',
      actorUserId: 'clw8q8z48000008l6c5f14def',
    });

    expect(result.counts).toMatchObject({
      user: 1,
      oidcIdentities: 2,
      assignedIncidents: 14,
      incidentNotes: 3,
      notifications: 86,
      auditEvents: 41,
    });
    expect(result.limitations).toHaveLength(5);
    expect(result).not.toHaveProperty('records');
    expect(prisma.auditLog.count).toHaveBeenCalledWith({
      where: {
        OR: [
          { actorId: 'clw8q8z48000008l6c5f14abc' },
          { entityType: 'USER', entityId: 'clw8q8z48000008l6c5f14abc' },
        ],
      },
    });
    expect(prisma.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: 'privacy.subject_discovery.viewed',
        entityType: 'USER',
        entityId: 'clw8q8z48000008l6c5f14abc',
        actorId: 'clw8q8z48000008l6c5f14def',
        targetEmail: null,
        details: expect.objectContaining({
          metadata: expect.objectContaining({
            resultCategory: 'DIRECT_RELATION_COUNTS',
            matchedCategories: 6,
            totalDirectRelations: 147,
          }),
        }),
      }),
    });
  });

  it('rejects malformed identifiers before querying', async () => {
    await expect(
      discoverSubjectData({ userId: '../users', actorUserId: 'clw8q8z48000008l6c5f14def' })
    ).rejects.toThrow();
    expect(prisma.user.count).not.toHaveBeenCalled();
  });
});
