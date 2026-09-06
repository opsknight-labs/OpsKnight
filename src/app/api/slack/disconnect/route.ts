/**
 * Disconnect Slack Integration
 * Removes Slack OAuth integration for a service or globally
 */

import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser, assertAdmin } from '@/lib/rbac';
import prisma from '@/lib/prisma';
import { logger } from '@/lib/logger';

export async function DELETE(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Only admins can disconnect integrations
    await assertAdmin();

    const { searchParams } = new URL(request.url);
    const serviceId = searchParams.get('serviceId');
    const integrationId = searchParams.get('integrationId');

    if (integrationId) {
      // Delete specific integration
      const integration = await prisma.slackIntegration.findUnique({
        where: { id: integrationId },
      });

      if (!integration) {
        return NextResponse.json({ error: 'Integration not found' }, { status: 404 });
      }

      // Check permissions (admin or service owner)
      // Find service that uses this integration
      const service = await prisma.service.findFirst({
        where: { slackIntegrationId: integrationId },
        include: { team: { include: { members: true } } },
      });

      if (service) {
        // Check if user is admin or team owner
        const isTeamOwner = service.team?.members.some(
          m => m.userId === user.id && m.role === 'OWNER'
        );

        if (!isTeamOwner && user.role !== 'ADMIN') {
          return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
        }
      }

      await prisma.$transaction(async tx => {
        await tx.service.updateMany({
          where: { slackIntegrationId: integrationId },
          data: { slackIntegrationId: null },
        });
        await tx.slackIntegration.delete({ where: { id: integrationId } });
      });

      logger.info('[Slack] Integration disconnected', {
        integrationId,
        serviceId: service?.id || null,
        userId: user.id,
      });

      return NextResponse.json({ success: true });
    } else if (serviceId) {
      // Delete service-specific integration
      const service = await prisma.service.findUnique({
        where: { id: serviceId },
        include: { slackIntegration: true },
      });

      if (service?.slackIntegration) {
        await prisma.service.update({
          where: { id: serviceId },
          data: { slackIntegrationId: null },
        });

        // Check if integration is used by other services
        const otherServices = await prisma.service.findFirst({
          where: {
            slackIntegrationId: service.slackIntegration.id,
            id: { not: serviceId },
          },
        });

        // Only delete integration if not used by other services
        if (!otherServices) {
          await prisma.slackIntegration.delete({
            where: { id: service.slackIntegration.id },
          });
        }
      }

      return NextResponse.json({ success: true });
    } else {
      // Disconnect global integration (no serviceId)
      const globalIntegration = await prisma.slackIntegration.findFirst({
        orderBy: { updatedAt: 'desc' },
      });

      if (globalIntegration) {
        await prisma.$transaction(async tx => {
          await tx.service.updateMany({
            where: { slackIntegrationId: globalIntegration.id },
            data: { slackIntegrationId: null },
          });
          await tx.slackIntegration.delete({ where: { id: globalIntegration.id } });
        });

        logger.info('[Slack] Global integration disconnected', {
          integrationId: globalIntegration.id,
          userId: user.id,
        });

        return NextResponse.json({ success: true });
      }

      return NextResponse.json({ error: 'No integration found to disconnect' }, { status: 404 });
    }
  } catch (error: any) {
    logger.error('[Slack] Disconnect error', {
      error: error.message,
      stack: error.stack,
    });
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
