import type { Prisma } from '@prisma/client';
import { AppError } from '@/lib/errors';
import {
  buildScheduleBlocks, getFinalScheduleBlocks,
  type LayerInput, type LayerRestrictions, type OverrideInput,
} from '@/lib/oncall';
import type { z } from 'zod';
import { scheduleLayerBodySchema } from './layer-commands';

type Candidate = z.infer<typeof scheduleLayerBodySchema>;
const DAY_MS = 86_400_000;

export async function previewScheduleLayer(
  tx: Prisma.TransactionClient,
  scheduleId: string,
  revision: number,
  windowStart: Date,
  windowEnd: Date,
  layerId: string | null,
  candidate: Candidate
) {
  if (windowEnd <= windowStart || windowEnd.getTime() - windowStart.getTime() > 7 * DAY_MS) {
    throw new AppError({ code: 'VALIDATION_FAILED', userMessage: 'Preview range must be greater than zero and no longer than seven days.' });
  }
  const schedule = await tx.onCallSchedule.findUnique({
    where: { id: scheduleId },
    select: {
      id: true, name: true, timeZone: true, revision: true,
      layers: {
        take: 101, orderBy: [{ priority: 'desc' }, { createdAt: 'asc' }],
        include: { users: {
          orderBy: { position: 'asc' }, take: 101,
          include: { user: { select: {
            id: true, name: true, email: true, avatarUrl: true, gender: true,
            timeZone: true, emailNotificationsEnabled: true, status: true,
          } } },
        } },
      },
      overrides: {
        where: {
          start: { lt: windowEnd }, end: { gt: windowStart },
          user: { status: 'ACTIVE' },
        },
        take: 1001,
        include: { user: { select: {
          name: true, email: true, avatarUrl: true, gender: true,
          timeZone: true, emailNotificationsEnabled: true,
        } } },
      },
    },
  });
  if (!schedule) throw new AppError({ code: 'SCHEDULE_NOT_FOUND' });
  if (schedule.revision !== revision) throw new AppError({ code: 'PRECONDITION_FAILED' });
  if (schedule.layers.length > 100 || schedule.overrides.length > 1000 ||
      schedule.layers.some(layer => layer.users.length > 100)) {
    throw new AppError({ code: 'VALIDATION_FAILED', userMessage: 'Schedule is too large for a bounded preview.' });
  }
  const replaced = layerId ? schedule.layers.find(layer => layer.id === layerId) : null;
  if (layerId && !replaced) throw new AppError({ code: 'SCHEDULE_LAYER_NOT_FOUND' });
  if (!layerId && schedule.layers.length >= 100) {
    throw new AppError({ code: 'VALIDATION_FAILED', userMessage: 'A schedule can have at most 100 layers.' });
  }
  const otherAssigned = new Set(schedule.layers
    .filter(layer => layer.id !== layerId)
    .flatMap(layer => layer.users.map(member => member.userId)));
  if (candidate.responderIds.some(id => otherAssigned.has(id))) {
    throw new AppError({ code: 'SCHEDULE_LAYER_USER_DUPLICATE' });
  }
  const active = await tx.user.findMany({
    where: { id: { in: candidate.responderIds }, status: 'ACTIVE' },
    select: {
      id: true, name: true, email: true, avatarUrl: true, gender: true,
      timeZone: true, emailNotificationsEnabled: true,
    },
  });
  if (active.length !== candidate.responderIds.length) {
    throw new AppError({ code: 'SCHEDULE_RESPONDER_NOT_ACTIVE' });
  }
  const activeById = new Map(active.map(user => [user.id, user]));
  const layers: LayerInput[] = schedule.layers.filter(layer => layer.id !== layerId).map(layer => ({
    id: layer.id, name: layer.name, start: layer.start, end: layer.end,
    rotationLengthHours: layer.rotationLengthHours,
    shiftLengthHours: layer.shiftLengthHours,
    restrictions: layer.restrictions as LayerRestrictions | null,
    priority: layer.priority,
    users: layer.users.filter(member => member.user.status === 'ACTIVE').map(member => ({
      userId: member.userId, position: member.position,
      user: {
        name: member.user.name ?? 'Unknown User', email: member.user.email,
        avatarUrl: member.user.avatarUrl, gender: member.user.gender,
        timeZone: member.user.timeZone,
        emailNotificationsEnabled: member.user.emailNotificationsEnabled,
      },
    })),
  }));
  const previewId = layerId ?? 'preview-layer';
  const priority = replaced?.priority ?? (layers.length ? Math.min(...layers.map(layer => layer.priority ?? 0)) - 1 : 0);
  layers.push({
    id: previewId, name: candidate.name,
    start: new Date(candidate.start), end: candidate.end ? new Date(candidate.end) : null,
    rotationLengthHours: candidate.rotationLengthHours,
    shiftLengthHours: candidate.shiftLengthHours,
    restrictions: candidate.restrictions,
    priority,
    users: candidate.responderIds.map((id, index) => {
      const user = activeById.get(id)!;
      return {
        userId: id, position: index + 1,
        user: {
          name: user.name ?? 'Unknown User', email: user.email,
          avatarUrl: user.avatarUrl, gender: user.gender,
          timeZone: user.timeZone,
          emailNotificationsEnabled: user.emailNotificationsEnabled,
        },
      };
    }),
  });
  const overrides: OverrideInput[] = schedule.overrides.map(override => ({
    id: override.id, userId: override.userId,
    user: {
      name: override.user.name ?? 'Unknown User', email: override.user.email,
      avatarUrl: override.user.avatarUrl, gender: override.user.gender,
      timeZone: override.user.timeZone,
      emailNotificationsEnabled: override.user.emailNotificationsEnabled,
    },
    start: override.start, end: override.end, replacesUserId: override.replacesUserId,
  }));
  const blocks = getFinalScheduleBlocks(
    buildScheduleBlocks(layers, overrides, windowStart, windowEnd, schedule.timeZone || 'UTC'),
    new Map(layers.map(layer => [layer.id, layer.priority ?? 0]))
  );
  const intervals = blocks
    .map(block => ({
      userId: block.userId,
      start: Math.max(windowStart.getTime(), block.start.getTime()),
      end: Math.min(windowEnd.getTime(), block.end.getTime()),
    }))
    .filter(block => block.end > block.start)
    .sort((a, b) => a.start - b.start || a.end - b.end);
  const gaps: Array<{ start: string; end: string }> = [];
  let coveredUntil = windowStart.getTime();
  for (const block of intervals) {
    if (block.start > coveredUntil) {
      gaps.push({ start: new Date(coveredUntil).toISOString(), end: new Date(block.start).toISOString() });
    }
    coveredUntil = Math.max(coveredUntil, block.end);
  }
  if (coveredUntil < windowEnd.getTime()) {
    gaps.push({ start: new Date(coveredUntil).toISOString(), end: windowEnd.toISOString() });
  }
  return {
    scheduleId, revision, layerId: previewId, advisory: true,
    start: windowStart.toISOString(), end: windowEnd.toISOString(),
    shifts: intervals.map(block => ({
      userId: block.userId,
      start: new Date(block.start).toISOString(), end: new Date(block.end).toISOString(),
    })),
    gaps,
  };
}
