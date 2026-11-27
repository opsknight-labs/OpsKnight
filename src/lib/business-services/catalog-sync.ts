import 'server-only';

import type { Prisma } from '@prisma/client';
import prisma from '@/lib/prisma';
import { emitAuditEvent } from '@/lib/audit';
import { isAppError } from '@/lib/errors';
import { logger } from '@/lib/logger';
import type { AuthorizationActor } from '@/lib/authorization-policy';
import type { CatalogEntity } from '@/lib/intelligence/dependencies/import';
import { applyImportRows, backstageRowsFromEntities, type ImportRow } from './import';

/** Imports run with org-wide management rights; the audit trail names the sync, not a person. */
const SYNC_ACTOR: AuthorizationActor = {
  id: 'system:backstage-sync',
  role: 'ADMIN',
  status: 'ACTIVE',
  teamIds: [],
};
const MAX_LISTED = 50;

class SyncRejected extends Error {}

export type BusinessServiceSyncSummary = {
  status: 'OK' | 'FAILED';
  created: number;
  updated: number;
  unchanged: number;
  /** Synced business services whose System (or Domain) left the catalog; marked, never deleted. */
  removed: string[];
  /** Previously removed ones that are back in the catalog. */
  restored: string[];
  /** Names already owned by another source; left alone. */
  skipped: string[];
  /** Component or System references that match no service or business service. */
  unmatched: string[];
  error?: string;
};

const lower = (value: string) => value.trim().toLowerCase();
export const externalKeyPrefix = (sourceId: string) => `backstage:${sourceId}:`;
export const externalKeyFor = (sourceId: string, name: string) =>
  `${externalKeyPrefix(sourceId)}${lower(name)}`;

/** Member references resolved to service ids: catalog alias, then id, then a unique name. */
async function resolveMembers(rows: ImportRow[], unmatched: Set<string>) {
  const refs = [...new Set(rows.flatMap(row => row.members ?? []))];
  if (!refs.length) return;
  const [aliases, services] = await Promise.all([
    prisma.catalogServiceAlias.findMany({
      where: { name: { in: refs.map(lower) } },
      select: { name: true, serviceId: true },
    }),
    prisma.service.findMany({
      where: { OR: [{ id: { in: refs } }, { name: { in: refs, mode: 'insensitive' } }] },
      select: { id: true, name: true },
    }),
  ]);
  const alias = new Map(aliases.map(row => [row.name, row.serviceId]));
  const resolve = (ref: string) => {
    const byName = services.filter(service => lower(service.name) === lower(ref));
    return (
      alias.get(lower(ref)) ??
      services.find(service => service.id === ref)?.id ??
      (byName.length === 1 ? byName[0].id : undefined)
    );
  };
  for (const row of rows) {
    if (!row.members) continue;
    const ids: string[] = [];
    for (const ref of row.members) {
      const id = resolve(ref);
      if (id) ids.push(id);
      else unmatched.add(ref);
    }
    // Nothing resolvable keeps the current members: a catalog gap must not empty a business service.
    row.members = ids.length ? [...new Set(ids)] : undefined;
  }
}

/**
 * Maps Backstage Systems (and optionally Domains) of one topology source to business services:
 * idempotent upsert keyed by `externalKey`, the same validation and all-or-nothing apply as the
 * import, and audit entries. Business services created by hand are adopted by name, never deleted;
 * synced ones whose entity disappeared are marked with externalRemovedAt.
 */
export async function syncBusinessServicesFromCatalog(
  source: { id: string; name: string; syncDomains: boolean },
  entities: readonly CatalogEntity[],
  now = new Date()
): Promise<BusinessServiceSyncSummary> {
  const summary: BusinessServiceSyncSummary = {
    status: 'OK',
    created: 0,
    updated: 0,
    unchanged: 0,
    removed: [],
    restored: [],
    skipped: [],
    unmatched: [],
  };
  const prefix = externalKeyPrefix(source.id);
  const unmatched = new Set<string>();
  let rows = backstageRowsFromEntities(entities, { domains: source.syncDomains });
  const [byName, owned] = await Promise.all([
    rows.length
      ? prisma.businessService.findMany({
          where: { name: { in: rows.map(row => row.name), mode: 'insensitive' } },
          select: { name: true, externalKey: true },
        })
      : [],
    prisma.businessService.findMany({
      where: { externalKey: { startsWith: prefix } },
      select: { id: true, name: true, externalKey: true, externalRemovedAt: true },
    }),
  ]);
  const otherSource = new Set(
    byName
      .filter(row => row.externalKey && !row.externalKey.startsWith(prefix))
      .map(row => lower(row.name))
  );
  summary.skipped = rows.filter(row => otherSource.has(lower(row.name))).map(row => row.name);
  rows = rows.filter(row => !otherSource.has(lower(row.name)));
  await resolveMembers(rows, unmatched);
  // A dependsOn naming nothing known would fail the whole apply; drop it and report it instead.
  const known = new Set([
    ...rows.map(row => lower(row.name)),
    ...byName.map(row => lower(row.name)),
  ]);
  const unknownRefs = [
    ...new Set(rows.flatMap(row => (row.dependsOn ?? []).filter(ref => !known.has(lower(ref))))),
  ];
  const existingRefs = unknownRefs.length
    ? await prisma.businessService.findMany({
        where: { name: { in: unknownRefs, mode: 'insensitive' } },
        select: { name: true },
      })
    : [];
  for (const row of existingRefs) known.add(lower(row.name));
  for (const row of rows) {
    if (!row.dependsOn) continue;
    for (const ref of row.dependsOn) if (!known.has(lower(ref))) unmatched.add(ref);
    row.dependsOn = row.dependsOn.filter(ref => known.has(lower(ref)));
  }
  summary.unmatched = [...unmatched].slice(0, MAX_LISTED);

  const keys = new Map(rows.map(row => [externalKeyFor(source.id, row.name), row.name]));
  const auditActor = { type: 'SYSTEM' as const, id: `topology-source:${source.id}` };
  try {
    await prisma.$transaction(
      async tx => {
        if (rows.length) {
          const plan = await applyImportRows(
            rows.map((row, index) => ({ ...row, line: index + 1 })),
            [],
            { format: 'backstage', dryRun: false },
            { actor: SYNC_ACTOR, source: 'BACKGROUND', auditActor },
            tx
          );
          if (!plan.applied)
            throw new SyncRejected(
              plan.issues
                .slice(0, 3)
                .map(issue => (issue.name ? `${issue.name}: ${issue.message}` : issue.message))
                .join(' ')
            );
          summary.created = plan.summary.create;
          summary.updated = plan.summary.update;
          summary.unchanged = plan.summary.unchanged;
        }
        for (const [key, name] of keys)
          await tx.businessService.updateMany({
            where: {
              name: { equals: name, mode: 'insensitive' },
              OR: [{ externalKey: null }, { externalKey: key }],
            },
            data: { externalKey: key, externalRemovedAt: null },
          });
        const removed = owned.filter(row => !keys.has(row.externalKey!) && !row.externalRemovedAt);
        const restored = owned.filter(row => keys.has(row.externalKey!) && row.externalRemovedAt);
        if (removed.length)
          await tx.businessService.updateMany({
            where: { id: { in: removed.map(row => row.id) } },
            data: { externalRemovedAt: now },
          });
        for (const [action, list] of [
          ['business_service.catalog_removed', removed],
          ['business_service.catalog_restored', restored],
        ] as const)
          for (const row of list)
            await emitAuditEvent(
              {
                action,
                source: 'BACKGROUND',
                actor: auditActor,
                target: { type: 'BUSINESS_SERVICE', id: row.id },
                metadata: { topologySource: source.name, externalKey: row.externalKey },
              },
              tx
            );
        summary.removed = removed.map(row => row.name).slice(0, MAX_LISTED);
        summary.restored = restored.map(row => row.name).slice(0, MAX_LISTED);
        await emitAuditEvent(
          {
            action: 'business_service.catalog_synced',
            source: 'BACKGROUND',
            actor: auditActor,
            target: { type: 'BUSINESS_SERVICE', id: null },
            metadata: {
              topologySource: source.name,
              created: summary.created,
              updated: summary.updated,
              unchanged: summary.unchanged,
              removed: removed.length,
              restored: restored.length,
              skipped: summary.skipped.length,
              unmatched: unmatched.size,
            } satisfies Prisma.InputJsonObject,
          },
          tx
        );
      },
      { timeout: 120_000 }
    );
  } catch (error) {
    if (!(error instanceof SyncRejected) && !isAppError(error))
      logger.warn('[BusinessService] Catalog sync failed', { sourceId: source.id, error });
    return {
      ...summary,
      status: 'FAILED',
      created: 0,
      updated: 0,
      unchanged: 0,
      removed: [],
      restored: [],
      error:
        error instanceof SyncRejected
          ? error.message
          : isAppError(error)
            ? error.userMessage
            : 'Business-service sync failed.',
    };
  }
  return summary;
}
