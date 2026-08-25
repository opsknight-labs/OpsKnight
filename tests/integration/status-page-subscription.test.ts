import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest';
import { POST } from '@/app/api/status-page/subscribe/route';
import { GET, DELETE } from '@/app/api/status-page/subscribers/route';
import VerifyPage from '@/app/(public)/status/verify/[token]/page';
import UnsubscribePage from '@/app/(public)/status/unsubscribe/[token]/page';
import { notifyStatusPageSubscribers } from '@/lib/status-page-notifications';
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
  const actual = (await importOriginal()) as any;
  return {
    ...actual,
    getStatusPageEmailConfig: vi.fn().mockResolvedValue({ enabled: true, provider: 'resend' }),
  };
});

import { getServerSession } from 'next-auth';
import { sendEmail } from '@/lib/email';

describeIfRealDB('Status Page Subscription Integration', () => {
  beforeAll(() => {
    process.env.VITEST_USE_REAL_DB = '1';
  });

  beforeEach(async () => {
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

      const res = await POST(req as any);
      expect(res.status).toBe(200);

      const sub = await testPrisma.statusPageSubscription.findFirst({
        where: { email: 'user@example.com' },
      });
      expect(sub).toBeDefined();
      expect(sub?.verified).toBe(false);
      expect(sub?.verificationToken).not.toBeNull();
      expect(sendEmail).toHaveBeenCalled();
    });

    it('should resubscribe an unsubscribed user', async () => {
      const sp = await createTestStatusPage();
      const sub = await createTestStatusPageSubscription(sp.id, 'user@example.com', {
        unsubscribedAt: new Date(),
        verified: true,
      });

      const req = new Request('http://localhost/api/status-page/subscribe', {
        method: 'POST',
        body: JSON.stringify({ statusPageId: sp.id, email: 'user@example.com' }),
      });

      const res = await POST(req as any);
      expect(res.status).toBe(200);

      const updatedSub = await testPrisma.statusPageSubscription.findUnique({
        where: { id: sub.id },
      });
      expect(updatedSub?.unsubscribedAt).toBeNull();
      expect(updatedSub?.verified).toBe(false);
    });
  });

  describe('Verification Flow', () => {
    it('should verify subscription with valid token', async () => {
      const sp = await createTestStatusPage();
      const sub = await createTestStatusPageSubscription(sp.id, 'user@example.com', {
        verified: false,
        verificationToken: 'valid-token',
      });

      // Call the Server Component function directly
      await VerifyPage({ params: Promise.resolve({ token: 'valid-token' }) });

      const updatedSub = await testPrisma.statusPageSubscription.findUnique({
        where: { id: sub.id },
      });
      expect(updatedSub?.verified).toBe(true);
      expect(updatedSub?.verificationToken).toBeNull();
    });
  });

  describe('Unsubscribe Flow', () => {
    it('should require confirmation without mutating on GET', async () => {
      const sp = await createTestStatusPage();
      const sub = await createTestStatusPageSubscription(sp.id, 'user@example.com', {
        token: 'unsubscribe-token',
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
        token: 'unsubscribe-token',
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
    let adminUser: any;

    beforeEach(async () => {
      adminUser = await createTestUser({ email: 'admin@example.com', role: 'ADMIN' });
      (getServerSession as any).mockResolvedValue({
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

      const res = await GET(req as any);
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
          searchParams: new URLSearchParams({ id: sub.id }),
        },
      };

      const res = await DELETE(req as any);
      expect(res.status).toBe(200);

      const updatedSub = await testPrisma.statusPageSubscription.findUnique({
        where: { id: sub.id },
      });
      expect(updatedSub?.unsubscribedAt).not.toBeNull();
    });
  });

  describe('Incident Notifications', () => {
    it('should send email to verified subscribers when incident occurs', async () => {
      const service = await createTestService('Data API');
      const sp = await createTestStatusPage();
      await linkServiceToStatusPage(sp.id, service.id);
      await createTestStatusPageSubscription(sp.id, 'verified@example.com', { verified: true });
      await createTestStatusPageSubscription(sp.id, 'unverified@example.com', { verified: false });

      const incident = await createTestIncident('API Outage', service.id);

      await notifyStatusPageSubscribers(incident.id, 'triggered');

      expect(sendEmail).toHaveBeenCalledTimes(1);
      expect(sendEmail).toHaveBeenCalledWith(
        expect.objectContaining({ to: 'verified@example.com' }),
        expect.anything()
      );
    });
  });
});
