import 'server-only';

import type { Prisma } from '@prisma/client';
import { z } from 'zod/v3';
import prisma from '@/lib/prisma';
import { AppError } from '@/lib/errors';
import type { AuditEventSource } from '@/lib/audit';
import type { AuthorizationActor } from '@/lib/authorization-policy';
import {
  assertCanManageBusinessServices,
  businessServiceWriteWhere,
  updateBusinessService,
  type BusinessServiceInput,
} from './commands';
import { invalidateBusinessServiceHealth } from './health';

export const MAX_BULK_ITEMS = 100;
const id = z.string().trim().min(1).max(100);
const tag = z.string().trim().min(1).max(40);

export const BulkEditInputSchema = z
  .object({
    ids: z.array(id).min(1).max(MAX_BULK_ITEMS),
    changes: z
      .object({
        ownerTeamId: id.nullable().optional(),
        criticality: z.enum(['TIER_0', 'TIER_1', 'TIER_2', 'TIER_3']).nullable().optional(),
        lifecycle: z.enum(['ACTIVE', 'BETA', 'DEPRECATED', 'RETIRED']).optional(),
        addTags: z.array(tag).max(20).optional(),
        removeTags: z.array(tag).max(20).optional(),
        markReviewed: z.literal(true).optional(),
        sloTarget: z.number().min(90).max(99.999).nullable().optional(),
        sloWindowDays: z.union([z.literal(7), z.literal(30), z.literal(90)]).optional(),
      })
      .strict()
      .refine(changes => Object.values(changes).some(value => value !== undefined), {
        message: 'Choose at least one change.',
      }),
    dryRun: z.boolean().default(false),
  })
  .strict();

export type BulkEditInput = z.input<typeof BulkEditInputSchema>;
type Changes = z.output<typeof BulkEditInputSchema>['changes'];

export type BulkItemResult =
  { id: string; ok: true; changed: string[] } | { id: string; ok: false; error: string };

/** The partial update for one service, from its current tags. Pure. */
export function bulkPatch(
  changes: Changes,
  currentTags: readonly string[],
  now: Date
): Partial<BusinessServiceInput> {
  const patch: Partial<BusinessServiceInput> = {};
  if (changes.ownerTeamId !== undefined) patch.ownerTeamId = changes.ownerTeamId;
  if (changes.criticality !== undefined) patch.criticality = changes.criticality;
  if (changes.lifecycle !== undefined) patch.lifecycle = changes.lifecycle;
  if (changes.sloTarget !== undefined) patch.sloTarget = changes.sloTarget;
  if (changes.sloWindowDays !== undefined) patch.sloWindowDays = changes.sloWindowDays;
  if (changes.markReviewed) patch.lastReviewedAt = now;
  if (changes.addTags?.length || changes.removeTags?.length) {
    const removed = new Set((changes.removeTags ?? []).map(value => value.toLowerCase()));
    const next = [...currentTags, ...(changes.addTags ?? [])].filter(
      (value, index, all) =>
        !removed.has(value.toLowerCase()) &&
        all.findIndex(other => other.toLowerCase() === value.toLowerCase()) === index
    );
    // Over the 20-tag cap is reported per item by the update's own validation.
    patch.tags = next;
  }
  return patch;
}

type Context = { actor: AuthorizationActor; source?: AuditEventSource };

/**
 * Applies the same change to up to 100 business services. Each service runs in its own savepoint
 * inside one transaction: a failing service is rolled back and reported without blocking the rest.
 * Dry run applies and then rolls every service back, so it reports real validation results.
 * Each applied service writes its own `business_service.updated` audit event (via the update command).
 */
export async function bulkEditBusinessServices(
  raw: BulkEditInput,
  context: Context,
  client?: Prisma.TransactionClient
): Promise<{
  dryRun: boolean;
  results: BulkItemResult[];
  summary: { ok: number; failed: number };
}> {
  assertCanManageBusinessServices(context.actor);
  const input = BulkEditInputSchema.parse(raw);
  const ids = [...new Set(input.ids)];
  const run = async (tx: Prisma.TransactionClient) => {
    const rows = await tx.businessService.findMany({
      where: { AND: [{ id: { in: ids } }, businessServiceWriteWhere(context.actor)] },
      select: { id: true, tags: true },
    });
    const byId = new Map(rows.map(row => [row.id, row]));
    const now = new Date();
    const results: BulkItemResult[] = [];
    for (const [index, serviceId] of ids.entries()) {
      const row = byId.get(serviceId);
      if (!row) {
        results.push({ id: serviceId, ok: false, error: 'Business service not found.' });
        continue;
      }
      const savepoint = `bulk_bs_${index}`;
      await tx.$executeRawUnsafe(`SAVEPOINT ${savepoint}`);
      try {
        const patch = bulkPatch(input.changes, row.tags, now);
        await updateBusinessService(
          serviceId,
          patch,
          { actor: context.actor, source: context.source },
          tx
        );
        await tx.$executeRawUnsafe(
          input.dryRun ? `ROLLBACK TO SAVEPOINT ${savepoint}` : `RELEASE SAVEPOINT ${savepoint}`
        );
        results.push({ id: serviceId, ok: true, changed: Object.keys(patch) });
      } catch (error) {
        await tx.$executeRawUnsafe(`ROLLBACK TO SAVEPOINT ${savepoint}`);
        if (error instanceof z.ZodError)
          results.push({
            id: serviceId,
            ok: false,
            error: 'The change is not valid for this service.',
          });
        else if (error instanceof AppError)
          results.push({ id: serviceId, ok: false, error: error.userMessage ?? error.code });
        else throw error;
      }
    }
    return results;
  };
  // shortcut: one long transaction (60 s) for up to 100 services; split the selection if it times out.
  const results = await (client ? run(client) : prisma.$transaction(run, { timeout: 60_000 }));
  if (!input.dryRun) invalidateBusinessServiceHealth();
  const ok = results.filter(result => result.ok).length;
  return { dryRun: input.dryRun, results, summary: { ok, failed: results.length - ok } };
}
