import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const db = vi.hoisted(() => ({
  slackOAuthConfig: { findFirst: vi.fn(), updateMany: vi.fn(), deleteMany: vi.fn() },
}));

vi.mock('@/lib/prisma', () => ({ default: db }));
vi.mock('@/lib/rbac', () => ({
  assertAdmin: vi.fn().mockResolvedValue(undefined),
  getCurrentUser: vi.fn().mockResolvedValue({ id: 'admin-1' }),
}));
vi.mock('@/lib/audit', () => ({ logAudit: vi.fn() }));
vi.mock('@/lib/encryption', () => ({ encrypt: vi.fn(async (v: string) => `enc:${v}`) }));
vi.mock('@/lib/slack-signature', () => ({ resetSigningSecretCache: vi.fn() }));
vi.mock('@/app/(app)/settings/slack-oauth/actions', () => ({ saveSlackOAuthConfig: vi.fn() }));

import { DELETE } from '@/app/api/settings/slack-oauth/route';

const req = () =>
  new NextRequest('http://localhost/api/settings/slack-oauth', { method: 'DELETE' });

describe('Reset Slack app credentials', () => {
  beforeEach(() => vi.clearAllMocks());

  it('keeps the signing secret so inbound Slack requests keep verifying', async () => {
    db.slackOAuthConfig.findFirst.mockResolvedValue({ id: 'default' });

    await DELETE(req());

    expect(db.slackOAuthConfig.deleteMany).not.toHaveBeenCalled();
    const call = db.slackOAuthConfig.updateMany.mock.calls[0][0];
    expect(call.data).toEqual({
      clientId: 'workspace-credentials',
      clientSecret: 'enc:managed-credentials',
    });
    expect(call.data).not.toHaveProperty('signingSecret');
  });

  it('deletes the row when there is no signing secret to preserve', async () => {
    db.slackOAuthConfig.findFirst.mockResolvedValue(null);

    await DELETE(req());

    expect(db.slackOAuthConfig.deleteMany).toHaveBeenCalled();
  });
});
