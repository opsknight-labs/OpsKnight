import { Prisma, PrismaClient } from '@prisma/client';
import { invalidateNotificationProviderCache } from '@/lib/notification-providers';

const prisma = new PrismaClient();

async function seedRequiredReferenceData() {
  await prisma.incidentSlaPolicy.upsert({
    where: { scopeKey_version: { scopeKey: 'workspace', version: 1 } },
    update: {},
    create: {
      id: 'test-incident-sla-workspace-v1',
      scopeKey: 'workspace',
      version: 1,
      inheritWorkspace: false,
      baseAckTargetMs: 15 * 60_000,
      baseResolveTargetMs: 120 * 60_000,
    },
  });
  await prisma.incidentSlaPolicyRule.createMany({
    data: [
      {
        policyId: 'test-incident-sla-workspace-v1',
        priority: 'P1',
        ackTargetMs: 5 * 60_000,
        resolveTargetMs: 60 * 60_000,
      },
      {
        policyId: 'test-incident-sla-workspace-v1',
        priority: 'P2',
        ackTargetMs: 15 * 60_000,
        resolveTargetMs: 240 * 60_000,
      },
      {
        policyId: 'test-incident-sla-workspace-v1',
        priority: 'P3',
        ackTargetMs: 30 * 60_000,
        resolveTargetMs: 480 * 60_000,
      },
      {
        policyId: 'test-incident-sla-workspace-v1',
        priority: 'P4',
        ackTargetMs: 60 * 60_000,
        resolveTargetMs: 1440 * 60_000,
      },
      {
        policyId: 'test-incident-sla-workspace-v1',
        priority: 'P5',
        ackTargetMs: 120 * 60_000,
        resolveTargetMs: 2880 * 60_000,
      },
    ],
  });
  await prisma.incidentSlaPolicy.update({
    where: { id: 'test-incident-sla-workspace-v1' },
    data: { sealedAt: new Date(0) },
  });
  await prisma.incidentClassificationPolicy.upsert({
    where: { scopeKey_version: { scopeKey: 'workspace', version: 1 } },
    update: {},
    create: {
      id: 'test-incident-classification-workspace-v1',
      scopeKey: 'workspace',
      version: 1,
      inheritWorkspace: false,
    },
  });
  await prisma.incidentClassificationPolicyRule.createMany({
    data: [
      ['critical', 'P1', 'HIGH'],
      ['error', 'P2', 'MEDIUM'],
      ['warning', 'P3', 'MEDIUM'],
      ['info', 'P5', 'LOW'],
    ].map(([matchValue, priority, urgency]) => ({
      policyId: 'test-incident-classification-workspace-v1',
      matchType: 'ALERT_SEVERITY',
      matchValue,
      priority,
      urgency: urgency as 'HIGH' | 'MEDIUM' | 'LOW',
      priorityMode: 'SET',
      urgencyMode: 'SET',
      label: `${matchValue} alert`,
    })),
    skipDuplicates: true,
  });
  await prisma.incidentClassificationPolicy.update({
    where: { id: 'test-incident-classification-workspace-v1' },
    data: { sealedAt: new Date(0) },
  });
}

export async function resetDatabase() {
  try {
    const tablenames = await prisma.$queryRaw<
      Array<{ tablename: string }>
    >`SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename NOT LIKE '_prisma_migrations';`;

    if (tablenames.length === 0) {
      console.log('No tables found to reset.');
      return;
    }

    const tables = tablenames.map(({ tablename }) => `"${tablename}"`).join(', ');

    try {
      await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${tables} CASCADE;`);
    } catch (error: unknown) {
      if ((error as { code?: string }).code === '40P01') {
        // Deadlock
        console.log('Deadlock detected during reset, retrying...');
        await new Promise(resolve => setTimeout(resolve, 100));
        await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${tables} CASCADE;`);
      } else {
        throw error;
      }
    }
    await seedRequiredReferenceData();
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('Error resetting database:', message);
    if (message.includes("Can't reach database") || message.includes('Canbt reach database')) {
      console.error('Check if your database at DATABASE_URL is running.');
    }
    throw error; // Fail the test if reset fails
  }
}

export async function createTestUser(overrides: Partial<Prisma.UserCreateInput> = {}) {
  // Ensure unique email
  const email =
    typeof overrides.email === 'string'
      ? overrides.email
      : `test-${Math.random().toString(36).slice(2, 9)}@example.com`;

  return await prisma.user.create({
    data: {
      email,
      name: 'Test User',
      passwordHash: 'hashed-pw',
      role: 'USER',
      status: 'ACTIVE',
      ...overrides,
    },
  });
}

export async function createTestTeam(
  name: string,
  overrides: Partial<Prisma.TeamUncheckedCreateInput> = {}
) {
  // Append random suffix to avoid unique constraint violations
  const uniqueName = `${name}-${Math.random().toString(36).slice(2, 9)}`;
  return await prisma.team.create({
    data: {
      name: uniqueName,
      ...overrides,
    },
  });
}

export async function createTestService(
  name: string,
  teamId?: string | null,
  overrides: Partial<Prisma.ServiceUncheckedCreateInput> = {}
) {
  // Append random suffix to avoid unique constraint violations
  const uniqueName = `${name}-${Math.random().toString(36).slice(2, 9)}`;
  return await prisma.service.create({
    data: {
      name: uniqueName,
      ...overrides,
      ...(teamId ? { teamId } : {}),
    },
  });
}

export async function createTestIncident(
  title: string,
  serviceId: string,
  overrides: Partial<Prisma.IncidentUncheckedCreateInput> = {}
) {
  return await prisma.incident.create({
    data: {
      title,
      serviceId,
      status: 'OPEN',
      urgency: 'HIGH',
      ...overrides,
    },
  });
}

export async function createTestNotificationProvider(
  provider: string,
  config: Prisma.InputJsonObject = {},
  overrides: Partial<Prisma.NotificationProviderCreateInput> = {}
) {
  const record = await prisma.notificationProvider.upsert({
    where: {
      provider: provider,
    },
    update: {
      enabled: true,
      config,
      ...overrides,
    },
    create: {
      provider,
      enabled: true,
      config,
      ...overrides,
    },
  });
  invalidateNotificationProviderCache();
  return record;
}

export async function createTestEscalationPolicy(
  name: string,
  steps: Array<any>,
  overrides: Partial<Prisma.EscalationPolicyCreateInput> = {}
) {
  return await prisma.escalationPolicy.create({
    data: {
      name,
      steps: {
        create: steps.map(s => {
          const {
            targetUserId,
            targetScheduleId,
            targetTeamId,
            targetUser,
            targetSchedule,
            targetTeam,
            ...rest
          } = s;
          const data: any = {
            notificationChannels: [],
            ...rest,
          };

          // Prioritize scalar IDs if provided, otherwise fallback to relations
          if (targetUserId) data.targetUserId = targetUserId;
          else if (targetUser) data.targetUser = targetUser;

          if (targetScheduleId) data.targetScheduleId = targetScheduleId;
          else if (targetSchedule) data.targetSchedule = targetSchedule;

          if (targetTeamId) data.targetTeamId = targetTeamId;
          else if (targetTeam) data.targetTeam = targetTeam;

          return data;
        }),
      },
      ...overrides,
    },
  });
}

export async function createTestStatusPage(overrides: Partial<Prisma.StatusPageCreateInput> = {}) {
  // Use unique name to avoid constraint violations
  const uniqueName = overrides.name || `Test Status Page ${Math.random().toString(36).slice(2, 9)}`;
  return await prisma.statusPage.create({
    data: {
      name: uniqueName,
      enabled: true,
      ...overrides,
    },
  });
}

export async function linkServiceToStatusPage(
  statusPageId: string,
  serviceId: string,
  overrides: Partial<Prisma.StatusPageServiceUncheckedCreateInput> = {}
) {
  return await prisma.statusPageService.create({
    data: {
      statusPageId,
      serviceId,
      showOnPage: true,
      ...overrides,
    },
  });
}

export async function createTestStatusPageSubscription(
  statusPageId: string,
  email: string,
  overrides: Partial<Prisma.StatusPageSubscriptionUncheckedCreateInput> = {}
) {
  const verified = overrides.verified ?? true;
  const state = (overrides as { state?: string }).state;
  const inferredState = state === undefined ? (verified ? 'ACTIVE' : 'PENDING') : undefined;
  return await prisma.statusPageSubscription.create({
    data: {
      statusPageId,
      email,
      token: Math.random().toString(36).substring(2),
      verified,
      ...(inferredState ? { state: inferredState as never } : {}),
      ...overrides,
    },
  });
}

export async function createTestOnCallSchedule(name: string, layers: any[] = []) {
  // Append random suffix to avoid unique constraint violations
  const uniqueName = `${name}-${Math.random().toString(36).slice(2, 9)}`;
  return await prisma.onCallSchedule.create({
    data: {
      name: uniqueName,
      layers: {
        create: layers.map((layer, index) => ({
          name: layer.name || `Layer ${index}`,
          start: layer.start || new Date(),
          rotationLengthHours: layer.rotationLengthHours || 168,
          users: {
            create: (layer.userIds || []).map((userId: string, pos: number) => ({
              userId,
              position: pos,
            })),
          },
        })),
      },
    },
    include: {
      layers: {
        include: {
          users: true,
        },
      },
    },
  });
}

export async function createTestScheduleOverride(
  scheduleId: string,
  userId: string,
  start: Date,
  end: Date,
  replacesUserId?: string
) {
  return await prisma.onCallOverride.create({
    data: {
      scheduleId,
      userId,
      start,
      end,
      replacesUserId,
    },
  });
}

export async function createTestStatusPageWebhook(
  statusPageId: string,
  url: string,
  overrides: Partial<Prisma.StatusPageWebhookUncheckedCreateInput> = {}
) {
  return await prisma.statusPageWebhook.create({
    data: {
      statusPageId,
      url,
      secret: 'test-secret',
      events: ['incident.created', 'incident.updated'],
      enabled: true,
      ...overrides,
    },
  });
}

export { prisma as testPrisma };
