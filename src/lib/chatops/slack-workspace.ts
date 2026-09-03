import 'server-only';

import prisma from '@/lib/prisma';
import { AppError } from '@/lib/errors';

/**
 * Assert that a signed Slack request came from the workspace installed for the
 * incident's service. Signature verification proves Slack sent the request;
 * this binding proves it came from the correct tenant.
 *
 * The check deliberately happens before token decryption/provider calls.
 */
export async function assertSlackWorkspaceForService(
  serviceId: string,
  requestWorkspaceId: string | null | undefined
): Promise<void> {
  const workspaceId = requestWorkspaceId?.trim();
  if (!workspaceId) {
    throw new AppError({
      code: 'AUTHORIZATION_DENIED',
      userMessage: 'Slack workspace identity is missing.',
      details: { serviceId, source: 'SLACK' },
    });
  }

  const service = await prisma.service.findUnique({
    where: { id: serviceId },
    select: {
      slackWorkspaceId: true,
      slackIntegration: {
        select: { workspaceId: true, enabled: true },
      },
    },
  });
  if (!service) {
    throw new AppError({ code: 'INTERNAL_ERROR', details: { reason: 'Service not found', serviceId } });
  }

  const configuredWorkspaceId =
    (service.slackIntegration?.enabled ? service.slackIntegration.workspaceId : null) ||
    service.slackWorkspaceId;

  if (configuredWorkspaceId) {
    if (configuredWorkspaceId !== workspaceId) {
      throw new AppError({
        code: 'AUTHORIZATION_DENIED',
        userMessage: 'This Slack workspace is not connected to the incident service.',
        details: { serviceId, source: 'SLACK', workspaceMismatch: true },
      });
    }
    return;
  }

  // A service may intentionally inherit a global workspace integration. Require
  // an enabled installation with the exact workspace ID; never accept "any
  // signed workspace" merely because a global integration exists.
  const globalIntegration = await prisma.slackIntegration.findFirst({
    where: {
      workspaceId,
      enabled: true,
      services: { none: {} },
    },
    select: { id: true },
  });
  if (!globalIntegration) {
    throw new AppError({
      code: 'AUTHORIZATION_DENIED',
      userMessage: 'This Slack workspace is not connected to OpsKnight for this service.',
      details: { serviceId, source: 'SLACK', workspaceMismatch: true },
    });
  }
}
