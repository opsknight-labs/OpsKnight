import 'server-only';
import { createHash, randomBytes } from 'node:crypto';
import { z } from 'zod/v3';
import type { GraphViewVisibility, Prisma } from '@prisma/client';
import prisma from '@/lib/prisma';
import { logAudit } from '@/lib/audit';
import { CAPABILITIES } from '@/lib/authorization';
import { resolveUserActor } from '@/lib/authorization-actors';
import { actorHasCapability, type AuthorizationActor } from '@/lib/authorization-policy';
import { AppError } from '@/lib/errors';
import { parseGraphFocus } from '@/lib/service-graph/focus';
import { getServiceGraphForActor } from '../graph-view';

export const EMBED_SETTING_KEY = 'graphEmbed.enabled';
const MAX_VIEWS = 200;
const EMBED_MAX_NODES = 200;
const EMBED_MAX_EDGES = 1000;
const id = z.string().trim().min(1).max(100);

export const viewConfigSchema = z
  .object({
    focus: z
      .string()
      .trim()
      .max(110)
      .refine(value => parseGraphFocus(value) !== null, 'Use svc:<id> or bs:<id>.')
      .nullable()
      .default(null),
    hops: z.number().int().min(1).max(3).default(2),
    filters: z
      .object({
        statuses: z.array(z.string().trim().min(1).max(32)).max(10).optional(),
        origins: z.array(z.enum(['DECLARED', 'OBSERVED'])).max(2).optional(),
        includeSuggested: z.boolean().optional(),
        teamIds: z.array(id).max(50).optional(),
      })
      .strict()
      .default({}),
    mode: z.string().trim().regex(/^[A-Za-z_-]{1,32}$/).default('graph'),
    pinned: z
      .array(
        z.object({ id, x: z.number().finite().min(-1e6).max(1e6), y: z.number().finite().min(-1e6).max(1e6) }).strict()
      )
      .max(200)
      .default([]),
    /** The explorer's client-side URL state (search, tier, impact mode…); the embed ignores it. */
    search: z.string().max(600).optional(),
  })
  .strict();
export type ViewConfig = z.infer<typeof viewConfigSchema>;

export const viewInputSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    visibility: z.enum(['PRIVATE', 'TEAM', 'ORG']).default('PRIVATE'),
    teamId: id.nullable().optional(),
    config: viewConfigSchema,
  })
  .strict();
export type ViewInput = z.infer<typeof viewInputSchema>;

type Row = {
  id: string;
  name: string;
  ownerId: string;
  teamId: string | null;
  visibility: GraphViewVisibility;
  config: Prisma.JsonValue;
  shareExpiresAt: Date | null;
  shareRevokedAt: Date | null;
  shareTokenHash: string | null;
  createdAt: Date;
  updatedAt: Date;
};

const dto = (row: Row) => ({
  id: row.id,
  name: row.name,
  ownerId: row.ownerId,
  teamId: row.teamId,
  visibility: row.visibility,
  config: row.config,
  shared: Boolean(
    row.shareTokenHash &&
      !row.shareRevokedAt &&
      (!row.shareExpiresAt || row.shareExpiresAt > new Date())
  ),
  shareExpiresAt: row.shareExpiresAt?.toISOString() ?? null,
  createdAt: row.createdAt.toISOString(),
  updatedAt: row.updatedAt.toISOString(),
});

/** Own views, views of the actor's teams, and org-wide views. Hidden views are simply absent. */
const readableWhere = (actor: AuthorizationActor): Prisma.SavedGraphViewWhereInput => ({
  OR: [
    { ownerId: actor.id },
    { visibility: 'TEAM', teamId: { in: [...actor.teamIds] } },
    { visibility: 'ORG' },
  ],
});

const canManage = (actor: AuthorizationActor, row: Pick<Row, 'ownerId'>) =>
  row.ownerId === actor.id || actorHasCapability(actor, CAPABILITIES.ADMIN_MANAGE);

function checkVisibility(actor: AuthorizationActor, input: Pick<ViewInput, 'visibility' | 'teamId'>) {
  const bad = (message: string) =>
    new AppError({ code: 'VALIDATION_FAILED', fields: [{ field: 'visibility', code: 'custom', message }] });
  if (input.visibility === 'TEAM' && (!input.teamId || !actor.teamIds.includes(input.teamId)))
    throw bad('TEAM views need a teamId you belong to.');
  if (input.visibility !== 'TEAM' && input.teamId) throw bad('teamId is only for TEAM views.');
  if (input.visibility === 'ORG' && !actorHasCapability(actor, CAPABILITIES.OPERATIONS_MANAGE))
    throw new AppError({ code: 'AUTHORIZATION_DENIED' });
}

const audit = (actor: AuthorizationActor, action: string, entityId: string, details?: object) =>
  logAudit({
    action,
    entityType: 'SYSTEM_CONFIG',
    entityId,
    actorId: actor.id,
    source: 'API',
    details: { view: true, ...details },
  });

export async function listViews(actor: AuthorizationActor) {
  const rows = await prisma.savedGraphView.findMany({
    where: readableWhere(actor),
    orderBy: [{ name: 'asc' }, { id: 'asc' }],
    take: MAX_VIEWS,
  });
  return rows.map(dto);
}

async function findReadable(actor: AuthorizationActor, viewId: string): Promise<Row> {
  const row = await prisma.savedGraphView.findFirst({ where: { AND: [{ id: viewId }, readableWhere(actor)] } });
  if (!row) throw new AppError({ code: 'RESOURCE_NOT_FOUND' });
  return row;
}

export async function getView(actor: AuthorizationActor, viewId: string) {
  return dto(await findReadable(actor, viewId));
}

export async function createView(actor: AuthorizationActor, input: ViewInput) {
  checkVisibility(actor, input);
  if ((await prisma.savedGraphView.count({ where: { ownerId: actor.id } })) >= MAX_VIEWS)
    throw new AppError({
      code: 'VALIDATION_FAILED',
      fields: [{ field: 'name', code: 'custom', message: `At most ${MAX_VIEWS} saved views each.` }],
    });
  const row = await prisma.savedGraphView.create({
    data: {
      name: input.name,
      ownerId: actor.id,
      visibility: input.visibility,
      teamId: input.teamId ?? null,
      config: input.config as Prisma.InputJsonValue,
    },
  });
  await audit(actor, 'graph_view.created', row.id, { visibility: row.visibility });
  return dto(row);
}

export async function updateView(actor: AuthorizationActor, viewId: string, patch: Partial<ViewInput>) {
  const row = await findReadable(actor, viewId);
  if (!canManage(actor, row)) throw new AppError({ code: 'RESOURCE_NOT_FOUND' });
  const next = { visibility: patch.visibility ?? row.visibility, teamId: patch.teamId === undefined ? row.teamId : patch.teamId };
  if (patch.visibility !== undefined || patch.teamId !== undefined) checkVisibility(actor, next);
  const updated = await prisma.savedGraphView.update({
    where: { id: viewId },
    data: {
      ...(patch.name !== undefined && { name: patch.name }),
      ...(patch.config !== undefined && { config: patch.config as Prisma.InputJsonValue }),
      visibility: next.visibility,
      teamId: next.visibility === 'TEAM' ? next.teamId : null,
    },
  });
  await audit(actor, 'graph_view.updated', viewId, { visibility: updated.visibility });
  return dto(updated);
}

export async function deleteView(actor: AuthorizationActor, viewId: string) {
  const row = await findReadable(actor, viewId);
  if (!canManage(actor, row)) throw new AppError({ code: 'RESOURCE_NOT_FOUND' });
  await prisma.savedGraphView.delete({ where: { id: viewId } });
  await audit(actor, 'graph_view.deleted', viewId, { hadShare: Boolean(row.shareTokenHash) });
}

export async function isEmbedEnabled(): Promise<boolean> {
  const row = await prisma.systemConfig.findUnique({ where: { key: EMBED_SETTING_KEY } });
  return row?.value === true;
}

/** Admin only: turns read-only embeds on or off for the whole install. Off by default. */
export async function setEmbedEnabled(actor: AuthorizationActor, enabled: boolean) {
  if (!actorHasCapability(actor, CAPABILITIES.ADMIN_MANAGE)) throw new AppError({ code: 'AUTHORIZATION_DENIED' });
  await prisma.systemConfig.upsert({
    where: { key: EMBED_SETTING_KEY },
    create: { key: EMBED_SETTING_KEY, value: enabled, updatedBy: actor.id },
    update: { value: enabled, updatedBy: actor.id },
  });
  await logAudit({
    action: 'graph_embed.setting_changed',
    entityType: 'SYSTEM_CONFIG',
    entityId: EMBED_SETTING_KEY,
    actorId: actor.id,
    source: 'API',
    newValue: { enabled },
  });
}

const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');

/**
 * Admin only, and only while embeds are enabled. Returns the token once (only its SHA-256 is
 * stored); sharing again replaces the previous token, which stops working.
 */
export async function shareView(actor: AuthorizationActor, viewId: string, expiresInDays: number) {
  if (!actorHasCapability(actor, CAPABILITIES.ADMIN_MANAGE)) throw new AppError({ code: 'AUTHORIZATION_DENIED' });
  if (!(await isEmbedEnabled())) throw new AppError({ code: 'RESOURCE_CONFLICT', userMessage: 'Graph embeds are turned off.' });
  await findReadable(actor, viewId);
  const token = `gve_${randomBytes(32).toString('base64url')}`;
  const expiresAt = new Date(Date.now() + Math.min(Math.max(expiresInDays, 1), 90) * 864e5);
  await prisma.savedGraphView.update({
    where: { id: viewId },
    data: { shareTokenHash: hashToken(token), shareExpiresAt: expiresAt, shareRevokedAt: null },
  });
  await audit(actor, 'graph_view.shared', viewId, { expiresAt: expiresAt.toISOString() });
  return { token, expiresAt: expiresAt.toISOString() };
}

export async function revokeShare(actor: AuthorizationActor, viewId: string) {
  const row = await findReadable(actor, viewId);
  if (!canManage(actor, row)) throw new AppError({ code: 'RESOURCE_NOT_FOUND' });
  await prisma.savedGraphView.update({ where: { id: viewId }, data: { shareRevokedAt: new Date() } });
  await audit(actor, 'graph_view.share_revoked', viewId);
}

type ViewFilters = z.infer<typeof viewConfigSchema>['filters'];

/** Saved-view filters, applied server-side so filtered-out nodes and their edges never leave it. */
export function applyViewFilters<
  G extends {
    nodes: { id: string; status: string; teamId: string | null }[];
    businessServices: { id: string; status: string; teamId: string | null }[];
    edges: { upstreamServiceId: string; downstreamServiceId: string; status: string; origin?: string | null }[];
    memberEdges: { serviceId: string; businessServiceId: string }[];
  },
>(graph: G, f: ViewFilters): G {
  const keep = (n: { status: string; teamId: string | null }) =>
    (!f.statuses?.length || f.statuses.includes(n.status)) &&
    (!f.teamIds?.length || (n.teamId !== null && f.teamIds.includes(n.teamId)));
  const nodes = graph.nodes.filter(keep);
  const businessServices = graph.businessServices.filter(keep);
  const svc = new Set(nodes.map(n => n.id));
  const bs = new Set(businessServices.map(b => b.id));
  return {
    ...graph,
    nodes,
    businessServices,
    edges: graph.edges.filter(
      e =>
        svc.has(e.upstreamServiceId) &&
        svc.has(e.downstreamServiceId) &&
        (!f.origins?.length || (!!e.origin && f.origins.includes(e.origin as 'DECLARED' | 'OBSERVED'))) &&
        (f.includeSuggested || e.status !== 'SUGGESTED')
    ),
    memberEdges: graph.memberEdges.filter(m => svc.has(m.serviceId) && bs.has(m.businessServiceId)),
  };
}

/**
 * Read-only embed. Resolves the token, then reads the graph as the view's OWNER (so it can never
 * show more than they can see now, and stops when they are disabled), and anonymizes it: no ids,
 * names, teams or incident data, only opaque labels, statuses and edges. Null for any bad,
 * expired, revoked or disabled token, indistinguishably.
 */
export async function getEmbeddedView(token: string) {
  if (!/^gve_[A-Za-z0-9_-]{20,80}$/.test(token) || !(await isEmbedEnabled())) return null;
  const row = await prisma.savedGraphView.findUnique({ where: { shareTokenHash: hashToken(token) } });
  if (!row || row.shareRevokedAt || !row.shareExpiresAt || row.shareExpiresAt <= new Date()) return null;
  const owner = await resolveUserActor(row.ownerId);
  if (!owner || owner.status !== 'ACTIVE') return null;
  const config = viewConfigSchema.safeParse(row.config);
  if (!config.success) return null;
  const full = await getServiceGraphForActor(owner, prisma, {
    access: 'service',
    focus: config.data.focus ? parseGraphFocus(config.data.focus) : null,
    hops: config.data.hops,
  });
  if (!full) return null;
  const graph = applyViewFilters(full, config.data.filters);
  const nodes = graph.nodes.slice(0, EMBED_MAX_NODES);
  const ref = new Map(nodes.map((node, index) => [node.id, `S${index + 1}`] as const));
  const bsRef = new Map(graph.businessServices.map((bs, index) => [bs.id, `B${index + 1}`] as const));
  return {
    anonymized: true,
    truncated: graph.truncated || graph.nodes.length > EMBED_MAX_NODES,
    services: nodes.map(node => ({ ref: ref.get(node.id)!, status: node.status })),
    businessServices: graph.businessServices.map(bs => ({ ref: bsRef.get(bs.id)!, status: bs.status })),
    dependencies: graph.edges
      .filter(edge => edge.status === 'ACTIVE' && ref.has(edge.upstreamServiceId) && ref.has(edge.downstreamServiceId))
      .slice(0, EMBED_MAX_EDGES)
      .map(edge => ({ from: ref.get(edge.upstreamServiceId)!, to: ref.get(edge.downstreamServiceId)! })),
    members: graph.memberEdges
      .filter(member => ref.has(member.serviceId) && bsRef.has(member.businessServiceId))
      .map(member => ({ businessService: bsRef.get(member.businessServiceId)!, service: ref.get(member.serviceId)! })),
    mode: config.data.mode,
    pinned: config.data.pinned
      .filter(pin => ref.has(pin.id))
      .map(pin => ({ ref: ref.get(pin.id)!, x: pin.x, y: pin.y })),
  };
}
