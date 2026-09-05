import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { GET as initiationHandler } from '@/app/api/slack/oauth/route';
import { GET as callbackHandler } from '@/app/api/slack/oauth/callback/route';
import { NextRequest } from 'next/server';

// 1. Mock dependencies exactly like other tests
vi.mock('@/lib/prisma', () => ({
  __esModule: true,
  default: {
    systemSettings: {
      findFirst: vi.fn(),
      findUnique: vi.fn(),
    },
    slackOAuthConfig: {
      findFirst: vi.fn(),
    },
    slackIntegration: {
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    service: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
  },
}));

import prisma from '@/lib/prisma';

vi.mock('@/lib/encryption', () => ({
  encrypt: vi.fn(val => Promise.resolve(`encrypted_${val}`)),
  decrypt: vi.fn(val => Promise.resolve(val.replace('encrypted_', ''))),
}));

vi.mock('@/lib/rbac', () => ({
  assertAdmin: vi.fn().mockResolvedValue({ id: 'user-123', role: 'ADMIN' }),
  assertCanModifyService: vi.fn().mockResolvedValue({ id: 'user-123', role: 'ADMIN' }),
}));

vi.mock('@/lib/logger', () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  },
}));

// Capture env to restore later, but don't replace the whole object
const initialSlackId = process.env.SLACK_CLIENT_ID;
const initialAppUrl = process.env.NEXT_PUBLIC_APP_URL;

describe('Slack OAuth Integration', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    // Restore standard envs
    if (initialSlackId) process.env.SLACK_CLIENT_ID = initialSlackId;
    if (initialAppUrl) process.env.NEXT_PUBLIC_APP_URL = initialAppUrl;

    // Default Mocks
    vi.mocked(prisma.systemSettings.findFirst).mockResolvedValue(null);
    vi.mocked(prisma.slackOAuthConfig.findFirst).mockResolvedValue({
      id: 'default',
      clientId: 'test-client-id',
      clientSecret: 'encrypted_secret',
      signingSecret: null,
      redirectUri: null,
      enabled: true,
      createdAt: new Date(),
      updatedAt: new Date(),
      updatedBy: 'user-1',
    });

    global.fetch = vi.fn();
  });

  afterEach(() => {
    // Cleanup env changes
    if (initialSlackId) process.env.SLACK_CLIENT_ID = initialSlackId;
    else delete process.env.SLACK_CLIENT_ID;

    if (initialAppUrl) process.env.NEXT_PUBLIC_APP_URL = initialAppUrl;
    else delete process.env.NEXT_PUBLIC_APP_URL;
  });

  describe('Initiation (GET /api/slack/oauth)', () => {
    it('should redirect to Slack with correct params', async () => {
      // Ensure env var logic works (priority to DB, fallback to env)
      // Here DB has 'test-client-id'

      const req = new NextRequest('http://localhost:3000/api/slack/oauth');
      const response = await initiationHandler(req);

      expect(response.status).toBe(307);
      const redirectUrl = new URL(response.headers.get('Location') || '');

      expect(redirectUrl.hostname).toBe('slack.com');
      expect(redirectUrl.searchParams.get('client_id')).toBe('test-client-id');
    });

    it('should fail if not configured', async () => {
      // Mock DB returning null
      vi.mocked(prisma.slackOAuthConfig.findFirst).mockResolvedValue(null);
      // Ensure env is also empty
      delete process.env.SLACK_CLIENT_ID;

      const req = new NextRequest('http://localhost:3000/api/slack/oauth');
      const response = await initiationHandler(req);

      expect(response.status).toBe(400);
      const body = await response.json();
      expect(body.error).toContain('not configured with a valid Client ID');
    });

    it('should reject and redirect if Client ID is a Slack Workspace ID (starts with T)', async () => {
      vi.mocked(prisma.slackOAuthConfig.findFirst).mockResolvedValue({
        id: 'default',
        clientId: 'T0BTSM5GP8D',
        clientSecret: 'encrypted_secret',
        signingSecret: null,
        redirectUri: null,
        enabled: true,
        createdAt: new Date(),
        updatedAt: new Date(),
        updatedBy: 'user-1',
      });

      const req = new NextRequest('http://localhost:3000/api/slack/oauth', {
        headers: { accept: 'text/html' },
      });
      const response = await initiationHandler(req);

      expect(response.status).toBe(307);
      expect(response.headers.get('Location')).toContain(
        '/settings/integrations/slack?error=invalid_client_id'
      );
    });

    it('should reject with 400 if Client ID is a Slack App ID (starts with A)', async () => {
      vi.mocked(prisma.slackOAuthConfig.findFirst).mockResolvedValue({
        id: 'default',
        clientId: 'A0123456789',
        clientSecret: 'encrypted_secret',
        signingSecret: null,
        redirectUri: null,
        enabled: true,
        createdAt: new Date(),
        updatedAt: new Date(),
        updatedBy: 'user-1',
      });

      const req = new NextRequest('http://localhost:3000/api/slack/oauth', {
        headers: { accept: 'application/json' },
      });
      const response = await initiationHandler(req);

      expect(response.status).toBe(400);
      const body = await response.json();
      expect(body.error).toContain('not configured with a valid Client ID');
    });
  });

  describe('Callback (GET /api/slack/oauth/callback)', () => {
    it('should successfully exchange code', async () => {
      const state = 'valid-state';
      const code = 'valid-code';
      const req = new NextRequest(
        `http://localhost:3000/api/slack/oauth/callback?code=${code}&state=${state}`
      );
      req.cookies.set('slack_oauth_state', state);

      const mockFetch = vi.fn().mockResolvedValue({
        json: async () => ({
          ok: true,
          access_token: 'xoxb-token',
          team: { id: 'team-1', name: 'Test Team' },
          authed_user: { id: 'user-slack-id' },
          scope: 'chat:write',
        }),
      });
      global.fetch = mockFetch;

      vi.mocked(prisma.slackIntegration.findUnique).mockResolvedValue(null);
      vi.mocked(prisma.slackIntegration.create).mockResolvedValue({
        id: 'integration-1',
      } as unknown as NonNullable<Awaited<ReturnType<typeof prisma.slackIntegration.create>>>);

      const response = await callbackHandler(req);

      expect(response.status).toBe(307);
      expect(response.headers.get('Location')).toContain(
        '/settings/integrations/slack?slack_connected=true'
      );

      // Verify fetch call includes cache: 'no-store' (Critical for OAuth)
      expect(global.fetch).toHaveBeenCalledWith(
        'https://slack.com/api/oauth.v2.access',
        expect.objectContaining({
          method: 'POST',
          cache: 'no-store',
        })
      );
    });

    it('should use SystemSettings for absolute URL construction', async () => {
      // Scenario: Env var is missing, but DB has setting
      delete process.env.NEXT_PUBLIC_APP_URL;
      vi.mocked(prisma.systemSettings.findUnique).mockResolvedValue({
        id: 'default',
        appUrl: 'https://db-config-url.com',
        createdAt: new Date(),
        updatedAt: new Date(),
        encryptionKey: null,
      } as unknown as NonNullable<Awaited<ReturnType<typeof prisma.systemSettings.findUnique>>>);

      const req = new NextRequest(
        'http://localhost:3000/api/slack/oauth/callback?error=test_error'
      );
      const response = await callbackHandler(req);

      const location = response.headers.get('Location');
      expect(location).toContain('https://db-config-url.com');
    });

    it('rebinds only the selected service when reconnecting to a different workspace', async () => {
      const state = 'valid-state';
      const req = new NextRequest(
        `http://localhost:3000/api/slack/oauth/callback?code=valid-code&state=${state}`
      );
      req.cookies.set('slack_oauth_state', state);
      req.cookies.set('slack_oauth_service_id', 'service-a');
      global.fetch = vi.fn().mockResolvedValue({
        json: async () => ({
          ok: true,
          access_token: 'xoxb-new-workspace',
          team: { id: 'workspace-y', name: 'Workspace Y' },
          scope: 'chat:write',
        }),
      });
      vi.mocked(prisma.service.findUnique).mockResolvedValue({
        id: 'service-a',
        slackIntegration: { id: 'shared-workspace-x', workspaceId: 'workspace-x' },
      } as unknown as Awaited<ReturnType<typeof prisma.service.findUnique>>);
      vi.mocked(prisma.slackIntegration.findUnique).mockResolvedValue(null);
      vi.mocked(prisma.slackIntegration.create).mockResolvedValue(
        { id: 'workspace-y-row' } as unknown as Awaited<ReturnType<typeof prisma.slackIntegration.create>>
      );

      await callbackHandler(req);

      expect(prisma.slackIntegration.update).not.toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'shared-workspace-x' } })
      );
      expect(prisma.service.update).toHaveBeenCalledWith({
        where: { id: 'service-a' },
        data: { slackIntegrationId: 'workspace-y-row' },
      });
    });
  });
});
