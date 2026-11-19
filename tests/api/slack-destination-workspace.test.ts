import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const db = vi.hoisted(() => {
  const tx = {
    slackDestination: { findUnique: vi.fn(), findFirst: vi.fn(), update: vi.fn() },
  };
  return {
    tx,
    service: { findUnique: vi.fn() },
    slackIntegration: { findFirst: vi.fn() },
    $transaction: vi.fn(async (cb: (t: typeof tx) => unknown) => cb(tx)),
  };
});

vi.mock('@/lib/prisma', () => ({ default: db }));
vi.mock('@/lib/rbac', () => ({ assertCanModifyService: vi.fn().mockResolvedValue({ id: 'u1' }) }));
vi.mock('@/lib/slack', () => ({ getSlackBotToken: vi.fn().mockResolvedValue('xoxb') }));
vi.mock('@/lib/audit', () => ({ logAudit: vi.fn() }));

import { POST } from '@/app/api/slack/destinations/route';

function link() {
  return POST(
    new NextRequest('http://localhost/api/slack/destinations', {
      method: 'POST',
      body: JSON.stringify({ serviceId: 'svc-1', channelId: 'C1', channelName: 'alerts' }),
    })
  );
}

describe('Slack destination workspace matches the delivery token workspace', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    db.tx.slackDestination.findUnique.mockResolvedValue({
      id: 'd1',
      enabled: true,
      channelName: 'alerts',
      isPrivate: false,
      integrationId: null,
    });
    db.tx.slackDestination.update.mockImplementation(async ({ data }) => ({ id: 'd1', ...data }));
  });

  it('uses the global (service-less) workspace, not the oldest enabled one', async () => {
    db.service.findUnique.mockResolvedValue({ id: 'svc-1', slackIntegration: null });
    db.slackIntegration.findFirst.mockResolvedValue({ id: 'g1', workspaceId: 'W-GLOBAL' });

    await link();

    expect(db.slackIntegration.findFirst).toHaveBeenCalledWith({
      where: { enabled: true, services: { none: {} } },
    });
    expect(db.tx.slackDestination.update.mock.calls[0][0].data.workspaceId).toBe('W-GLOBAL');
  });

  it('ignores a disabled service integration (token falls back to global)', async () => {
    db.service.findUnique.mockResolvedValue({
      id: 'svc-1',
      slackIntegration: { id: 's1', workspaceId: 'W-DISABLED', enabled: false },
    });
    db.slackIntegration.findFirst.mockResolvedValue({ id: 'g1', workspaceId: 'W-GLOBAL' });

    await link();

    expect(db.tx.slackDestination.update.mock.calls[0][0].data.workspaceId).toBe('W-GLOBAL');
  });
});
