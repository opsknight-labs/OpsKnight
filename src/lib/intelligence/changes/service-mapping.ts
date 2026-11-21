import 'server-only';
import { Prisma } from '@prisma/client';
import prisma from '@/lib/prisma';
import { logAudit } from '@/lib/audit';
import { AppError } from '@/lib/errors';
import { enqueueWorkItems, WORK_KINDS } from '../jobs/work-queue';
import { getIntelligenceSettings } from '../settings/service';
import { maskVolatileIdentifiers } from '../normalization/text';
import type { MappedChange } from './mappers';
import { recordChange, type ChangeInput, type RecordChangeResult } from './service';

/** Labels that name the app or component a change belongs to, after the change's own `component`. */
const APP_LABEL_KEYS = ['app', 'application', 'service', 'component'] as const;

/** The form a label value is stored and looked up in: the same masking `recordChange` applies to `component`. */
export function changeMappingKey(value: string): string {
  return maskVolatileIdentifiers(value.trim()).slice(0, 128);
}

function candidateValues(change: Pick<MappedChange, 'component' | 'labels'>): string[] {
  // eslint-disable-next-line security/detect-object-injection -- keys come from the fixed APP_LABEL_KEYS list
  const values = [change.component, ...APP_LABEL_KEYS.map(key => change.labels[key])]
    .filter((value): value is string => typeof value === 'string' && value.trim() !== '')
    .map(value => value.trim().slice(0, 128));
  return [...new Set(values)];
}

export type ChangeServiceResolution =
  { multiService: false } | { multiService: true; serviceId: string | null };

/**
 * Which service a change from this integration belongs to. An integration without a mapping keeps the old
 * behaviour (its own service). With one it is multi-service: the change's app/component values are looked up
 * in the mapping, then in Backstage entity names from the last catalog import, then as an exact service name
 * (case-insensitive). No match leaves the service null for an operator to map on /changes.
 */
export async function resolveChangeService(
  integrationId: string,
  change: Pick<MappedChange, 'component' | 'labels'>
): Promise<ChangeServiceResolution> {
  const mapping = await prisma.changeServiceMapping.findUnique({
    where: { integrationId },
    select: { mappings: true },
  });
  if (!mapping) return { multiService: false };
  const values = candidateValues(change);
  if (values.length === 0) return { multiService: true, serviceId: null };
  const keys = values.map(changeMappingKey);
  const table = (mapping.mappings ?? {}) as Record<string, unknown>;
  const explicit = keys
    // eslint-disable-next-line security/detect-object-injection -- own-property check above; the table is a parsed JSON record
    .map(key => (Object.hasOwn(table, key) ? table[key] : undefined))
    .filter((id): id is string => typeof id === 'string');
  const [services, aliases] = await Promise.all([
    prisma.service.findMany({
      where: {
        OR: [{ id: { in: explicit } }, { name: { in: values, mode: 'insensitive' } }],
      },
      select: { id: true, name: true },
      take: 50,
    }),
    prisma.catalogServiceAlias.findMany({
      where: { name: { in: keys } },
      select: { name: true, serviceId: true },
    }),
  ]);
  // A mapped service that was deleted falls through to the other lookups instead of failing the webhook.
  const existing = new Set(services.map(service => service.id));
  const byName = new Map(services.map(service => [service.name.trim().toLowerCase(), service.id]));
  const byAlias = new Map(aliases.map(alias => [alias.name, alias.serviceId]));
  const serviceId =
    explicit.find(id => existing.has(id)) ??
    keys.map(key => byAlias.get(key)).find(Boolean) ??
    values.map(value => byName.get(value.toLowerCase())).find(Boolean) ??
    null;
  return { multiService: true, serviceId };
}

/**
 * Records a change sent through an integration's webhook: to the integration's service, or for a
 * multi-service integration to the service its labels resolve to, else unmapped.
 */
export async function recordIntegrationChange(
  integration: { id: string; serviceId: string },
  change: Omit<ChangeInput, 'serviceId'>
): Promise<RecordChangeResult> {
  const labels = (change.labels ?? {}) as MappedChange['labels'];
  const resolved = await resolveChangeService(integration.id, {
    component: change.component ?? undefined,
    labels,
  });
  if (!resolved.multiService) return recordChange({ ...change, serviceId: integration.serviceId });
  return recordChange({ ...change, serviceId: resolved.serviceId }, undefined, {
    unmappedIntegrationId: integration.id,
  });
}

const MAX_MAPPING_ENTRIES = 2000;
const REMAP_LIMIT = 500;
export const UNMAPPED_WINDOW_DAYS = 30;
export const UNMAPPED_GROUP_LIMIT = 50;

export interface UnmappedChangeGroup {
  integrationId: string;
  integrationName: string;
  source: string;
  component: string | null;
  count: number;
  latestAt: Date;
}

/**
 * Unmapped changes of the last 30 days, one row per integration, source and component, most recent first.
 * Only shown to intelligence managers, who may map any of them, so it is not scoped further.
 */
export async function listUnmappedChanges(now: Date = new Date()): Promise<UnmappedChangeGroup[]> {
  const groups = await prisma.changeEvent.groupBy({
    by: ['unmappedIntegrationId', 'source', 'component'],
    where: {
      unmappedIntegrationId: { not: null },
      occurredAt: { gte: new Date(now.getTime() - UNMAPPED_WINDOW_DAYS * 86_400_000) },
    },
    _count: { _all: true },
    _max: { occurredAt: true },
    orderBy: { _max: { occurredAt: 'desc' } },
    take: UNMAPPED_GROUP_LIMIT,
  });
  const integrations = await prisma.integration.findMany({
    where: { id: { in: [...new Set(groups.map(group => group.unmappedIntegrationId!))] } },
    select: { id: true, name: true },
  });
  const names = new Map(integrations.map(integration => [integration.id, integration.name]));
  return groups.map(group => ({
    integrationId: group.unmappedIntegrationId!,
    integrationName: names.get(group.unmappedIntegrationId!) ?? 'Deleted integration',
    source: group.source,
    component: group.component,
    count: group._count._all,
    latestAt: group._max.occurredAt!,
  }));
}

function invalidValue(message: string): AppError {
  return new AppError({
    code: 'VALIDATION_FAILED',
    fields: [{ field: 'value', code: 'custom', message }],
  });
}

/**
 * Maps one app/component label value of a change integration to a service (or removes it with a null
 * service), creating the mapping (which makes the integration multi-service) when it does not exist yet.
 * Every edit increases the mapping's version and is audited. Recent unmapped changes with that value move
 * to the service and are queued for risk scoring and cause re-analysis, like a newly recorded change.
 */
export async function setChangeServiceMapping(input: {
  integrationId: string;
  value: string;
  serviceId: string | null;
  actorId: string;
}): Promise<{ version: number; remapped: number }> {
  const key = changeMappingKey(input.value);
  if (!key) throw invalidValue('Enter a label value');
  return prisma.$transaction(async tx => {
    const integration = await tx.integration.findUnique({
      where: { id: input.integrationId },
      select: { type: true },
    });
    if (integration?.type !== 'WEBHOOK') throw new AppError({ code: 'RESOURCE_NOT_FOUND' });
    if (input.serviceId) {
      const service = await tx.service.findUnique({
        where: { id: input.serviceId },
        select: { id: true },
      });
      if (!service) throw new AppError({ code: 'SERVICE_NOT_FOUND' });
    }
    const [current] = await tx.$queryRaw<Array<{ mappings: Prisma.JsonValue; version: number }>>`
      SELECT "mappings", "version" FROM "ChangeServiceMapping"
      WHERE "integrationId" = ${input.integrationId} FOR UPDATE`;
    const entries = new Map(Object.entries((current?.mappings ?? {}) as Record<string, string>));
    const previous = entries.get(key) ?? null;
    if (input.serviceId) entries.set(key, input.serviceId);
    else entries.delete(key);
    if (entries.size > MAX_MAPPING_ENTRIES) {
      throw invalidValue(`At most ${MAX_MAPPING_ENTRIES} mapped values`);
    }
    const mappings = Object.fromEntries(entries);
    const { version } = current
      ? await tx.changeServiceMapping.update({
          where: { integrationId: input.integrationId },
          data: { mappings, version: { increment: 1 }, updatedById: input.actorId },
          select: { version: true },
        })
      : await tx.changeServiceMapping.create({
          data: { integrationId: input.integrationId, mappings, updatedById: input.actorId },
          select: { version: true },
        });

    let remapped = 0;
    if (input.serviceId) {
      const moved = await tx.changeEvent.findMany({
        where: { unmappedIntegrationId: input.integrationId, component: key },
        orderBy: { occurredAt: 'desc' },
        take: REMAP_LIMIT,
        select: { id: true },
      });
      if (moved.length > 0) {
        remapped = (
          await tx.changeEvent.updateMany({
            where: { id: { in: moved.map(row => row.id) } },
            data: { serviceId: input.serviceId, unmappedIntegrationId: null },
          })
        ).count;
        if ((await getIntelligenceSettings(tx)).enabled) {
          await enqueueWorkItems(
            moved.map(row => ({ kind: WORK_KINDS.LATE_CHANGE, subjectKey: row.id })),
            tx
          );
        }
      }
    }
    await logAudit(
      {
        action: 'intelligence.change_mapping.updated',
        entityType: 'SYSTEM_CONFIG',
        entityId: `change-mapping:${input.integrationId}`,
        actorId: input.actorId,
        source: 'UI',
        oldValue: { value: key, serviceId: previous },
        newValue: { value: key, serviceId: input.serviceId },
        details: { version, remapped },
      },
      tx
    );
    return { version, remapped };
  });
}
