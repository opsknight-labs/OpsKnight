import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest';
import type { NextRequest } from 'next/server';
import type { User } from '@prisma/client';
import { POST } from '@/app/api/status-page/subscribe/route';
import { GET, DELETE } from '@/app/api/status-page/subscribers/route';
import VerifyPage from '@/app/(public)/status/verify/[token]/page';
import UnsubscribePage from '@/app/(public)/status/unsubscribe/[token]/page';
import { notifyStatusPageSubscribers } from '@/lib/status-page-notifications';
import { hashSubscriptionToken } from '@/lib/status-pages/subscription-tokens';
import {
  testPrisma,
  resetDatabase,
  createTestStatusPage,
  createTestService,
  linkServiceToStatusPage,
  createTestIncident,
  createTestStatusPageSubscription,
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

vi.mock('@/lib/email', () => ({
  sendEmail: vi.fn().mockResolvedValue({ success: true }),
}));

vi.mock('@/lib/notification-providers', async importOriginal => {
  const actual = await importOriginal<typeof import('@/lib/notification-providers')>();
  return {
    ...actual,
    getStatusPageEmailConfig: vi.fn().mockResolvedValue({ enabled: true, provider: 'resend' }),
  };
});

import { getServerSession } from 'next-auth';
import { sendEmail } from '@/lib/email';
import {
  createCentralNotificationIntent,
  processCentralNotificationQueue,
} from '@/lib/notification-control-plane';
import { ingestNotificationProviderFeedback } from '@/lib/notification-provider-feedback';

describeIfRealDB('Status Page Subscription Integration', () => {
  beforeAll(() => {
    process.env.VITEST_USE_REAL_DB = '1';
  });

  beforeEach(async () => {
    process.env.ENCRYPTION_KEY = '0123456789abcdef'.repeat(4);
    vi.clearAllMocks();
    await resetDatabase();
  });

  describe('Public Subscription Flow (POST /api/status-page/subscribe)', () => {
    it('should create a new unverified subscription', async () => {
      const sp = await createTestStatusPage();

      const req = new Request('http://localhost/api/status-page/subscribe', {
        method: 'POST',
        body: JSON.stringify({ statusPageId: sp.id, email: 'user@example.com' }),
      });

      const res = await POST(req as NextRequest);
      await processCentralNotificationQueue();
      expect(res.status).toBe(200);

      const sub = await testPrisma.statusPageSubscription.findFirst({
        where: { email: 'user@example.com' },
      });
      expect(sub).toBeDefined();
      expect(sub?.verified).toBe(false);
      expect(sub?.verificationToken).not.toBeNull();
      expect(
        await testPrisma.notification.findFirst({
          where: { templateKey: 'status-page-verification', recipientId: sub?.id },
        })
      ).toBeDefined();
    });

    it('should resubscribe an unsubscribed user', async () => {
      const sp = await createTestStatusPage();
      const sub = await createTestStatusPageSubscription(sp.id, 'user@example.com', {
        unsubscribedAt: new Date(),
        verified: true,
        state: 'UNSUBSCRIBED',
      });

      const req = new Request('http://localhost/api/status-page/subscribe', {
        method: 'POST',
        body: JSON.stringify({ statusPageId: sp.id, email: 'user@example.com' }),
      });

      const res = await POST(req as NextRequest);
      expect(res.status).toBe(200);

      const updatedSub = await testPrisma.statusPageSubscription.findUnique({
        where: { id: sub.id },
      });
      expect(updatedSub?.unsubscribedAt).toBeNull();
      expect(updatedSub?.verified).toBe(false);
      expect(updatedSub?.state).toBe('PENDING');
      expect(updatedSub?.suppressionReason).toBeNull();
    });

    it.each(['COMPLAINED', 'SUPPRESSED', 'BOUNCED'] as const)(
      'does not automatically reactivate a %s subscriber',
      async state => {
        const sp = await createTestStatusPage();
        const unsubscribedAt = new Date('2026-09-09T09:00:00.000Z');
        const sub = await createTestStatusPageSubscription(sp.id, 'blocked@example.com', {
          state,
          unsubscribedAt,
          suppressionReason: `provider:${state.toLowerCase()}`,
          verified: false,
        });

        const res = await POST(
          new Request('http://localhost/api/status-page/subscribe', {
            method: 'POST',
            body: JSON.stringify({ statusPageId: sp.id, email: 'blocked@example.com' }),
          }) as NextRequest
        );

        expect(res.status).toBe(200);
        expect(
          await testPrisma.statusPageSubscription.findUnique({ where: { id: sub.id } })
        ).toMatchObject({
          state,
          unsubscribedAt,
          suppressionReason: `provider:${state.toLowerCase()}`,
          verified: false,
        });
        expect(
          await testPrisma.notification.count({
            where: { recipientType: 'SUBSCRIBER', recipientId: sub.id },
          })
        ).toBe(0);
      }
    );

    it('preserves a delayed complaint received after unsubscribe', async () => {
      const sp = await createTestStatusPage();
      const unsubscribedAt = new Date('2026-09-09T09:00:00.000Z');
      const sub = await createTestStatusPageSubscription(sp.id, 'complaint@example.com', {
        state: 'UNSUBSCRIBED',
        unsubscribedAt,
        verified: false,
      });
      const notification = await createCentralNotificationIntent({
        category: 'STATUS_PAGE',
        channel: 'EMAIL',
        recipientType: 'SUBSCRIBER',
        recipientId: sub.id,
        recipientAddress: 'complaint@example.com',
        templateKey: 'status-page-update',
        sourceType: 'STATUS_PAGE',
        sourceId: sp.id,
        eventKey: 'delayed-complaint',
        displayMessage: 'Status page update',
        payload: {
          kind: 'EMAIL',
          to: 'complaint@example.com',
          subject: 'Status page update',
          html: '<p>Status page update</p>',
        },
      });
      await testPrisma.notification.update({
        where: { id: notification.id },
        data: {
          providerMessageId: 'provider-message-delayed-complaint',
          deliveryProvider: 'test-provider',
        },
      });
      const complainedAt = new Date('2026-09-09T09:05:00.000Z');

      await ingestNotificationProviderFeedback({
        provider: 'test-provider',
        providerEventId: 'delayed-complaint-event',
        providerMessageId: 'provider-message-delayed-complaint',
        type: 'COMPLAINT',
        occurredAt: complainedAt,
      });
      const res = await POST(
        new Request('http://localhost/api/status-page/subscribe', {
          method: 'POST',
          body: JSON.stringify({ statusPageId: sp.id, email: 'complaint@example.com' }),
        }) as NextRequest
      );

      expect(res.status).toBe(200);
      expect(
        await testPrisma.statusPageSubscription.findUnique({ where: { id: sub.id } })
      ).toMatchObject({
        state: 'COMPLAINED',
        unsubscribedAt,
        suppressionReason: 'COMPLAINT',
        complainedAt,
        verified: false,
      });
      expect(
        await testPrisma.notification.count({
          where: {
            recipientType: 'SUBSCRIBER',
            recipientId: sub.id,
            templateKey: 'status-page-verification',
          },
        })
      ).toBe(0);
    });

    it('keeps an active subscriber active without queueing verification', async () => {
      const sp = await createTestStatusPage();
      const sub = await createTestStatusPageSubscription(sp.id, 'active@example.com', {
        state: 'ACTIVE',
        verified: true,
      });

      const res = await POST(
        new Request('http://localhost/api/status-page/subscribe', {
          method: 'POST',
          body: JSON.stringify({ statusPageId: sp.id, email: 'active@example.com' }),
        }) as NextRequest
      );

      expect(res.status).toBe(200);
      expect(
        await testPrisma.statusPageSubscription.findUnique({ where: { id: sub.id } })
      ).toMatchObject({
        state: 'ACTIVE',
        verified: true,
      });
      expect(await testPrisma.notification.count({ where: { recipientId: sub.id } })).toBe(0);
    });

    it('does not resend verification for a recently created pending subscriber', async () => {
      const sp = await createTestStatusPage();
      const sub = await createTestStatusPageSubscription(sp.id, 'recent@example.com', {
        state: 'PENDING',
        verified: false,
        subscribedAt: new Date(),
      });

      const res = await POST(
        new Request('http://localhost/api/status-page/subscribe', {
          method: 'POST',
          body: JSON.stringify({ statusPageId: sp.id, email: 'recent@example.com' }),
        }) as NextRequest
      );

      expect(res.status).toBe(200);
      expect(await testPrisma.notification.count({ where: { recipientId: sub.id } })).toBe(0);
    });

    it('refreshes verification for an expired pending subscriber', async () => {
      const sp = await createTestStatusPage();
      const oldVerificationToken = hashSubscriptionToken('old-verification-token');
      const sub = await createTestStatusPageSubscription(sp.id, 'pending@example.com', {
        state: 'PENDING',
        verified: false,
        subscribedAt: new Date(Date.now() - 61_000),
        verificationToken: oldVerificationToken,
      });

      const res = await POST(
        new Request('http://localhost/api/status-page/subscribe', {
          method: 'POST',
          body: JSON.stringify({ statusPageId: sp.id, email: 'pending@example.com' }),
        }) as NextRequest
      );

      expect(res.status).toBe(200);
      const updatedSub = await testPrisma.statusPageSubscription.findUnique({
        where: { id: sub.id },
      });
      expect(updatedSub).toMatchObject({ state: 'PENDING', verified: false });
      expect(updatedSub?.verificationToken).not.toBe(oldVerificationToken);
      expect(
        await testPrisma.notification.count({
          where: {
            recipientType: 'SUBSCRIBER',
            recipientId: sub.id,
            templateKey: 'status-page-verification',
          },
        })
      ).toBe(1);
    });
  });

  describe('Verification Flow', () => {
    it('does not verify a subscription when an email scanner opens its link', async () => {
      const sp = await createTestStatusPage();
      const sub = await createTestStatusPageSubscription(sp.id, 'user@example.com', {
        verified: false,
        verificationToken: hashSubscriptionToken('valid-token'),
      });

      // Call the Server Component function directly
      await VerifyPage({ params: Promise.resolve({ token: 'valid-token' }) });

      const updatedSub = await testPrisma.statusPageSubscription.findUnique({
        where: { id: sub.id },
      });
      expect(updatedSub?.verified).toBe(false);
      expect(updatedSub?.verificationToken).toBe(hashSubscriptionToken('valid-token'));
    });
  });

  describe('Unsubscribe Flow', () => {
    it('should require confirmation without mutating on GET', async () => {
      const sp = await createTestStatusPage();
      const sub = await createTestStatusPageSubscription(sp.id, 'user@example.com', {
        token: hashSubscriptionToken('unsubscribe-token'),
      });

      await UnsubscribePage({ params: Promise.resolve({ token: 'unsubscribe-token' }) });

      const updatedSub = await testPrisma.statusPageSubscription.findUnique({
        where: { id: sub.id },
      });
      expect(updatedSub?.unsubscribedAt).toBeNull();
    });

    it('shows success after a confirmed unsubscribe', async () => {
      const sp = await createTestStatusPage();
      await createTestStatusPageSubscription(sp.id, 'user@example.com', {
        token: hashSubscriptionToken('unsubscribe-token'),
        unsubscribedAt: new Date(),
      });

      const rendered = await UnsubscribePage({
        params: Promise.resolve({ token: 'unsubscribe-token' }),
        searchParams: Promise.resolve({ done: '1' }),
      });

      const successCard = rendered.props.children;
      const successHeading = successCard.props.children[1];
      expect(successHeading.props.children).toBe('Successfully Unsubscribed');
    });
  });

  describe('Admin Subscriber Management', () => {
    let adminUser: User;

    beforeEach(async () => {
      adminUser = await createTestUser({ email: 'admin@example.com', role: 'ADMIN' });
      vi.mocked(getServerSession).mockResolvedValue({
        user: { email: adminUser.email, role: 'ADMIN' },
      });
    });

    it('should list verified subscribers (Admin Only)', async () => {
      const sp = await createTestStatusPage();
      await createTestStatusPageSubscription(sp.id, 'user1@example.com', { verified: true });
      await createTestStatusPageSubscription(sp.id, 'user2@example.com', { verified: false });

      const req = {
        nextUrl: {
          searchParams: new URLSearchParams({ statusPageId: sp.id, verified: 'true' }),
        },
      };

      const res = await GET(req as NextRequest);
      const data = await res.json();

      expect(res.status).toBe(200);
      expect(data.subscribers).toHaveLength(1);
      expect(data.subscribers[0].email).toBe('user1@example.com');
    });

    it('should mark subscriber as unsubscribed', async () => {
      const sp = await createTestStatusPage();
      const sub = await createTestStatusPageSubscription(sp.id, 'user@example.com');

      const req = {
        nextUrl: {
          searchParams: new URLSearchParams({ id: sub.id, statusPageId: sp.id }),
        },
      };

      const res = await DELETE(req as NextRequest);
      expect(res.status).toBe(200);

      const updatedSub = await testPrisma.statusPageSubscription.findUnique({
        where: { id: sub.id },
      });
      expect(updatedSub?.unsubscribedAt).not.toBeNull();
    });
  });

  describe('Incident Notifications', () => {
    it('queues verified subscriber email without delivering from the producer', async () => {
      const service = await createTestService('Data API');
      const sp = await createTestStatusPage();
      await linkServiceToStatusPage(sp.id, service.id);
      await createTestStatusPageSubscription(sp.id, 'verified@example.com', { verified: true });
      await createTestStatusPageSubscription(sp.id, 'unverified@example.com', { verified: false });

      const incident = await createTestIncident('API Outage', service.id);

      await notifyStatusPageSubscribers(incident.id, 'triggered');

      expect(sendEmail).not.toHaveBeenCalled();
      const intents = await testPrisma.notification.findMany({
        where: { incidentId: incident.id, category: 'STATUS_PAGE' },
      });
      expect(intents).toHaveLength(1);
      expect(intents[0]).toMatchObject({
        status: 'PENDING',
        priority: 4,
        trafficClass: 'PUBLIC_INCIDENT',
        attempts: 0,
      });
      expect(intents[0].payloadEncrypted).toBeTruthy();
    });
  });
});
