import { beforeEach, describe, expect, it, vi } from 'vitest';
import prisma from '@/lib/prisma';
import {
  assertEscalationPolicyNameAvailable,
  assertIncidentTemplateNameAvailable,
  assertScheduleNameAvailable,
  assertServiceNameAvailable,
  assertStatusPageNameAvailable,
  assertTeamNameAvailable,
  assertWebhookIntegrationNameAvailable,
  UniqueNameConflictError,
} from '@/lib/unique-names';

vi.mock('@/lib/prisma', () => ({
  __esModule: true,
  default: {
    service: { findFirst: vi.fn() },
    team: { findFirst: vi.fn() },
    escalationPolicy: { findFirst: vi.fn() },
    onCallSchedule: { findFirst: vi.fn() },
    incidentTemplate: { findFirst: vi.fn() },
    webhookIntegration: { findFirst: vi.fn() },
    statusPage: { findFirst: vi.fn() },
  },
}));

describe('assertServiceNameAvailable', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns trimmed name when it is available', async () => {
    vi.mocked(prisma.service.findFirst).mockResolvedValue(null);

    const result = await assertServiceNameAvailable('  API Gateway  ');

    expect(result).toBe('API Gateway');
    expect(prisma.service.findFirst).toHaveBeenCalledWith({
      where: { name: 'API Gateway' },
      select: { id: true },
    });
  });

  it('excludes the current service id when provided', async () => {
    vi.mocked(prisma.service.findFirst).mockResolvedValue(null);

    await assertServiceNameAvailable('Billing', { excludeId: 'svc-1' });

    expect(prisma.service.findFirst).toHaveBeenCalledWith({
      where: { name: 'Billing', NOT: { id: 'svc-1' } },
      select: { id: true },
    });
  });

  it('throws a conflict error when the name is already taken', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.mocked(prisma.service.findFirst).mockResolvedValue({ id: 'svc-1' } as any);

    await expect(assertServiceNameAvailable('Billing')).rejects.toBeInstanceOf(
      UniqueNameConflictError
    );
  });

  it('throws when the name is empty after trimming', async () => {
    await expect(assertServiceNameAvailable('   ')).rejects.toThrow('Service name is required.');
  });
});

describe('assertTeamNameAvailable', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns the trimmed team name when unique', async () => {
    vi.mocked(prisma.team.findFirst).mockResolvedValue(null);

    const result = await assertTeamNameAvailable('  Response  ');

    expect(result).toBe('Response');
  });
});

describe('assertEscalationPolicyNameAvailable', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('throws a conflict error when policy name is already taken', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.mocked(prisma.escalationPolicy.findFirst).mockResolvedValue({ id: 'pol-1' } as any);

    await expect(assertEscalationPolicyNameAvailable('Primary')).rejects.toBeInstanceOf(
      UniqueNameConflictError
    );
  });
});

describe('assertScheduleNameAvailable', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('excludes the current schedule id when provided', async () => {
    vi.mocked(prisma.onCallSchedule.findFirst).mockResolvedValue(null);

    await assertScheduleNameAvailable('Primary', { excludeId: 'sched-1' });

    expect(prisma.onCallSchedule.findFirst).toHaveBeenCalledWith({
      where: { name: 'Primary', NOT: { id: 'sched-1' } },
      select: { id: true },
    });
  });
});

describe('assertIncidentTemplateNameAvailable', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns the trimmed template name when unique', async () => {
    vi.mocked(prisma.incidentTemplate.findFirst).mockResolvedValue(null);

    const result = await assertIncidentTemplateNameAvailable('  Outage  ');

    expect(result).toBe('Outage');
  });
});

describe('assertWebhookIntegrationNameAvailable', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('throws a conflict error when webhook name is already taken', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.mocked(prisma.webhookIntegration.findFirst).mockResolvedValue({ id: 'wh-1' } as any);

    await expect(assertWebhookIntegrationNameAvailable('Slack', { serviceId: 'service-1' })).rejects.toBeInstanceOf(
      UniqueNameConflictError
    );
    expect(prisma.webhookIntegration.findFirst).toHaveBeenCalledWith({
      where: { serviceId: 'service-1', name: 'Slack' },
      select: { id: true },
    });
  });
});

describe('assertStatusPageNameAvailable', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns the trimmed status page name when unique', async () => {
    vi.mocked(prisma.statusPage.findFirst).mockResolvedValue(null);

    const result = await assertStatusPageNameAvailable('  Status Page  ');

    expect(result).toBe('Status Page');
  });
});
