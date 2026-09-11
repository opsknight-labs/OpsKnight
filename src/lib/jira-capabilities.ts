/**
 * JiraCapabilityService — centralized Jira availability and capability contract.
 *
 * Every operational Jira surface MUST consume this service instead of independently checking
 * `jiraConfig.enabled` or other scattered flags.
 */

import prisma from '@/lib/prisma';

export type JiraWorkspaceState =
  | 'NOT_CONFIGURED'
  | 'CONFIGURED'
  | 'DISABLED'
  | 'ENABLED';

export type JiraCapabilityReason =
  | 'NOT_CONFIGURED'
  | 'CONFIGURED'
  | 'DISABLED'
  | 'NOT_MAPPED'
  | 'SYNC_DISABLED'
  | 'OK';

export type JiraCapability = {
  workspaceState: JiraWorkspaceState;
  serviceMapped: boolean;
  /**
   * Effective metadata-sync policy for an already-linked Jira issue.
   * No service mapping defaults to true because mapping is required for Create,
   * not for reading/syncing an explicitly linked issue. An existing mapping can
   * explicitly disable sync with `syncEnabled=false`.
   */
  syncEnabled: boolean;
  showOperationalJira: boolean;
  canCreate: boolean;
  canLink: boolean;
  canSync: boolean;
  canUnlink: boolean;
  reason: JiraCapabilityReason;
  rawEnabled: boolean;
};

export type JiraCapabilityInput = {
  /** Service ID for the entity being rendered. Null is informational workspace state only. */
  serviceId: string | null;
  canManage: boolean;
};

type DeriveJiraCapabilityInput = {
  workspaceState: JiraWorkspaceState;
  canManage: boolean;
  serviceMapped: boolean;
  /** Effective sync policy, independent of whether a mapping exists. */
  syncEnabled: boolean;
  rawEnabled: boolean;
};

type JiraConfigSnapshot = {
  enabled: boolean;
  baseUrl: string | null;
  userEmail: string | null;
  apiTokenEncrypted: string | null;
} | null;

function getWorkspaceState(jiraConfig: JiraConfigSnapshot): JiraWorkspaceState {
  if (!jiraConfig) return 'NOT_CONFIGURED';
  if (!jiraConfig.enabled) return 'DISABLED';
  if (jiraConfig.baseUrl && jiraConfig.userEmail && jiraConfig.apiTokenEncrypted) return 'ENABLED';
  return 'CONFIGURED';
}

/** Pure capability derivation used by production and directly exercised by tests. */
export function deriveJiraCapability(input: DeriveJiraCapabilityInput): JiraCapability {
  const { workspaceState, canManage, serviceMapped, syncEnabled, rawEnabled } = input;
  const isOperational = workspaceState === 'ENABLED';
  const showOperationalJira = isOperational && canManage;

  // Mapping is required only for issue creation. Existing issues can be linked,
  // synced, and unlinked without a service mapping. If a mapping exists,
  // syncEnabled=false explicitly disables metadata synchronization.
  const canCreate = showOperationalJira && serviceMapped;
  const canLink = showOperationalJira;
  const canSync = showOperationalJira && syncEnabled;
  const canUnlink = showOperationalJira;

  let reason: JiraCapabilityReason = 'OK';
  if (workspaceState === 'NOT_CONFIGURED') reason = 'NOT_CONFIGURED';
  else if (workspaceState === 'CONFIGURED') reason = 'CONFIGURED';
  else if (workspaceState === 'DISABLED') reason = 'DISABLED';
  else if (!serviceMapped) reason = 'NOT_MAPPED';
  else if (!syncEnabled) reason = 'SYNC_DISABLED';

  return {
    workspaceState,
    serviceMapped,
    syncEnabled,
    showOperationalJira,
    canCreate,
    canLink,
    canSync,
    canUnlink,
    reason,
    rawEnabled,
  };
}

const jiraConfigSelect = {
  enabled: true,
  baseUrl: true,
  userEmail: true,
  apiTokenEncrypted: true,
} as const;

function getEffectiveSyncEnabled(mapping: { syncEnabled: boolean } | null | undefined): boolean {
  // Explicitly linked Jira issues remain syncable when no mapping exists.
  // A configured service mapping is the only place that can opt out.
  return mapping?.syncEnabled ?? true;
}

export async function getJiraCapabilities(input: JiraCapabilityInput): Promise<JiraCapability> {
  const { serviceId, canManage } = input;

  const [jiraConfig, mapping] = await Promise.all([
    prisma.jiraConfig.findUnique({
      where: { id: 'default' },
      select: jiraConfigSelect,
    }),
    serviceId
      ? prisma.jiraServiceMapping.findUnique({
          where: { serviceId },
          select: { projectKey: true, syncEnabled: true },
        })
      : Promise.resolve(null),
  ]);

  const serviceMapped = Boolean(mapping?.projectKey);
  return deriveJiraCapability({
    workspaceState: getWorkspaceState(jiraConfig),
    // No service context means there is no safe operational target. Workspace-only
    // capability reads are informational and must never surface create/link/sync/unlink.
    canManage: Boolean(serviceId) && canManage,
    serviceMapped,
    syncEnabled: serviceId ? getEffectiveSyncEnabled(mapping) : false,
    rawEnabled: jiraConfig?.enabled ?? false,
  });
}

/** Resolve capabilities for aggregate screens in two queries regardless of item count. */
export async function getJiraCapabilitiesByServiceIds(
  serviceIds: string[],
  canManage: boolean
): Promise<Record<string, JiraCapability>> {
  const uniqueServiceIds = [...new Set(serviceIds.filter(Boolean))];
  if (uniqueServiceIds.length === 0) return {};

  const [jiraConfig, mappings] = await Promise.all([
    prisma.jiraConfig.findUnique({
      where: { id: 'default' },
      select: jiraConfigSelect,
    }),
    prisma.jiraServiceMapping.findMany({
      where: { serviceId: { in: uniqueServiceIds } },
      select: { serviceId: true, projectKey: true, syncEnabled: true },
    }),
  ]);

  const workspaceState = getWorkspaceState(jiraConfig);
  const mappingsByServiceId = new Map(mappings.map(mapping => [mapping.serviceId, mapping]));

  return Object.fromEntries(
    uniqueServiceIds.map(serviceId => {
      const mapping = mappingsByServiceId.get(serviceId);
      const serviceMapped = Boolean(mapping?.projectKey);
      return [
        serviceId,
        deriveJiraCapability({
          workspaceState,
          canManage,
          serviceMapped,
          syncEnabled: getEffectiveSyncEnabled(mapping),
          rawEnabled: jiraConfig?.enabled ?? false,
        }),
      ];
    })
  );
}

export async function getIncidentJiraCapabilities(
  serviceId: string,
  canManage: boolean
): Promise<JiraCapability> {
  return getJiraCapabilities({ serviceId, canManage });
}

export async function getActionItemJiraCapabilities(
  serviceId: string | null,
  canManage: boolean
): Promise<JiraCapability> {
  return getJiraCapabilities({ serviceId, canManage });
}

export type JiraErrorCode =
  | 'JIRA_AUTH_FAILED'
  | 'JIRA_FORBIDDEN'
  | 'JIRA_PROJECT_NOT_FOUND'
  | 'JIRA_ISSUE_NOT_FOUND'
  | 'JIRA_ISSUE_ALREADY_LINKED'
  | 'JIRA_ISSUE_TYPE_INVALID'
  | 'JIRA_COMPONENT_INVALID'
  | 'JIRA_RATE_LIMITED'
  | 'JIRA_TIMEOUT'
  | 'JIRA_UNAVAILABLE'
  | 'JIRA_VALIDATION_FAILED'
  | 'JIRA_NOT_CONFIGURED'
  | 'JIRA_DISABLED'
  | 'JIRA_NOT_MAPPED'
  | 'JIRA_UNKNOWN';

export function classifyJiraError(error: unknown): {
  code: JiraErrorCode;
  retryable: boolean;
  userMessage: string;
} {
  const rawMsg = error instanceof Error ? error.message : String(error);
  const lower = rawMsg.toLowerCase();

  if (lower.includes('integration_disabled') || lower.includes('disabled in workspace')) {
    return {
      code: 'JIRA_DISABLED',
      retryable: false,
      userMessage: 'Jira is disabled in workspace settings.',
    };
  }
  if (lower.includes('not configured')) {
    return {
      code: 'JIRA_NOT_CONFIGURED',
      retryable: false,
      userMessage: 'Jira is not configured in workspace settings.',
    };
  }
  if (lower.includes('configure a jira project') || lower.includes('jira mapping')) {
    return {
      code: 'JIRA_NOT_MAPPED',
      retryable: false,
      userMessage: 'Configure a Jira project for this service first.',
    };
  }
  if (lower.includes('already linked')) {
    return {
      code: 'JIRA_ISSUE_ALREADY_LINKED',
      retryable: false,
      userMessage: 'That Jira issue is already linked to another incident or action item.',
    };
  }
  if (lower.includes('401') || lower.includes('unauthorized') || lower.includes('authentication')) {
    return {
      code: 'JIRA_AUTH_FAILED',
      retryable: false,
      userMessage:
        'Jira authentication failed. Check the API token in Settings → Integrations → Jira.',
    };
  }
  if (lower.includes('403') || lower.includes('forbidden') || lower.includes('permission')) {
    return {
      code: 'JIRA_FORBIDDEN',
      retryable: false,
      userMessage:
        'The Jira service account lacks permission for this operation. Check project permissions.',
    };
  }
  if (
    lower.includes('project') &&
    (lower.includes("doesn't exist") || lower.includes('not found') || lower.includes('404'))
  ) {
    return {
      code: 'JIRA_PROJECT_NOT_FOUND',
      retryable: false,
      userMessage: 'The configured Jira project does not exist or is inaccessible.',
    };
  }
  if (lower.includes('issue type') || lower.includes('issuetype')) {
    return {
      code: 'JIRA_ISSUE_TYPE_INVALID',
      retryable: false,
      userMessage: 'The configured issue type is invalid for this Jira project.',
    };
  }
  if (lower.includes('component')) {
    return {
      code: 'JIRA_COMPONENT_INVALID',
      retryable: false,
      userMessage: 'The configured component does not exist in this Jira project.',
    };
  }
  if ((lower.includes('issue') && lower.includes('not found')) || lower.includes('404')) {
    return {
      code: 'JIRA_ISSUE_NOT_FOUND',
      retryable: false,
      userMessage: 'The Jira issue was not found in your Jira workspace.',
    };
  }
  if (lower.includes('429') || lower.includes('rate limit') || lower.includes('too many')) {
    return {
      code: 'JIRA_RATE_LIMITED',
      retryable: true,
      userMessage: 'Jira rate limit exceeded. Please try again shortly.',
    };
  }
  if (lower.includes('timeout') || lower.includes('aborted') || lower.includes('econnrefused')) {
    return {
      code: 'JIRA_TIMEOUT',
      retryable: true,
      userMessage: 'Jira is temporarily unreachable. Please try again.',
    };
  }
  if (
    lower.includes('502') ||
    lower.includes('503') ||
    lower.includes('504') ||
    lower.includes('unavailable')
  ) {
    return {
      code: 'JIRA_UNAVAILABLE',
      retryable: true,
      userMessage: 'Jira is temporarily unavailable. Please try again.',
    };
  }

  return {
    code: 'JIRA_UNKNOWN',
    retryable: false,
    userMessage: `Jira operation failed: ${rawMsg.slice(0, 200)}`,
  };
}
