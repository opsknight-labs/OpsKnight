import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createCentralNotificationIntent,
  deliverCentralNotification,
  getNextCentralNotificationAt,
  maskedNotificationRecipient,
  processCentralNotificationQueue,
} from '@/lib/notification-control-plane';
import prisma from '@/lib/prisma';
import { CircuitBreakerError } from '@/lib/circuit-breaker';
import { acquireProviderAdmission, acquireProviderConcurrency } from '@/lib/provider-admission';

const mocks = vi.hoisted(() => ({
  sendEmail: vi.fn(),
  sendIncidentEmail: vi.fn(),
  sendSlackMessageToChannel: vi.fn(),
  encrypt: vi.fn(async (value: string) => `encrypted:${value}`),
  decrypt: vi.fn(async (value: string) => value.replace(/^encrypted:/, '')),
}));

vi.mock('@/lib/prisma', () => ({
  default: {
    notification: {
      create: vi.fn(),
      findFirst: vi.fn(),
      findMany: vi.fn(),
      findUnique: vi.fn(),
      updateMany: vi.fn(),
    },
    incident: { findUnique: vi.fn() },
    service: { findUnique: vi.fn() },
    notificationDeliveryAttempt: { create: vi.fn(), count: vi.fn() },
    $queryRaw: vi.fn(),
    $transaction: vi.fn(async (operation: unknown) =>
      Array.isArray(operation)
        ? Promise.all(operation)
        : (operation as (tx: unknown) => unknown)({
            notification: { updateMany: vi.fn() },
            notificationDeliveryAttempt: { create: vi.fn() },
          })
    ),
  },
}));
vi.mock('@/lib/encryption', () => ({
  encrypt: mocks.encrypt,
  decrypt: mocks.decrypt,
  getEncryptionKey: vi.fn(() => '11'.repeat(32)),
}));
vi.mock('@/lib/email', () => ({
  sendEmail: mocks.sendEmail,
  sendIncidentEmail: mocks.sendIncidentEmail,
}));
vi.mock('@/lib/slack', () => ({
  sendSlackMessageToChannel: mocks.sendSlackMessageToChannel,
  sendSlackNotification: vi.fn(),
}));
vi.mock('@/lib/provider-admission', () => ({
  acquireProviderAdmission: vi.fn().mockResolvedValue({ allowed: true }),
  acquireProviderConcurrency: vi.fn().mockResolvedValue({ allowed: true, leaseKey: 'lease-1' }),
  releaseProviderConcurrency: vi.fn().mockResolvedValue(undefined),
  deferProviderAdmission: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('@/lib/circuit-breaker', () => ({
  CircuitBreakerError: class CircuitBreakerError extends Error {},
  CircuitBreakerTimeoutError: class CircuitBreakerTimeoutError extends Error {},
  CircuitBreakers: {
    email: () => ({ execute: (operation: () => unknown) => operation() }),
    sms: () => ({ execute: (operation: () => unknown) => operation() }),
    whatsapp: () => ({ execute: (operation: () => unknown) => operation() }),
    push: () => ({ execute: (operation: () => unknown) => operation() }),
    slack: () => ({ execute: (operation: () => unknown) => operation() }),
    webhook: () => ({ execute: (operation: () => unknown) => operation() }),
  },
}));
vi.mock('@/lib/logger', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

const input = {
  category: 'SECURITY' as const,
  channel: 'EMAIL' as const,
  recipientType: 'EMAIL' as const,
  recipientAddress: 'Person@Example.com',
  templateKey: 'password-reset',
  sourceType: 'USER',
  sourceId: 'user-1',
  eventKey: 'reset-request-1',
  displayMessage: 'Password reset',
  payload: {
    kind: 'EMAIL' as const,
    to: 'Person@Example.com',
    subject: 'Reset password',
    html: '<p>Reset</p>',
  },
};

describe('central notification control plane', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(acquireProviderAdmission).mockResolvedValue({ allowed: true });
    vi.mocked(acquireProviderConcurrency).mockResolvedValue({
      allowed: true,
      leaseKey: 'lease-1',
    });
    vi.mocked(prisma.notification.findFirst).mockResolvedValue(null);
    vi.mocked(prisma.notification.findMany).mockResolvedValue([]);
    vi.mocked(prisma.notificationDeliveryAttempt.count).mockResolvedValue(0);
    vi.mocked(prisma.$queryRaw).mockResolvedValue([]);
  });

  it('stores only encrypted payloads and masked recipients', async () => {
    vi.mocked(prisma.notification.create).mockResolvedValue({ id: 'notification_one' } as never);

    const result = await createCentralNotificationIntent(input);

    expect(result.created).toBe(true);
    expect(mocks.encrypt).toHaveBeenCalledWith(JSON.stringify(input.payload));
    expect(prisma.notification.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          recipientDisplay: 'p***@example.com',
          payloadEncrypted: expect.stringMatching(/^encrypted:/),
          deliveryKey: expect.stringMatching(/^[a-f0-9]{64}$/),
        }),
      })
    );
  });

  it('rejects an empty recipient before persisting a delivery intent', async () => {
    await expect(
      createCentralNotificationIntent({ ...input, recipientAddress: '   ' })
    ).rejects.toThrow('Notification recipient is required');
    expect(prisma.notification.create).not.toHaveBeenCalled();
  });

  it('derives recipient identity from the existing session secret, not a new setting', async () => {
    const previousSessionSecret = process.env.NEXTAUTH_SECRET;
    const previousIdentitySecret = process.env.NOTIFICATION_IDENTITY_KEY;
    process.env.NEXTAUTH_SECRET = 'existing-session-secret';
    process.env.NOTIFICATION_IDENTITY_KEY = 'ignored-legacy-setting';
    vi.mocked(prisma.notification.create).mockResolvedValue({ id: 'notification_one' } as never);

    try {
      await createCentralNotificationIntent(input);
      const firstHash = vi.mocked(prisma.notification.create).mock.calls[0]?.[0]?.data
        .recipientHash as string;
      vi.clearAllMocks();
      vi.mocked(prisma.notification.create).mockResolvedValue({ id: 'notification_two' } as never);

      await createCentralNotificationIntent({ ...input, eventKey: 'reset-request-2' });
      const secondHash = vi.mocked(prisma.notification.create).mock.calls[0]?.[0]?.data
        .recipientHash as string;

      expect(firstHash).toMatch(/^[a-f0-9]{64}$/);
      expect(secondHash).toBe(firstHash);
    } finally {
      if (previousSessionSecret === undefined) delete process.env.NEXTAUTH_SECRET;
      else process.env.NEXTAUTH_SECRET = previousSessionSecret;
      if (previousIdentitySecret === undefined) delete process.env.NOTIFICATION_IDENTITY_KEY;
      else process.env.NOTIFICATION_IDENTITY_KEY = previousIdentitySecret;
    }
  });

  it('returns the durable existing intent when concurrent creation loses the unique race', async () => {
    vi.mocked(prisma.notification.create).mockRejectedValue({ code: 'P2002' });
    vi.mocked(prisma.notification.findUnique).mockResolvedValue({
      id: 'notification_existing',
    } as never);

    await expect(createCentralNotificationIntent(input)).resolves.toEqual({
      id: 'notification_existing',
      created: false,
    });
  });

  it('uses one atomic claim when two workers race for the same delivery', async () => {
    const due = new Date(Date.now() - 60_000);
    vi.mocked(prisma.notification.findUnique).mockResolvedValue({
      id: 'notification_race',
      status: 'PENDING',
      category: 'SECURITY',
      attempts: 0,
      maxAttempts: 5,
      nextAttemptAt: due,
      scheduledAt: due,
      lastAttemptAt: null,
      expiresAt: null,
      payloadEncrypted: `encrypted:${JSON.stringify(input.payload)}`,
    } as never);
    let claimed = false;
    vi.mocked(prisma.notification.updateMany).mockImplementation((async (
      args: Parameters<typeof prisma.notification.updateMany>[0]
    ) => {
      const data = args.data as Record<string, unknown>;
      if ('lastAttemptAt' in data && !('attempts' in data)) {
        if (claimed) return { count: 0 };
        claimed = true;
      }
      return { count: 1 };
    }) as never);
    vi.mocked(prisma.notificationDeliveryAttempt.create).mockResolvedValue({} as never);
    mocks.sendEmail.mockResolvedValue({ success: true, providerMessageId: 'provider-1' });

    const results = await Promise.all([
      deliverCentralNotification('notification_race'),
      deliverCentralNotification('notification_race'),
    ]);

    expect(results.filter(result => result.claimed)).toHaveLength(1);
    expect(mocks.sendEmail).toHaveBeenCalledTimes(1);
    expect(prisma.notification.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'SENT', payloadEncrypted: null }),
      })
    );
  });

  it('does not let a later escalation step skip a sibling triggered channel', async () => {
    const due = new Date(Date.now() - 60_000);
    const payload = {
      kind: 'INCIDENT_EMAIL' as const,
      userId: 'user-1',
      incidentId: 'incident-1',
      eventType: 'triggered' as const,
      eventAt: '2026-08-30T12:00:00.000Z',
      escalationGeneration: 4,
      escalationStep: 0,
      durableMessage: 'encrypted message snapshot',
    };
    vi.mocked(prisma.notification.findUnique).mockResolvedValue({
      id: 'notification_sibling_channel',
      status: 'PENDING',
      category: 'INCIDENT',
      attempts: 0,
      maxAttempts: 5,
      nextAttemptAt: due,
      scheduledAt: due,
      lastAttemptAt: null,
      expiresAt: null,
      payloadEncrypted: `encrypted:${JSON.stringify(payload)}`,
    } as never);
    vi.mocked(prisma.incident.findUnique).mockResolvedValue({
      status: 'OPEN',
      updatedAt: new Date('2026-08-30T12:01:00.000Z'),
      acknowledgedAt: null,
      resolvedAt: null,
      currentEscalationStep: 1,
      escalationGeneration: 4,
    } as never);
    vi.mocked(prisma.notification.updateMany).mockResolvedValue({ count: 1 } as never);
    mocks.sendIncidentEmail.mockResolvedValue({ success: true, providerMessageId: 'email-1' });

    await expect(deliverCentralNotification('notification_sibling_channel')).resolves.toEqual({
      success: true,
      claimed: true,
    });
    expect(mocks.sendIncidentEmail).toHaveBeenCalledTimes(1);
  });

  it('skips a queued service Slack intent after the service checkbox is disabled', async () => {
    const due = new Date(Date.now() - 60_000);
    const payload = {
      kind: 'SLACK_CHANNEL' as const,
      channel: 'opsknight-alert',
      incident: {
        id: 'incident-1',
        title: 'Workflow failed',
        status: 'RESOLVED',
        urgency: 'HIGH',
        serviceName: 'CI',
      },
      eventType: 'resolved' as const,
      serviceId: 'service-1',
    };
    vi.mocked(prisma.notification.findUnique).mockResolvedValue({
      id: 'notification-disabled-slack',
      status: 'PENDING',
      category: 'INCIDENT',
      attempts: 0,
      maxAttempts: 3,
      nextAttemptAt: due,
      scheduledAt: due,
      lastAttemptAt: null,
      expiresAt: null,
      payloadEncrypted: `encrypted:${JSON.stringify(payload)}`,
      sourceType: 'SERVICE_INCIDENT',
      sourceId: 'service-1:incident-1',
      recipientId: 'service-1',
      templateKey: 'service-slack-resolved',
    } as never);
    vi.mocked(prisma.notification.updateMany).mockResolvedValue({ count: 1 } as never);
    vi.mocked(prisma.service.findUnique).mockResolvedValue({
      serviceNotificationChannels: [],
      slackChannel: 'opsknight-alert',
      slackWebhookUrl: null,
    } as never);

    await expect(deliverCentralNotification('notification-disabled-slack')).resolves.toEqual({
      success: true,
      claimed: true,
    });
    expect(mocks.sendSlackMessageToChannel).not.toHaveBeenCalled();
    expect(prisma.notification.updateMany).toHaveBeenLastCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: 'SKIPPED',
          errorMsg: 'Service Slack notifications were disabled',
        }),
      })
    );
  });

  it('uses lease expiry as the next scheduler deadline for active claims', async () => {
    const leaseExpiry = new Date(Date.now() + 9 * 60_000);
    vi.mocked(prisma.$queryRaw).mockResolvedValue([{ nextEligibleAt: leaseExpiry }] as never);

    await expect(getNextCentralNotificationAt()).resolves.toEqual(leaseExpiry);
    const query = vi.mocked(prisma.$queryRaw).mock.calls[0]?.[0] as { strings?: string[] };
    const sql = query.strings?.join('?') ?? '';
    expect(sql).toContain('lastAttemptAt');
    expect(sql).toContain('nextEligibleAt');
  });

  it('keeps admission deferrals pending without consuming delivery attempts', async () => {
    const due = new Date(Date.now() - 60_000);
    vi.mocked(prisma.notification.findUnique).mockResolvedValue({
      id: 'notification_deferred',
      status: 'PENDING',
      category: 'SECURITY',
      attempts: 0,
      maxAttempts: 5,
      nextAttemptAt: due,
      scheduledAt: due,
      lastAttemptAt: null,
      expiresAt: null,
      payloadEncrypted: `encrypted:${JSON.stringify(input.payload)}`,
    } as never);
    const retryAt = new Date(Date.now() + 30_000);
    vi.mocked(acquireProviderAdmission).mockResolvedValue({
      allowed: false,
      retryAt,
      reason: 'RATE_LIMITED',
    });
    vi.mocked(prisma.notification.updateMany).mockResolvedValue({ count: 1 } as never);

    await deliverCentralNotification('notification_deferred');

    expect(prisma.notification.updateMany).toHaveBeenLastCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: 'PENDING',
          failedAt: null,
          lastAttemptAt: null,
          nextAttemptAt: retryAt,
        }),
      })
    );
    expect(mocks.sendEmail).not.toHaveBeenCalled();
  });

  it('does not consume retry budget when the provider circuit is already open', async () => {
    const due = new Date(Date.now() - 60_000);
    vi.mocked(prisma.notification.findUnique).mockResolvedValue({
      id: 'notification_circuit_open',
      status: 'PENDING',
      category: 'SECURITY',
      attempts: 1,
      maxAttempts: 5,
      nextAttemptAt: due,
      scheduledAt: due,
      lastAttemptAt: null,
      expiresAt: null,
      payloadEncrypted: `encrypted:${JSON.stringify(input.payload)}`,
    } as never);
    vi.mocked(prisma.notification.updateMany).mockResolvedValue({ count: 1 } as never);
    mocks.sendEmail.mockRejectedValue(new CircuitBreakerError('Email circuit is open', 'email'));

    await deliverCentralNotification('notification_circuit_open');

    expect(prisma.notification.updateMany).toHaveBeenLastCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'PENDING', attempts: 1, failedAt: null }),
      })
    );
    expect(prisma.notificationDeliveryAttempt.create).not.toHaveBeenCalled();
  });

  it('scrubs expired security payloads in a bounded queue cleanup pass', async () => {
    vi.mocked(prisma.notification.findMany).mockResolvedValue([
      { id: 'notification_expired' },
    ] as never);
    vi.mocked(prisma.notification.updateMany).mockResolvedValue({ count: 1 } as never);

    await expect(processCentralNotificationQueue()).resolves.toEqual({
      processed: 0,
      succeeded: 0,
      failed: 0,
    });
    expect(prisma.notification.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        take: 100,
        where: expect.objectContaining({
          OR: expect.arrayContaining([
            expect.objectContaining({ status: 'PENDING', lastAttemptAt: null }),
          ]),
        }),
      })
    );
    expect(prisma.notification.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'SKIPPED', payloadEncrypted: null }),
      })
    );
  });

  it('never redelivers an already terminal notification', async () => {
    vi.mocked(prisma.notification.findUnique).mockResolvedValue({
      id: 'notification_sent',
      status: 'SENT',
      payloadEncrypted: 'encrypted:{}',
    } as never);

    await expect(deliverCentralNotification('notification_sent')).resolves.toEqual({
      success: false,
      claimed: false,
    });
    expect(prisma.notification.updateMany).not.toHaveBeenCalled();
    expect(mocks.sendEmail).not.toHaveBeenCalled();
  });

  it('does not report provider acceptance as failure when attempt-ledger persistence aborts', async () => {
    const due = new Date(Date.now() - 60_000);
    vi.mocked(prisma.notification.findUnique).mockResolvedValue({
      id: 'notification_accepted',
      status: 'PENDING',
      category: 'ADMINISTRATION',
      attempts: 0,
      maxAttempts: 5,
      nextAttemptAt: due,
      scheduledAt: due,
      lastAttemptAt: null,
      expiresAt: null,
      payloadEncrypted: `encrypted:${JSON.stringify(input.payload)}`,
    } as never);
    vi.mocked(prisma.notification.updateMany).mockResolvedValue({ count: 1 } as never);
    vi.mocked(prisma.$transaction).mockRejectedValueOnce(new Error('attempt ledger unavailable'));
    mocks.sendEmail.mockResolvedValue({ success: true, providerMessageId: 'provider-accepted' });

    await expect(deliverCentralNotification('notification_accepted')).resolves.toEqual({
      success: true,
      claimed: true,
    });
    expect(prisma.notification.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: 'SENT',
          providerMessageId: 'provider-accepted',
          payloadEncrypted: null,
        }),
      })
    );
  });

  it('masks every externally-addressed channel without exposing a full address', () => {
    expect(maskedNotificationRecipient('EMAIL', 'alice@example.com')).toBe('a***@example.com');
    expect(maskedNotificationRecipient('SMS', '+1 (555) 123-9876')).toBe('***9876');
    expect(maskedNotificationRecipient('WEBHOOK', 'https://hooks.example.com/secret/token')).toBe(
      'https://hooks.example.com'
    );
  });
});
