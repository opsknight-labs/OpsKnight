import 'server-only';
import { z } from 'zod/v3';
import prisma from '@/lib/prisma';
import { emitAuditEvent, type AuditEventSource } from '@/lib/audit';
import { AppError } from '@/lib/errors';
import {
  AUTHORIZATION_ACTIONS,
  authorize,
  type AuthorizationActor,
} from '@/lib/authorization-policy';
import { activeStatusOverride, MAX_OVERRIDE_DAYS, STATUS_OVERRIDE_VALUES } from './status-override';

export { activeStatusOverride, MAX_OVERRIDE_DAYS, STATUS_OVERRIDE_VALUES };

export const StatusOverrideInputSchema = z
  .object({
    /** null clears the override. */
    status: z.enum(STATUS_OVERRIDE_VALUES).nullable(),
    /** When the override lapses; omitted or null keeps it for the maximum period. */
    until: z.string().datetime({ offset: true }).nullable().optional(),
  })
  .strict();

export type StatusOverrideInput = z.infer<typeof StatusOverrideInputSchema>;

/**
 * Pins (or clears) the public status of a business service on one status page, like a
 * Statuspage component-group override. The mapping row's snapshot trigger republishes the page.
 */
export async function setStatusPageBusinessServiceOverride(
  pageId: string,
  businessServiceId: string,
  raw: unknown,
  context: { actor: AuthorizationActor; source?: AuditEventSource },
  now = new Date()
) {
  if (
    !authorize({ actor: context.actor, action: AUTHORIZATION_ACTIONS.STATUS_PAGE_MANAGE }).allowed
  )
    throw new AppError({ code: 'AUTHORIZATION_DENIED' });
  const parsed = StatusOverrideInputSchema.safeParse(raw);
  if (!parsed.success)
    throw new AppError({
      code: 'VALIDATION_FAILED',
      userMessage: 'Choose a valid status and an ISO 8601 end time.',
    });
  const input = parsed.data;
  const latest = new Date(now.getTime() + MAX_OVERRIDE_DAYS * 86_400_000);
  const until = input.status ? (input.until ? new Date(input.until) : latest) : null;
  if (until && (until <= now || until > latest))
    throw new AppError({
      code: 'VALIDATION_FAILED',
      userMessage: `An override must end in the future and within ${MAX_OVERRIDE_DAYS} days.`,
      fields: [{ field: 'until', code: 'out_of_range', message: 'Out of range.' }],
    });
  return prisma.$transaction(async tx => {
    const row = await tx.statusPageBusinessService.findUnique({
      where: { statusPageId_businessServiceId: { statusPageId: pageId, businessServiceId } },
      select: { id: true, statusOverride: true, statusOverrideUntil: true },
    });
    if (!row)
      throw new AppError({
        code: 'RESOURCE_NOT_FOUND',
        userMessage: 'This business service is not on the status page.',
      });
    const updated = await tx.statusPageBusinessService.update({
      where: { id: row.id },
      data: { statusOverride: input.status, statusOverrideUntil: until },
      select: { businessServiceId: true, statusOverride: true, statusOverrideUntil: true },
    });
    await emitAuditEvent(
      {
        action: input.status
          ? 'status_page.business_service_override_set'
          : 'status_page.business_service_override_cleared',
        source: context.source ?? 'UI',
        target: { type: 'STATUS_PAGE', id: pageId },
        actor: { type: 'USER', id: context.actor.id },
        oldValue: {
          businessServiceId,
          status: row.statusOverride,
          until: row.statusOverrideUntil?.toISOString() ?? null,
        },
        newValue: { businessServiceId, status: input.status, until: until?.toISOString() ?? null },
      },
      tx
    );
    return {
      statusPageId: pageId,
      businessServiceId: updated.businessServiceId,
      status: updated.statusOverride,
      until: updated.statusOverrideUntil?.toISOString() ?? null,
    };
  });
}

/**
 * Clears lapsed overrides. The public builder already ignores them; clearing the row keeps the
 * admin view truthful and, through the mapping trigger, republishes the page promptly.
 */
export async function expireStatusPageBusinessServiceOverrides(now = new Date()) {
  const lapsed = await prisma.statusPageBusinessService.findMany({
    where: { statusOverride: { not: null }, statusOverrideUntil: { lte: now } },
    select: { id: true, statusPageId: true, businessServiceId: true, statusOverride: true },
    take: 500,
  });
  if (!lapsed.length) return { expired: 0 };
  await prisma.$transaction(async tx => {
    await tx.statusPageBusinessService.updateMany({
      where: { id: { in: lapsed.map(row => row.id) }, statusOverrideUntil: { lte: now } },
      data: { statusOverride: null, statusOverrideUntil: null },
    });
    for (const row of lapsed)
      await emitAuditEvent(
        {
          action: 'status_page.business_service_override_expired',
          source: 'BACKGROUND',
          target: { type: 'STATUS_PAGE', id: row.statusPageId },
          actor: { type: 'SYSTEM' },
          oldValue: { businessServiceId: row.businessServiceId, status: row.statusOverride },
        },
        tx
      );
  });
  return { expired: lapsed.length };
}
