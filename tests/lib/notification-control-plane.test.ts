import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createCentralNotificationIntent,
  deliverCentralNotification,
  getNextCentralNotificationAt,
  maskedNotificationRecipient,
  processCentralNotificationQueue,
  reconcileUnknownNotifications,
  resolveNotificationExpiry,
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
  isBulkPaused: vi.fn().mockResolvedValue(false),
}));

vi.mock('@/lib/prisma', () => ({
  default: {
    notification: {
      create: vi.fn(),
      count: vi.fn(),
      findFirst: vi.fn(),
      findMany: vi.fn(),
      findUnique: vi.fn(),
      updateMany: vi.fn(),
    },
    incident: { findUnique: vi.fn() },
    service: { findUnique: vi.fn() },
    systemConfig: { findUnique: vi.fn() },
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
vi.mock('@/lib/notification-capacity-control', () => ({
  isBulkNotificationDeliveryPaused: mocks.isBulkPaused,
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
    vi.mocked(prisma.notification.count).mockResolvedValue(0);
    vi.mocked(prisma.notification.updateMany).mockResolvedValue({ count: 1 } as never);
    vi.mocked(prisma.notificationDeliveryAttempt.count).mockResolvedValue(0);
    vi.mocked(prisma.systemConfig.findUnique).mockResolvedValue(null);
    vi.mocked(prisma.$queryRaw).mockResolvedValue([]);
    mocks.isBulkPaused.mockResolvedValue(false);
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

  it('enforces the traffic-class aging floor when persisting a caller priority', async () => {
    vi.mocked(prisma.notification.create).mockResolvedValue({ id: 'notification_one' } as never);

    await createCentralNotificationIntent({
      ...input,
      category: 'STATUS_PAGE',
      trafficClass: 'BULK',
      priority: 0,
    });

    expect(prisma.notification.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ trafficClass: 'BULK', priority: 5 }),
      })
    );
  });

  it('rejects an empty recipient before persisting a delivery intent', async () => {
    await expect(
      createCentralNotificationIntent({ ...input, recipientAddress: '   ' })
    ).rejects.toThrow('Notification recipient is required');
    expect(prisma.notification.create).not.toHaveBeenCalled();
  });

  it('rejects malformed runtime input before accessing typed fields', async () => {
    await expect(
      createCentralNotificationIntent({ ...input, sourceType: 42 } as never)
    ).rejects.toThrow('Notification input is invalid');
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
      eventAt: due.toISOString(),
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
      updatedAt: new Date(due.getTime() + 10_000),
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

  it('excludes paused bulk traffic from scheduler wakeups', async () => {
    mocks.isBulkPaused.mockResolvedValue(true);
    const transactionalAt = new Date(Date.now() + 3 * 60_000);
    vi.mocked(prisma.$queryRaw).mockResolvedValue([{ nextEligibleAt: transactionalAt }] as never);

    await expect(getNextCentralNotificationAt()).resolves.toEqual(transactionalAt);
    expect(prisma.notification.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          trafficClass: { in: ['CRITICAL', 'TRANSACTIONAL'] },
        }),
      })
    );
    const query = vi.mocked(prisma.$queryRaw).mock.calls[0]?.[0] as { values?: unknown[] };
    expect(query.values).toEqual(expect.arrayContaining(['CRITICAL', 'TRANSACTIONAL']));
    expect(query.values).not.toEqual(expect.arrayContaining(['BULK', 'PUBLIC_INCIDENT']));
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

  it('uses class-specific floors when aging queued notifications', async () => {
    await processCentralNotificationQueue();

    const queueQuery = vi.mocked(prisma.$queryRaw).mock.calls.at(-1)?.[0] as {
      strings?: readonly string[];
      values?: readonly unknown[];
    };
    const sql = queueQuery.strings?.join('?') ?? '';
    expect(sql).toContain('CASE ranked."trafficClass"');
    expect(sql).toContain('PARTITION BY "trafficClass", "tenantKey"');
    expect(sql).toContain('tenant_rank <=');
    expect(sql).not.toContain('WHERE ranked.tenant_rank <=');
    expect(sql).toContain("WHEN 'CRITICAL'");
    expect(sql).toContain("WHEN 'PUBLIC_INCIDENT'");
    expect(sql).toContain('ELSE');
    expect(queueQuery.values).toEqual(expect.arrayContaining([0, 1, 3, 5]));
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

  it('reconciles an ambiguous idempotent push exactly once without consuming retry budget', async () => {
    const due = new Date('2026-09-20T00:00:00.000Z');
    vi.mocked(prisma.notification.findMany).mockResolvedValue([
      {
        id: 'notification_unknown_push',
        channel: 'PUSH',
        attempts: 1,
        providerMessageId: null,
        deliveryAttempts: [{ provider: 'web-push' }],
      },
    ] as never);
    vi.mocked(prisma.notification.updateMany).mockResolvedValueOnce({ count: 1 } as never);

    await expect(reconcileUnknownNotifications(due)).resolves.toEqual({
      retried: 1,
      awaitingCallback: 0,
      unsupported: 0,
    });
    expect(prisma.notification.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: 'notification_unknown_push', status: 'UNKNOWN' }),
        data: expect.objectContaining({ status: 'PENDING', attempts: 0, nextAttemptAt: due }),
      })
    );
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

  it('skips delivering historical notifications whose payload eventAt exceeds TTL even without stored expiresAt', async () => {
    const due = new Date();
    const staleEventAt = new Date(Date.now() - 35 * 60 * 1000).toISOString(); // 35m ago (TTL is 30m)
    const payload = {
      kind: 'INCIDENT_EMAIL' as const,
      userId: 'user-1',
      incidentId: 'incident-1',
      eventType: 'triggered' as const,
      eventAt: staleEventAt,
      escalationGeneration: 1,
      escalationStep: 0,
      durableMessage: 'encrypted message snapshot',
    };
    vi.mocked(prisma.notification.findUnique).mockResolvedValue({
      id: 'notification_stale_event',
      status: 'PENDING',
      category: 'INCIDENT',
      trafficClass: 'CRITICAL',
      attempts: 0,
      maxAttempts: 5,
      nextAttemptAt: due,
      scheduledAt: due,
      lastAttemptAt: null,
      expiresAt: null,
      payloadEncrypted: `encrypted:${JSON.stringify(payload)}`,
    } as never);
    vi.mocked(prisma.notification.updateMany).mockResolvedValue({ count: 1 } as never);

    await expect(deliverCentralNotification('notification_stale_event')).resolves.toEqual({
      success: true,
      claimed: true,
    });
    expect(mocks.sendIncidentEmail).not.toHaveBeenCalled();
    expect(prisma.notification.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'notification_stale_event', status: { in: ['PENDING', 'FAILED'] } },
        data: expect.objectContaining({
          status: 'SKIPPED',
        }),
      })
    );
  });

  it('derives expiresAt from explicit eventAt and payload.eventAt for newly created intents', () => {
    const scheduledAt = new Date('2026-09-15T12:00:00.000Z');
    const twoHoursAgo = new Date('2026-09-15T10:00:00.000Z');

    // Case 1: Explicit eventAt overrides scheduledAt
    const expiryFromEventAt = resolveNotificationExpiry(
      {
        category: 'INCIDENT',
        channel: 'EMAIL',
        recipientType: 'USER',
        recipientAddress: 'alice@example.com',
        templateKey: 'incident-triggered',
        sourceType: 'INCIDENT',
        sourceId: 'incident-1',
        eventKey: 'event-1',
        displayMessage: 'Alert',
        trafficClass: 'CRITICAL',
        eventAt: twoHoursAgo,
        payload: {
          kind: 'INCIDENT_EMAIL',
          userId: 'u1',
          incidentId: 'incident-1',
          eventType: 'triggered',
        } as never,
      },
      scheduledAt
    );
    // 10:00 + 30m TTL = 10:30 (1.5h before scheduledAt)
    expect(expiryFromEventAt.toISOString()).toBe('2026-09-15T10:30:00.000Z');

    // Case 2: Inferred from payload.eventAt
    const expiryFromPayload = resolveNotificationExpiry(
      {
        category: 'INCIDENT',
        channel: 'EMAIL',
        recipientType: 'USER',
        recipientAddress: 'alice@example.com',
        templateKey: 'incident-triggered',
        sourceType: 'INCIDENT',
        sourceId: 'incident-1',
        eventKey: 'event-1',
        displayMessage: 'Alert',
        trafficClass: 'CRITICAL',
        payload: {
          kind: 'INCIDENT_EMAIL',
          userId: 'u1',
          incidentId: 'incident-1',
          eventType: 'triggered',
          eventAt: twoHoursAgo.toISOString(),
        } as never,
      },
      scheduledAt
    );
    expect(expiryFromPayload.toISOString()).toBe('2026-09-15T10:30:00.000Z');

    // Case 3: Future scheduled item without eventAt falls back to scheduledAt + TTL
    const futureExpiry = resolveNotificationExpiry(
      {
        category: 'ADMINISTRATION',
        channel: 'EMAIL',
        recipientType: 'USER',
        recipientAddress: 'alice@example.com',
        templateKey: 'user-invite',
        sourceType: 'USER',
        sourceId: 'user-1',
        eventKey: 'invite-1',
        displayMessage: 'Invite',
        trafficClass: 'TRANSACTIONAL',
        payload: { kind: 'CUSTOM', message: 'hello' } as never,
      },
      scheduledAt
    );
    // 12:00 + 2h TTL = 14:00
    expect(futureExpiry.toISOString()).toBe('2026-09-15T14:00:00.000Z');
  });

  it('skips new intents created with stale eventAt immediately upon delivery with zero provider attempts', async () => {
    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);
    const staleExpiresAt = new Date(twoHoursAgo.getTime() + 30 * 60 * 1000); // 1.5h ago

    vi.mocked(prisma.notification.findUnique).mockResolvedValue({
      id: 'notification_stale_new_intent',
      status: 'PENDING',
      category: 'INCIDENT',
      trafficClass: 'CRITICAL',
      attempts: 0,
      maxAttempts: 5,
      nextAttemptAt: new Date(),
      scheduledAt: new Date(),
      lastAttemptAt: null,
      expiresAt: staleExpiresAt,
      payloadEncrypted: `encrypted:${JSON.stringify({
        kind: 'INCIDENT_EMAIL',
        userId: 'user-1',
        incidentId: 'incident-1',
        eventType: 'triggered',
        eventAt: twoHoursAgo.toISOString(),
      })}`,
    } as never);
    vi.mocked(prisma.notification.updateMany).mockResolvedValue({ count: 1 } as never);

    await expect(deliverCentralNotification('notification_stale_new_intent')).resolves.toEqual({
      success: true,
      claimed: true,
    });
    expect(mocks.sendIncidentEmail).not.toHaveBeenCalled();
    expect(prisma.notification.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'notification_stale_new_intent', status: { in: ['PENDING', 'FAILED'] } },
        data: expect.objectContaining({
          status: 'SKIPPED',
          errorMsg: 'Notification expired before delivery.',
        }),
      })
    );
  });

  it('safely handles concurrent legacy and central producers for the same lifecycle event with retry deduplication', async () => {
    const input = {
      category: 'INCIDENT' as const,
      channel: 'EMAIL' as const,
      recipientType: 'USER' as const,
      recipientAddress: 'alice@example.com',
      templateKey: 'incident-triggered',
      sourceType: 'INCIDENT',
      sourceId: 'incident-1',
      eventKey: 'event-unique-123',
      displayMessage: 'Incident Alert',
      payload: {
        kind: 'INCIDENT_EMAIL' as const,
        userId: 'user-1',
        incidentId: 'incident-1',
        eventType: 'triggered' as const,
        eventAt: new Date().toISOString(),
        durableMessage: 'Incident Alert snapshot',
      },
    };

    // 1. Central intent creation wins initial insert
    vi.mocked(prisma.notification.create).mockResolvedValueOnce({ id: 'intent-1' } as never);
    const firstResult = await createCentralNotificationIntent(input);
    expect(firstResult).toEqual({ id: expect.any(String), created: true });

    // 2. Concurrent/subsequent legacy or mixed producer creation encounters duplicate key on deliveryKey
    const duplicateError = new Error('Unique constraint failed on the fields: (`deliveryKey`)');
    (duplicateError as unknown as { code: string }).code = 'P2002';
    vi.mocked(prisma.notification.create).mockRejectedValueOnce(duplicateError);
    vi.mocked(prisma.notification.findUnique).mockResolvedValueOnce({
      id: firstResult.id,
    } as never);

    const secondResult = await createCentralNotificationIntent(input);
    expect(secondResult).toEqual({ id: firstResult.id, created: false });
  });

  it('masks every externally-addressed channel without exposing a full address', () => {
    expect(maskedNotificationRecipient('EMAIL', 'alice@example.com')).toBe('a***@example.com');
    expect(maskedNotificationRecipient('SMS', '+1 (555) 123-9876')).toBe('***9876');
    expect(maskedNotificationRecipient('WEBHOOK', 'https://hooks.example.com/secret/token')).toBe(
      'https://hooks.example.com'
    );
  });
});
