import 'server-only';
import { parseAllDocuments } from 'yaml';
import type { Prisma } from '@prisma/client';
import { logAudit } from '@/lib/audit';
import { AppError } from '@/lib/errors';
import type { IntelligenceActor } from '../settings/service';
import { MAX_DEPENDENCIES } from './service';

/**
 * Backstage catalog import. Entities of kind Component/Resource/System with `spec.dependsOn` become
 * DECLARED, ACTIVE edges: "entity depends on target". Entities are matched to OpsKnight services by the
 * `opsknight.com/service-id` annotation, or by exact (case-insensitive) name. Unmatched entities are
 * reported, never created: the service catalog stays the operator's. Idempotent: re-importing the same
 * catalog changes nothing. Observed (SUGGESTED) edges are left alone; a previously rejected edge that the
 * catalog now declares is re-activated, because an explicit declaration outranks an old rejection.
 */

export const MAX_IMPORT_BYTES = 2 * 1024 * 1024;
export const MAX_IMPORT_ENTITIES = 5000;
export const SERVICE_ID_ANNOTATION = 'opsknight.com/service-id';
const DEPENDENCY_KINDS = new Set(['component', 'resource', 'system', 'api']);

export interface CatalogEntity {
  name: string;
  kind: string;
  namespace: string;
  serviceId: string | null;
  dependsOn: string[];
}

type Json = Record<string, unknown>;
const obj = (value: unknown): Json =>
  value && typeof value === 'object' && !Array.isArray(value) ? (value as Json) : {};

function invalid(message: string): AppError {
  return new AppError({
    code: 'VALIDATION_FAILED',
    fields: [{ field: 'catalog', code: 'custom', message }],
  });
}

/** Lower-cased "kind:namespace/name" for a dependsOn reference, defaulting kind and namespace like Backstage. */
export function normalizeEntityRef(
  ref: string,
  defaultKind: string,
  defaultNamespace: string
): string {
  const trimmed = ref.trim().toLowerCase();
  const [kindPart, rest] = trimmed.includes(':') ? trimmed.split(':', 2) : [defaultKind, trimmed];
  const [namespace, name] = rest.includes('/') ? rest.split('/', 2) : [defaultNamespace, rest];
  return `${kindPart}:${namespace}/${name}`;
}

function entityFrom(document: unknown): CatalogEntity | null {
  const root = obj(document);
  const kind = typeof root.kind === 'string' ? root.kind.toLowerCase() : '';
  const metadata = obj(root.metadata);
  const spec = obj(root.spec);
  const name = typeof metadata.name === 'string' ? metadata.name.trim() : '';
  if (!name || !DEPENDENCY_KINDS.has(kind)) return null;
  const annotations = obj(metadata.annotations);
  const annotated = annotations[SERVICE_ID_ANNOTATION];
  const dependsOn = Array.isArray(spec.dependsOn)
    ? spec.dependsOn.filter((ref): ref is string => typeof ref === 'string' && ref.trim() !== '')
    : [];
  return {
    name,
    kind,
    namespace:
      typeof metadata.namespace === 'string' && metadata.namespace
        ? metadata.namespace.toLowerCase()
        : 'default',
    serviceId: typeof annotated === 'string' && annotated.trim() ? annotated.trim() : null,
    dependsOn,
  };
}

/** Parses a JSON array/object or a multi-document YAML catalog into entities. */
export function parseCatalog(text: string): CatalogEntity[] {
  if (text.length > MAX_IMPORT_BYTES) throw invalid('Catalog is larger than 2 MB');
  const trimmed = text.trim();
  if (!trimmed) throw invalid('Catalog is empty');
  let documents: unknown[];
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      throw invalid('Catalog is not valid JSON');
    }
    const root = obj(parsed);
    documents = Array.isArray(parsed)
      ? parsed
      : Array.isArray(root.items)
        ? root.items
        : Array.isArray(root.entities)
          ? root.entities
          : [parsed];
  } else {
    try {
      documents = parseAllDocuments(trimmed, { maxAliasCount: 100 }).map(document => {
        if (document.errors.length > 0) throw document.errors[0];
        return document.toJS();
      });
    } catch {
      throw invalid('Catalog is not valid YAML');
    }
  }
  if (documents.length > MAX_IMPORT_ENTITIES) throw invalid('Catalog has more than 5000 entities');
  return documents.map(entityFrom).filter((entity): entity is CatalogEntity => entity !== null);
}

export interface ImportSummary {
  entities: number;
  matched: number;
  unmatched: string[];
  edgesDeclared: number;
  edgesUnchanged: number;
  /** Declared references whose target entity is not in the catalog or not an OpsKnight service. */
  danglingReferences: number;
}

/**
 * Resolves entities to services and declares their edges in one transaction. Both ends of an edge must
 * resolve; anything else is counted, not guessed.
 */
export async function applyCatalogImport(
  tx: Prisma.TransactionClient,
  entities: readonly CatalogEntity[],
  actor: IntelligenceActor | null,
  source: string
): Promise<ImportSummary> {
  const services = await tx.service.findMany({
    take: 20_000,
    select: { id: true, name: true },
  });
  const byId = new Set(services.map(service => service.id));
  const byName = new Map(services.map(service => [service.name.trim().toLowerCase(), service.id]));
  const resolved = new Map<string, string>();
  const unmatched: string[] = [];
  for (const entity of entities) {
    const serviceId =
      entity.serviceId && byId.has(entity.serviceId)
        ? entity.serviceId
        : (byName.get(entity.name.toLowerCase()) ?? null);
    const ref = `${entity.kind}:${entity.namespace}/${entity.name.toLowerCase()}`;
    if (serviceId) resolved.set(ref, serviceId);
    else if (unmatched.length < 200) unmatched.push(entity.name);
  }

  const edges = new Map<string, { upstreamServiceId: string; downstreamServiceId: string }>();
  let dangling = 0;
  for (const entity of entities) {
    const downstream = resolved.get(
      `${entity.kind}:${entity.namespace}/${entity.name.toLowerCase()}`
    );
    if (!downstream) continue;
    for (const ref of entity.dependsOn) {
      const upstream = resolved.get(normalizeEntityRef(ref, 'component', entity.namespace));
      if (!upstream || upstream === downstream) {
        dangling += 1;
        continue;
      }
      edges.set(`${upstream}>${downstream}`, {
        upstreamServiceId: upstream,
        downstreamServiceId: downstream,
      });
    }
  }

  let declared = 0;
  let unchanged = 0;
  if (edges.size > 0) {
    const existing = await tx.serviceDependency.findMany({
      where: {
        OR: [...edges.values()].map(edge => ({
          upstreamServiceId: edge.upstreamServiceId,
          downstreamServiceId: edge.downstreamServiceId,
        })),
      },
      select: {
        id: true,
        upstreamServiceId: true,
        downstreamServiceId: true,
        origin: true,
        status: true,
      },
    });
    const existingByKey = new Map(
      existing.map(row => [`${row.upstreamServiceId}>${row.downstreamServiceId}`, row])
    );
    const total = await tx.serviceDependency.count();
    const toCreate = [...edges.entries()].filter(([key]) => !existingByKey.has(key));
    if (total + toCreate.length > MAX_DEPENDENCIES) throw invalid('Dependency limit reached');
    for (const [key, edge] of edges) {
      const current = existingByKey.get(key);
      if (current && current.origin === 'DECLARED' && current.status === 'ACTIVE') {
        unchanged += 1;
        continue;
      }
      await tx.serviceDependency.upsert({
        where: { upstreamServiceId_downstreamServiceId: edge },
        create: {
          ...edge,
          origin: 'DECLARED',
          status: 'ACTIVE',
          confidence: 1,
          evidence: { type: 'declared', source },
        },
        update: {
          origin: 'DECLARED',
          status: 'ACTIVE',
          confidence: 1,
          evidence: { type: 'declared', source },
        },
      });
      declared += 1;
    }
  }
  const summary: ImportSummary = {
    entities: entities.length,
    matched: resolved.size,
    unmatched,
    edgesDeclared: declared,
    edgesUnchanged: unchanged,
    danglingReferences: dangling,
  };
  await logAudit(
    {
      action: 'intelligence.topology.imported',
      entityType: 'SYSTEM_CONFIG',
      entityId: `intelligence-topology:${source}`,
      actorId: actor?.actorId ?? null,
      source: actor?.source ?? 'SYSTEM',
      details: {
        entities: summary.entities,
        matched: summary.matched,
        unmatched: summary.unmatched.length,
        edgesDeclared: summary.edgesDeclared,
        edgesUnchanged: summary.edgesUnchanged,
        danglingReferences: summary.danglingReferences,
      },
    },
    tx
  );
  return summary;
}
