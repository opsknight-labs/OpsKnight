import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const db = vi.hoisted(() => ({
  slackDestination: { findMany: vi.fn() },
  microsoftTeamsDestination: { findMany: vi.fn() },
  service: { findUnique: vi.fn() },
}));

vi.mock('@/lib/prisma', () => ({ default: db }));
vi.mock('@/lib/rbac', () => ({ assertCanModifyService: vi.fn().mockResolvedValue({ id: 'u1' }) }));
vi.mock('@/lib/slack', () => ({ getSlackBotToken: vi.fn().mockResolvedValue('xoxb') }));
vi.mock('@/lib/audit', () => ({ logAudit: vi.fn() }));

import { GET as slackGet } from '@/app/api/slack/destinations/route';
import { GET as teamsGet } from '@/app/api/microsoft-teams/destinations/route';

describe('destination reads report the service revision for the settings form', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    db.slackDestination.findMany.mockResolvedValue([]);
    db.microsoftTeamsDestination.findMany.mockResolvedValue([]);
    db.service.findUnique.mockResolvedValue({ revision: 12 });
  });

  it.each([
    ['Slack', slackGet, 'slack'],
    ['Microsoft Teams', teamsGet, 'microsoft-teams'],
  ])('%s returns the current serviceRevision', async (_name, handler, path) => {
    const response = await handler(
      new NextRequest(`http://localhost/api/${path}/destinations?serviceId=svc-1`)
    );

    expect(response.status).toBe(200);
    expect((await response.json()).data).toMatchObject({ serviceRevision: 12 });
    expect(db.service.findUnique).toHaveBeenCalledWith({
      where: { id: 'svc-1' },
      select: { revision: true },
    });
  });
});
