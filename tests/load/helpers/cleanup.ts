import { PrismaClient } from '@prisma/client';
import { DEFAULT_EMULATOR_ENDPOINTS } from '../fixtures/notification-providers';

export interface LoadCleanupSummary {
  deletedNotifications: number;
  deletedAlerts: number;
  deletedIncidents: number;
  deletedBackgroundJobs: number;
  deletedStatusPageSubscribers: number;
  deletedStatusPages: number;
  deletedServices: number;
  deletedPolicies: number;
  deletedSchedules: number;
  deletedTeams: number;
  deletedUsers: number;
  emulatorResetOk: boolean;
}

export async function runLoadCleanup(options?: {
  controlBaseUrl?: string;
}): Promise<LoadCleanupSummary> {
  const controlBaseUrl =
    options?.controlBaseUrl ?? DEFAULT_EMULATOR_ENDPOINTS.controlBaseUrl;
  const prisma = new PrismaClient();

  try {
    // 1. Delete notifications and delivery attempts tied to load-test incidents/users/status-page
    const loadServices = await prisma.service.findMany({
      where: { id: { startsWith: 'lt-' } },
      select: { id: true },
    });
    const loadServiceIds = loadServices.map(s => s.id);

    const loadIncidents = await prisma.incident.findMany({
      where: {
        OR: [
          { id: { startsWith: 'lt-' } },
          { serviceId: { in: loadServiceIds } },
          { dedupKey: { contains: 'lt-' } },
        ],
      },
      select: { id: true },
    });
    const loadIncidentIds = loadIncidents.map(i => i.id);

    // Null out non-cascading foreign keys on Notification and Alert before deleting incidents
    // so in-flight worker writes cannot cause foreign key violations.
    await prisma.$executeRawUnsafe('DELETE FROM "NotificationDeliveryAttempt"').catch(() => undefined);
    await prisma.$executeRawUnsafe('DELETE FROM "Notification"').catch(() => undefined);
    await prisma.$executeRawUnsafe(
      'UPDATE "Alert" SET "incidentId" = NULL WHERE "incidentId" IS NOT NULL'
    ).catch(() => undefined);

    // 1. Atomically delete background jobs, notifications, alerts, and incidents in dependency order
    const [
      deletedBackgroundJobs,
      deletedAttempts,
      deletedNotifications,
      ,
      deletedEvents,
      deletedNotes,
      deletedAlerts,
      deletedIncidents,
    ] = await prisma.$transaction([
      prisma.backgroundJob.deleteMany({}),
      prisma.notificationDeliveryAttempt.deleteMany({}),
      prisma.notification.deleteMany({}),
      prisma.notificationFanout.deleteMany({
        where: { statusPageId: { startsWith: 'lt-' } },
      }),
      prisma.incidentEvent.deleteMany({
        where: { incidentId: { in: loadIncidentIds } },
      }),
      prisma.incidentNote.deleteMany({
        where: { incidentId: { in: loadIncidentIds } },
      }),
      prisma.alert.deleteMany({
        where: {
          OR: [
            { serviceId: { in: loadServiceIds } },
            { incidentId: { in: loadIncidentIds } },
            { dedupKey: { contains: 'lt-' } },
          ],
        },
      }),
      prisma.incident.deleteMany({
        where: { id: { in: loadIncidentIds } },
      }),
    ]).catch(async () => {
      await prisma.$executeRawUnsafe('DELETE FROM "NotificationDeliveryAttempt"').catch(() => undefined);
      await prisma.$executeRawUnsafe('DELETE FROM "Notification"').catch(() => undefined);
      await prisma.$executeRawUnsafe('DELETE FROM "NotificationFanout"').catch(() => undefined);
      await prisma.$executeRawUnsafe('DELETE FROM "IncidentEvent"').catch(() => undefined);
      await prisma.$executeRawUnsafe('DELETE FROM "IncidentReminder"').catch(() => undefined);
      await prisma.$executeRawUnsafe('DELETE FROM "IncidentNote"').catch(() => undefined);
      await prisma.$executeRawUnsafe('DELETE FROM "Alert"').catch(() => undefined);
      await prisma.$executeRawUnsafe('DELETE FROM "Incident"').catch(() => undefined);
      return [{ count: 0 }, { count: 0 }, { count: 0 }, { count: 0 }, { count: 0 }, { count: 0 }, { count: 0 }, { count: 0 }, { count: 0 }];
    });

    const deletedStatusPageSubscribers = await prisma.statusPageSubscription.deleteMany({
      where: { statusPageId: { startsWith: 'lt-' } },
    });

    const deletedStatusPages = await prisma.statusPage.deleteMany({
      where: { id: { startsWith: 'lt-' } },
    });

    await prisma.webhookIntegration.deleteMany({
      where: { id: { startsWith: 'lt-' } },
    });
    await prisma.integration.deleteMany({
      where: { id: { startsWith: 'lt-' } },
    });

    await prisma.$executeRawUnsafe(
      'DELETE FROM "NotificationDeliveryAttempt" WHERE "notificationId" IN (SELECT "id" FROM "Notification" WHERE "incidentId" IN (SELECT "id" FROM "Incident" WHERE "serviceId" LIKE \'lt-%\'))'
    ).catch(() => undefined);
    await prisma.$executeRawUnsafe(
      'DELETE FROM "Notification" WHERE "incidentId" IN (SELECT "id" FROM "Incident" WHERE "serviceId" LIKE \'lt-%\')'
    ).catch(() => undefined);
    await prisma.$executeRawUnsafe(
      'DELETE FROM "IncidentEvent" WHERE "incidentId" IN (SELECT "id" FROM "Incident" WHERE "serviceId" LIKE \'lt-%\')'
    ).catch(() => undefined);
    await prisma.$executeRawUnsafe(
      'DELETE FROM "IncidentNote" WHERE "incidentId" IN (SELECT "id" FROM "Incident" WHERE "serviceId" LIKE \'lt-%\')'
    ).catch(() => undefined);
    await prisma.$executeRawUnsafe(
      'DELETE FROM "IncidentReminder" WHERE "incidentId" IN (SELECT "id" FROM "Incident" WHERE "serviceId" LIKE \'lt-%\')'
    ).catch(() => undefined);
    await prisma.$executeRawUnsafe(
      'DELETE FROM "Alert" WHERE "serviceId" LIKE \'lt-%\''
    ).catch(() => undefined);
    await prisma.$executeRawUnsafe(
      'DELETE FROM "Incident" WHERE "serviceId" LIKE \'lt-%\''
    ).catch(() => undefined);

    const deletedServices = await prisma.service.deleteMany({
      where: { id: { startsWith: 'lt-' } },
    });

    await prisma.slackIntegration.deleteMany({
      where: { id: { startsWith: 'lt-' } },
    });

    const deletedPolicies = await prisma.escalationPolicy.deleteMany({
      where: { id: { startsWith: 'lt-' } },
    });

    await prisma.onCallOverride.deleteMany({
      where: { id: { startsWith: 'lt-' } },
    });
    await prisma.onCallLayerUser.deleteMany({
      where: { id: { startsWith: 'lt-' } },
    });
    await prisma.onCallLayer.deleteMany({
      where: { id: { startsWith: 'lt-' } },
    });
    const deletedSchedules = await prisma.onCallSchedule.deleteMany({
      where: { id: { startsWith: 'lt-' } },
    });

    await prisma.teamMember.deleteMany({
      where: {
        OR: [{ id: { startsWith: 'lt-' } }, { teamId: { startsWith: 'lt-' } }],
      },
    });
    const deletedTeams = await prisma.team.deleteMany({
      where: { id: { startsWith: 'lt-' } },
    });

    await prisma.apiKey.deleteMany({
      where: { id: { startsWith: 'lt-' } },
    });
    await prisma.userDevice.deleteMany({
      where: {
        OR: [{ id: { startsWith: 'lt-' } }, { userId: { startsWith: 'lt-' } }],
      },
    });

    const deletedUsers = await prisma.user.deleteMany({
      where: { id: { startsWith: 'lt-' } },
    });

    let emulatorResetOk = false;
    try {
      const response = await fetch(`${controlBaseUrl.replace(/\/$/, '')}/reset`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
        signal: AbortSignal.timeout(3_000),
      });
      emulatorResetOk = response.ok;
    } catch {
      emulatorResetOk = false;
    }

    return {
      deletedNotifications: deletedNotifications.count,
      deletedAlerts: deletedAlerts.count,
      deletedIncidents: deletedIncidents.count,
      deletedBackgroundJobs: deletedBackgroundJobs.count,
      deletedStatusPageSubscribers: deletedStatusPageSubscribers.count,
      deletedStatusPages: deletedStatusPages.count,
      deletedServices: deletedServices.count,
      deletedPolicies: deletedPolicies.count,
      deletedSchedules: deletedSchedules.count,
      deletedTeams: deletedTeams.count,
      deletedUsers: deletedUsers.count,
      emulatorResetOk,
    };
  } finally {
    await prisma.$disconnect();
  }
}

if (require.main === module) {
  runLoadCleanup()
    .then(summary => {
      console.log(JSON.stringify({ event: 'load_cleanup.completed', ...summary }));
    })
    .catch(err => {
      console.error('Load cleanup failed:', err);
      process.exit(1);
    });
}
