import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const m = vi.hoisted(() => {
  const tx = {
    statusPageApiToken: { create: vi.fn(), update: vi.fn() },
    statusPageWebhook: { create: vi.fn(), update: vi.fn(), deleteMany: vi.fn() },
    statusPageAnnouncement: { findFirst: vi.fn(), delete: vi.fn() },
  };
  return {
    tx,
    prisma: {
      $transaction: vi.fn(async (fn: (client: typeof tx) => unknown) => fn(tx)),
      statusPageApiToken: { findFirst: vi.fn() },
      statusPageWebhook: { findFirst: vi.fn() },
    },
    logAudit: vi.fn().mockResolvedValue(undefined),
    createStatusPage: vi.fn(),
    makeDefaultStatusPage: vi.fn(),
  };
});

vi.mock('@/lib/prisma', () => ({ default: m.prisma }));
vi.mock('@/lib/rbac', () => ({ assertAdmin: vi.fn().mockResolvedValue({ id: 'admin_1' }) }));
vi.mock('@/lib/audit', () => ({ logAudit: m.logAudit }));
vi.mock('@/lib/encryption', () => ({ encrypt: vi.fn().mockResolvedValue('enc') }));
vi.mock('@/lib/network-security', () => ({ assertSafeOutboundUrl: vi.fn() }));
vi.mock('@/lib/status-pages/admin', () => ({
  createStatusPage: m.createStatusPage,
  makeDefaultStatusPage: m.makeDefaultStatusPage,
  deleteStatusPage: vi.fn(),
  StatusPageAdminError: class StatusPageAdminError extends Error {},
  MAX_STATUS_PAGES: 2,
}));
vi.mock('@/lib/status-pages/announcement-commands', () => ({
  cancelPendingAnnouncementJobs: vi.fn(),
  createAnnouncementFanoutJob: vi.fn(),
  lockAnnouncementMutation: vi.fn(),
  suppressUndeliveredAnnouncementIntents: vi.fn(),
}));
vi.mock('@/lib/status-pages/announcement-notification-generation', () => ({
  incrementAnnouncementNotificationGeneration: vi.fn(),
  readAnnouncementNotificationGeneration: vi.fn(),
}));

import * as tokens from '@/app/api/settings/status-page/api-tokens/route';
import * as webhooks from '@/app/api/status-page/webhooks/route';
import * as announcements from '@/app/api/settings/status-page/announcements/route';
import * as pages from '@/app/api/settings/status-pages/route';
import * as makeDefault from '@/app/api/settings/status-pages/[pageId]/make-default/route';

function request(method: string, body?: unknown, search = '') {
  return new NextRequest(`http://localhost/api/x${search}`, {
    method,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

const audited = () => m.logAudit.mock.calls.map(([params]) => params);

describe('status page admin routes write an audit record', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('records minting a status API token without the token itself', async () => {
    m.tx.statusPageApiToken.create.mockResolvedValue({ id: 'tok_1', name: 'CI' });
    const res = await tokens.POST(request('POST', { statusPageId: 'sp_1', name: 'CI' }));
    expect(res.status).toBe(200);
    const [params] = audited();
    expect(params).toMatchObject({
      action: 'status_page.api_token.created',
      entityType: 'STATUS_PAGE',
      entityId: 'sp_1',
      actorId: 'admin_1',
    });
    expect(JSON.stringify(params)).not.toMatch(/tokenHash/);
    expect(m.logAudit.mock.calls[0]![1]).toBe(m.tx);
  });

  it('records revoking a status API token', async () => {
    m.prisma.statusPageApiToken.findFirst.mockResolvedValue({
      id: 'tok_1',
      name: 'CI',
      prefix: 'ok_ab',
    });
    m.tx.statusPageApiToken.update.mockResolvedValue({ id: 'tok_1' });
    const res = await tokens.DELETE(request('DELETE', { statusPageId: 'sp_1', id: 'tok_1' }));
    expect(res.status).toBe(200);
    expect(audited()[0]).toMatchObject({
      action: 'status_page.api_token.revoked',
      entityId: 'sp_1',
      actorId: 'admin_1',
    });
  });

  it('records webhook create, update and delete, and never logs the URL or secret', async () => {
    m.tx.statusPageWebhook.create.mockResolvedValue({ id: 'wh_1' });
    expect(
      (
        await webhooks.POST(
          request('POST', {
            statusPageId: 'sp_1',
            url: 'https://hooks.example.com/secret-path',
            events: ['incident.created'],
          })
        )
      ).status
    ).toBe(201);

    m.prisma.statusPageWebhook.findFirst.mockResolvedValue({ id: 'wh_1' });
    m.tx.statusPageWebhook.update.mockResolvedValue({ id: 'wh_1' });
    await webhooks.PATCH(request('PATCH', { statusPageId: 'sp_1', id: 'wh_1', enabled: false }));

    m.tx.statusPageWebhook.deleteMany.mockResolvedValue({ count: 1 });
    await webhooks.DELETE(request('DELETE', undefined, '?id=wh_1&statusPageId=sp_1'));

    expect(audited().map(p => p.action)).toEqual([
      'status_page.webhook.created',
      'status_page.webhook.updated',
      'status_page.webhook.deleted',
    ]);
    expect(JSON.stringify(audited())).not.toMatch(/secret-path|enc/);
    expect(audited()[1]).toMatchObject({ details: { changed: ['enabled'], enabled: false } });
  });

  it('does not audit a webhook delete that matched nothing', async () => {
    m.tx.statusPageWebhook.deleteMany.mockResolvedValue({ count: 0 });
    const res = await webhooks.DELETE(request('DELETE', undefined, '?id=wh_1&statusPageId=sp_1'));
    expect(res.status).toBe(404);
    expect(m.logAudit).not.toHaveBeenCalled();
  });

  it('records deleting an announcement inside the same transaction', async () => {
    m.tx.statusPageAnnouncement.findFirst.mockResolvedValue({ id: 'an_1', title: 'Maintenance' });
    m.tx.statusPageAnnouncement.delete.mockResolvedValue({});
    const res = await announcements.DELETE(request('DELETE', { statusPageId: 'sp_1', id: 'an_1' }));
    expect(res.status).toBe(200);
    expect(audited()[0]).toMatchObject({
      action: 'status_page.announcement.deleted',
      entityId: 'sp_1',
      actorId: 'admin_1',
      details: { announcementId: 'an_1', title: 'Maintenance' },
    });
    expect(m.logAudit.mock.calls[0]![1]).toBe(m.tx);
  });

  it('records creating a status page and making one the default', async () => {
    m.createStatusPage.mockImplementation(async (_input, afterCreate) => {
      const page = { id: 'sp_2', name: 'Acme', slug: 'acme', isDefault: false };
      await afterCreate(m.tx, page);
      return page;
    });
    await pages.POST(request('POST', { name: 'Acme', slug: 'acme' }));

    m.makeDefaultStatusPage.mockImplementation(async (_id, inTx) => {
      await inTx(m.tx);
      return { id: 'sp_2' };
    });
    await makeDefault.POST(request('POST'), { params: Promise.resolve({ pageId: 'sp_2' }) });

    expect(audited().map(p => [p.action, p.entityId, p.actorId])).toEqual([
      ['status_page.created', 'sp_2', 'admin_1'],
      ['status_page.updated', 'sp_2', 'admin_1'],
    ]);
  });
});
