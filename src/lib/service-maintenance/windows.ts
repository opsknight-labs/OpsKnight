import 'server-only';

import { Prisma, type MaintenanceEndBehavior } from '@prisma/client';
import { z } from 'zod';
import prisma from '@/lib/prisma';
import { logAudit, type AuditEventSource } from '@/lib/audit';
import { runSerializableTransaction } from '@/lib/db-utils';
import { AppError } from '@/lib/errors/app-error';
import { applyIncidentLifecycleCommand } from '@/lib/incidents/lifecycle';
import { logger } from '@/lib/logger';
import {
  cancelPendingAnnouncementJobs,
  createAnnouncementFanoutJob,
  lockAnnouncementMutation,
  suppressUndeliveredAnnouncementIntents,
} from '@/lib/status-pages/announcement-commands';
import { incrementAnnouncementNotificationGeneration } from '@/lib/status-pages/announcement-notification-generation';

export { findActiveMaintenanceWindow } from '@/lib/service-maintenance/active';

// Activity is always derived from startsAt <= now < endsAt. Nothing flips a flag
// at start time, so a stalled scheduler can never leave a service stuck in (or
// out of) maintenance. The scheduler only handles held incidents at window end.

export const MAINTENANCE_LIMITS = {
  maxServices: 200,
  maxDurationMs: 7 * 24 * 60 * 60 * 1000,
  // "Start now" from a browser is a few seconds old by the time it lands.
  startGraceMs: 5 * 60 * 1000,
  sweepWindowsPerRun: 20,
  sweepIncidentBatch: 100,
} as const;

const END_BEHAVIORS = ['RESUME_FIRING', 'RESOLVE_HELD'] as const;

const serviceIdsSchema = z
  .array(z.string().trim().min(1).max(64))
  .min(1, 'Select at least one service.')
  .max(MAINTENANCE_LIMITS.maxServices)
  .transform(ids => Array.from(new Set(ids)));

export const MaintenanceWindowCreateSchema = z
  .object({
    title: z.string().trim().min(1).max(200),
    description: z.string().trim().max(2000).nullish(),
    serviceIds: serviceIdsSchema,
    startsAt: z.coerce.date(),
    endsAt: z.coerce.date(),
    endBehavior: z.enum(END_BEHAVIORS).default('RESUME_FIRING'),
    publishToStatusPage: z.boolean().default(false),
  })
  .strict();

export const MaintenanceWindowPatchSchema = z
  .object({
    title: z.string().trim().min(1).max(200).optional(),
    description: z.string().trim().max(2000).nullish(),
    serviceIds: serviceIdsSchema.optional(),
    startsAt: z.coerce.date().optional(),
    endsAt: z.coerce.date().optional(),
    endBehavior: z.enum(END_BEHAVIORS).optional(),
    publishToStatusPage: z.boolean().optional(),
  })
  .strict();

export type MaintenanceWindowCreateInput = z.input<typeof MaintenanceWindowCreateSchema>;
export type MaintenanceWindowPatchInput = z.input<typeof MaintenanceWindowPatchSchema>;

export interface MaintenanceActor {
  id: string | null;
  source: AuditEventSource;
}

export type MaintenanceWindowPhase = 'UPCOMING' | 'ACTIVE' | 'ENDED';

export const maintenanceWindowSelect = {
  id: true,
  revision: true,
  title: true,
  description: true,
  startsAt: true,
  endsAt: true,
  endBehavior: true,
  publishToStatusPage: true,
  endProcessedAt: true,
  createdById: true,
  createdAt: true,
  updatedAt: true,
  services: { select: { serviceId: true, service: { select: { name: true } } } },
  _count: { select: { heldIncidents: true } },
} satisfies Prisma.MaintenanceWindowSelect;

export type MaintenanceWindowRecord = Prisma.MaintenanceWindowGetPayload<{
  select: typeof maintenanceWindowSelect;
}>;

export function maintenanceWindowPhase(
  window: { startsAt: Date; endsAt: Date },
  now: Date = new Date()
): MaintenanceWindowPhase {
  if (window.endsAt.getTime() <= now.getTime()) return 'ENDED';
  if (window.startsAt.getTime() <= now.getTime()) return 'ACTIVE';
  return 'UPCOMING';
}

function invalid(message: string): AppError {
  return new AppError({ code: 'VALIDATION_FAILED', userMessage: message });
}

function conflict(message: string): AppError {
  return new AppError({ code: 'RESOURCE_CONFLICT', userMessage: message });
}

function notFound(): AppError {
  return new AppError({
    code: 'RESOURCE_NOT_FOUND',
    userMessage: 'Maintenance window not found.',
  });
}

export function assertMaintenanceBounds(startsAt: Date, endsAt: Date, now: Date): void {
  if (Number.isNaN(startsAt.getTime()) || Number.isNaN(endsAt.getTime())) {
    throw invalid('Start and end must be valid dates.');
  }
  if (endsAt.getTime() <= startsAt.getTime()) throw invalid('End must be after start.');
  if (endsAt.getTime() <= now.getTime()) throw invalid('End must be in the future.');
  if (endsAt.getTime() - startsAt.getTime() > MAINTENANCE_LIMITS.maxDurationMs) {
    throw invalid('A maintenance window can last at most 7 days.');
  }
}

/** Services (from the given set) that are inside an active window right now. */
export async function findServicesInMaintenance(
  serviceIds: string[],
  at: Date = new Date()
): Promise<Map<string, { id: string; title: string; endsAt: Date }>> {
  const result = new Map<string, { id: string; title: string; endsAt: Date }>();
  if (serviceIds.length === 0) return result;
  const rows = await prisma.maintenanceWindowService.findMany({
    where: { serviceId: { in: serviceIds }, startsAt: { lte: at }, endsAt: { gt: at } },
    orderBy: { endsAt: 'desc' },
    select: { serviceId: true, endsAt: true, window: { select: { id: true, title: true } } },
  });
  for (const row of rows) {
    if (!result.has(row.serviceId)) {
      result.set(row.serviceId, { ...row.window, endsAt: row.endsAt });
    }
  }
  return result;
}

export interface MaintenanceCommandOptions {
  now?: Date;
  /** Run inside the caller's transaction (REST v2 idempotent writes). */
  tx?: Prisma.TransactionClient;
}

function inTransaction<T>(
  tx: Prisma.TransactionClient | undefined,
  fn: (tx: Prisma.TransactionClient) => Promise<T>
): Promise<T> {
  return tx ? fn(tx) : prisma.$transaction(fn);
}

async function lockWindow(tx: Prisma.TransactionClient, windowId: string) {
  const key = `maintenance-window:${windowId}`;
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${key}, 0))`;
}

async function assertServicesExist(tx: Prisma.TransactionClient, serviceIds: string[]) {
  const count = await tx.service.count({ where: { id: { in: serviceIds } } });
  if (count !== serviceIds.length) throw invalid('One or more services do not exist.');
}

async function writeServiceRows(
  tx: Prisma.TransactionClient,
  windowId: string,
  serviceIds: string[],
  startsAt: Date,
  endsAt: Date
) {
  await tx.maintenanceWindowService.deleteMany({ where: { windowId } });
  await tx.maintenanceWindowService.createMany({
    data: serviceIds.map(serviceId => ({ windowId, serviceId, startsAt, endsAt })),
  });
}

async function audit(
  tx: Prisma.TransactionClient,
  action: string,
  windowId: string,
  serviceIds: string[],
  actor: MaintenanceActor,
  details: Record<string, unknown>
) {
  for (const serviceId of serviceIds) {
    await logAudit(
      {
        action,
        entityType: 'SERVICE',
        entityId: serviceId,
        actorId: actor.id,
        source: actor.source,
        details: { maintenanceWindowId: windowId, ...details } as Prisma.InputJsonValue,
      },
      tx
    );
  }
}

interface AnnouncementSource {
  id: string;
  title: string;
  description: string | null;
  startsAt: Date;
  endsAt: Date;
  publishToStatusPage: boolean;
  serviceIds: string[];
}

function announcementMessage(window: AnnouncementSource): string {
  return window.description?.trim() || `Scheduled maintenance: ${window.title}`;
}

/**
 * Keeps exactly one MAINTENANCE announcement per status page that shows any of
 * the window's services. It reuses the settings route's generation and fan-out
 * contract, so status-page display, history, subscriber email and incident-email
 * suppression all work unchanged.
 */
export async function syncMaintenanceAnnouncements(
  tx: Prisma.TransactionClient,
  window: AnnouncementSource | { id: string; publishToStatusPage: false }
) {
  const desired = new Map<string, string[]>();
  if (window.publishToStatusPage) {
    const rows = await tx.statusPageService.findMany({
      where: { serviceId: { in: window.serviceIds }, showOnPage: true },
      select: { statusPageId: true, serviceId: true },
    });
    for (const row of rows) {
      desired.set(row.statusPageId, [...(desired.get(row.statusPageId) ?? []), row.serviceId]);
    }
  }

  const existing = await tx.statusPageAnnouncement.findMany({
    where: { maintenanceWindowId: window.id },
    select: {
      id: true,
      statusPageId: true,
      title: true,
      message: true,
      startDate: true,
      endDate: true,
      affectedServiceIds: true,
    },
  });

  for (const announcement of existing) {
    if (desired.has(announcement.statusPageId)) continue;
    await lockAnnouncementMutation(tx, announcement.statusPageId, announcement.id);
    await incrementAnnouncementNotificationGeneration(
      announcement.id,
      announcement.statusPageId,
      tx
    );
    await cancelPendingAnnouncementJobs(tx, announcement.id, announcement.statusPageId);
    await suppressUndeliveredAnnouncementIntents(
      tx,
      announcement.id,
      'Maintenance window no longer publishes to this status page.'
    );
    await tx.statusPageAnnouncement.delete({ where: { id: announcement.id } });
  }

  if (!window.publishToStatusPage) return;
  const now = new Date();
  for (const [statusPageId, serviceIds] of desired) {
    const content = {
      title: window.title,
      message: announcementMessage(window),
      startDate: window.startsAt,
      endDate: window.endsAt,
      affectedServiceIds: serviceIds.sort(),
    };
    const current = existing.find(a => a.statusPageId === statusPageId);
    if (!current) {
      const created = await tx.statusPageAnnouncement.create({
        data: {
          ...content,
          statusPageId,
          type: 'MAINTENANCE',
          timeMode: 'EXACT',
          allDay: false,
          publishAt: now,
          notificationTiming: 'ON_PUBLISH',
          isActive: true,
          maintenanceWindowId: window.id,
        },
        select: { id: true, notificationGeneration: true },
      });
      await createAnnouncementFanoutJob(tx, {
        announcementId: created.id,
        statusPageId,
        scheduledAt: now,
        generation: created.notificationGeneration,
        deliveryMode: 'ALL_ELIGIBLE',
      });
      continue;
    }

    const unchanged =
      current.title === content.title &&
      current.message === content.message &&
      current.startDate.getTime() === content.startDate.getTime() &&
      current.endDate?.getTime() === content.endDate.getTime() &&
      JSON.stringify(current.affectedServiceIds) === JSON.stringify(content.affectedServiceIds);
    if (unchanged) continue;

    await lockAnnouncementMutation(tx, statusPageId, current.id);
    await tx.statusPageAnnouncement.update({ where: { id: current.id }, data: content });
    const generation = await incrementAnnouncementNotificationGeneration(
      current.id,
      statusPageId,
      tx
    );
    await cancelPendingAnnouncementJobs(tx, current.id, statusPageId);
    await suppressUndeliveredAnnouncementIntents(
      tx,
      current.id,
      'Maintenance window was updated; superseded by a newer generation.'
    );
    // Only subscribers who never received an earlier generation are emailed.
    await createAnnouncementFanoutJob(tx, {
      announcementId: current.id,
      statusPageId,
      scheduledAt: now,
      generation,
      deliveryMode: 'UNDELIVERED_ONLY',
    });
  }
}

export async function getMaintenanceWindow(id: string) {
  return prisma.maintenanceWindow.findUnique({ where: { id }, select: maintenanceWindowSelect });
}

export async function createMaintenanceWindow(
  input: MaintenanceWindowCreateInput,
  actor: MaintenanceActor,
  options: MaintenanceCommandOptions = {}
): Promise<MaintenanceWindowRecord> {
  const now = options.now ?? new Date();
  const data = MaintenanceWindowCreateSchema.parse(input);
  if (data.startsAt.getTime() < now.getTime() - MAINTENANCE_LIMITS.startGraceMs) {
    throw invalid('Start cannot be in the past.');
  }
  assertMaintenanceBounds(data.startsAt, data.endsAt, now);

  return inTransaction(options.tx, async tx => {
    await assertServicesExist(tx, data.serviceIds);
    const created = await tx.maintenanceWindow.create({
      data: {
        title: data.title,
        description: data.description || null,
        startsAt: data.startsAt,
        endsAt: data.endsAt,
        endBehavior: data.endBehavior,
        publishToStatusPage: data.publishToStatusPage,
        createdById: actor.id,
      },
      select: { id: true },
    });
    await writeServiceRows(tx, created.id, data.serviceIds, data.startsAt, data.endsAt);
    await syncMaintenanceAnnouncements(tx, {
      id: created.id,
      title: data.title,
      description: data.description ?? null,
      startsAt: data.startsAt,
      endsAt: data.endsAt,
      publishToStatusPage: data.publishToStatusPage,
      serviceIds: data.serviceIds,
    });
    await audit(tx, 'maintenance_window.created', created.id, data.serviceIds, actor, {
      title: data.title,
      startsAt: data.startsAt.toISOString(),
      endsAt: data.endsAt.toISOString(),
      endBehavior: data.endBehavior,
    });
    return tx.maintenanceWindow.findUniqueOrThrow({
      where: { id: created.id },
      select: maintenanceWindowSelect,
    });
  });
}

export async function updateMaintenanceWindow(
  id: string,
  input: MaintenanceWindowPatchInput,
  actor: MaintenanceActor,
  options: MaintenanceCommandOptions & { expectedRevision?: number } = {}
): Promise<MaintenanceWindowRecord> {
  const patch = MaintenanceWindowPatchSchema.parse(input);
  const now = options.now ?? new Date();

  return inTransaction(options.tx, async tx => {
    await lockWindow(tx, id);
    const existing = await tx.maintenanceWindow.findUnique({
      where: { id },
      select: maintenanceWindowSelect,
    });
    if (!existing) throw notFound();
    if (options.expectedRevision !== undefined && existing.revision !== options.expectedRevision) {
      throw new AppError({ code: 'PRECONDITION_FAILED' });
    }

    const phase = maintenanceWindowPhase(existing, now);
    if (phase === 'ENDED') throw conflict('An ended maintenance window cannot be changed.');
    if (
      phase === 'ACTIVE' &&
      patch.startsAt &&
      patch.startsAt.getTime() !== existing.startsAt.getTime()
    ) {
      throw conflict('The start of an active maintenance window cannot be changed.');
    }
    const startsAt = patch.startsAt ?? existing.startsAt;
    const endsAt = patch.endsAt ?? existing.endsAt;
    if (
      phase === 'UPCOMING' &&
      patch.startsAt &&
      startsAt.getTime() < now.getTime() - MAINTENANCE_LIMITS.startGraceMs
    ) {
      throw invalid('Start cannot be in the past.');
    }
    assertMaintenanceBounds(startsAt, endsAt, now);

    const serviceIds = patch.serviceIds ?? existing.services.map(s => s.serviceId);
    if (patch.serviceIds) await assertServicesExist(tx, serviceIds);

    const title = patch.title ?? existing.title;
    const description =
      patch.description === undefined ? existing.description : patch.description || null;
    const publishToStatusPage = patch.publishToStatusPage ?? existing.publishToStatusPage;

    await tx.maintenanceWindow.update({
      where: { id },
      data: {
        title,
        description,
        startsAt,
        endsAt,
        publishToStatusPage,
        ...(patch.endBehavior ? { endBehavior: patch.endBehavior } : {}),
      },
    });
    await writeServiceRows(tx, id, serviceIds, startsAt, endsAt);
    await syncMaintenanceAnnouncements(tx, {
      id,
      title,
      description,
      startsAt,
      endsAt,
      publishToStatusPage,
      serviceIds,
    });
    const affected = Array.from(
      new Set([...serviceIds, ...existing.services.map(s => s.serviceId)])
    );
    await audit(tx, 'maintenance_window.updated', id, affected, actor, {
      changes: Object.keys(patch),
      startsAt: startsAt.toISOString(),
      endsAt: endsAt.toISOString(),
    });
    return tx.maintenanceWindow.findUniqueOrThrow({
      where: { id },
      select: maintenanceWindowSelect,
    });
  });
}

/** Ends an active window now and releases its held incidents. Idempotent. */
export async function endMaintenanceWindowNow(
  id: string,
  actor: MaintenanceActor,
  options: MaintenanceCommandOptions = {}
): Promise<MaintenanceWindowRecord> {
  const now = options.now ?? new Date();
  const ended = await inTransaction(options.tx, async tx => {
    await lockWindow(tx, id);
    const existing = await tx.maintenanceWindow.findUnique({
      where: { id },
      select: maintenanceWindowSelect,
    });
    if (!existing) throw notFound();
    const phase = maintenanceWindowPhase(existing, now);
    if (phase === 'ENDED') return existing;
    if (phase === 'UPCOMING') {
      throw conflict('This maintenance window has not started; delete it instead.');
    }
    const serviceIds = existing.services.map(s => s.serviceId);
    await tx.maintenanceWindow.update({ where: { id }, data: { endsAt: now } });
    await tx.maintenanceWindowService.updateMany({
      where: { windowId: id },
      data: { endsAt: now },
    });
    await syncMaintenanceAnnouncements(tx, {
      id,
      title: existing.title,
      description: existing.description,
      startsAt: existing.startsAt,
      endsAt: now,
      publishToStatusPage: existing.publishToStatusPage,
      serviceIds,
    });
    await audit(tx, 'maintenance_window.ended', id, serviceIds, actor, {
      endedAt: now.toISOString(),
      scheduledEnd: existing.endsAt.toISOString(),
    });
    return tx.maintenanceWindow.findUniqueOrThrow({
      where: { id },
      select: maintenanceWindowSelect,
    });
  });

  // Inside a caller's transaction nothing is committed yet; the sweep picks it up.
  if (options.tx) return ended;
  // Best effort: the scheduler sweep is the durable backstop if this fails.
  try {
    await processEndedMaintenanceWindow(id, now);
  } catch (error) {
    logger.warn('maintenance_window.inline_release_failed', {
      maintenanceWindowId: id,
      error: error instanceof Error ? error.message : String(error),
    });
  }
  return ended;
}

/** Only upcoming windows can be deleted; active ones are ended, ended ones are history. */
export async function deleteMaintenanceWindow(
  id: string,
  actor: MaintenanceActor,
  options: MaintenanceCommandOptions = {}
): Promise<void> {
  const now = options.now ?? new Date();
  await inTransaction(options.tx, async tx => {
    await lockWindow(tx, id);
    const existing = await tx.maintenanceWindow.findUnique({
      where: { id },
      select: maintenanceWindowSelect,
    });
    if (!existing) throw notFound();
    if (maintenanceWindowPhase(existing, now) !== 'UPCOMING') {
      throw conflict(
        'Only upcoming maintenance windows can be deleted. End an active window instead.'
      );
    }
    await syncMaintenanceAnnouncements(tx, { id, publishToStatusPage: false });
    await audit(
      tx,
      'maintenance_window.deleted',
      id,
      existing.services.map(s => s.serviceId),
      actor,
      { title: existing.title }
    );
    await tx.maintenanceWindow.delete({ where: { id } });
  });
}

async function releaseHeldIncident(
  incidentId: string,
  windowId: string,
  endBehavior: MaintenanceEndBehavior,
  now: Date
): Promise<boolean> {
  return runSerializableTransaction(async tx => {
    const current = await tx.incident.findUnique({
      where: { id: incidentId },
      select: { status: true, maintenanceWindowId: true },
    });
    // A responder may already have acted on it; never override that.
    if (!current || current.status !== 'SUPPRESSED' || current.maintenanceWindowId !== windowId) {
      return false;
    }
    const result = await applyIncidentLifecycleCommand(tx, {
      incidentId,
      source: 'SYSTEM',
      expectedStatus: 'SUPPRESSED',
      ...(endBehavior === 'RESOLVE_HELD'
        ? {
            command: 'RESOLVE' as const,
            resolutionKind: 'AUTOMATION' as const,
            eventMessage: 'Maintenance window ended; held incident auto-resolved.',
          }
        : {
            command: 'UNSUPPRESS' as const,
            eventMessage:
              'Maintenance window ended while the alert was still firing; incident released for paging.',
          }),
      now,
    });
    return result.changed;
  });
}

/**
 * Releases every incident a window still holds, then marks the window
 * processed. Each release is its own idempotent transaction; the window is only
 * marked once all succeed, so a crash or a failed release resumes on the next tick.
 */
export async function processEndedMaintenanceWindow(
  windowId: string,
  now: Date = new Date()
): Promise<{ released: number; complete: boolean }> {
  const window = await prisma.maintenanceWindow.findUnique({
    where: { id: windowId },
    select: { endsAt: true, endProcessedAt: true, endBehavior: true },
  });
  if (!window || window.endProcessedAt || window.endsAt.getTime() > now.getTime()) {
    return { released: 0, complete: true };
  }

  let released = 0;
  let failed = 0;
  let cursor: string | undefined;
  for (;;) {
    const batch = await prisma.incident.findMany({
      where: {
        maintenanceWindowId: windowId,
        status: 'SUPPRESSED',
        ...(cursor ? { id: { gt: cursor } } : {}),
      },
      orderBy: { id: 'asc' },
      take: MAINTENANCE_LIMITS.sweepIncidentBatch,
      select: { id: true },
    });
    if (batch.length === 0) break;
    cursor = batch[batch.length - 1].id;
    for (const incident of batch) {
      try {
        if (await releaseHeldIncident(incident.id, windowId, window.endBehavior, now))
          released += 1;
      } catch (error) {
        failed += 1;
        logger.error('maintenance_window.release_failed', {
          maintenanceWindowId: windowId,
          incidentId: incident.id,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }

  if (failed > 0) return { released, complete: false };
  await prisma.maintenanceWindow.updateMany({
    where: { id: windowId, endProcessedAt: null, endsAt: { lte: now } },
    data: { endProcessedAt: now },
  });
  logger.info('maintenance_window.end_processed', {
    maintenanceWindowId: windowId,
    released,
    endBehavior: window.endBehavior,
  });
  return { released, complete: true };
}

/** Scheduler entrypoint: oldest unprocessed ended windows first, bounded per tick. */
export async function processEndedMaintenanceWindows(
  now: Date = new Date()
): Promise<{ windows: number; released: number }> {
  const due = await prisma.maintenanceWindow.findMany({
    where: { endProcessedAt: null, endsAt: { lte: now } },
    orderBy: { endsAt: 'asc' },
    take: MAINTENANCE_LIMITS.sweepWindowsPerRun,
    select: { id: true },
  });
  let released = 0;
  for (const window of due) {
    try {
      released += (await processEndedMaintenanceWindow(window.id, now)).released;
    } catch (error) {
      logger.error('maintenance_window.sweep_failed', {
        maintenanceWindowId: window.id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return { windows: due.length, released };
}

export async function listMaintenanceWindows(options: {
  serviceIds?: string[];
  phase?: MaintenanceWindowPhase;
  take?: number;
  cursor?: string;
  now?: Date;
}) {
  const now = options.now ?? new Date();
  const where: Prisma.MaintenanceWindowWhereInput = {
    ...(options.serviceIds
      ? { services: { some: { serviceId: { in: options.serviceIds } } } }
      : {}),
    ...(options.phase === 'UPCOMING' ? { startsAt: { gt: now } } : {}),
    ...(options.phase === 'ACTIVE' ? { startsAt: { lte: now }, endsAt: { gt: now } } : {}),
    ...(options.phase === 'ENDED' ? { endsAt: { lte: now } } : {}),
  };
  return prisma.maintenanceWindow.findMany({
    where,
    orderBy: [{ startsAt: 'desc' }, { id: 'desc' }],
    take: options.take ?? 50,
    ...(options.cursor ? { cursor: { id: options.cursor }, skip: 1 } : {}),
    select: maintenanceWindowSelect,
  });
}
