import 'server-only';

import { Prisma, type BusinessServiceTier } from '@prisma/client';
import { z } from 'zod/v3';
import prisma from '@/lib/prisma';
import { AppError } from '@/lib/errors';
import { logger } from '@/lib/logger';
import { emitAuditEvent } from '@/lib/audit';
import { CAPABILITIES } from '@/lib/authorization';
import { actorHasCapability, type AuthorizationActor } from '@/lib/authorization-policy';
import { businessServiceReadWhere } from './commands';
import { getBusinessServiceHealth, type BusinessServiceHealth } from './contract';

/**
 * Internal status dashboards: the board read model (tiles, notices) and the commands that manage
 * custom dashboards. Everything a board shows is safe for STAKEHOLDER: status, since and counts, never
 * incident titles or responders.
 */

/**
 * Resolves to null instead of throwing when health cannot be computed (database or engine failure),
 * so a page can show the rest of its content with an inline error. User-facing `AppError`s (access
 * denied, bad cursor) still throw.
 */
export async function orUnavailable<T>(promise: Promise<T>, event: string): Promise<T | null> {
  try {
    return await promise;
  } catch (error) {
    if (error instanceof AppError) throw error;
    logger.error(event, { component: 'business-services', error });
    return null;
  }
}

/** A board shows at most this many business services; the catalog is the place to browse more. */
export const BOARD_LIMIT = 500;
const NOTICE_HORIZON_MS = 24 * 60 * 60 * 1000;

export type StatusBoardTile = {
  id: string;
  name: string;
  criticality: BusinessServiceTier | null;
  health: BusinessServiceHealth;
};

export type StatusBoardNotice = {
  id: string;
  kind: 'ANNOUNCEMENT' | 'MAINTENANCE';
  title: string;
  message: string | null;
  startsAt: Date;
  endsAt: Date | null;
  /** Business services a maintenance window covers (only ones the viewer can see). */
  businessServiceNames: string[];
};

export type StatusBoard = {
  tiles: StatusBoardTile[];
  notices: StatusBoardNotice[];
  computedAt: Date;
};

const TILE_SELECT = { id: true, name: true, criticality: true } as const;

/** Tiles in board order (a custom dashboard's position, else name), plus live notices. */
export async function loadStatusBoard(
  actor: AuthorizationActor,
  options: { dashboardId?: string } = {}
): Promise<StatusBoard> {
  const now = new Date();
  const horizon = new Date(now.getTime() + NOTICE_HORIZON_MS);
  const readWhere = businessServiceReadWhere(actor);
  const rows = options.dashboardId
    ? (
        await prisma.statusDashboardBusinessService.findMany({
          where: { dashboardId: options.dashboardId, businessService: readWhere },
          orderBy: [{ position: 'asc' }, { businessServiceId: 'asc' }],
          take: BOARD_LIMIT,
          select: { businessService: { select: TILE_SELECT } },
        })
      ).map(row => row.businessService)
    : await prisma.businessService.findMany({
        where: readWhere,
        orderBy: { name: 'asc' },
        take: BOARD_LIMIT,
        select: TILE_SELECT,
      });
  const ids = rows.map(row => row.id);

  const [health, announcements, windows] = await Promise.all([
    getBusinessServiceHealth(ids, actor),
    prisma.statusPageAnnouncement.findMany({
      where: {
        isActive: true,
        publishAt: { lte: now },
        startDate: { lte: horizon },
        OR: [{ endDate: null }, { endDate: { gte: now } }],
        statusPage: { enabled: true },
      },
      orderBy: { startDate: 'desc' },
      take: 5,
      select: {
        id: true,
        title: true,
        message: true,
        startDate: true,
        endDate: true,
        maintenanceWindowId: true,
      },
    }),
    ids.length
      ? prisma.maintenanceWindow.findMany({
          where: {
            startsAt: { lte: horizon },
            endsAt: { gte: now },
            businessServices: { some: { businessServiceId: { in: ids } } },
          },
          orderBy: { startsAt: 'asc' },
          take: 5,
          select: {
            id: true,
            title: true,
            description: true,
            startsAt: true,
            endsAt: true,
            businessServices: {
              where: { businessServiceId: { in: ids } },
              select: { businessService: { select: { name: true } } },
            },
          },
        })
      : Promise.resolve([]),
  ]);

  const windowIds = new Set(windows.map(window => window.id));
  const notices: StatusBoardNotice[] = [
    ...windows.map(window => ({
      id: window.id,
      kind: 'MAINTENANCE' as const,
      title: window.title,
      message: window.description,
      startsAt: window.startsAt,
      endsAt: window.endsAt,
      businessServiceNames: window.businessServices.map(link => link.businessService.name),
    })),
    // A window that also published an announcement is shown once, as the window.
    ...announcements
      .filter(row => !row.maintenanceWindowId || !windowIds.has(row.maintenanceWindowId))
      .map(row => ({
        id: row.id,
        kind: 'ANNOUNCEMENT' as const,
        title: row.title,
        message: row.message,
        startsAt: row.startDate,
        endsAt: row.endDate,
        businessServiceNames: [],
      })),
  ];

  const tiles = rows.flatMap(row => {
    const entry = health.get(row.id);
    return entry ? [{ ...row, health: entry }] : [];
  });
  return { tiles, notices, computedAt: now };
}

// ── Custom dashboards ────────────────────────────────────────────────────────────────────────────

const id = z.string().trim().min(1).max(100);

export const StatusDashboardInputSchema = z
  .object({
    name: z.string().trim().min(1).max(80),
    slug: z
      .string()
      .trim()
      .toLowerCase()
      .min(1)
      .max(60)
      .regex(/^[a-z0-9-]+$/, 'Use lowercase letters, numbers and hyphens.')
      .refine(
        slug => !slug.startsWith('-') && !slug.endsWith('-') && !slug.includes('--'),
        'Start and end with a letter or number, with single hyphens between words.'
      ),
    businessServiceIds: z.array(id).max(BOARD_LIMIT).default([]),
  })
  .strict();

export type StatusDashboardInput = z.input<typeof StatusDashboardInputSchema>;

export type StatusDashboardSummary = {
  id: string;
  name: string;
  slug: string;
  /** In board order; only business services the viewer can see. */
  businessServiceIds: string[];
};

export function canManageStatusDashboards(actor: AuthorizationActor): boolean {
  return actorHasCapability(actor, CAPABILITIES.OPERATIONS_MANAGE);
}

function assertCanManage(actor: AuthorizationActor) {
  if (!canManageStatusDashboards(actor)) {
    throw new AppError({
      code: 'AUTHORIZATION_DENIED',
      userMessage: 'Only Responders and Admins can manage status dashboards.',
    });
  }
}

export async function listStatusDashboards(
  actor: AuthorizationActor
): Promise<StatusDashboardSummary[]> {
  const readWhere = businessServiceReadWhere(actor);
  const rows = await prisma.statusDashboard.findMany({
    orderBy: [{ position: 'asc' }, { name: 'asc' }],
    take: 100,
    select: {
      id: true,
      name: true,
      slug: true,
      businessServices: {
        where: { businessService: readWhere },
        orderBy: { position: 'asc' },
        select: { businessServiceId: true },
      },
    },
  });
  return rows.map(row => ({
    id: row.id,
    name: row.name,
    slug: row.slug,
    businessServiceIds: row.businessServices.map(link => link.businessServiceId),
  }));
}

export function getStatusDashboardBySlug(slug: string) {
  return prisma.statusDashboard.findUnique({
    where: { slug },
    select: { id: true, name: true, slug: true },
  });
}

type DashboardContext = { actor: AuthorizationActor };

/** Every id must be a business service the actor can see; returns them in input order, deduplicated. */
async function visibleIds(
  tx: Prisma.TransactionClient,
  actor: AuthorizationActor,
  ids: readonly string[]
) {
  const unique = [...new Set(ids)];
  if (!unique.length) return unique;
  const found = await tx.businessService.findMany({
    where: { AND: [{ id: { in: unique } }, businessServiceReadWhere(actor)] },
    select: { id: true },
  });
  if (found.length !== unique.length) {
    throw new AppError({
      code: 'VALIDATION_FAILED',
      userMessage: 'One of the business services no longer exists or is not visible to you.',
    });
  }
  return unique;
}

function slugConflict(error: unknown): never {
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
    throw new AppError({
      code: 'RESOURCE_CONFLICT',
      userMessage: 'Another dashboard already uses this URL. Pick a different one.',
    });
  }
  throw error;
}

async function audit(
  tx: Prisma.TransactionClient,
  context: DashboardContext,
  action: string,
  dashboardId: string,
  newValue?: Prisma.InputJsonObject
) {
  await emitAuditEvent(
    {
      action,
      source: 'UI',
      target: { type: 'DASHBOARD', id: dashboardId },
      actor: { type: 'USER', id: context.actor.id },
      ...(newValue ? { newValue } : {}),
    },
    tx
  );
}

export async function createStatusDashboard(
  raw: StatusDashboardInput,
  context: DashboardContext
): Promise<{ id: string; slug: string }> {
  assertCanManage(context.actor);
  const input = StatusDashboardInputSchema.parse(raw);
  return prisma
    .$transaction(async tx => {
      const ids = await visibleIds(tx, context.actor, input.businessServiceIds);
      const created = await tx.statusDashboard.create({
        data: { name: input.name, slug: input.slug },
        select: { id: true, slug: true },
      });
      await tx.statusDashboardBusinessService.createMany({
        data: ids.map((businessServiceId, position) => ({
          dashboardId: created.id,
          businessServiceId,
          position,
        })),
      });
      await audit(tx, context, 'status_dashboard.created', created.id, {
        name: input.name,
        slug: input.slug,
        businessServiceIds: ids,
      });
      return created;
    })
    .catch(slugConflict);
}

export async function updateStatusDashboard(
  dashboardId: string,
  raw: StatusDashboardInput,
  context: DashboardContext
): Promise<{ id: string; slug: string }> {
  assertCanManage(context.actor);
  const input = StatusDashboardInputSchema.parse(raw);
  return prisma
    .$transaction(async tx => {
      const ids = await visibleIds(tx, context.actor, input.businessServiceIds);
      const updated = await tx.statusDashboard
        .update({
          where: { id: dashboardId },
          data: { name: input.name, slug: input.slug },
          select: { id: true, slug: true },
        })
        .catch(error => {
          if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025') {
            throw new AppError({ code: 'RESOURCE_NOT_FOUND', userMessage: 'Dashboard not found.' });
          }
          throw error;
        });
      // Only links the actor can see are replaced; others' business services stay on the board.
      await tx.statusDashboardBusinessService.deleteMany({
        where: { dashboardId, businessService: businessServiceReadWhere(context.actor) },
      });
      await tx.statusDashboardBusinessService.createMany({
        data: ids.map((businessServiceId, position) => ({
          dashboardId,
          businessServiceId,
          position,
        })),
        skipDuplicates: true,
      });
      await audit(tx, context, 'status_dashboard.updated', dashboardId, {
        name: input.name,
        slug: input.slug,
        businessServiceIds: ids,
      });
      return updated;
    })
    .catch(slugConflict);
}

export async function deleteStatusDashboard(dashboardId: string, context: DashboardContext) {
  assertCanManage(context.actor);
  await prisma.$transaction(async tx => {
    const { count } = await tx.statusDashboard.deleteMany({ where: { id: dashboardId } });
    if (!count) {
      throw new AppError({ code: 'RESOURCE_NOT_FOUND', userMessage: 'Dashboard not found.' });
    }
    await audit(tx, context, 'status_dashboard.deleted', dashboardId);
  });
}
