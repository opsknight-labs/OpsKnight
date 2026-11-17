import 'server-only';
import prisma from '@/lib/prisma';
import { loadMcpInForce } from '@/lib/mcp/core/policy-in-force';
import type { IntegrationState } from './IntegrationStatus';

export type IntegrationProviderId = 'slack' | 'microsoft-teams' | 'chatops' | 'jira' | 'mcp';

export type IntegrationStatus = { state: IntegrationState; label: string };

function settled<T>(
  result: PromiseSettledResult<T>,
  toStatus: (value: T) => IntegrationStatus
): IntegrationStatus {
  return result.status === 'fulfilled'
    ? toStatus(result.value)
    : { state: 'error', label: "Couldn't check" };
}

/** Workspace-level connection state of each integration (admin data; one query per provider). */
export async function loadIntegrationStates(): Promise<
  Record<IntegrationProviderId, IntegrationStatus>
> {
  const [slack, teams, chatops, jira, mcp] = await Promise.allSettled([
    prisma.slackIntegration.findFirst({
      where: { services: { none: {} }, enabled: true },
      select: { workspaceName: true, enabled: true },
    }),
    prisma.microsoftTeamsConfig.findFirst({ select: { enabled: true } }),
    prisma.chatOpsConfig.findUnique({ where: { id: 'default' }, select: { enabled: true } }),
    prisma.jiraConfig.findUnique({ where: { id: 'default' }, select: { enabled: true } }),
    loadMcpInForce(),
  ]);

  return {
    slack: settled(slack, value =>
      value?.enabled
        ? {
            state: 'connected',
            label: value.workspaceName ? `Connected · ${value.workspaceName}` : 'Connected',
          }
        : { state: 'not_connected', label: 'Not connected' }
    ),
    'microsoft-teams': settled(teams, value =>
      value?.enabled
        ? { state: 'connected', label: 'Connected' }
        : { state: 'not_connected', label: 'Not connected' }
    ),
    chatops: settled(chatops, value =>
      value?.enabled
        ? { state: 'connected', label: 'On' }
        : { state: 'not_connected', label: 'Off' }
    ),
    jira: settled(jira, value =>
      value?.enabled
        ? { state: 'connected', label: 'Connected' }
        : { state: 'not_connected', label: 'Not connected' }
    ),
    mcp: settled(mcp, value =>
      value ? { state: 'connected', label: 'On' } : { state: 'not_connected', label: 'Off' }
    ),
  };
}
