import 'server-only';

import { Prisma } from '@prisma/client';
import { z } from 'zod';
import prisma from '@/lib/prisma';
import { logAudit } from '@/lib/audit';
import { AppError } from '@/lib/errors/app-error';
import { logger } from '@/lib/logger';
import {
  createMaintenanceWindow,
  deleteMaintenanceWindow,
  MAINTENANCE_LIMITS,
  type MaintenanceActor,
} from '@/lib/service-maintenance/windows';
import {
  describeRecurrence,
  nextOccurrence,
  occurrencesBetween,
  recurrenceError,
  type MaintenanceRecurrence,
} from '@/lib/service-maintenance/recurrence';

// Recurring maintenance never touches ingestion or the end sweep: every upcoming
// occurrence is materialised as an ordinary MaintenanceWindow (scheduleId set),
// created through the same command as a one-off window.

export const MAINTENANCE_SCHEDULE_LIMITS = {
  horizonMs: 14 * 24 * 60 * 60 * 1000,
  // Top up once the materialised horizon is a day short.
  refreshMs: 24 * 60 * 60 * 1000,
  schedulesPerRun: 20,
  occurrencesPerSchedule: 60,
  transactionTimeoutMs: 60_000,
  failureBackoffMs: 15 * 60 * 1000,
} as const;

// shortcut: per-process backoff so a persistently failing schedule cannot hog the
// per-tick batch; it resets when scheduler leadership moves, which only costs a retry.
const failedUntil = new Map<string, number>();

const dateKey = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a YYYY-MM-DD date.');

const fields = {
  title: z.string().trim().min(1).max(200),
  description: z.string().trim().max(2000).nullish(),
  serviceIds: z
    .array(z.string().trim().min(1).max(64))
    .min(1, 'Select at least one service.')
    .max(MAINTENANCE_LIMITS.maxServices)
    .transform(ids => Array.from(new Set(ids))),
  endBehavior: z.enum(['RESUME_FIRING', 'RESOLVE_HELD']),
  publishToStatusPage: z.boolean(),
  frequency: z.enum(['DAILY', 'WEEKLY', 'MONTHLY']),
  interval: z.number().int().min(1).max(52),
  byWeekday: z.array(z.number().int().min(0).max(6)).max(7),
  dayOfMonth: z.number().int().min(1).max(31).nullish(),
  timeZone: z.string().trim().min(1).max(64),
  startTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use a HH:mm start time.'),
  durationMinutes: z
    .number()
    .int()
    .min(1)
    .max(MAINTENANCE_LIMITS.maxDurationMs / 60_000, 'An occurrence can last at most 7 days.'),
  startsOn: dateKey,
  endsOn: dateKey.nullish(),
};

export const MaintenanceScheduleCreateSchema = z
  .object({
    ...fields,
    endBehavior: fields.endBehavior.default('RESUME_FIRING'),
    publishToStatusPage: fields.publishToStatusPage.default(false),
    interval: fields.interval.default(1),
    byWeekday: fields.byWeekday.default([]),
  })
  .strict();

export const MaintenanceSchedulePatchSchema = z
  .object({
    ...fields,
    /** true pauses (upcoming occurrences are removed), false resumes. */
    paused: z.boolean(),
  })
  .partial()
  .strict();

export type MaintenanceScheduleCreateInput = z.input<typeof MaintenanceScheduleCreateSchema>;
export type MaintenanceSchedulePatchInput = z.input<typeof MaintenanceSchedulePatchSchema>;

export const maintenanceScheduleSelect = {
  id: true,
  revision: true,
  title: true,
  description: true,
  endBehavior: true,
  publishToStatusPage: true,
  frequency: true,
  interval: true,
  byWeekday: true,
  dayOfMonth: true,
  timeZone: true,
  startTime: true,
  durationMinutes: true,
  startsOn: true,
  endsOn: true,
  pausedAt: true,
  materializedUntil: true,
  createdById: true,
  createdAt: true,
  updatedAt: true,
  services: { select: { serviceId: true, service: { select: { name: true, teamId: true } } } },
} satisfies Prisma.MaintenanceScheduleSelect;

export type MaintenanceScheduleRecord = Prisma.MaintenanceScheduleGetPayload<{
  select: typeof maintenanceScheduleSelect;
}>;

export interface MaintenanceScheduleOptions {
  now?: Date;
  /** Run inside the caller's transaction (REST v2 idempotent writes). */
  tx?: Prisma.TransactionClient;
}

const SYSTEM_ACTOR: MaintenanceActor = { id: null, source: 'SYSTEM' };

function notFound(): AppError {
  return new AppError({
    code: 'RESOURCE_NOT_FOUND',
    userMessage: 'Maintenance schedule not found.',
  });
}

/** Normalises a rule (drops fields its frequency ignores) and validates it. */
function toRecurrence(input: {
  frequency: MaintenanceRecurrence['frequency'];
  interval: number;
  byWeekday: number[];
  dayOfMonth?: number | null;
  timeZone: string;
  startTime: string;
  durationMinutes: number;
  startsOn: string;
  endsOn?: string | null;
}): MaintenanceRecurrence {
  const rule: MaintenanceRecurrence = {
    frequency: input.frequency,
    interval: input.interval,
    byWeekday:
      input.frequency === 'WEEKLY' ? [...new Set(input.byWeekday)].sort((a, b) => a - b) : [],
    dayOfMonth: input.frequency === 'MONTHLY' ? (input.dayOfMonth ?? null) : null,
    timeZone: input.timeZone,
    startTime: input.startTime,
    durationMinutes: input.durationMinutes,
    startsOn: input.startsOn,
    endsOn: input.endsOn ?? null,
  };
  const error = recurrenceError(rule);
  if (error) throw new AppError({ code: 'VALIDATION_FAILED', userMessage: error });
  return rule;
}

export function scheduleRecurrence(row: MaintenanceScheduleRecord): MaintenanceRecurrence {
  return {
    frequency: row.frequency,
    interval: row.interval,
    byWeekday: row.byWeekday,
    dayOfMonth: row.dayOfMonth,
    timeZone: row.timeZone,
    startTime: row.startTime,
    durationMinutes: row.durationMinutes,
    startsOn: row.startsOn,
    endsOn: row.endsOn,
  };
}

/** Human summary plus the next start (null when paused or finished). */
export function describeMaintenanceSchedule(row: MaintenanceScheduleRecord, now = new Date()) {
  const rule = scheduleRecurrence(row);
  return {
    summary: describeRecurrence(rule),
    nextOccurrence: row.pausedAt ? null : nextOccurrence(rule, now),
  };
}

async function lockSchedule(tx: Prisma.TransactionClient, scheduleId: string) {
  const key = `maintenance-schedule:${scheduleId}`;
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${key}, 0))`;
}

function inTransaction<T>(
  tx: Prisma.TransactionClient | undefined,
  fn: (tx: Prisma.TransactionClient) => Promise<T>
): Promise<T> {
  return tx
    ? fn(tx)
    : prisma.$transaction(fn, { timeout: MAINTENANCE_SCHEDULE_LIMITS.transactionTimeoutMs });
}

async function audit(
  tx: Prisma.TransactionClient,
  action: string,
  scheduleId: string,
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
        details: { maintenanceScheduleId: scheduleId, ...details } as Prisma.InputJsonValue,
      },
      tx
    );
  }
}

/**
 * Creates the occurrences starting in (materializedUntil, now + horizon]. Starting
 * after the previous horizon means an occurrence someone deleted or moved by hand
 * is not recreated. `fresh` restarts from now (after an edit or resume).
 * Caller holds the schedule lock.
 */
async function materializeLocked(
  tx: Prisma.TransactionClient,
  scheduleId: string,
  actor: MaintenanceActor,
  now: Date,
  fresh: boolean
): Promise<number> {
  const schedule = await tx.maintenanceSchedule.findUnique({
    where: { id: scheduleId },
    select: maintenanceScheduleSelect,
  });
  if (!schedule || schedule.pausedAt) return 0;
  const until = new Date(now.getTime() + MAINTENANCE_SCHEDULE_LIMITS.horizonMs);
  const previous = fresh ? null : schedule.materializedUntil;
  const from = previous && previous > now ? new Date(previous.getTime() + 1) : now;
  const serviceIds = schedule.services.map(s => s.serviceId);

  let created = 0;
  if (serviceIds.length > 0 && from <= until) {
    const occurrences = occurrencesBetween(
      scheduleRecurrence(schedule),
      from,
      until,
      MAINTENANCE_SCHEDULE_LIMITS.occurrencesPerSchedule
    );
    const existing = new Set(
      (
        await tx.maintenanceWindow.findMany({
          where: { scheduleId, startsAt: { gte: from, lte: until } },
          select: { startsAt: true },
        })
      ).map(w => w.startsAt.getTime())
    );
    for (const occurrence of occurrences) {
      // The schedule lock serialises writers; the unique (scheduleId, startsAt)
      // index is the backstop.
      if (existing.has(occurrence.startsAt.getTime())) continue;
      await createMaintenanceWindow(
        {
          title: schedule.title,
          description: schedule.description,
          serviceIds,
          startsAt: occurrence.startsAt,
          endsAt: occurrence.endsAt,
          endBehavior: schedule.endBehavior,
          publishToStatusPage: schedule.publishToStatusPage,
        },
        actor,
        { tx, now, scheduleId }
      );
      created += 1;
    }
  }
  await tx.maintenanceSchedule.update({
    where: { id: scheduleId },
    data: { materializedUntil: until },
  });
  return created;
}

/** Deletes occurrences that have not started. Active and ended ones are never touched. */
async function deleteUpcomingOccurrences(
  tx: Prisma.TransactionClient,
  scheduleId: string,
  actor: MaintenanceActor,
  now: Date
) {
  const upcoming = await tx.maintenanceWindow.findMany({
    where: { scheduleId, startsAt: { gt: now } },
    select: { id: true },
  });
  for (const window of upcoming) {
    await deleteMaintenanceWindow(window.id, actor, { tx, now });
  }
}

export async function getMaintenanceSchedule(id: string) {
  return prisma.maintenanceSchedule.findUnique({
    where: { id },
    select: maintenanceScheduleSelect,
  });
}

export async function listMaintenanceSchedules(options: { serviceIds?: string[]; take?: number }) {
  return prisma.maintenanceSchedule.findMany({
    where: options.serviceIds
      ? { services: { some: { serviceId: { in: options.serviceIds } } } }
      : {},
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: options.take ?? 50,
    select: maintenanceScheduleSelect,
  });
}

export async function createMaintenanceSchedule(
  input: MaintenanceScheduleCreateInput,
  actor: MaintenanceActor,
  options: MaintenanceScheduleOptions = {}
): Promise<MaintenanceScheduleRecord> {
  const now = options.now ?? new Date();
  const data = MaintenanceScheduleCreateSchema.parse(input);
  const rule = toRecurrence(data);

  return inTransaction(options.tx, async tx => {
    const count = await tx.service.count({ where: { id: { in: data.serviceIds } } });
    if (count !== data.serviceIds.length) {
      throw new AppError({
        code: 'VALIDATION_FAILED',
        userMessage: 'One or more services do not exist.',
      });
    }
    const created = await tx.maintenanceSchedule.create({
      data: {
        ...rule,
        title: data.title,
        description: data.description || null,
        endBehavior: data.endBehavior,
        publishToStatusPage: data.publishToStatusPage,
        createdById: actor.id,
        services: { createMany: { data: data.serviceIds.map(serviceId => ({ serviceId })) } },
      },
      select: { id: true },
    });
    await lockSchedule(tx, created.id);
    await audit(tx, 'maintenance_schedule.created', created.id, data.serviceIds, actor, {
      title: data.title,
      summary: describeRecurrence(rule),
    });
    await materializeLocked(tx, created.id, actor, now, true);
    return tx.maintenanceSchedule.findUniqueOrThrow({
      where: { id: created.id },
      select: maintenanceScheduleSelect,
    });
  });
}

/**
 * Applies a change, then replaces the upcoming occurrences: those not yet started
 * are deleted and re-materialised from the new rule (unless paused). Active and
 * ended occurrences keep their original bounds.
 */
export async function updateMaintenanceSchedule(
  id: string,
  input: MaintenanceSchedulePatchInput,
  actor: MaintenanceActor,
  options: MaintenanceScheduleOptions & { expectedRevision?: number } = {}
): Promise<MaintenanceScheduleRecord> {
  const patch = MaintenanceSchedulePatchSchema.parse(input);
  const now = options.now ?? new Date();

  return inTransaction(options.tx, async tx => {
    await lockSchedule(tx, id);
    const existing = await tx.maintenanceSchedule.findUnique({
      where: { id },
      select: maintenanceScheduleSelect,
    });
    if (!existing) throw notFound();
    if (options.expectedRevision !== undefined && existing.revision !== options.expectedRevision) {
      throw new AppError({ code: 'PRECONDITION_FAILED' });
    }

    const current = scheduleRecurrence(existing);
    const rule = toRecurrence({
      frequency: patch.frequency ?? current.frequency,
      interval: patch.interval ?? current.interval,
      byWeekday: patch.byWeekday ?? current.byWeekday,
      dayOfMonth: patch.dayOfMonth === undefined ? current.dayOfMonth : patch.dayOfMonth,
      timeZone: patch.timeZone ?? current.timeZone,
      startTime: patch.startTime ?? current.startTime,
      durationMinutes: patch.durationMinutes ?? current.durationMinutes,
      startsOn: patch.startsOn ?? current.startsOn,
      endsOn: patch.endsOn === undefined ? current.endsOn : patch.endsOn,
    });
    const previousServiceIds = existing.services.map(s => s.serviceId);
    const serviceIds = patch.serviceIds ?? previousServiceIds;
    if (patch.serviceIds) {
      const count = await tx.service.count({ where: { id: { in: serviceIds } } });
      if (count !== serviceIds.length) {
        throw new AppError({
          code: 'VALIDATION_FAILED',
          userMessage: 'One or more services do not exist.',
        });
      }
      await tx.maintenanceScheduleService.deleteMany({ where: { scheduleId: id } });
      await tx.maintenanceScheduleService.createMany({
        data: serviceIds.map(serviceId => ({ scheduleId: id, serviceId })),
      });
    }
    const pausedAt =
      patch.paused === undefined
        ? existing.pausedAt
        : patch.paused
          ? (existing.pausedAt ?? now)
          : null;

    await tx.maintenanceSchedule.update({
      where: { id },
      data: {
        ...rule,
        title: patch.title ?? existing.title,
        description:
          patch.description === undefined ? existing.description : patch.description || null,
        ...(patch.endBehavior ? { endBehavior: patch.endBehavior } : {}),
        publishToStatusPage: patch.publishToStatusPage ?? existing.publishToStatusPage,
        pausedAt,
        materializedUntil: null,
      },
    });
    await deleteUpcomingOccurrences(tx, id, actor, now);
    await materializeLocked(tx, id, actor, now, true);

    const action =
      patch.paused === true && !existing.pausedAt
        ? 'maintenance_schedule.paused'
        : patch.paused === false && existing.pausedAt
          ? 'maintenance_schedule.resumed'
          : 'maintenance_schedule.updated';
    await audit(
      tx,
      action,
      id,
      Array.from(new Set([...serviceIds, ...previousServiceIds])),
      actor,
      { changes: Object.keys(patch), summary: describeRecurrence(rule) }
    );
    return tx.maintenanceSchedule.findUniqueOrThrow({
      where: { id },
      select: maintenanceScheduleSelect,
    });
  });
}

/** Deletes the schedule and its upcoming occurrences; active and ended ones stay as history. */
export async function deleteMaintenanceSchedule(
  id: string,
  actor: MaintenanceActor,
  options: MaintenanceScheduleOptions = {}
): Promise<void> {
  const now = options.now ?? new Date();
  await inTransaction(options.tx, async tx => {
    await lockSchedule(tx, id);
    const existing = await tx.maintenanceSchedule.findUnique({
      where: { id },
      select: maintenanceScheduleSelect,
    });
    if (!existing) throw notFound();
    await deleteUpcomingOccurrences(tx, id, actor, now);
    await audit(
      tx,
      'maintenance_schedule.deleted',
      id,
      existing.services.map(s => s.serviceId),
      actor,
      { title: existing.title }
    );
    // Remaining occurrences keep existing; their scheduleId is set to null.
    await tx.maintenanceSchedule.delete({ where: { id } });
  });
}

/**
 * Scheduler entrypoint: tops up schedules whose materialised horizon is more than
 * a day short, most behind first. Each schedule is its own transaction, so one
 * failure never blocks the others; it is retried on the next tick.
 */
export async function materializeMaintenanceSchedules(
  now: Date = new Date()
): Promise<{ schedules: number; created: number; failed: number }> {
  for (const [id, until] of failedUntil) if (until <= now.getTime()) failedUntil.delete(id);
  const due = await prisma.maintenanceSchedule.findMany({
    where: {
      pausedAt: null,
      ...(failedUntil.size > 0 ? { id: { notIn: [...failedUntil.keys()] } } : {}),
      OR: [
        { materializedUntil: null },
        {
          materializedUntil: {
            lt: new Date(
              now.getTime() +
                MAINTENANCE_SCHEDULE_LIMITS.horizonMs -
                MAINTENANCE_SCHEDULE_LIMITS.refreshMs
            ),
          },
        },
      ],
    },
    orderBy: { materializedUntil: { sort: 'asc', nulls: 'first' } },
    take: MAINTENANCE_SCHEDULE_LIMITS.schedulesPerRun,
    select: { id: true },
  });
  let created = 0;
  let failed = 0;
  for (const schedule of due) {
    try {
      created += await prisma.$transaction(
        async tx => {
          await lockSchedule(tx, schedule.id);
          return materializeLocked(tx, schedule.id, SYSTEM_ACTOR, now, false);
        },
        { timeout: MAINTENANCE_SCHEDULE_LIMITS.transactionTimeoutMs }
      );
    } catch (error) {
      failed += 1;
      failedUntil.set(schedule.id, now.getTime() + MAINTENANCE_SCHEDULE_LIMITS.failureBackoffMs);
      logger.warn('maintenance_schedule.materialize_failed', {
        maintenanceScheduleId: schedule.id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return { schedules: due.length, created, failed };
}
