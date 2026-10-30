import { z } from 'zod/v3';
import type { AuthorizationActor } from '@/lib/authorization-policy';
import { AppError } from '@/lib/errors';
import type { Prisma } from '@prisma/client';
import { WIDGET_REGISTRY } from '@/lib/reports/widget-registry';

const position = z
  .object({
    x: z.number().int().min(0),
    y: z.number().int().min(0),
    w: z.number().int().min(1).max(4),
    h: z.number().int().min(1).max(4),
  })
  .strict();

export const DashboardWidgetV2Schema = z
  .object({
    widgetType: z.string().trim().min(1).max(100),
    metricKey: z.string().trim().min(1).max(100),
    widgetDefinitionId: z.string().max(100).nullish(),
    title: z.string().max(200).nullish(),
    position: position.default({ x: 0, y: 0, w: 1, h: 1 }),
    config: z.record(z.unknown()).default({}),
  })
  .strict()
  .superRefine((widget, context) => {
    const supported = WIDGET_REGISTRY.some(
      definition =>
        definition.type === widget.widgetType &&
        definition.metricKey === widget.metricKey &&
        (!widget.widgetDefinitionId || definition.id === widget.widgetDefinitionId)
    );
    if (!supported) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['widgetDefinitionId'],
        message: 'Widget type, metric, and definition must match a supported dashboard widget.',
      });
    }
  });

const base = {
  name: z.string().trim().min(1).max(200),
  description: z.string().max(2000).nullish(),
  visibility: z.enum(['PRIVATE', 'TEAM', 'PUBLIC']),
  teamId: z.string().min(1).nullish(),
  widgets: z.array(DashboardWidgetV2Schema).max(50),
};

export const DashboardCreateV2Schema = z
  .object({
    ...base,
    visibility: base.visibility.default('PRIVATE'),
    widgets: base.widgets.default([]),
    templateId: z.string().min(1).optional(),
    sourceTemplate: z.string().max(100).optional(),
  })
  .strict();

export const DashboardUpdateV2Schema = z
  .object({
    name: base.name.optional(),
    description: base.description.optional(),
    visibility: base.visibility.optional(),
    teamId: base.teamId.optional(),
    widgets: base.widgets.optional(),
    layout: z
      .object({
        columns: z.number().int().min(1).max(12),
        rowHeight: z.number().int().min(20).max(1000),
      })
      .strict()
      .optional(),
    config: z
      .object({
        timeRange: z.number().int().min(1).max(90).optional(),
        refreshInterval: z.number().int().min(10).max(3600).optional(),
      })
      .strict()
      .optional(),
  })
  .strict()
  .refine(value => Object.keys(value).length > 0, 'At least one field is required.');

export const DashboardListV2Schema = z
  .object({
    limit: z.string().optional(),
    cursor: z.string().optional(),
    search: z.string().trim().max(200).optional(),
  })
  .strict();

export const DashboardIdV2Schema = z.object({ id: z.string().min(1) });

export function dashboardReadWhere(actor: AuthorizationActor): Prisma.DashboardWhereInput {
  return {
    OR: [
      { userId: actor.id },
      { visibility: 'PUBLIC' },
      { isTemplate: true },
      { visibility: 'TEAM', team: { members: { some: { userId: actor.id } } } },
    ],
  };
}

export async function requireCurrentDashboardTeamMembership(
  db: Prisma.TransactionClient,
  actorId: string,
  teamId: string | null
) {
  if (!teamId) return;
  const member = await db.teamMember.findUnique({
    where: { userId_teamId: { userId: actorId, teamId } },
    select: { id: true },
  });
  if (!member) {
    throw new AppError({
      code: 'AUTHORIZATION_DENIED',
      userMessage: 'Team dashboard access denied.',
    });
  }
}

export function assertDashboardTeam(
  actor: AuthorizationActor,
  visibility: 'PRIVATE' | 'TEAM' | 'PUBLIC',
  teamId: string | null | undefined
): string | null {
  if (visibility === 'TEAM') {
    if (!teamId || !actor.teamIds.includes(teamId)) {
      throw new AppError({
        code: 'AUTHORIZATION_DENIED',
        userMessage: 'Team dashboard access denied.',
      });
    }
    return teamId;
  }
  if (teamId) {
    throw new AppError({
      code: 'VALIDATION_FAILED',
      userMessage: 'Only team dashboards can specify a team.',
    });
  }
  return null;
}

export function dashboardWidgetCreate(widget: z.infer<typeof DashboardWidgetV2Schema>) {
  return {
    widgetType: widget.widgetType,
    metricKey: widget.metricKey,
    widgetDefinitionId: widget.widgetDefinitionId ?? null,
    title: widget.title ?? null,
    position: widget.position as Prisma.InputJsonValue,
    config: widget.config as Prisma.InputJsonValue,
  };
}
