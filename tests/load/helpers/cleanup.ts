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

function assertSafeCleanupDatabase(): void {
  if (
    process.env.OPSKNIGHT_LOAD_CERT_DB === 'true' ||
    process.env.OPSKNIGHT_ALLOW_LOAD_DB_CLEANUP === 'true'
  ) {
    return;
  }
  const dbUrl = process.env.DATABASE_URL || '';
  const isLikelyTestDb =
    dbUrl.includes('test') ||
    dbUrl.includes('load') ||
    dbUrl.includes('cert') ||
    dbUrl.includes('scratch') ||
    dbUrl.includes('ci');
  if (!isLikelyTestDb) {
    throw new Error(
      `Refusing to run load cleanup: DATABASE_URL does not match test patterns (test, load, cert, scratch, ci) and OPSKNIGHT_LOAD_CERT_DB is not 'true'. Target: ${dbUrl.replace(/:[^:@]+@/, ':***@')}`
    );
  }
}

export async function runLoadCleanup(options?: {
  controlBaseUrl?: string;
}): Promise<LoadCleanupSummary> {
  assertSafeCleanupDatabase();

  const controlBaseUrl =
    options?.controlBaseUrl ?? DEFAULT_EMULATOR_ENDPOINTS.controlBaseUrl;
  const prisma = new PrismaClient();

  try {
    // 1. Identify all load-test scoped entities by lt- prefix
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

    const loadNotifications = await prisma.notification.findMany({
      where: {
        OR: [
          { id: { startsWith: 'lt-' } },
          { incidentId: { in: loadIncidentIds } },
          { userId: { startsWith: 'lt-' } },
        ],
      },
      select: { id: true },
    });
    const loadNotificationIds = loadNotifications.map(n => n.id);

    // Strictly scoped foreign key disassociations for load test entities only
    if (loadServiceIds.length > 0 || loadIncidentIds.length > 0) {
      await prisma.alert.updateMany({
        where: {
          OR: [
            { serviceId: { in: loadServiceIds } },
            { incidentId: { in: loadIncidentIds } },
            { dedupKey: { contains: 'lt-' } },
          ],
        },
        data: { incidentId: null },
      }).catch(() => undefined);
    }

    // 2. Atomically delete load-test background jobs, notifications, alerts, and incidents in dependency order
    const [
      deletedBackgroundJobs,
      _deletedAttempts,
      deletedNotifications,
      ,
      _deletedEvents,
      _deletedNotes,
      deletedAlerts,
      deletedIncidents,
    ] = await prisma.$transaction([
      prisma.backgroundJob.deleteMany({
        where: {
          OR: [
            { id: { startsWith: 'lt-' } },
            { payload: { string_contains: 'lt-' } },
          ],
        },
      }),
      prisma.notificationDeliveryAttempt.deleteMany({
        where: {
          OR: [
            { id: { startsWith: 'lt-' } },
            { notificationId: { in: loadNotificationIds } },
          ],
        },
      }),
      prisma.notification.deleteMany({
        where: { id: { in: loadNotificationIds } },
      }),
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
      // Scoped fallback if transaction encounters serialization / deadlocks under load
      const delAttempts = await prisma.notificationDeliveryAttempt.deleteMany({
        where: {
          OR: [
            { id: { startsWith: 'lt-' } },
            { notificationId: { in: loadNotificationIds } },
          ],
        },
      }).catch(() => ({ count: 0 }));

      const delNotifs = await prisma.notification.deleteMany({
        where: { id: { in: loadNotificationIds } },
      }).catch(() => ({ count: 0 }));

      const delJobs = await prisma.backgroundJob.deleteMany({
        where: {
          OR: [
            { id: { startsWith: 'lt-' } },
            { payload: { string_contains: 'lt-' } },
          ],
        },
      }).catch(() => ({ count: 0 }));

      await prisma.notificationFanout.deleteMany({
        where: { statusPageId: { startsWith: 'lt-' } },
      }).catch(() => undefined);

      await prisma.incidentEvent.deleteMany({
        where: { incidentId: { in: loadIncidentIds } },
      }).catch(() => undefined);

      await prisma.incidentNote.deleteMany({
        where: { incidentId: { in: loadIncidentIds } },
      }).catch(() => undefined);

      const delAlerts = await prisma.alert.deleteMany({
        where: {
          OR: [
            { serviceId: { in: loadServiceIds } },
            { incidentId: { in: loadIncidentIds } },
            { dedupKey: { contains: 'lt-' } },
          ],
        },
      }).catch(() => ({ count: 0 }));

      const delIncs = await prisma.incident.deleteMany({
        where: { id: { in: loadIncidentIds } },
      }).catch(() => ({ count: 0 }));

      return [delJobs, delAttempts, delNotifs, { count: 0 }, { count: 0 }, { count: 0 }, delAlerts, delIncs];
    });

    await prisma.statusPageService.deleteMany({
      where: {
        OR: [
          { statusPageId: { startsWith: 'lt-' } },
          { serviceId: { in: loadServiceIds } },
        ],
      },
    }).catch(() => undefined);
    await prisma.statusPageSubscriptionService.deleteMany({
      where: {
        OR: [
          { subscription: { statusPageId: { startsWith: 'lt-' } } },
          { serviceId: { in: loadServiceIds } },
        ],
      },
    }).catch(() => undefined);

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

    const targetIncidentCondition = {
      OR: [
        { serviceId: { in: loadServiceIds } },
        { id: { startsWith: 'lt-' } },
        { id: { in: loadIncidentIds } },
      ],
    };
    const incsToDelete = await prisma.incident.findMany({
      where: targetIncidentCondition,
      select: { id: true },
    }).catch(() => []);
    const incIds = incsToDelete.map(i => i.id);

    if (incIds.length > 0) {
      await prisma.notificationDeliveryAttempt.deleteMany({
        where: { notification: { incidentId: { in: incIds } } },
      }).catch(() => undefined);
      await prisma.notification.deleteMany({
        where: { incidentId: { in: incIds } },
      }).catch(() => undefined);
      await prisma.alert.deleteMany({
        where: { incidentId: { in: incIds } },
      }).catch(() => undefined);
      await prisma.incidentEvent.deleteMany({
        where: { incidentId: { in: incIds } },
      }).catch(() => undefined);
      await prisma.incidentNote.deleteMany({
        where: { incidentId: { in: incIds } },
      }).catch(() => undefined);
      await prisma.incidentWatcher.deleteMany({
        where: { incidentId: { in: incIds } },
      }).catch(() => undefined);
      await prisma.incidentTag.deleteMany({
        where: { incidentId: { in: incIds } },
      }).catch(() => undefined);
      await prisma.actionItem.deleteMany({
        where: { incidentId: { in: incIds } },
      }).catch(() => undefined);
      await prisma.statusPageAnnouncement.deleteMany({
        where: { incidentId: { in: incIds } },
      }).catch(() => undefined);
      await prisma.incidentSlaPause.deleteMany({
        where: { incidentId: { in: incIds } },
      }).catch(() => undefined);
      await prisma.customFieldValue.deleteMany({
        where: { incidentId: { in: incIds } },
      }).catch(() => undefined);
      await prisma.postmortem.deleteMany({
        where: { incidentId: { in: incIds } },
      }).catch(() => undefined);
      await prisma.externalIssueLink.deleteMany({
        where: { incidentId: { in: incIds } },
      }).catch(() => undefined);
      await prisma.slackPinnedMessage.deleteMany({
        where: { incidentId: { in: incIds } },
      }).catch(() => undefined);
      await prisma.microsoftTeamsIncidentMessage.deleteMany({
        where: { incidentId: { in: incIds } },
      }).catch(() => undefined);
      await prisma.incidentWarRoom.deleteMany({
        where: { incidentId: { in: incIds } },
      }).catch(() => undefined);
      await prisma.incidentMeeting.deleteMany({
        where: { incidentId: { in: incIds } },
      }).catch(() => undefined);
    }

    await prisma.notificationDeliveryAttempt.deleteMany({
      where: {
        OR: [
          { notification: { incident: { serviceId: { in: loadServiceIds } } } },
          { notification: { incidentId: { in: incIds } } },
          { notification: { id: { startsWith: 'lt-' } } },
        ],
      },
    }).catch(() => undefined);

    await prisma.notification.deleteMany({
      where: {
        OR: [
          { incident: { serviceId: { in: loadServiceIds } } },
          { incidentId: { in: incIds } },
          { id: { startsWith: 'lt-' } },
        ],
      },
    }).catch(() => undefined);

    await prisma.alert.deleteMany({
      where: {
        OR: [
          { serviceId: { in: loadServiceIds } },
          { incidentId: { in: incIds } },
          { id: { startsWith: 'lt-' } },
          { dedupKey: { contains: 'lt-' } },
        ],
      },
    }).catch(() => undefined);

    await prisma.incident.deleteMany({
      where: {
        OR: [
          { serviceId: { in: loadServiceIds } },
          { serviceId: { startsWith: 'lt-' } },
          { id: { startsWith: 'lt-' } },
          { id: { in: loadIncidentIds } },
        ],
      },
    }).catch(() => ({ count: 0 }));

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
