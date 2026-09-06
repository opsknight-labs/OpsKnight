import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest';
import { POST, GET, PATCH, DELETE } from '@/app/api/status-page/webhooks/route';
import { triggerStatusPageWebhooks, verifyWebhookSignature } from '@/lib/status-page-webhooks';
import {
  testPrisma,
  resetDatabase,
  createTestStatusPage,
  createTestStatusPageWebhook,
  createTestUser,
} from '../helpers/test-db';

const describeIfRealDB =
  process.env.VITEST_USE_REAL_DB === '1' || process.env.CI ? describe : describe.skip;

// Mock dependencies
vi.mock('next-auth', () => ({
  getServerSession: vi.fn(),
}));

vi.mock('@/lib/auth', () => ({
  getAuthOptions: vi.fn(),
}));

vi.mock('@/lib/network-security', () => ({
  assertSafeOutboundUrl: vi.fn(async (value: string) => new URL(value)),
  validateWebhookUrl: vi.fn().mockResolvedValue(true),
  safeOutboundFetch: vi.fn((value: string, init: RequestInit) => global.fetch(value, init)),
}));

// Mock logger to avoid side-effects (like fetch calls to /api/logs/ingest)
vi.mock('@/lib/logger', () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
    child: vi.fn().mockReturnThis(),
  },
}));

// Mock fetch for webhook delivery
global.fetch = vi.fn().mockResolvedValue({
  ok: true,
  status: 200,
});

import { getServerSession } from 'next-auth';

describeIfRealDB('Status Page Webhooks Integration', () => {
  beforeAll(() => {
    process.env.VITEST_USE_REAL_DB = '1';
    process.env.ENCRYPTION_KEY = '2f8a9c4e6b1d3f50718293a4b5c6d7e8f90123456789abcdef0123456789abcd';
  });

  beforeEach(async () => {
    vi.clearAllMocks();
    await resetDatabase();
  });

  describe('Webhook Management (Admin API)', () => {
    let adminUser: any;

    beforeEach(async () => {
      adminUser = await createTestUser({ email: 'admin@webhook.com', role: 'ADMIN' });
      (getServerSession as any).mockResolvedValue({
        user: { email: adminUser.email, role: 'ADMIN' },
      });
    });

    it('should create a new webhook with secret', async () => {
      const sp = await createTestStatusPage();

      const req = new Request('http://localhost/api/status-page/webhooks', {
        method: 'POST',
        body: JSON.stringify({
          statusPageId: sp.id,
          url: 'https://example.com/webhook',
          events: ['incident.created'],
        }),
      });

      const res = await POST(req as any);
      const data = await res.json();

      expect(res.status).toBe(201);
      expect(data.webhook.secret).toBeDefined();
      expect(data.webhook.url).toBe('https://example.com/webhook');

      const dbWebhook = await testPrisma.statusPageWebhook.findUnique({
        where: { id: data.webhook.id },
      });
      expect(dbWebhook).toBeDefined();
    });

    it('should list webhooks for a status page', async () => {
      const sp = await createTestStatusPage();
      await createTestStatusPageWebhook(sp.id, 'https://hook1.com');
      await createTestStatusPageWebhook(sp.id, 'https://hook2.com');

      const req = {
        url: `http://localhost/api/status-page/webhooks?statusPageId=${sp.id}`,
        nextUrl: {
          searchParams: new URLSearchParams({ statusPageId: sp.id }),
        },
      };

      const res = await GET(req as any);
      const data = await res.json();

      expect(res.status).toBe(200);
      expect(data.webhooks).toHaveLength(2);
    });

    it('should update a webhook', async () => {
      const sp = await createTestStatusPage();
      const webhook = await createTestStatusPageWebhook(sp.id, 'https://old.com');

      const req = new Request('http://localhost/api/status-page/webhooks', {
        method: 'PATCH',
        body: JSON.stringify({
          id: webhook.id,
          url: 'https://new.com',
          enabled: false,
        }),
      });

      const res = await PATCH(req as any);
      expect(res.status).toBe(200);

      const updated = await testPrisma.statusPageWebhook.findUnique({ where: { id: webhook.id } });
      expect(updated?.url).toBe('https://new.com');
      expect(updated?.enabled).toBe(false);
    });

    it('should delete a webhook', async () => {
      const sp = await createTestStatusPage();
      const webhook = await createTestStatusPageWebhook(sp.id, 'https://delete-me.com');

      const req = new Request(`http://localhost/api/status-page/webhooks?id=${webhook.id}`, {
        method: 'DELETE',
      });
      // Also mock nextUrl as some routes might use it
      (req as any).nextUrl = {
        searchParams: new URLSearchParams({ id: webhook.id }),
      };

      const res = await DELETE(req as any);
      expect(res.status).toBe(200);

      const dbWebhook = await testPrisma.statusPageWebhook.findUnique({
        where: { id: webhook.id },
      });
      expect(dbWebhook).toBeNull();
    });
  });

  describe('Webhook Delivery', () => {
    it('should deliver webhook and verify signature', async () => {
      const sp = await createTestStatusPage();
      const secret = 'test-signing-secret';
      const webhook = await createTestStatusPageWebhook(sp.id, 'https://receiver.com/callback', {
        secret,
        events: ['incident.created'],
      });

      const payloadData = { id: 'inc-123', title: 'Critical System Failure' };
      await triggerStatusPageWebhooks(sp.id, 'incident.created', payloadData);

      expect(global.fetch).toHaveBeenCalled();
      const [url, options]: any = (global.fetch as any).mock.calls[0];

      expect(url).toBe('https://receiver.com/callback');
      expect(options.method).toBe('POST');
      expect(options.headers['X-Webhook-Event']).toBe('incident.created');

      // Verify signature using the actual library function
      const signature = options.headers['X-Webhook-Signature'];
      const timestamp = options.headers['X-Webhook-Timestamp'];
      const isValid = verifyWebhookSignature(options.body, signature, secret, timestamp);
      expect(isValid).toBe(true);

      // Verify lastTriggeredAt update
      const updatedWebhook = await testPrisma.statusPageWebhook.findUnique({
        where: { id: webhook.id },
      });
      expect(updatedWebhook?.lastTriggeredAt).not.toBeNull();
    });

    it('should only deliver to webhooks subscribed to the specific event', async () => {
      const sp = await createTestStatusPage();
      await createTestStatusPageWebhook(sp.id, 'https://hook1.com', {
        events: ['incident.created'],
      });
      await createTestStatusPageWebhook(sp.id, 'https://hook2.com', {
        events: ['incident.resolved'],
      });

      await triggerStatusPageWebhooks(sp.id, 'incident.created', { foo: 'bar' });

      expect(global.fetch).toHaveBeenCalledTimes(1);
      const [url]: any = (global.fetch as any).mock.calls[0];
      expect(url).toBe('https://hook1.com');
    });
  });
});
