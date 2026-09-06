import { Prisma, PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

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
        return;
      }
      throw error;
    }
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
  return await prisma.notificationProvider.upsert({
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
  return await prisma.statusPageSubscription.create({
    data: {
      statusPageId,
      email,
      token: Math.random().toString(36).substring(2),
      verified: true,
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
