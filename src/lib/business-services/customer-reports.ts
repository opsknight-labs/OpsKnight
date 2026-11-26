import 'server-only';

import type { Prisma } from '@prisma/client';
import { z } from 'zod/v3';
import prisma from '@/lib/prisma';
import { AppError } from '@/lib/errors';
import { emitAuditEvent, type AuditEventSource } from '@/lib/audit';
import type { AuthorizationActor } from '@/lib/authorization-policy';
import {
  assertCanManageBusinessServices,
  businessServiceReadWhere,
  businessServiceWriteWhere,
} from './commands';
import { invalidateBusinessServiceHealth } from './health';

export const MAX_REPORT_COUNT = 1_000_000;
/** A report describes at most a week; older signals are history, not health. */
export const MAX_REPORT_WINDOW_MS = 7 * 86_400_000;
const FUTURE_SKEW_MS = 5 * 60_000;

export const CustomerImpactReportInputSchema = z
  .object({
    source: z
      .string()
      .trim()
      .toLowerCase()
      .regex(/^[a-z0-9][a-z0-9_.-]{0,39}$/, 'Use letters, digits, dot, dash or underscore.'),
    count: z.number().int().min(1).max(MAX_REPORT_COUNT),
    windowStart: z.coerce.date(),
    windowEnd: z.coerce.date(),
    externalRef: z.string().trim().min(1).max(200).optional(),
  })
  .strict();

export type CustomerImpactReportInput = z.input<typeof CustomerImpactReportInputSchema>;

/** Pure window checks, so the rule is testable without a database. */
export function assertReportWindow(
  input: { windowStart: Date; windowEnd: Date },
  now = new Date()
) {
  const start = input.windowStart.getTime();
  const end = input.windowEnd.getTime();
  if (Number.isNaN(start) || Number.isNaN(end) || end < start)
    throw new AppError({
      code: 'VALIDATION_FAILED',
      userMessage: 'The report window must end after it starts.',
    });
  if (end - start > MAX_REPORT_WINDOW_MS)
    throw new AppError({
      code: 'VALIDATION_FAILED',
      userMessage: 'A report window can span at most 7 days.',
    });
  if (end > now.getTime() + FUTURE_SKEW_MS)
    throw new AppError({
      code: 'VALIDATION_FAILED',
      userMessage: 'A report window cannot end in the future.',
    });
}

type Context = { actor: AuthorizationActor; source?: AuditEventSource };

const SELECT = {
  id: true,
  businessServiceId: true,
  source: true,
  count: true,
  windowStart: true,
  windowEnd: true,
  externalRef: true,
  createdById: true,
  createdAt: true,
} satisfies Prisma.CustomerImpactReportSelect;

/**
 * Records customer reports for a business service. Idempotent by (service, externalRef): a retry
 * returns the stored row with `created: false`. Bumps the realtime clock in the same transaction
 * because the global health snapshot is cached per realtime generation.
 */
export async function createCustomerImpactReport(
  businessServiceId: string,
  raw: CustomerImpactReportInput,
  context: Context,
  client?: Prisma.TransactionClient
) {
  assertCanManageBusinessServices(context.actor);
  const input = CustomerImpactReportInputSchema.parse(raw);
  assertReportWindow(input);
  const run = async (tx: Prisma.TransactionClient) => {
    const visible = await tx.businessService.findFirst({
      where: { AND: [{ id: businessServiceId }, businessServiceWriteWhere(context.actor)] },
      select: { id: true },
    });
    if (!visible) throw new AppError({ code: 'RESOURCE_NOT_FOUND' });
    const data = { ...input, businessServiceId, createdById: context.actor.id };
    let report;
    if (input.externalRef) {
      // ON CONFLICT DO NOTHING instead of catching P2002: a unique violation would abort the
      // caller's transaction (REST passes one), so a concurrent duplicate must not raise.
      const inserted = await tx.customerImpactReport.createMany({
        data: [data],
        skipDuplicates: true,
      });
      report = await tx.customerImpactReport.findUniqueOrThrow({
        where: {
          businessServiceId_externalRef: { businessServiceId, externalRef: input.externalRef },
        },
        select: SELECT,
      });
      if (!inserted.count) {
        // A retry must repeat the same report; a different one under the same ref is a client bug.
        if (
          report.source !== input.source ||
          report.count !== input.count ||
          report.windowStart.getTime() !== input.windowStart.getTime() ||
          report.windowEnd.getTime() !== input.windowEnd.getTime()
        )
          throw new AppError({
            code: 'RESOURCE_CONFLICT',
            userMessage: 'This externalRef was already used for a different report.',
            fields: [{ field: 'externalRef', code: 'conflict', message: 'Already used' }],
          });
        return { report, created: false as const };
      }
    } else {
      report = await tx.customerImpactReport.create({ data, select: SELECT });
    }
    await tx.realtimeChange.create({ data: {} });
    await emitAuditEvent(
      {
        action: 'business_service.customer_report.created',
        source: context.source ?? 'UI',
        target: { type: 'BUSINESS_SERVICE', id: businessServiceId },
        actor: { type: 'USER', id: context.actor.id },
        newValue: { reportId: report.id, source: input.source, count: input.count },
      },
      tx
    );
    return { report, created: true as const };
  };
  const result = await (client ? run(client) : prisma.$transaction(run));
  if (result.created) invalidateBusinessServiceHealth();
  return result;
}

/**
 * Deletes a report its author recorded by mistake. Only the author, and only while they can still
 * manage the business service; imported reports (no author) stay. Bumps the realtime clock like create.
 */
export async function deleteCustomerImpactReport(
  businessServiceId: string,
  reportId: string,
  context: Context
) {
  assertCanManageBusinessServices(context.actor);
  await prisma.$transaction(async tx => {
    const report = await tx.customerImpactReport.findFirst({
      where: {
        id: reportId,
        businessServiceId,
        createdById: context.actor.id,
        businessService: businessServiceWriteWhere(context.actor),
      },
      select: { id: true, source: true, count: true },
    });
    if (!report) throw new AppError({ code: 'RESOURCE_NOT_FOUND' });
    await tx.customerImpactReport.delete({ where: { id: report.id } });
    await tx.realtimeChange.create({ data: {} });
    await emitAuditEvent(
      {
        action: 'business_service.customer_report.deleted',
        source: context.source ?? 'UI',
        target: { type: 'BUSINESS_SERVICE', id: businessServiceId },
        actor: { type: 'USER', id: context.actor.id },
        oldValue: { reportId: report.id, source: report.source, count: report.count },
      },
      tx
    );
  });
  invalidateBusinessServiceHealth();
}

/** Newest first; readers need the business service in their read scope. */
export async function listCustomerImpactReports(
  businessServiceId: string,
  actor: AuthorizationActor,
  limit = 50
) {
  const visible = await prisma.businessService.findFirst({
    where: { AND: [{ id: businessServiceId }, businessServiceReadWhere(actor)] },
    select: { id: true },
  });
  if (!visible) throw new AppError({ code: 'RESOURCE_NOT_FOUND' });
  return prisma.customerImpactReport.findMany({
    where: { businessServiceId },
    orderBy: [{ windowEnd: 'desc' }, { id: 'asc' }],
    take: Math.min(Math.max(limit, 1), 200),
    select: SELECT,
  });
}
