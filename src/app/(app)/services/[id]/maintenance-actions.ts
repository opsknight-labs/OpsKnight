'use server';

import { revalidatePath } from 'next/cache';
import { ZodError } from 'zod';
import { assertCanModifyService } from '@/lib/rbac';
import { AppError } from '@/lib/errors/app-error';
import { logger } from '@/lib/logger';
import {
  createMaintenanceWindow,
  deleteMaintenanceWindow,
  endMaintenanceWindowNow,
  getMaintenanceWindow,
  updateMaintenanceWindow,
  type MaintenanceWindowCreateInput,
  type MaintenanceWindowPatchInput,
} from '@/lib/service-maintenance/windows';
import {
  createMaintenanceSchedule,
  deleteMaintenanceSchedule,
  getMaintenanceSchedule,
  updateMaintenanceSchedule,
  type MaintenanceScheduleCreateInput,
  type MaintenanceSchedulePatchInput,
} from '@/lib/service-maintenance/schedules';

export type MaintenanceActionResult = { ok: true } | { ok: false; error: string };

// A window spans services; the caller must be allowed to modify every one of them.
async function assertCanModifyAll(serviceIds: string[]) {
  let actorId: string | null = null;
  for (const serviceId of new Set(serviceIds)) {
    const user = await assertCanModifyService(serviceId);
    actorId = user.id;
  }
  return actorId;
}

async function existingServiceIds(windowId: string): Promise<string[]> {
  const window = await getMaintenanceWindow(windowId);
  if (!window) {
    throw new AppError({
      code: 'RESOURCE_NOT_FOUND',
      userMessage: 'Maintenance window not found.',
    });
  }
  return window.services.map(s => s.serviceId);
}

async function run(
  pathServiceId: string,
  name: string,
  fn: () => Promise<unknown>
): Promise<MaintenanceActionResult> {
  try {
    await fn();
    revalidatePath(`/services/${pathServiceId}`);
    revalidatePath('/services');
    return { ok: true };
  } catch (error) {
    if (error instanceof AppError) return { ok: false, error: error.userMessage };
    if (error instanceof ZodError) {
      return { ok: false, error: error.issues[0]?.message ?? 'Invalid maintenance window.' };
    }
    logger.error(`service_maintenance.${name}_failed`, {
      error: error instanceof Error ? error.message : String(error),
    });
    return { ok: false, error: 'Something went wrong. Please try again.' };
  }
}

export async function createMaintenanceWindowAction(
  pathServiceId: string,
  input: MaintenanceWindowCreateInput
): Promise<MaintenanceActionResult> {
  return run(pathServiceId, 'create', async () => {
    const serviceIds = Array.isArray(input?.serviceIds) ? input.serviceIds : [];
    const actorId = await assertCanModifyAll(serviceIds);
    await createMaintenanceWindow(input, { id: actorId, source: 'UI' });
  });
}

export async function updateMaintenanceWindowAction(
  pathServiceId: string,
  windowId: string,
  input: MaintenanceWindowPatchInput
): Promise<MaintenanceActionResult> {
  return run(pathServiceId, 'update', async () => {
    const next = Array.isArray(input?.serviceIds) ? input.serviceIds : [];
    const actorId = await assertCanModifyAll([...(await existingServiceIds(windowId)), ...next]);
    await updateMaintenanceWindow(windowId, input, { id: actorId, source: 'UI' });
  });
}

export async function endMaintenanceWindowAction(
  pathServiceId: string,
  windowId: string
): Promise<MaintenanceActionResult> {
  return run(pathServiceId, 'end', async () => {
    const actorId = await assertCanModifyAll(await existingServiceIds(windowId));
    await endMaintenanceWindowNow(windowId, { id: actorId, source: 'UI' });
  });
}

export async function deleteMaintenanceWindowAction(
  pathServiceId: string,
  windowId: string
): Promise<MaintenanceActionResult> {
  return run(pathServiceId, 'delete', async () => {
    const actorId = await assertCanModifyAll(await existingServiceIds(windowId));
    await deleteMaintenanceWindow(windowId, { id: actorId, source: 'UI' });
  });
}

async function existingScheduleServiceIds(scheduleId: string): Promise<string[]> {
  const schedule = await getMaintenanceSchedule(scheduleId);
  if (!schedule) {
    throw new AppError({
      code: 'RESOURCE_NOT_FOUND',
      userMessage: 'Maintenance schedule not found.',
    });
  }
  return schedule.services.map(s => s.serviceId);
}

export async function createMaintenanceScheduleAction(
  pathServiceId: string,
  input: MaintenanceScheduleCreateInput
): Promise<MaintenanceActionResult> {
  return run(pathServiceId, 'schedule_create', async () => {
    const serviceIds = Array.isArray(input?.serviceIds) ? input.serviceIds : [];
    const actorId = await assertCanModifyAll(serviceIds);
    await createMaintenanceSchedule(input, { id: actorId, source: 'UI' });
  });
}

/** Edits, pauses ({ paused: true }) or resumes ({ paused: false }) a schedule. */
export async function updateMaintenanceScheduleAction(
  pathServiceId: string,
  scheduleId: string,
  input: MaintenanceSchedulePatchInput
): Promise<MaintenanceActionResult> {
  return run(pathServiceId, 'schedule_update', async () => {
    const next = Array.isArray(input?.serviceIds) ? input.serviceIds : [];
    const actorId = await assertCanModifyAll([
      ...(await existingScheduleServiceIds(scheduleId)),
      ...next,
    ]);
    await updateMaintenanceSchedule(scheduleId, input, { id: actorId, source: 'UI' });
  });
}

export async function deleteMaintenanceScheduleAction(
  pathServiceId: string,
  scheduleId: string
): Promise<MaintenanceActionResult> {
  return run(pathServiceId, 'schedule_delete', async () => {
    const actorId = await assertCanModifyAll(await existingScheduleServiceIds(scheduleId));
    await deleteMaintenanceSchedule(scheduleId, { id: actorId, source: 'UI' });
  });
}
