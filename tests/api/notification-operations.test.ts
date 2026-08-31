import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { GET } from '@/app/api/admin/notifications/operations/route';
import { POST } from '@/app/api/admin/notifications/operations/[id]/retry/route';
import { getCurrentUser } from '@/lib/rbac';
import { getNotificationOperations } from '@/lib/notification-operations';
import { requeueCentralNotification } from '@/lib/notification-control-plane';

vi.mock('@/lib/rbac', () => ({ getCurrentUser: vi.fn() }));
vi.mock('@/lib/notification-operations', () => ({
  OPERATIONS_CHANNELS: ['EMAIL', 'SMS', 'PUSH', 'SLACK', 'WEBHOOK', 'WHATSAPP'],
  OPERATIONS_STATUSES: ['PENDING', 'SENT', 'DELIVERED', 'FAILED', 'SKIPPED'],
  OPERATIONS_CATEGORIES: ['INCIDENT', 'SECURITY', 'STATUS_PAGE', 'SLA', 'ADMINISTRATION', 'SYSTEM'],
  getNotificationOperations: vi.fn(),
}));
vi.mock('@/lib/notification-control-plane', () => ({
  requeueCentralNotification: vi.fn(),
}));
vi.mock('@/lib/audit', () => ({ emitAuditEvent: vi.fn() }));
vi.mock('@/lib/logger', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

const admin = { id: 'admin-1', role: 'ADMIN', email: 'admin@example.com', name: 'Admin' };
const auditor = { ...admin, id: 'auditor-1', role: 'AUDITOR' };
const responder = { ...admin, id: 'responder-1', role: 'RESPONDER' };

describe('notification operations authorization', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getNotificationOperations).mockResolvedValue({
      notifications: [],
      stats: { byStatus: {}, byCategory: {} },
      pagination: { limit: 50, nextCursor: null, hasMore: false },
      range: { from: new Date().toISOString(), to: null },
    });
  });

  it('allows auditors to inspect workspace delivery metadata', async () => {
    vi.mocked(getCurrentUser).mockResolvedValue(auditor as never);
    const response = await GET(
      new NextRequest('https://example.com/api/admin/notifications/operations?status=FAILED')
    );
    expect(response.status).toBe(200);
    expect(getNotificationOperations).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'FAILED' })
    );
    expect(response.headers.get('cache-control')).toBe('private, no-store');
  });

  it('denies the workspace console to ordinary responders', async () => {
    vi.mocked(getCurrentUser).mockResolvedValue(responder as never);
    const response = await GET(
      new NextRequest('https://example.com/api/admin/notifications/operations')
    );
    expect(response.status).toBe(403);
    expect(getNotificationOperations).not.toHaveBeenCalled();
  });

  it('rejects unbounded history scans beyond the 90-day operations window', async () => {
    vi.mocked(getCurrentUser).mockResolvedValue(admin as never);
    const response = await GET(
      new NextRequest(
        'https://example.com/api/admin/notifications/operations?from=2020-01-01T00:00:00.000Z'
      )
    );
    expect(response.status).toBe(400);
    expect(getNotificationOperations).not.toHaveBeenCalled();
  });

  it('keeps retry mutation administrator-only', async () => {
    vi.mocked(getCurrentUser).mockResolvedValue(auditor as never);
    const response = await POST(
      new NextRequest(
        'https://example.com/api/admin/notifications/operations/notification_abc/retry',
        {
          method: 'POST',
        }
      ),
      { params: Promise.resolve({ id: 'notification_abc' }) }
    );
    expect(response.status).toBe(403);
    expect(requeueCentralNotification).not.toHaveBeenCalled();
  });

  it('atomically requeues an eligible delivery for an administrator', async () => {
    vi.mocked(getCurrentUser).mockResolvedValue(admin as never);
    vi.mocked(requeueCentralNotification).mockResolvedValue(true);
    const response = await POST(
      new NextRequest(
        'https://example.com/api/admin/notifications/operations/notification_abc/retry',
        {
          method: 'POST',
          headers: { origin: 'https://example.com' },
        }
      ),
      { params: Promise.resolve({ id: 'notification_abc' }) }
    );
    expect(response.status).toBe(200);
    expect(requeueCentralNotification).toHaveBeenCalledWith('notification_abc');
  });
});
