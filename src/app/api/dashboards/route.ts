import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { getServerSession } from 'next-auth';
import { getAuthOptions } from '@/lib/auth';
import { logger } from '@/lib/logger';
import { Prisma } from '@prisma/client';
import { z } from 'zod';

const CreateDashboardSchema = z.object({
  name: z.string().min(1, 'Name is required').max(200).trim(),
  description: z.string().max(2000).nullish(),
  visibility: z.enum(['PRIVATE', 'TEAM', 'PUBLIC']).default('PRIVATE'),
  teamId: z.string().nullish(),
  sourceTemplate: z.string().max(100).nullish(),
  templateId: z.string().nullish(), // backward compat
  widgets: z.array(z.object({
    widgetType: z.string().min(1),
    metricKey: z.string().min(1),
    widgetDefinitionId: z.string().max(100).nullish(),
    title: z.string().max(200).nullish(),
    position: z.object({
      x: z.number().int().min(0),
      y: z.number().int().min(0),
      w: z.number().int().min(1).max(4),
      h: z.number().int().min(1).max(4),
    }).default({ x: 0, y: 0, w: 1, h: 1 }),
    config: z.record(z.unknown()).default({}),
  })).max(50, 'Maximum 50 widgets per dashboard').default([]),
});

export const dynamic = 'force-dynamic';

/**
 * Dashboard API - List and Create Dashboards
 *
 * GET: List user's dashboards and available templates
 * POST: Create a new dashboard (optionally from template)
 */

// GET: List dashboards
export async function GET() {
  try {
    const session = await getServerSession(await getAuthOptions());
    if (!session?.user?.email) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const user = await prisma.user.findUnique({
      where: { email: session.user.email },
      select: { id: true, teamMemberships: { select: { teamId: true } } },
    });

    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    const teamIds = user.teamMemberships.map(m => m.teamId);

    // Fetch user's own dashboards, team dashboards, and templates
    // Apply reasonable limits to prevent memory exhaustion
    const MAX_DASHBOARDS_PER_QUERY = 100;
    const MAX_WIDGETS_PER_DASHBOARD = 50;

    const [userDashboards, teamDashboards, publicDashboards] = await Promise.all([
      // User's private dashboards
      prisma.dashboard.findMany({
        where: { userId: user.id, isTemplate: false },
        include: { widgets: { orderBy: { createdAt: 'asc' }, take: MAX_WIDGETS_PER_DASHBOARD } },
        orderBy: { updatedAt: 'desc' },
        take: MAX_DASHBOARDS_PER_QUERY,
      }),
      // Team shared dashboards
      prisma.dashboard.findMany({
        where: {
          visibility: 'TEAM',
          teamId: { in: teamIds },
          isTemplate: false,
        },
        include: {
          widgets: { orderBy: { createdAt: 'asc' }, take: MAX_WIDGETS_PER_DASHBOARD },
          user: { select: { name: true } },
        },
        orderBy: { updatedAt: 'desc' },
        take: MAX_DASHBOARDS_PER_QUERY,
      }),
      // Public templates and dashboards
      prisma.dashboard.findMany({
        where: {
          OR: [{ isTemplate: true }, { visibility: 'PUBLIC' }],
        },
        include: {
          widgets: { orderBy: { createdAt: 'asc' }, take: MAX_WIDGETS_PER_DASHBOARD },
          user: { select: { name: true } },
        },
        orderBy: { name: 'asc' },
        take: MAX_DASHBOARDS_PER_QUERY,
      }),
    ]);

    // Separate templates from public dashboards
    const templates = publicDashboards.filter(d => d.isTemplate);
    const publicShared = publicDashboards.filter(d => !d.isTemplate && d.visibility === 'PUBLIC');

    return NextResponse.json({
      success: true,
      dashboards: userDashboards,
      teamDashboards,
      publicDashboards: publicShared,
      templates,
    });
  } catch (error) {
    logger.error('api.dashboards.get.error', {
      error: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json({ error: 'Failed to fetch dashboards' }, { status: 500 });
  }
}

// POST: Create dashboard
export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(await getAuthOptions());
    if (!session?.user?.email) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const user = await prisma.user.findUnique({
      where: { email: session.user.email },
      select: { id: true, teamMemberships: { select: { teamId: true } } },
    });

    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    const body = await request.json();
    const parseResult = CreateDashboardSchema.safeParse(body);
    if (!parseResult.success) {
      return NextResponse.json(
        { error: 'Invalid dashboard configuration', details: parseResult.error.flatten().fieldErrors },
        { status: 400 }
      );
    }
    const { name, description, visibility, teamId, sourceTemplate, templateId, widgets } = parseResult.data;

    const teamIds = new Set(user.teamMemberships.map(membership => membership.teamId));
    if (
      (visibility === 'TEAM' && (typeof teamId !== 'string' || !teamIds.has(teamId))) ||
      (visibility !== 'TEAM' && teamId !== undefined && teamId !== null)
    ) {
      return NextResponse.json({ error: 'Invalid team dashboard configuration' }, { status: 403 });
    }

    // If creating from template, clone the template's widgets
    let widgetsToCreate = widgets;
    if (templateId && widgets.length === 0) {
      const template = await prisma.dashboard.findUnique({
        where: { id: templateId },
        include: { widgets: true },
      });
      if (!template) return NextResponse.json({ error: 'Template not found' }, { status: 404 });
      const canReadTemplate =
        template.isTemplate ||
        template.visibility === 'PUBLIC' ||
        template.userId === user.id ||
        (template.teamId !== null && teamIds.has(template.teamId));
      if (!canReadTemplate) return NextResponse.json({ error: 'Access denied' }, { status: 403 });
      widgetsToCreate = template.widgets.map(w => ({
        widgetType: w.widgetType,
        metricKey: w.metricKey,
        widgetDefinitionId: w.widgetDefinitionId || null,
        title: w.title,
        position: (w.position && typeof w.position === 'object' && !Array.isArray(w.position)
          ? w.position
          : { x: 0, y: 0, w: 1, h: 1 }) as { x: number; y: number; w: number; h: number },
        config: (w.config && typeof w.config === 'object' && !Array.isArray(w.config)
          ? w.config
          : {}) as Record<string, unknown>,
      }));
    }

    const dashboard = await prisma.dashboard.create({
      data: {
        name,
        description,
        templateId: sourceTemplate || templateId,
        visibility,
        userId: user.id,
        teamId: visibility === 'TEAM' ? teamId : null,
        layout: { columns: 4, rowHeight: 120 },
        config: { timeRange: 7, refreshInterval: 60 },
        widgets: {
          create: widgetsToCreate.map(w => ({
            widgetType: w.widgetType,
            metricKey: w.metricKey,
            widgetDefinitionId: w.widgetDefinitionId || null,
            title: w.title || null,
            position: (w.position || { x: 0, y: 0, w: 1, h: 1 }) as Prisma.InputJsonValue,
            config: (w.config || {}) as Prisma.InputJsonValue,
          })),
        },
      },
      include: { widgets: true },
    });

    return NextResponse.json({ success: true, dashboard }, { status: 201 });
  } catch (error) {
    logger.error('api.dashboards.post.error', {
      error: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json({ error: 'Failed to create dashboard' }, { status: 500 });
  }
}
