import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { getServerSession } from 'next-auth';
import { getAuthOptions } from '@/lib/auth';
import { logger } from '@/lib/logger';

const dashboardVisibilities = new Set(['PRIVATE', 'TEAM', 'PUBLIC']);

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
    const { name, description, templateId, visibility = 'PRIVATE', teamId, widgets = [] } = body;

    if (!name || typeof name !== 'string' || !dashboardVisibilities.has(visibility)) {
      return NextResponse.json({ error: 'Invalid dashboard configuration' }, { status: 400 });
    }
    const teamIds = new Set(user.teamMemberships.map(membership => membership.teamId));
    if (
      (visibility === 'TEAM' && (typeof teamId !== 'string' || !teamIds.has(teamId))) ||
      (visibility !== 'TEAM' && teamId !== undefined && teamId !== null)
    ) {
      return NextResponse.json({ error: 'Invalid team dashboard configuration' }, { status: 403 });
    }

    // If creating from template, clone the template's widgets
    let widgetsToCreate = widgets;
    if (templateId) {
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
        title: w.title,
        position: w.position,
        config: w.config,
      }));
    }

    const dashboard = await prisma.dashboard.create({
      data: {
        name,
        description,
        templateId,
        visibility,
        userId: user.id,
        teamId: visibility === 'TEAM' ? teamId : null,
        layout: { columns: 4, rowHeight: 120 },
        config: { timeRange: 7, refreshInterval: 60 },
        widgets: {
          create: widgetsToCreate.map((w: any) => ({
            widgetType: w.widgetType,
            metricKey: w.metricKey,
            title: w.title || null,
            position: w.position || { x: 0, y: 0, w: 1, h: 1 },
            config: w.config || {},
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
