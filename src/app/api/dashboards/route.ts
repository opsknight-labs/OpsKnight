import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { getCurrentUser } from '@/lib/rbac';
import { logger } from '@/lib/logger';

const dashboardVisibilities = new Set(['PRIVATE', 'TEAM', 'PUBLIC']);

export const dynamic = 'force-dynamic';

/**
 * Dashboard API - List and Create Dashboards
 *
 * GET: List user's dashboards and available templates
 * POST: Create a new dashboard (optionally from template)
 */

async function getDashboardActor() {
  const user = await getCurrentUser();
  const memberships = await prisma.teamMember.findMany({
    where: { userId: user.id },
    select: { teamId: true },
  });
  return { user, teamIds: memberships.map(membership => membership.teamId) };
}

// GET: List dashboards
export async function GET() {
  try {
    const { user, teamIds } = await getDashboardActor();

    const MAX_DASHBOARDS_PER_QUERY = 100;
    const MAX_WIDGETS_PER_DASHBOARD = 50;

    const [userDashboards, teamDashboards, publicDashboards] = await Promise.all([
      prisma.dashboard.findMany({
        where: { userId: user.id, isTemplate: false },
        include: { widgets: { orderBy: { createdAt: 'asc' }, take: MAX_WIDGETS_PER_DASHBOARD } },
        orderBy: { updatedAt: 'desc' },
        take: MAX_DASHBOARDS_PER_QUERY,
      }),
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
    const unauthorized = error instanceof Error && error.message.includes('Unauthorized');
    if (unauthorized) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    logger.error('api.dashboards.get.error', {
      error: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json({ error: 'Failed to fetch dashboards' }, { status: 500 });
  }
}

// POST: Create dashboard
export async function POST(request: NextRequest) {
  try {
    const { user, teamIds: teamIdList } = await getDashboardActor();
    const body = await request.json();
    const { name, description, templateId, visibility = 'PRIVATE', teamId, widgets = [] } = body;

    if (!name || typeof name !== 'string' || !dashboardVisibilities.has(visibility)) {
      return NextResponse.json({ error: 'Invalid dashboard configuration' }, { status: 400 });
    }
    const teamIds = new Set(teamIdList);
    if (
      (visibility === 'TEAM' && (typeof teamId !== 'string' || !teamIds.has(teamId))) ||
      (visibility !== 'TEAM' && teamId !== undefined && teamId !== null)
    ) {
      return NextResponse.json({ error: 'Invalid team dashboard configuration' }, { status: 403 });
    }

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
    const unauthorized = error instanceof Error && error.message.includes('Unauthorized');
    if (unauthorized) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    logger.error('api.dashboards.post.error', {
      error: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json({ error: 'Failed to create dashboard' }, { status: 500 });
  }
}
