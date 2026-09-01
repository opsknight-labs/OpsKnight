/**
 * Disconnect Slack Integration
 * Removes Slack OAuth integration for a service or globally.
 */

import { NextRequest, NextResponse } from 'next/server';
import { assertAdmin } from '@/lib/rbac';
import prisma from '@/lib/prisma';
import { logger } from '@/lib/logger';

export async function DELETE(request: NextRequest) {
  try {
    const user = await assertAdmin();
    const { searchParams } = new URL(request.url);
    const serviceId = searchParams.get('serviceId');
    const integrationId = searchParams.get('integrationId');

    if (integrationId) {
      const integration = await prisma.slackIntegration.findUnique({ where: { id: integrationId } });
      if (!integration) {
        return NextResponse.json({ error: 'Integration not found' }, { status: 404 });
      }

      const service = await prisma.service.findFirst({
        where: { slackIntegrationId: integrationId },
        select: { id: true },
      });

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
    }

    if (serviceId) {
      const service = await prisma.service.findUnique({
        where: { id: serviceId },
        include: { slackIntegration: true },
      });

      if (service?.slackIntegration) {
        await prisma.service.update({
          where: { id: serviceId },
          data: { slackIntegrationId: null },
        });

        const otherServices = await prisma.service.findFirst({
          where: {
            slackIntegrationId: service.slackIntegration.id,
            id: { not: serviceId },
          },
        });

        if (!otherServices) {
          await prisma.slackIntegration.delete({ where: { id: service.slackIntegration.id } });
        }
      }

      return NextResponse.json({ success: true });
    }

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
  } catch (error: any) {
    logger.error('[Slack] Disconnect error', {
      error: error.message,
      stack: error.stack,
    });
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
