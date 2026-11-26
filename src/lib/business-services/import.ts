import 'server-only';

import { parse as parseYaml } from 'yaml';
import type { BusinessServiceTier, Prisma } from '@prisma/client';
import prisma from '@/lib/prisma';
import { AppError } from '@/lib/errors';
import { emitAuditEvent, type AuditEventSource } from '@/lib/audit';
import type { AuthorizationActor } from '@/lib/authorization-policy';
import { parseCatalog } from '@/lib/intelligence/dependencies/import';
import {
  assertCanManageBusinessServices,
  businessServiceReadWhere,
  createBusinessService,
  updateBusinessService,
} from './commands';
import { invalidateBusinessServiceHealth } from './health';
import { CustomAttributesSchema } from './attributes';

export const MAX_IMPORT_ROWS = 1000;
export const MAX_IMPORT_BYTES = 2 * 1024 * 1024;
export const IMPORT_FORMATS = ['csv', 'yaml', 'backstage'] as const;
export type ImportFormat = (typeof IMPORT_FORMATS)[number];

/** One business service as the file describes it. Absent fields are left unchanged on update. */
export type ImportRow = {
  line: number;
  name: string;
  description?: string | null;
  criticality?: BusinessServiceTier | null;
  /** Team name or id. */
  ownerTeam?: string | null;
  /** Service names or ids; replaces the member set when present. */
  members?: string[];
  /** Business services (names) this one depends on; replaces that set when present. */
  dependsOn?: string[];
  /** Custom attributes to set; merged over the stored ones (CSV `attr.<key>` columns, YAML `attributes`). */
  attributes?: Record<string, string | number | boolean>;
};

export type ImportIssue = { line: number; name?: string; message: string };

const invalid = (message: string) =>
  new AppError({ code: 'VALIDATION_FAILED', userMessage: message });

const TIERS = new Map<string, BusinessServiceTier>([
  ['tier_0', 'TIER_0'],
  ['tier_1', 'TIER_1'],
  ['tier_2', 'TIER_2'],
  ['tier_3', 'TIER_3'],
]);

/** "TIER_0", "tier-0", "Tier 0", "0" → TIER_0; blank → null; anything else → undefined. */
export function parseCriticality(value: unknown): BusinessServiceTier | null | undefined {
  if (value === null || value === undefined) return undefined;
  const text = String(value).trim().toLowerCase();
  if (!text) return null;
  const key = /^\d$/.test(text) ? `tier_${text}` : text.replace(/[\s-]+/g, '_');
  return TIERS.get(key);
}

/** RFC 4180 CSV: quoted fields may hold commas, quotes ("") and newlines. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text.charAt(index);
    if (quoted) {
      if (char === '"' && text.charAt(index + 1) === '"') {
        field += '"';
        index += 1;
      } else if (char === '"') quoted = false;
      else field += char;
    } else if (char === '"' && field === '') quoted = true;
    else if (char === ',') {
      row.push(field);
      field = '';
    } else if (char === '\n' || char === '\r') {
      if (char === '\r' && text.charAt(index + 1) === '\n') index += 1;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else field += char;
  }
  if (quoted) throw invalid('The CSV has an unclosed quote.');
  if (field !== '' || row.length) rows.push([...row, field]);
  return rows.filter(cells => cells.some(cell => cell.trim() !== ''));
}

const list = (value: unknown): string[] | undefined => {
  if (value === undefined || value === null) return undefined;
  const items = Array.isArray(value) ? value : String(value).split(/[;\n]/);
  return [...new Set(items.map(item => String(item).trim()).filter(Boolean))];
};
const text = (value: unknown) =>
  value === undefined ? undefined : value === null ? null : String(value).trim() || null;

function rowFrom(
  record: Record<string, unknown>,
  line: number,
  issues: ImportIssue[]
): ImportRow | null {
  const name = typeof record.name === 'string' ? record.name.trim() : '';
  if (!name) {
    issues.push({ line, message: 'Every row needs a name.' });
    return null;
  }
  if (name.length > 120) {
    issues.push({ line, name, message: 'Names are at most 120 characters.' });
    return null;
  }
  const criticality = parseCriticality(record.criticality);
  if (criticality === undefined && record.criticality !== undefined && record.criticality !== null)
    issues.push({ line, name, message: `Unknown criticality "${String(record.criticality)}".` });
  const row: ImportRow = { line, name };
  const description = text(record.description);
  if (description !== undefined) row.description = description;
  if (criticality !== undefined) row.criticality = criticality;
  const ownerTeam = text('ownerTeam' in record ? record.ownerTeam : record.owner_team);
  if (ownerTeam !== undefined) row.ownerTeam = ownerTeam;
  const members = list(record.members);
  if (members) row.members = members;
  const dependsOn = list('dependsOn' in record ? record.dependsOn : record.depends_on);
  if (dependsOn) row.dependsOn = dependsOn;
  const attributes = attributesFrom(record);
  if (attributes === null)
    issues.push({ line, name, message: 'Attributes must be scalar values with valid keys.' });
  else if (attributes) row.attributes = attributes;
  return row;
}

/** A CSV cell reads like the edit form: true/false and numbers become typed values. */
const typed = (value: string): string | number | boolean =>
  value === 'true'
    ? true
    : value === 'false'
      ? false
      : !isNaN(Number(value))
        ? Number(value)
        : value;

/** YAML `attributes` mapping or CSV `attr.<key>` columns; null when present but invalid. */
function attributesFrom(record: Record<string, unknown>) {
  const entries: [string, unknown][] = Object.entries(record).flatMap(([column, value]) =>
    column.startsWith('attr.')
      ? [[column.slice(5), typeof value === 'string' ? typed(value.trim()) : value]]
      : []
  );
  const mapping = record.attributes;
  if (mapping !== undefined && mapping !== null) {
    if (typeof mapping !== 'object' || Array.isArray(mapping)) return null;
    entries.push(...Object.entries(mapping));
  }
  if (!entries.length) return undefined;
  const parsed = CustomAttributesSchema.safeParse(Object.fromEntries(entries));
  return parsed.success ? parsed.data : null;
}

function csvRows(input: string, issues: ImportIssue[]): ImportRow[] {
  const [header, ...body] = parseCsv(input);
  if (!header) throw invalid('The CSV is empty.');
  const columns = header.map(cell => cell.trim().toLowerCase().replace(/\s+/g, '_'));
  if (!columns.includes('name')) throw invalid('The CSV needs a "name" column.');
  return body.flatMap((cells, index) => {
    // A blank cell means "leave unchanged", so only filled cells become fields.
    const record = Object.fromEntries(
      columns.flatMap((column, at) => (cells.at(at)?.trim() ? [[column, cells.at(at)]] : []))
    );
    const row = rowFrom(record, index + 2, issues);
    return row ? [row] : [];
  });
}

function yamlRows(input: string, issues: ImportIssue[]): ImportRow[] {
  let parsed: unknown;
  try {
    parsed = parseYaml(input, { maxAliasCount: 100 });
  } catch {
    throw invalid('The YAML could not be parsed.');
  }
  const root = parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {};
  const items = Array.isArray(parsed) ? parsed : root.businessServices;
  if (!Array.isArray(items))
    throw invalid('The YAML must be a list, or have a "businessServices" list.');
  return items.flatMap((item, index) => {
    const row =
      item && typeof item === 'object'
        ? rowFrom(item as Record<string, unknown>, index + 1, issues)
        : (issues.push({ line: index + 1, message: 'Each entry must be a mapping.' }), null);
    return row ? [row] : [];
  });
}

/**
 * Backstage catalog: each System is a business service; Components whose spec.system names it
 * are its members (by the opsknight.com/service-id annotation, else by name); a System's
 * dependsOn on other Systems becomes its supporting business services.
 */
function backstageRows(input: string): ImportRow[] {
  const entities = parseCatalog(input);
  const systems = entities.filter(entity => entity.kind === 'system');
  return systems.map((system, index) => {
    const key = system.name.toLowerCase();
    const members = entities
      .filter(
        entity =>
          entity.kind !== 'system' && entity.system?.replace(/^system:(default\/)?/, '') === key
      )
      .map(entity => entity.serviceId ?? entity.name);
    const dependsOn = system.dependsOn
      .map(ref => ref.trim())
      .filter(ref => /^system:/i.test(ref))
      .map(ref => ref.replace(/^system:/i, '').replace(/^[^/]+\//, ''));
    return { line: index + 1, name: system.name, members, dependsOn };
  });
}

/** Parses a file into rows plus row-level issues; throws for unreadable or oversized input. */
export function parseBusinessServiceImport(input: string, format: ImportFormat) {
  if (Buffer.byteLength(input, 'utf8') > MAX_IMPORT_BYTES)
    throw invalid('The file is larger than 2 MB.');
  const issues: ImportIssue[] = [];
  const rows =
    format === 'csv'
      ? csvRows(input, issues)
      : format === 'yaml'
        ? yamlRows(input, issues)
        : backstageRows(input);
  if (rows.length > MAX_IMPORT_ROWS)
    throw invalid(`An import holds at most ${MAX_IMPORT_ROWS} business services.`);
  if (!rows.length && !issues.length) throw invalid('The file has no business services.');
  return { rows, issues };
}

export type ImportChange = {
  line: number;
  name: string;
  action: 'create' | 'update' | 'unchanged';
  /** Fields that change, e.g. ["description", "members"]. */
  fields: string[];
  membersAdded: string[];
  membersRemoved: string[];
};

export type ImportPlan = {
  changes: ImportChange[];
  issues: ImportIssue[];
  summary: { create: number; update: number; unchanged: number; invalid: number };
};

type Resolved = {
  row: ImportRow;
  existingId: string | null;
  ownerTeamId?: string | null;
  memberServiceIds?: string[];
  /** Stored attributes with the file's merged over them. */
  customAttributes?: Record<string, string | number | boolean>;
};

const lower = (value: string) => value.trim().toLowerCase();

/** Whether a directed graph (parent → children) has a cycle. */
export function hasCycle(edges: ReadonlyMap<string, ReadonlySet<string>>): string | null {
  const state = new Map<string, 'visiting' | 'done'>();
  const visit = (node: string): string | null => {
    if (state.get(node) === 'done') return null;
    if (state.get(node) === 'visiting') return node;
    state.set(node, 'visiting');
    for (const next of edges.get(node) ?? []) {
      const found = visit(next);
      if (found) return found;
    }
    state.set(node, 'done');
    return null;
  };
  for (const node of edges.keys()) {
    const found = visit(node);
    if (found) return found;
  }
  return null;
}

async function resolveImport(rows: ImportRow[], parseIssues: ImportIssue[]) {
  const issues = [...parseIssues];
  const names = rows.map(row => row.name);
  const seen = new Map<string, number>();
  for (const row of rows) {
    const key = lower(row.name);
    if (seen.has(key))
      issues.push({
        line: row.line,
        name: row.name,
        message: `Duplicate of line ${seen.get(key)}.`,
      });
    else seen.set(key, row.line);
  }
  const memberRefs = [...new Set(rows.flatMap(row => row.members ?? []))];
  const teamRefs = [...new Set(rows.flatMap(row => (row.ownerTeam ? [row.ownerTeam] : [])))];
  const [existing, services, teams, supports] = await Promise.all([
    prisma.businessService.findMany({
      select: {
        id: true,
        name: true,
        description: true,
        criticality: true,
        ownerTeamId: true,
        customAttributes: true,
        members: { select: { serviceId: true, service: { select: { name: true } } } },
      },
    }),
    memberRefs.length
      ? prisma.service.findMany({
          where: {
            OR: [{ id: { in: memberRefs } }, { name: { in: memberRefs, mode: 'insensitive' } }],
          },
          select: { id: true, name: true },
        })
      : [],
    teamRefs.length
      ? prisma.team.findMany({
          where: {
            OR: [{ id: { in: teamRefs } }, { name: { in: teamRefs, mode: 'insensitive' } }],
          },
          select: { id: true, name: true },
        })
      : [],
    prisma.businessServiceSupport.findMany({ select: { parentId: true, childId: true } }),
  ]);
  const existingByName = new Map(existing.map(row => [lower(row.name), row]));
  const lookup = <T extends { id: string; name: string }>(items: T[]) => {
    const byKey = new Map<string, T[]>();
    for (const item of items)
      for (const key of new Set([item.id, lower(item.name)]))
        byKey.set(key, [...(byKey.get(key) ?? []), item]);
    return (ref: string) => byKey.get(ref) ?? byKey.get(lower(ref)) ?? [];
  };
  const serviceFor = lookup(services);
  const teamFor = lookup(teams);

  const resolved: Resolved[] = rows.map(row => {
    const current = existingByName.get(lower(row.name)) ?? null;
    const entry: Resolved = { row, existingId: current?.id ?? null };
    if (row.ownerTeam !== undefined) {
      if (row.ownerTeam === null) entry.ownerTeamId = null;
      else {
        const found = teamFor(row.ownerTeam);
        if (found.length === 1) entry.ownerTeamId = found[0].id;
        else
          issues.push({
            line: row.line,
            name: row.name,
            message: found.length
              ? `Team "${row.ownerTeam}" is ambiguous; use its id.`
              : `Unknown team "${row.ownerTeam}".`,
          });
      }
    }
    if (row.members) {
      const ids: string[] = [];
      for (const ref of row.members) {
        const found = serviceFor(ref);
        if (found.length === 1) ids.push(found[0].id);
        else
          issues.push({
            line: row.line,
            name: row.name,
            message: found.length
              ? `Service "${ref}" is ambiguous; use its id.`
              : `Unknown service "${ref}".`,
          });
      }
      if (ids.length > 200)
        issues.push({ line: row.line, name: row.name, message: 'At most 200 members.' });
      entry.memberServiceIds = [...new Set(ids)];
    }
    if (row.attributes) {
      const stored = existing.find(item => item.id === entry.existingId)?.customAttributes;
      const merged = CustomAttributesSchema.safeParse({
        ...(stored && typeof stored === 'object' && !Array.isArray(stored) ? stored : {}),
        ...row.attributes,
      });
      if (merged.success) entry.customAttributes = merged.data;
      else
        issues.push({
          line: row.line,
          name: row.name,
          message: merged.error.issues[0]?.message ?? 'Invalid attributes.',
        });
    }
    return entry;
  });

  // Support graph after the import: existing edges, with each row's dependsOn replacing its own.
  const fileNames = new Set(names.map(lower));
  const idFor = (name: string) => existingByName.get(lower(name))?.id ?? `new:${lower(name)}`;
  const edges = new Map<string, Set<string>>();
  const replaced = new Set(rows.filter(row => row.dependsOn).map(row => idFor(row.name)));
  for (const edge of supports)
    if (!replaced.has(edge.parentId))
      edges.set(edge.parentId, new Set([...(edges.get(edge.parentId) ?? []), edge.childId]));
  for (const row of rows) {
    if (!row.dependsOn) continue;
    const children = new Set<string>();
    for (const ref of row.dependsOn) {
      if (!existingByName.has(lower(ref)) && !fileNames.has(lower(ref))) {
        issues.push({
          line: row.line,
          name: row.name,
          message: `Unknown business service "${ref}".`,
        });
        continue;
      }
      if (lower(ref) === lower(row.name)) {
        issues.push({
          line: row.line,
          name: row.name,
          message: 'A business service cannot depend on itself.',
        });
        continue;
      }
      children.add(idFor(ref));
    }
    edges.set(idFor(row.name), children);
  }
  if (hasCycle(edges))
    issues.push({
      line: 0,
      message: 'The dependencies between business services would form a cycle.',
    });

  const changes: ImportChange[] = resolved.map(
    ({ row, existingId, ownerTeamId, memberServiceIds, customAttributes }) => {
      const current = existingId ? existing.find(item => item.id === existingId)! : null;
      const currentMembers = new Set(current?.members.map(member => member.serviceId) ?? []);
      const nameOf = new Map([
        ...(current?.members.map(member => [member.serviceId, member.service.name] as const) ?? []),
        ...services.map(service => [service.id, service.name] as const),
      ]);
      const next = memberServiceIds ? new Set(memberServiceIds) : currentMembers;
      const membersAdded = [...next]
        .filter(id => !currentMembers.has(id))
        .map(id => nameOf.get(id) ?? id);
      const membersRemoved = [...currentMembers]
        .filter(id => !next.has(id))
        .map(id => nameOf.get(id) ?? id);
      const fields: string[] = [];
      if (!current) fields.push('name');
      if (row.description !== undefined && row.description !== (current?.description ?? null))
        fields.push('description');
      if (row.criticality !== undefined && row.criticality !== (current?.criticality ?? null))
        fields.push('criticality');
      if (ownerTeamId !== undefined && ownerTeamId !== (current?.ownerTeamId ?? null))
        fields.push('ownerTeam');
      if (membersAdded.length || membersRemoved.length) fields.push('members');
      if (
        customAttributes &&
        JSON.stringify(customAttributes) !== JSON.stringify(current?.customAttributes ?? {})
      )
        fields.push('customAttributes');
      if (row.dependsOn) {
        const before = supports
          .filter(edge => edge.parentId === existingId)
          .map(edge => edge.childId)
          .sort();
        const after = [...(edges.get(idFor(row.name)) ?? [])].sort();
        if (before.join() !== after.join()) fields.push('dependsOn');
      }
      return {
        line: row.line,
        name: row.name,
        action: !current ? 'create' : fields.length ? 'update' : 'unchanged',
        fields,
        membersAdded,
        membersRemoved,
      };
    }
  );
  const invalidLines = new Set(issues.map(issue => issue.line));
  return {
    resolved,
    plan: {
      changes,
      issues,
      summary: {
        create: changes.filter(change => change.action === 'create').length,
        update: changes.filter(change => change.action === 'update').length,
        unchanged: changes.filter(change => change.action === 'unchanged').length,
        invalid: invalidLines.size,
      },
    } satisfies ImportPlan,
  };
}

type Context = { actor: AuthorizationActor; source?: AuditEventSource };

/**
 * Imports business services from CSV, YAML or a Backstage catalog. With `dryRun` it only returns
 * the diff; otherwise it applies everything in one transaction, or nothing when any row is invalid.
 */
export async function importBusinessServices(
  input: { content: string; format: ImportFormat; dryRun: boolean },
  context: Context,
  client?: Prisma.TransactionClient
): Promise<ImportPlan & { applied: boolean }> {
  assertCanManageBusinessServices(context.actor);
  const { rows, issues } = parseBusinessServiceImport(input.content, input.format);
  const { resolved, plan } = await resolveImport(rows, issues);
  if (input.dryRun || plan.issues.length) return { ...plan, applied: false };

  const apply = async (tx: Prisma.TransactionClient) => {
    // The same lock as every support-graph writer, so concurrent imports and edits cannot close a cycle.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended('business-service-support', 0))`;
    const idByName = new Map<string, string>();
    for (const entry of resolved) {
      const { row } = entry;
      const change = plan.changes.find(item => item.line === row.line)!;
      const fields = {
        ...(row.description !== undefined ? { description: row.description } : {}),
        ...(entry.ownerTeamId !== undefined ? { ownerTeamId: entry.ownerTeamId } : {}),
        ...(entry.memberServiceIds ? { memberServiceIds: entry.memberServiceIds } : {}),
        ...(row.criticality !== undefined ? { criticality: row.criticality } : {}),
        ...(entry.customAttributes ? { customAttributes: entry.customAttributes } : {}),
      };
      const saved =
        entry.existingId === null
          ? await createBusinessService({ name: row.name, ...fields }, context, tx)
          : change.action === 'unchanged' || !Object.keys(fields).length
            ? { id: entry.existingId }
            : await updateBusinessService(entry.existingId, fields, context, tx);
      idByName.set(lower(row.name), saved.id);
    }
    for (const { row } of resolved) {
      if (!row.dependsOn) continue;
      const parentId = idByName.get(lower(row.name))!;
      const childIds: string[] = [];
      for (const ref of row.dependsOn) {
        const known = idByName.get(lower(ref));
        const found = known
          ? { id: known }
          : await tx.businessService.findFirst({
              where: {
                AND: [
                  { name: { equals: ref, mode: 'insensitive' } },
                  businessServiceReadWhere(context.actor),
                ],
              },
              select: { id: true },
            });
        if (!found)
          throw new AppError({
            code: 'RESOURCE_NOT_FOUND',
            userMessage: `Unknown business service "${ref}".`,
          });
        childIds.push(found.id);
      }
      await tx.businessServiceSupport.deleteMany({
        where: { parentId, childId: { notIn: childIds } },
      });
      await tx.businessServiceSupport.createMany({
        data: childIds.map(childId => ({ parentId, childId })),
        skipDuplicates: true,
      });
    }
    // The plan was validated before the lock: recheck the stored graph now that this import is in it.
    const stored = new Map<string, Set<string>>();
    for (const edge of await tx.businessServiceSupport.findMany({
      select: { parentId: true, childId: true },
    }))
      stored.set(edge.parentId, new Set([...(stored.get(edge.parentId) ?? []), edge.childId]));
    if (hasCycle(stored))
      throw new AppError({
        code: 'VALIDATION_FAILED',
        userMessage: 'The dependencies between business services would form a cycle.',
      });
    // Edge-only changes touch no business service row, so tick the clock for the health caches.
    await tx.realtimeChange.create({ data: {} });
    await emitAuditEvent(
      {
        action: 'business_service.imported',
        source: context.source ?? 'UI',
        target: { type: 'BUSINESS_SERVICE', id: null },
        actor: { type: 'USER', id: context.actor.id },
        metadata: {
          format: input.format,
          ...plan.summary,
          names: plan.changes
            .filter(change => change.action !== 'unchanged')
            .map(change => change.name),
        } satisfies Prisma.InputJsonObject,
      },
      tx
    );
  };
  await (client ? apply(client) : prisma.$transaction(apply, { timeout: 120_000 }));
  invalidateBusinessServiceHealth();
  return { ...plan, applied: true };
}
