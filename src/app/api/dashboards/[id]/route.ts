import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { getCurrentUser } from '@/lib/rbac';
import { logger } from '@/lib/logger';

const dashboardVisibilities = new Set(['PRIVATE', 'TEAM', 'PUBLIC']);

export const dynamic = 'force-dynamic';

async function getDashboardActor() {
  const user = await getCurrentUser();
  const memberships = await prisma.teamMember.findMany({
    where: { userId: user.id },
    select: { teamId: true },
  });
  return { user, teamIds: memberships.map(membership => membership.teamId) };
}

/**
 * Single Dashboard API - GET, PUT, DELETE operations
 */

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const { user, teamIds } = await getDashboardActor();

    const dashboard = await prisma.dashboard.findUnique({
      where: { id },
      include: {
        widgets: { orderBy: { createdAt: 'asc' } },
        user: { select: { name: true, email: true } },
        team: { select: { id: true, name: true } },
      },
    });

    if (!dashboard) {
      return NextResponse.json({ error: 'Dashboard not found' }, { status: 404 });
    }

    const isOwner = dashboard.userId === user.id;
    const isTeamMember = Boolean(dashboard.teamId && teamIds.includes(dashboard.teamId));
    const isPublicOrTemplate = dashboard.visibility === 'PUBLIC' || dashboard.isTemplate;

    if (!isOwner && !isTeamMember && !isPublicOrTemplate) {
      return NextResponse.json({ error: 'Access denied' }, { status: 403 });
    }

    return NextResponse.json({
      success: true,
      dashboard,
      permissions: {
        canEdit: isOwner,
        canDelete: isOwner,
        canShare: isOwner,
      },
    });
  } catch (error) {
    const unauthorized = error instanceof Error && error.message.includes('Unauthorized');
    if (unauthorized) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    logger.error('api.dashboard.get.error', {
      error: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json({ error: 'Failed to fetch dashboard' }, { status: 500 });
  }
}

export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const { user, teamIds: teamIdList } = await getDashboardActor();

    const existing = await prisma.dashboard.findUnique({
      where: { id },
      select: { userId: true, visibility: true, teamId: true },
    });

    if (!existing) {
      return NextResponse.json({ error: 'Dashboard not found' }, { status: 404 });
    }

    if (existing.userId !== user.id) {
      return NextResponse.json(
        { error: 'Access denied. You can only edit your own dashboards.' },
        { status: 403 }
      );
    }

    const body = await request.json();
    const { name, description, layout, config, visibility, teamId, widgets } = body;
    const effectiveVisibility = visibility ?? existing.visibility;
    const effectiveTeamId = teamId ?? existing.teamId;
    if (!dashboardVisibilities.has(effectiveVisibility)) {
      return NextResponse.json({ error: 'Invalid dashboard visibility' }, { status: 400 });
    }
    const teamIds = new Set(teamIdList);
    if (effectiveVisibility === 'TEAM') {
      if (typeof effectiveTeamId !== 'string' || !teamIds.has(effectiveTeamId)) {
        return NextResponse.json({ error: 'Team dashboard access denied' }, { status: 403 });
      }
    } else if (teamId !== undefined) {
      return NextResponse.json({ error: 'Only team dashboards can specify a team' }, { status: 400 });
    }

    const dashboard = await prisma.$transaction(async tx => {
      if (widgets && Array.isArray(widgets)) {
        await tx.dashboardWidget.deleteMany({ where: { dashboardId: id } });
      }

      return tx.dashboard.update({
        where: { id },
        data: {
          ...(name !== undefined && { name }),
          ...(description !== undefined && { description }),
          ...(layout !== undefined && { layout }),
          ...(config !== undefined && { config }),
          ...(visibility !== undefined && { visibility }),
          ...(visibility !== undefined && {
            teamId: effectiveVisibility === 'TEAM' ? effectiveTeamId : null,
          }),
          ...(visibility === undefined && teamId !== undefined && { teamId: effectiveTeamId }),
          ...(widgets &&
            Array.isArray(widgets) && {
              widgets: {
                create: widgets.map((w: any) => ({
                  widgetType: w.widgetType,
                  metricKey: w.metricKey,
                  title: w.title || null,
                  position: w.position || { x: 0, y: 0, w: 1, h: 1 },
                  config: w.config || {},
                })),
              },
            }),
        },
        include: { widgets: { orderBy: { createdAt: 'asc' } } },
      });
    });

    return NextResponse.json({ success: true, dashboard });
  } catch (error) {
    const unauthorized = error instanceof Error && error.message.includes('Unauthorized');
    if (unauthorized) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    logger.error('api.dashboard.put.error', {
      error: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json({ error: 'Failed to update dashboard' }, { status: 500 });
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const user = await getCurrentUser();

    const existing = await prisma.dashboard.findUnique({
      where: { id },
      select: { userId: true, isTemplate: true },
    });

    if (!existing) {
      return NextResponse.json({ error: 'Dashboard not found' }, { status: 404 });
    }

    if (existing.isTemplate) {
      return NextResponse.json({ error: 'Cannot delete system templates' }, { status: 403 });
    }

    if (existing.userId !== user.id) {
      return NextResponse.json(
        { error: 'Access denied. You can only delete your own dashboards.' },
        { status: 403 }
      );
    }

    await prisma.dashboard.delete({ where: { id } });

    return NextResponse.json({ success: true, message: 'Dashboard deleted' });
  } catch (error) {
    const unauthorized = error instanceof Error && error.message.includes('Unauthorized');
    if (unauthorized) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    logger.error('api.dashboard.delete.error', {
      error: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json({ error: 'Failed to delete dashboard' }, { status: 500 });
  }
}
