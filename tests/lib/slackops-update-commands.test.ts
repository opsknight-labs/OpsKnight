import { beforeEach, describe, expect, it, vi } from 'vitest';

const m = vi.hoisted(() => ({
  prisma: {
    incident: { findUnique: vi.fn() },
    incidentEvent: { create: vi.fn() },
    slackIncidentMessage: { findMany: vi.fn().mockResolvedValue([]) },
    statusPage: { findMany: vi.fn() },
    statusPageAnnouncement: { create: vi.fn() },
    $transaction: vi.fn(),
  },
  authorize: vi.fn(),
  patch: vi.fn(),
  resolveActor: vi.fn(),
}));
vi.mock('@/lib/prisma', () => ({ default: m.prisma }));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('@/lib/incidents/chatops-lifecycle', () => ({
  authorizeChatOpsIncident: m.authorize,
  chatOpsLifecycleErrorMessage: (e: unknown) => (e instanceof Error ? e.message : 'failed'),
}));
vi.mock('@/lib/incidents/rest-patch', () => ({ applyRestIncidentPatch: m.patch }));
vi.mock('@/lib/authorization-actors', () => ({ resolveUserActor: m.resolveActor }));
vi.mock('@/lib/audit', () => ({ emitAuditEvent: vi.fn() }));
vi.mock('@/lib/status-pages/announcement-commands', () => ({
  createAnnouncementFanoutJob: vi.fn(),
}));

import {
  applyIncidentUpdate,
  handleUpdateSlashCommand,
  parseUpdateCommand,
  postIncidentStatusUpdate,
} from '@/lib/chatops/slash/update-commands';

const actor = { id: 'u1', name: 'Alice' };
const current = { title: 'Old', description: null, priority: 'P2', urgency: 'HIGH' };

beforeEach(() => {
  vi.clearAllMocks();
  m.authorize.mockResolvedValue(undefined);
  m.patch.mockResolvedValue({});
  m.prisma.incident.findUnique.mockResolvedValue(current);
  m.prisma.slackIncidentMessage.findMany.mockResolvedValue([]);
});

describe('parseUpdateCommand', () => {
  it('parses each subcommand and rejects bad input', () => {
    expect(parseUpdateCommand('priority', 'p1')).toEqual({ changes: { priority: 'P1' } });
    expect(parseUpdateCommand('priority', 'P9')).toHaveProperty('error');
    expect(parseUpdateCommand('urgency', 'Low')).toEqual({ changes: { urgency: 'LOW' } });
    expect(parseUpdateCommand('urgency', 'urgent')).toHaveProperty('error');
    expect(parseUpdateCommand('title', 'ab')).toHaveProperty('error');
    expect(parseUpdateCommand('title', ' New title ')).toEqual({ changes: { title: 'New title' } });
    expect(parseUpdateCommand('describe', '')).toHaveProperty('error');
    expect(parseUpdateCommand('status', 'We are on it')).toEqual({ status: 'We are on it' });
  });
});

describe('applyIncidentUpdate', () => {
  it('authorizes MANAGE and patches only the changed fields', async () => {
    const { lines } = await applyIncidentUpdate({
      incidentId: 'i1',
      actor,
      changes: { priority: 'P1', urgency: 'HIGH' },
    });
    expect(m.authorize).toHaveBeenCalledWith('i1', 'u1', 'MANAGE');
    expect(lines).toEqual(['Priority P2 → P1']);
    expect(m.patch).toHaveBeenCalledWith(
      expect.objectContaining({ incidentId: 'i1', priority: 'P1', hasAssigneeUpdate: false })
    );
    expect(m.patch.mock.calls[0][0]).not.toHaveProperty('urgency');
  });

  it('is a no-op when nothing differs', async () => {
    const { lines } = await applyIncidentUpdate({
      incidentId: 'i1',
      actor,
      changes: { priority: 'P2' },
    });
    expect(lines).toEqual([]);
    expect(m.patch).not.toHaveBeenCalled();
  });

  it('writes nothing when authorization is refused', async () => {
    m.authorize.mockRejectedValue(new Error('You do not have permission for this incident.'));
    await expect(
      applyIncidentUpdate({ incidentId: 'i1', actor, changes: { priority: 'P1' } })
    ).rejects.toThrow('permission');
    expect(m.patch).not.toHaveBeenCalled();
  });
});

describe('handleUpdateSlashCommand', () => {
  const base = { incidentId: 'i1', actor, rethrowIfTransient: vi.fn() };
  it('announces a change in channel', async () => {
    const reply = await handleUpdateSlashCommand({ ...base, subcommand: 'priority', args: 'P1' });
    expect(reply).toMatchObject({ response_type: 'in_channel' });
    expect(reply.text).toContain('Priority P2 → P1');
  });
  it('answers a refusal privately and never replaces the original', async () => {
    m.authorize.mockRejectedValue(new Error('nope'));
    const reply = await handleUpdateSlashCommand({ ...base, subcommand: 'priority', args: 'P1' });
    expect(reply.response_type).toBe('ephemeral');
    expect(reply.text).toContain('nope');
  });
  it('gives usage for bad arguments', async () => {
    const reply = await handleUpdateSlashCommand({ ...base, subcommand: 'urgency', args: 'x' });
    expect(reply.response_type).toBe('ephemeral');
    expect(m.authorize).not.toHaveBeenCalled();
  });
});

describe('postIncidentStatusUpdate', () => {
  const admin = { id: 'u1', status: 'ACTIVE', capabilities: ['admin:manage'] };
  const publicIncident = { id: 'i1', title: 'API down', visibility: 'PUBLIC', serviceId: 's1' };
  beforeEach(async () => {
    const { CAPABILITIES } = await import('@/lib/authorization');
    m.resolveActor.mockResolvedValue({ ...admin, capabilities: [CAPABILITIES.ADMIN_MANAGE] });
    m.prisma.incident.findUnique.mockResolvedValue(publicIncident);
    m.prisma.statusPage.findMany.mockResolvedValue([{ id: 'p1', name: 'Main' }]);
    m.prisma.statusPageAnnouncement.create.mockResolvedValue({
      id: 'a1',
      notificationGeneration: 0,
    });
    m.prisma.$transaction.mockImplementation(async (fn: (tx: unknown) => unknown) => fn(m.prisma));
  });

  it('publishes for a public incident on a status page', async () => {
    const result = await postIncidentStatusUpdate({
      incidentId: 'i1',
      actor,
      message: 'Investigating',
    });
    expect(result).toEqual({ ok: true, pages: ['Main'] });
    expect(m.prisma.statusPageAnnouncement.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          incidentId: 'i1',
          isActive: true,
          notificationTiming: 'NONE',
        }),
      })
    );
  });

  it('refuses an internal incident', async () => {
    m.prisma.incident.findUnique.mockResolvedValue({ ...publicIncident, visibility: 'PRIVATE' });
    const result = await postIncidentStatusUpdate({ incidentId: 'i1', actor, message: 'x y z' });
    expect(result).toMatchObject({ ok: false });
    expect(m.prisma.statusPageAnnouncement.create).not.toHaveBeenCalled();
  });

  it('refuses without the admin capability', async () => {
    m.resolveActor.mockResolvedValue({ ...admin, capabilities: [] });
    const result = await postIncidentStatusUpdate({ incidentId: 'i1', actor, message: 'x y z' });
    expect(result).toMatchObject({ ok: false });
    expect(m.prisma.statusPageAnnouncement.create).not.toHaveBeenCalled();
  });

  it('refuses when no enabled status page shows the service', async () => {
    m.prisma.statusPage.findMany.mockResolvedValue([]);
    const result = await postIncidentStatusUpdate({ incidentId: 'i1', actor, message: 'x y z' });
    expect(result).toMatchObject({ ok: false });
  });
});
