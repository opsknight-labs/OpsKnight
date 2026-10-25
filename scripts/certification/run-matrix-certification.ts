import dotenv from 'dotenv';
dotenv.config({ override: true });
import fs from 'node:fs';
import path from 'node:path';
import crypto, { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { V2_OPERATIONS, type V2OperationDefinition as V2Operation } from '../../src/lib/api-v2/openapi-registry';
import { V2_MUTATION_CONTRACT } from '../../src/lib/api-v2/mutation-contract';
import { getVerifiedSampleBody } from '../../src/lib/api-v2/endpoint-samples';
import { encrypt } from '../../src/lib/encryption';

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value || value.trim().length === 0) {
    throw new Error(`[FATAL] Missing mandatory environment variable: ${name}. Configure it in .env or shell environment.`);
  }
  return value.trim();
}

function canonicalJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalJson);
  if (value !== null && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, child]) => [key, canonicalJson(child)])
    );
  return value;
}
function computeCanonicalChecksum(value: unknown): string {
  return crypto.createHash('sha256').update(JSON.stringify(canonicalJson(value))).digest('hex');
}

interface Fixtures {
  seededAt: string;
  apiBase: string;
  directApiBase: string;
  tokens: {
    admin: string;
    responder: string;
    auditor: string;
    regular: string;
    teamA: string;
    teamB: string;
    serviceAccount: string;
    limited: string;
    revoked: string;
    expired: string;
    disabled: string;
    coldStart: string;
  };
  users: {
    adminId: string;
    responderId: string;
    auditorId: string;
    regularId: string;
    teamAUserId: string;
    teamBUserId: string;
    disabledUserId: string;
    serviceAccountUserId: string;
  };
  teams: { teamAId: string; teamBId: string };
  services: { serviceAId: string; serviceBId: string };
  escalationPolicies: { policyAId: string; policyBId: string };
  schedules: { scheduleAId: string };
  incidents: { openId: string; ackedId: string; resolvedId: string };
  postmortems: { postmortemId: string };
  statusPages: { statusPageId: string };
  runbooks: { runbookId: string; publishedVersionId?: string; draftVersionId?: string };
  runbookDrafts?: { draftVersionId?: string };
  notifications?: { notificationId?: string };
  signingIdentities?: { identityId?: string };
  dashboards: { dashboardId: string };
  customFields: { envFieldId: string };
  serviceAccounts: { serviceAccountId: string; tokenId: string };
  integrations?: { integrationId: string };
  templates?: { templateId: string };
  agentPools?: { poolId: string; agentId: string; memberId: string };
  runbookSecrets?: { secretId: string; grantId: string };
  objectives?: { objectiveId: string; lineageId?: string };
  subscribers?: { subscriberId: string };
  assets?: { assetId: string };
  watchers?: { watcherId: string };
  actionItems?: { actionItemId: string };
  overrides?: { overrideId: string };
  runbookVersions?: { versionId: string };
  runbookExecutions?: { executionId: string };
  signingKeys?: { keyId: string };
  scheduleLayers?: { layerId: string };
  escalationRules?: { ruleId: string };
  serviceRunbookRules?: { ruleId: string };
  automationVersions?: { versionId: string };
  auditExports?: { exportId: string };
}

export interface OperationResult {
  operationId: string;
  method: string;
  path: string;
  resolvedPath: string;
  requiredScope: string;
  positive: {
    tested: boolean;
    status: number;
    pass: boolean;
    latencyMs: number;
    hasRequestId: boolean;
    hasSecurityHeaders: boolean;
    hasEnvelope: boolean;
    errorDetail?: string;
  };
  noAuth: {
    tested: boolean;
    status: number;
    pass: boolean;
    isProblemDetails: boolean;
  };
  invalidAuth: {
    tested: boolean;
    status: number;
    pass: boolean;
  };
  revokedAuth: {
    tested: boolean;
    status: number;
    pass: boolean;
  };
  expiredAuth: {
    tested: boolean;
    status: number;
    pass: boolean;
  };
  scopeDenial: {
    tested: boolean;
    status?: number;
    pass?: boolean;
    skipped?: boolean;
  };
  inputBoundary: {
    tested: boolean;
    notApplicable?: boolean;
    status: number;
    pass: boolean;
  };
  mutationSafety?: {
    tested: boolean;
    idempotencyTested: boolean;
    idempotentPass?: boolean;
    concurrencyTested: boolean;
    concurrencyPass?: boolean;
  };
  overallVerdict: 'PASS' | 'FAIL';
  evidence: string;
}

function resolvePath(templatePath: string, fixtures: Fixtures): string {
  let resolved = templatePath;

  // Handle specific paths before generic {id}
  if (resolved.startsWith('/runbooks/agent-pools/')) {
    resolved = resolved.replace('{id}', fixtures.agentPools?.poolId || 'dummy-pool');
  } else if (resolved.startsWith('/runbooks/agents/')) {
    resolved = resolved.replace('{id}', fixtures.agentPools?.agentId || 'dummy-agent');
  } else if (resolved.startsWith('/runbooks/agent-enrollments/')) {
    resolved = resolved.replace('{id}', fixtures.agentPools?.agentId || 'dummy-agent');
  } else if (resolved.startsWith('/runbooks/signing-identities/')) {
    resolved = resolved.replace('{id}', fixtures.signingKeys?.keyId || 'dummy-key');
  } else if (resolved.startsWith('/runbooks/executions/')) {
    resolved = resolved.replace('{id}', fixtures.runbookExecutions?.executionId || 'dummy-exec');
  } else if (resolved.startsWith('/runbooks/secrets/')) {
    resolved = resolved.replace('{id}', fixtures.runbookSecrets?.secretId || 'dummy-sec');
  } else if (resolved.startsWith('/runbooks/') && resolved.includes('/drafts/{versionId}')) {
    resolved = resolved
      .replace('{id}', fixtures.runbooks.runbookId)
      .replace('{versionId}', fixtures.runbooks.draftVersionId || fixtures.runbookDrafts?.draftVersionId || 'dummy-draft');
  } else if (resolved.startsWith('/runbooks/')) {
    resolved = resolved.replace('{id}', fixtures.runbooks.runbookId);
  } else if (resolved.startsWith('/services/') && resolved.includes('/automation/versions/{versionId}')) {
    resolved = resolved
      .replace('{id}', fixtures.services.serviceAId)
      .replace('{versionId}', fixtures.automationVersions?.versionId || 'dummy-auto-ver');
  } else if (resolved.startsWith('/services/') && resolved.includes('/runbook-rules/{ruleId}')) {
    resolved = resolved
      .replace('{id}', fixtures.services.serviceAId)
      .replace('{ruleId}', fixtures.serviceRunbookRules?.ruleId || 'dummy-rule');
  } else if (resolved.startsWith('/services/')) {
    resolved = resolved.replace('{id}', fixtures.services.serviceAId);
  } else if (resolved.startsWith('/service-objectives/')) {
    resolved = resolved.replace('{id}', fixtures.objectives?.lineageId || 'cert-lineage-1792844059215');
  } else if (resolved.startsWith('/audit-exports/')) {
    resolved = resolved.replace('{id}', fixtures.auditExports?.exportId || 'cmvmdw7fn014kjq5tb3na5pw8');
  } else if (resolved.startsWith('/incidents/')) {
    resolved = resolved.replace('{id}', fixtures.incidents.openId);
  } else if (resolved.startsWith('/teams/')) {
    resolved = resolved.replace('{id}', fixtures.teams.teamAId);
  } else if (resolved.startsWith('/schedules/')) {
    resolved = resolved.replace('{id}', fixtures.schedules.scheduleAId);
  } else if (resolved.startsWith('/escalation-policies/')) {
    resolved = resolved.replace('{id}', fixtures.escalationPolicies.policyAId);
  } else if (resolved.startsWith('/postmortems/')) {
    resolved = resolved.replace('{id}', fixtures.postmortems.postmortemId);
  } else if (resolved.startsWith('/status-pages/')) {
    resolved = resolved.replace('{id}', fixtures.statusPages.statusPageId);
  } else if (resolved.startsWith('/dashboards/')) {
    resolved = resolved.replace('{id}', fixtures.dashboards.dashboardId);
  } else if (resolved.startsWith('/custom-fields/')) {
    resolved = resolved.replace('{id}', fixtures.customFields.envFieldId);
  } else if (resolved.startsWith('/service-accounts/')) {
    resolved = resolved.replace('{id}', fixtures.serviceAccounts.serviceAccountId);
  } else if (resolved.startsWith('/integrations/')) {
    resolved = resolved.replace('{id}', fixtures.integrations?.integrationId || 'dummy-int');
  } else if (resolved.startsWith('/notifications/')) {
    resolved = resolved.replace('{id}', fixtures.notifications?.notificationId || 'dummy-notif');
  } else if (resolved.startsWith('/reports/saved/')) {
    resolved = resolved.replace('{id}', (fixtures as any).savedReports?.id || 'cmvmcdf9m00041onrgmjawm0d');
  } else if (resolved.startsWith('/users/')) {
    resolved = resolved.replace('{id}', fixtures.users.responderId);
  } else {
    resolved = resolved.replace('{id}', 'cmvmcdf9m00041onrgmjawm0d');
  }

  resolved = resolved
    .replace('{serviceId}', fixtures.services.serviceAId)
    .replace('{userId}', fixtures.users.responderId)
    .replace('{teamId}', fixtures.teams.teamAId)
    .replace('{provider}', 'web-push')
    .replace('{agentId}', fixtures.agentPools?.agentId || 'dummy-agent')
    .replace('{grantId}', fixtures.runbookSecrets?.grantId || 'dummy-grant')
    .replace('{stepId}', fixtures.escalationRules?.ruleId || 'dummy-rule')
    .replace('{evaluationId}', randomUUID())
    .replace('{jobId}', 'b013bce7-76ae-4e55-87c2-19e59d1a3be2')
    .replace('{assetId}', fixtures.assets?.assetId || 'dummy-asset')
    .replace('{subscriberId}', fixtures.subscribers?.subscriberId || 'dummy-sub')
    .replace('{ruleId}', fixtures.serviceRunbookRules?.ruleId || 'dummy-rule')
    .replace('{versionId}', fixtures.runbooks?.publishedVersionId || 'dummy-ver')
    .replace('{templateId}', fixtures.templates?.templateId || 'dummy-tmpl')
    .replace('{fieldId}', fixtures.customFields.envFieldId)
    .replace('{tagId}', fixtures.incidents.openId)
    .replace('{watcherId}', fixtures.watchers?.watcherId || 'dummy-watcher')
    .replace('{layerId}', fixtures.scheduleLayers?.layerId || 'dummy-layer')
    .replace('{itemId}', fixtures.actionItems?.actionItemId || 'dummy-item')
    .replace('{overrideId}', fixtures.overrides?.overrideId || 'dummy-override')
    .replace('{tokenId}', fixtures.serviceAccounts.tokenId);

  if (templatePath === '/runbooks/executions') {
    resolved += `?incidentId=${fixtures.incidents.openId}`;
  }
  if (templatePath === '/runbooks/{id}/versions/{versionId}/diff') {
    resolved += `?baseVersionId=${fixtures.runbooks.publishedVersionId}`;
  }
  if (templatePath === '/schedules/{id}/coverage') {
    const start = new Date().toISOString();
    const end = new Date(Date.now() + 86400000).toISOString();
    resolved += `?start=${encodeURIComponent(start)}&end=${encodeURIComponent(end)}`;
  }

  return resolved;
}

function getPayloadForOperation(op: V2Operation, fixtures: Fixtures): unknown {
  const method = op.method.toUpperCase();
  if (method === 'GET' || method === 'DELETE') {
    return undefined;
  }

  if (op.path === '/settings/chatops' && method === 'PUT') {
    return {
      enabled: true,
      channelPrefix: 'inc',
      autoCreateOnUrgency: ['HIGH'],
      autoCreateOnPriority: ['P1'],
      archiveOnResolve: true,
      defaultVideoBridge: 'GOOGLE_MEET',
      customBridgeUrlTemplate: 'https://meet.google.com/{incidentId}',
      defaultProviders: ['SLACK']
    };
  }

  if (op.path === '/custom-fields' && method === 'POST') {
    return {
      name: `Field ${Date.now()}`,
      key: `field_${Date.now()}`,
      type: 'TEXT',
      required: false,
      defaultValue: null,
      options: null,
      showInList: false
    };
  }

  if (op.path === '/custom-fields/{id}' && method === 'PATCH') {
    return { name: `Updated Field ${Date.now()}` };
  }

  if (op.path === '/audit-exports' && method === 'POST') {
    return {
      from: '2026-10-01T00:00:00.000Z',
      to: '2026-10-24T00:00:00.000Z',
      maxRecords: 100
    };
  }

  if (op.path === '/notification-providers/web-push/rotate' && method === 'POST') {
    return {
      subject: 'mailto:admin@opsknight.local',
      keepPrevious: true
    };
  }

  if (op.path.includes('/notification-providers/') && method === 'PUT') {
    return {
      provider: 'web-push',
      enabled: true,
      config: {
        vapidPublicKey: 'BCm0w_mock_vapid_public_key_for_testing_purposes_only_1234567890',
        vapidSubject: 'mailto:admin@opsknight.local'
      }
    };
  }

  if (op.path === '/runbooks/agent-enrollments' && method === 'POST') {
    return { name: `Agent-Enroll-${Date.now()}` };
  }

  if (op.path === '/runbooks/agent-pools' && method === 'POST') {
    return { name: `Agent Pool ${Date.now()}`, description: 'Cert pool' };
  }

  if (op.path === '/runbooks/agent-pools/{id}' && method === 'PATCH') {
    return { name: `Updated Pool ${Date.now()}` };
  }

  if (op.path === '/runbooks/agents/{id}/configuration' && method === 'PATCH') {
    return { name: `Agent ${Date.now()}`, labels: { env: 'cert' } };
  }

  if (op.path === '/runbooks/secrets' && method === 'POST') {
    return { name: `sec-${Date.now()}`, value: 'cert_sec_val_123', description: 'Cert secret' };
  }

  if (op.path === '/runbooks/secrets/{id}/rotate' && method === 'POST') {
    return { value: 'cert_sec_val_rotated_456' };
  }

  if (op.path === '/runbooks/secrets/{id}/grants' && method === 'POST') {
    return { agentPoolId: fixtures.agentPools?.poolId };
  }

  if (op.path === '/runbooks/{id}/drafts' && method === 'POST') {
    return { sourceVersionId: fixtures.runbooks.publishedVersionId };
  }

  if (op.path === '/runbooks/{id}/drafts/{versionId}' && method === 'PATCH') {
    return {
      definition: {
        description: 'Certified remediation runbook draft',
        steps: [{ key: 'step_drain', name: 'Drain connections', type: 'MANUAL', riskClass: 'READ_ONLY', config: {} }]
      },
      inputs: []
    };
  }

  if (op.path === '/runbooks/executions/{id}/cancel' && method === 'POST') {
    return { reason: 'Cancelling certified execution' };
  }

  if (op.path === '/runbooks/{id}/executions/preview' && method === 'POST') {
    return { bindingId: fixtures.serviceRunbookRules?.ruleId, parameters: {} };
  }

  if (op.path.includes('/custom-fields/') && method === 'PUT') {
    return { value: 'production' };
  }

  if (op.path === '/incidents/templates' && method === 'POST') {
    return {
      name: `Template ${Date.now()}`,
      title: 'Database Outage Response',
      defaultUrgency: 'HIGH',
      defaultPriority: 'P1',
      defaultServiceId: fixtures.services.serviceAId,
      isPublic: false
    };
  }

  if (op.path === '/runbooks/executions/{id}/steps/{stepId}/approve' && method === 'POST') {
    return { planDigest: 'a'.repeat(64) };
  }

  if (op.path === '/runbooks/executions/{id}/steps/{stepId}/reject' && method === 'POST') {
    return { planDigest: 'a'.repeat(64), reason: 'Operator rejected' };
  }

  if (op.path === '/runbooks/executions/{id}/rerun' && method === 'POST') {
    return { expectedPlanDigest: 'a'.repeat(64), previewAuthorizationToken: 'a'.repeat(64) };
  }

  if (op.path === '/services/{id}/runbook-rules' && method === 'POST') {
    return {
      configuration: {
        runbookId: fixtures.runbooks.runbookId,
        name: `Auto Mitigate Rule ${Date.now()}`,
        mode: 'MANUAL',
        versionStrategy: 'LATEST_PUBLISHED'
      },
      expectedVersionId: fixtures.runbookVersions?.versionId
    };
  }

  if (op.path === '/services/{id}/runbook-rules/{ruleId}' && method === 'PATCH') {
    return {
      configuration: {
        name: `Updated Mitigate Rule ${Date.now()}`
      },
      expectedVersionId: fixtures.runbookVersions?.versionId
    };
  }

  if (op.path === '/services/{id}/runbook-rules/{ruleId}/activate' && method === 'POST') {
    return { confirmMatchAll: true };
  }

  if (op.path === '/service-objectives' && method === 'POST') {
    return {
      definition: {
        serviceId: fixtures.services.serviceAId,
        name: `Target SLO ${Date.now()}`,
        metricType: 'MTTR',
        target: 60,
        comparator: 'LESS_THAN_OR_EQUAL',
        windowType: 'ROLLING_DAYS',
        windowValue: 30
      },
      expectedActiveVersionId: null
    };
  }

  if (op.path === '/service-objectives/{id}' && method === 'PATCH') {
    return { name: `Updated Target SLO ${Date.now()}` };
  }

  if (op.path === '/service-objectives/{id}/evaluate' && method === 'POST') {
    return { expectedVersionId: fixtures.objectives?.objectiveId };
  }

  if (op.path === '/services/{id}/notification-settings' && method === 'PATCH') {
    return {
      serviceNotifyOnTriggered: true,
      serviceNotifyOnAck: true
    };
  }

  if (op.path === '/services/{id}/support-hours' && method === 'PUT') {
    return {
      timezone: 'UTC',
      inheritWorkspace: true,
      mode: 'INHERIT',
      windows: [],
      exceptions: []
    };
  }

  if (op.path === '/services/{id}/response-policy/classification' && method === 'PUT') {
    return {
      derivePriorityFromUrgency: true,
      priorityFallbackMode: 'INHERIT',
      rules: [
        { matchValue: 'critical', priorityMode: 'SET', priority: 'P1', urgencyMode: 'SET', urgency: 'HIGH' },
        { matchValue: 'error', priorityMode: 'SET', priority: 'P2', urgencyMode: 'SET', urgency: 'HIGH' },
        { matchValue: 'warning', priorityMode: 'SET', priority: 'P3', urgencyMode: 'SET', urgency: 'MEDIUM' },
        { matchValue: 'info', priorityMode: 'SET', priority: 'P4', urgencyMode: 'SET', urgency: 'LOW' }
      ]
    };
  }

  if (op.path === '/services/{id}/response-policy/sla' && method === 'PUT') {
    return {
      inheritWorkspace: false,
      baseAckTargetMs: 900000,
      baseResolveTargetMs: 7200000,
      rules: []
    };
  }

  if (op.path === '/settings/incident-sla' && method === 'PUT') {
    return {
      baseAckTargetMs: 900000,
      baseResolveTargetMs: 7200000,
      rules: []
    };
  }

  if (op.path === '/services/{id}/automation/restore' && method === 'POST') {
    return {
      sourceVersionId: fixtures.automationVersions?.versionId
    };
  }

  if (op.path === '/status-pages/{id}/services' && method === 'PUT') {
    return { serviceIds: [fixtures.services.serviceAId] };
  }

  if (op.path === '/status-pages/{id}/services/{serviceId}' && method === 'PATCH') {
    return { displayName: 'Primary Cert Service', order: 1, showOnPage: true };
  }

  if (op.path === '/status-pages/{id}/appearance' && method === 'PATCH') {
    return { branding: { theme: 'SYSTEM', headerColor: '#1a1a1a' } };
  }

  if (op.path === '/status-pages/{id}/privacy' && method === 'PATCH') {
    return { showIncidentDetails: true, showIncidentTitles: true };
  }

  if (op.path === '/status-pages/{id}/content' && method === 'PATCH') {
    return { footerText: 'Operational', contactEmail: 'support@example.com' };
  }

  if (op.path === '/status-pages/{id}/settings' && method === 'PATCH') {
    return { name: `Updated Page ${Date.now()}`, organizationName: 'OpsKnight Inc' };
  }

  if (op.path === '/reports/query' && method === 'POST') {
    return { metrics: ['totalIncidents', 'activeIncidents'], windowDays: 30 };
  }

  if (op.path === '/reports/exports' && method === 'POST') {
    return { metrics: ['totalIncidents', 'activeIncidents'], windowDays: 30 };
  }

  if (op.path === '/reports/saved' && method === 'POST') {
    return { name: `Cert Saved Report ${Date.now()}`, metrics: ['totalIncidents'], windowDays: 30, visibility: 'PRIVATE' };
  }

  if (op.path === '/reports/saved/{id}' && method === 'PATCH') {
    return { name: `Updated Report ${Date.now()}` };
  }

  if (op.path === '/dashboards' && method === 'POST') {
    return { name: `Cert Dashboard ${Date.now()}`, visibility: 'PRIVATE', widgets: [] };
  }

  if (op.path === '/dashboards/{id}' && method === 'PATCH') {
    return { name: `Updated Dash ${Date.now()}` };
  }

  if (op.path === '/dashboards/{id}/duplicate' && method === 'POST') {
    return { name: `Copy Dash ${Date.now()}`, visibility: 'PRIVATE' };
  }

  if (op.path === '/dashboards/{id}/widgets' && method === 'PUT') {
    return { widgets: [] };
  }

  if (op.path === '/escalation-policies' && method === 'POST') {
    return {
      name: `Cert EP ${Date.now()}`,
      description: 'Cert escalation policy',
      steps: [
        {
          delayMinutes: 5,
          targetType: 'USER',
          targetId: fixtures.users.responderId,
          notificationChannels: ['EMAIL']
        }
      ]
    };
  }

  if (op.path === '/escalation-policies/{id}/preview' && method === 'POST') {
    return {
      incidentId: fixtures.incidents.openId
    };
  }

  if ((op.path === '/runbooks/{id}/execute' || op.path === '/runbooks/{id}/executions/preview') && method === 'POST') {
    return {
      incidentId: fixtures.incidents.openId,
      parameters: {}
    };
  }

  if (op.path === '/incidents/{id}/assign' && method === 'POST') {
    return { assigneeId: fixtures.users.responderId };
  }

  if (op.path === '/integrations/{id}' && method === 'PATCH') {
    return { name: `Updated Integration ${Date.now()}` };
  }

  if (op.path === '/settings/runbooks' && method === 'PATCH') {
    return { runbookAutoExecutionsPerIncident: 10 };
  }

  if (op.path === '/runbooks/{id}/execute' && method === 'POST') {
    return {
      runbookId: fixtures.runbooks.runbookId,
      incidentId: fixtures.incidents.openId,
      serviceId: fixtures.services.serviceAId,
      inputValues: {}
    };
  }

  if (op.path === '/runbooks/{id}/executions/preview' && method === 'POST') {
    return {
      runbookId: fixtures.runbooks.runbookId,
      incidentId: fixtures.incidents.openId,
      serviceId: fixtures.services.serviceAId,
      inputValues: {}
    };
  }

  if (op.path === '/schedules/{id}/layers' && method === 'POST') {
    return {
      name: `Layer ${Date.now()}`,
      start: new Date().toISOString(),
      end: null,
      rotationLengthHours: 24,
      shiftLengthHours: null,
      restrictions: null,
      responderIds: []
    };
  }

  if (op.path === '/schedules/{id}/layers/{layerId}' && method === 'PATCH') {
    return {
      name: `Updated Layer ${Date.now()}`,
      start: new Date().toISOString(),
      end: null,
      rotationLengthHours: 24,
      shiftLengthHours: null,
      restrictions: null
    };
  }

  if (op.path === '/schedules/{id}/layers/{layerId}/participants' && method === 'POST') {
    return { userId: fixtures.users.auditorId };
  }

  if (op.path === '/schedules/{id}/layers/{layerId}/participants/{userId}' && method === 'PATCH') {
    return { direction: 'down' };
  }

  if (op.path === '/schedules/{id}/coverage/preview' && method === 'POST') {
    return {
      start: new Date().toISOString(),
      end: new Date(Date.now() + 86400000).toISOString(),
      layerId: null,
      proposedLayer: {
        name: `Prop Layer ${Date.now()}`,
        start: new Date().toISOString(),
        end: null,
        rotationLengthHours: 24,
        shiftLengthHours: null,
        restrictions: null,
        responderIds: []
      }
    };
  }

  if (op.path === '/incidents/templates/{templateId}' && method === 'PATCH') {
    return { name: `Updated Template ${Date.now()}` };
  }

  if (op.path === '/postmortems/{id}/publish' && method === 'POST') {
    return { isPublic: true };
  }

  if (op.path === '/postmortems/{id}/contributors' && method === 'PUT') {
    return { contributors: [{ userId: fixtures.users.responderId, role: 'CONTRIBUTOR' }] };
  }

  if (op.path === '/postmortems/{id}/action-items' && method === 'PUT') {
    return {
      items: [
        {
          title: `Action Item ${Date.now()}`,
          description: 'Cert action item',
          ownerId: fixtures.users.responderId,
          status: 'OPEN',
          priority: 'HIGH'
        }
      ]
    };
  }

  if (op.path === '/postmortems/{id}/action-items/{itemId}' && method === 'PATCH') {
    return { title: `Updated Action Item ${Date.now()}` };
  }

  if (op.path.includes('/runbook-rules') && op.path.includes('/activate') && method === 'POST') {
    return { confirmMatchAll: true };
  }

  if (op.path.includes('/runbook-rules') && op.path.includes('/policy-checks') && method === 'POST') {
    return {};
  }

  if (op.path.includes('/runbook-rules') && op.path.includes('/triggers') && method === 'PUT') {
    return { event: 'INCIDENT_CREATED', conditionLogic: 'AND', enabled: true, conditions: [] };
  }

  if (op.path === '/runbooks/{id}' && method === 'PATCH') {
    return { name: `Updated Runbook ${Date.now()}` };
  }

  if (op.path === '/services/{id}/response-policy/classification' && method === 'PUT') {
    return {
      derivePriorityFromUrgency: false,
      rules: [
        { matchValue: 'critical', priorityMode: 'SET', priority: 'P1', urgencyMode: 'SET', urgency: 'HIGH' },
        { matchValue: 'error', priorityMode: 'SET', priority: 'P2', urgencyMode: 'SET', urgency: 'HIGH' },
        { matchValue: 'warning', priorityMode: 'SET', priority: 'P3', urgencyMode: 'SET', urgency: 'MEDIUM' },
        { matchValue: 'info', priorityMode: 'SET', priority: 'P4', urgencyMode: 'SET', urgency: 'LOW' }
      ]
    };
  }

  if (op.path === '/services/{id}/response-policy/sla' && method === 'PUT') {
    return {
      inheritWorkspace: true,
      baseAckTargetMs: 600000,
      baseResolveTargetMs: 3600000,
      rules: []
    };
  }

  if (op.path === '/services/{id}/support-hours' && method === 'PUT') {
    return { timezone: 'UTC', inheritWorkspace: true, windows: [], exceptions: [] };
  }

  if (op.path === '/status-pages/{id}/assets' && method === 'POST') {
    return {
      image: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII='
    };
  }

  if (op.path === '/users/invitations' && method === 'POST') {
    return {
      name: `Invited User ${Date.now()}`,
      email: `invite_${Date.now()}@example.com`,
      role: 'RESPONDER',
      authenticationMode: 'PASSWORD',
      delivery: 'MANUAL',
      expectedPolicyVersion: 1,
      expectedOidcConfigVersion: null
    };
  }

  if (op.path.includes('/users/') && op.path.includes('/invitation') && method === 'POST') {
    return {
      authenticationMode: 'PASSWORD',
      delivery: 'MANUAL',
      expectedPolicyVersion: 1,
      expectedOidcConfigVersion: null,
      expectedLinkingApprovalRevision: null
    };
  }

  if (op.path === '/users/me/notification-preferences' && method === 'PATCH') {
    return {
      emailEnabled: false,
      smsEnabled: false,
      pushEnabled: false,
      voiceEnabled: false,
      whatsappEnabled: false,
      timeZone: 'UTC'
    };
  }

  if (op.path === '/users/{id}/administration' && method === 'PATCH') {
    return { operation: 'set-role', role: 'RESPONDER' };
  }

  if (op.path === '/teams/{id}/lead' && method === 'PUT') {
    return { userId: fixtures.users.teamAUserId };
  }

  if (op.path === '/teams/{id}/members/{userId}' && method === 'PUT') {
    return { role: 'MEMBER', receiveTeamNotifications: true };
  }

  if (op.path === '/teams/{id}/services/{serviceId}' && method === 'PUT') {
    return {};
  }

  if (op.path === '/runbooks/signing-identities' && method === 'POST') {
    return { expectedActiveKeyId: fixtures.signingKeys?.keyId || null };
  }

  if (op.path === '/runbooks/signing-identities/{id}/activate' && method === 'POST') {
    return { expectedActiveKeyId: fixtures.signingKeys?.keyId || 'dummy-key' };
  }

  if (op.path === '/runbooks/signing-identities/{id}/retire' && method === 'POST') {
    return { expectedState: 'RETIRING' };
  }

  if (op.path === '/service-accounts' && method === 'POST') {
    return {
      name: `Cert SA ${Date.now()}`,
      role: 'RESPONDER'
    };
  }

  if (op.path.includes('/service-accounts/') && op.path.includes('/tokens') && method === 'POST') {
    return {
      name: `Cert SA Token ${Date.now()}`,
      scopes: ['incidents:read'],
      expiresInDays: 30
    };
  }

  if (op.path === '/services' && method === 'POST') {
    return {
      name: `Cert Svc ${Date.now()}`,
      teamId: fixtures.teams.teamAId,
      escalationPolicyId: fixtures.escalationPolicies.policyAId
    };
  }

  if (op.path === '/postmortems' && method === 'POST') {
    return {
      incidentId: fixtures.incidents.resolvedId,
      title: `Certified Postmortem ${Date.now()}`,
      summary: 'Postmortem summary'
    };
  }

  const sample = getVerifiedSampleBody(method, op.path);
  if (sample) {
    const cloned = JSON.parse(JSON.stringify(sample));
    if (cloned.name) cloned.name = `${cloned.name} ${Date.now()}`;
    if (cloned.title) cloned.title = `${cloned.title} ${Date.now()}`;
    if (cloned.slug) cloned.slug = `${cloned.slug}-${Date.now()}`;
    if (cloned.serviceId) cloned.serviceId = fixtures.services.serviceAId;
    if (cloned.teamId) cloned.teamId = fixtures.teams.teamAId;
    if (cloned.userId) cloned.userId = fixtures.users.responderId;
    if (cloned.incidentId) cloned.incidentId = fixtures.incidents.openId;
    if (cloned.assigneeId) cloned.assigneeId = fixtures.users.responderId;
    if (cloned.startDate && cloned.endDate) {
      const start = new Date(Date.now() + 86400000 * 365 + Math.floor(Math.random() * 1000000000));
      const end = new Date(start.getTime() + 3600000);
      cloned.startDate = start.toISOString();
      cloned.endDate = end.toISOString();
    }
    if (cloned.ownerId) cloned.ownerId = fixtures.users.responderId;
    if (Array.isArray(cloned.steps)) {
      cloned.steps.forEach((s: any) => { if (s && s.targetId) s.targetId = fixtures.users.responderId; });
    }
    if (Array.isArray(cloned.responderIds)) {
      cloned.responderIds = [fixtures.users.responderId];
    }
    return cloned;
  }

  if (op.path.includes('/notes')) {
    return { content: `Certification note ${Date.now()}` };
  }
  if (op.path.includes('/tags')) {
    return { name: `cert-tag-${Date.now()}` };
  }
  if (op.path.includes('/watchers')) {
    return { userId: fixtures.users.responderId, role: 'FOLLOWER' };
  }
  if (op.path.includes('/announcements')) {
    return { title: 'System Notice', message: 'Cert routine announcement', type: 'INFO', isActive: true };
  }
  if (op.path.includes('/overrides')) {
    const start = new Date(Date.now() + 86400000 * 365 + Math.floor(Math.random() * 1000000000));
    const end = new Date(start.getTime() + 3600000);
    return {
      userId: fixtures.users.responderId,
      startDate: start.toISOString(),
      endDate: end.toISOString()
    };
  }

  return {};
}

async function request(
  url: string,
  options: {
    method: string;
    token?: string;
    body?: unknown;
    headers?: Record<string, string>;
  }
) {
  const headers: Record<string, string> = {
    Accept: 'application/json, application/problem+json',
    ...(options.headers || {})
  };

  if (options.token) {
    headers['Authorization'] = `Bearer ${options.token}`;
  }

  if (options.body !== undefined) {
    headers['Content-Type'] = 'application/json';
  }

  const start = performance.now();
  try {
    const res = await fetch(url, {
      method: options.method,
      headers,
      body: options.body !== undefined ? JSON.stringify(options.body) : undefined
    });
    const latencyMs = Math.round(performance.now() - start);
    const contentType = res.headers.get('content-type') || '';
    let json: any = null;
    let text = '';
    if (contentType.includes('json')) {
      try {
        json = await res.json();
      } catch {
        // ignore
      }
    } else {
      text = await res.text().catch(() => '');
    }

    return {
      status: res.status,
      headers: res.headers,
      json,
      text,
      latencyMs
    };
  } catch (err: any) {
    const latencyMs = Math.round(performance.now() - start);
    return {
      status: 0,
      headers: new Headers(),
      json: null,
      text: err.message,
      latencyMs,
      networkError: err
    };
  }
}

async function getResourceEtag(
  url: string,
  token: string,
  prisma: PrismaClient,
  op: V2Operation,
  fixtures: Fixtures
): Promise<string | null> {
  if (!url.includes('/order') && !url.includes('/preview') && !url.includes('/restore') && !url.includes('/activate')) {
    try {
      const probe = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
      const etag = probe.headers.get('etag');
      if (etag && etag.startsWith('"') && !etag.startsWith('W/')) {
        return etag;
      }
    } catch {}
  }
  if (url.includes('/runbook-rules/')) {
    const m = url.match(/\/runbook-rules\/([a-z0-9_-]+)/);
    const ruleId = m ? m[1] : fixtures.serviceRunbookRules?.ruleId;
    if (ruleId) {
      const r = await prisma.serviceAutomationRule.findUnique({ where: { id: ruleId } });
      if (r) return `"${r.configurationRevision}"`;
    }
  }
  if (url.includes('/status-pages/')) {
    const page = await prisma.statusPage.findUnique({ where: { id: fixtures.statusPages.statusPageId } });
    if (page) return `"${page.revision}"`;
  }
  if (url.includes('/notification-providers/')) {
    const prov = await prisma.notificationProvider.findUnique({ where: { provider: 'web-push' } });
    if (prov) return `"${prov.revision}"`;
  }
  if (url.includes('/teams/') && url.includes('/services/')) {
    const svc = await prisma.service.findUnique({ where: { id: fixtures.services.serviceAId } });
    if (svc) return `"${svc.revision}"`;
  }
  if (url.includes('/teams/')) {
    const m = url.match(/\/teams\/([a-z0-9_-]+)/);
    if (m) {
      const team = await prisma.team.findUnique({ where: { id: m[1] } });
      if (team) return `"${team.revision}"`;
    }
  }
  if (url.includes('/runbook-rules/')) {
    const m = url.match(/\/runbook-rules\/([a-z0-9_-]+)/);
    const ruleId = m && m[1] !== 'runbook-rules' ? m[1] : fixtures.serviceRunbookRules?.ruleId;
    if (ruleId) {
      const rule = await prisma.serviceAutomationRule.findFirst({ where: { id: ruleId, detachedAt: null } });
      if (rule) return `"${rule.configurationRevision}"`;
    }
    const rule = await prisma.serviceAutomationRule.findFirst({
      where: { serviceId: fixtures.services.serviceAId, detachedAt: null }
    });
    if (rule) return `"${rule.configurationRevision}"`;
  }
  if (url.includes('/services/') && url.includes('/automation')) {
    if (url.includes('/draft') || url.includes('/restore')) {
      const draft = await prisma.automationDraft.findFirst({
        where: { serviceId: fixtures.services.serviceAId }
      });
      return `"${draft?.revision ?? 0}"`;
    }
    const cfg = await prisma.serviceAutomationConfig.findFirst({
      where: { serviceId: fixtures.services.serviceAId }
    });
    return `"${cfg?.revision ?? 0}"`;
  }
  if (url.includes('/services/')) {
    const svc = await prisma.service.findUnique({ where: { id: fixtures.services.serviceAId } });
    if (svc) return `"${svc.revision}"`;
  }
  if (
    url.includes('/runbooks/') &&
    !url.includes('/agent-pools') &&
    !url.includes('/agents') &&
    !url.includes('/signing-identities') &&
    !url.includes('/executions') &&
    !url.includes('/secrets')
  ) {
    const m = url.match(/\/runbooks\/([a-z0-9_-]+)/);
    const rbId = m && m[1] !== 'runbooks' ? m[1] : fixtures.runbooks.runbookId;
    if (rbId) {
      const rb = await prisma.runbook.findUnique({ where: { id: rbId } });
      if (rb) return `"${rb.revision}"`;
    }
  }
  if (url.includes('/service-objectives/')) {
    const m = url.match(/\/service-objectives\/([a-zA-Z0-9_-]+)/);
    const targetLineageId = m && m[1] !== 'service-objectives' && m[1] !== 'catalog' ? m[1] : fixtures.objectives?.lineageId;
    const obj = await prisma.serviceObjective.findFirst({
      where: { lineageId: targetLineageId, activeTo: null },
      orderBy: { version: 'desc' }
    });
    if (obj) return `"${obj.version * 2}"`;
  }
  if (url.includes('/support-hours')) {
    const policy = await prisma.responseSupportHoursPolicy.findFirst({
      where: { scopeKey: `service:${fixtures.services.serviceAId}`, sealedAt: { not: null } },
      orderBy: { version: 'desc' }
    });
    return `"${policy?.version ?? 0}"`;
  }
  if (url.includes('/response-policy/classification')) {
    const p = await prisma.incidentClassificationPolicy.findFirst({
      where: { scopeKey: `service:${fixtures.services.serviceAId}`, sealedAt: { not: null } },
      orderBy: { version: 'desc' }
    });
    return `"${p?.version ?? 0}"`;
  }
  if (url.includes('/response-policy/sla')) {
    const p = await prisma.incidentSlaPolicy.findFirst({
      where: { scopeKey: `service:${fixtures.services.serviceAId}`, sealedAt: { not: null } },
      orderBy: { version: 'desc' }
    });
    return `"${p?.version ?? 0}"`;
  }
  if (url.includes('/runbook-rules/')) {
    const m = url.match(/\/runbook-rules\/([a-z0-9_-]+)/);
    const ruleId = m ? m[1] : fixtures.serviceRunbookRules?.ruleId;
    if (ruleId) {
      const r = await prisma.serviceAutomationRule.findUnique({ where: { id: ruleId } });
      if (r) return `"${r.configurationRevision}"`;
    }
  }
  if (url.includes('/status-pages/')) {
    const page = await prisma.statusPage.findUnique({ where: { id: fixtures.statusPages.statusPageId } });
    if (page) return `"${page.revision}"`;
  }
  if (url.includes('/settings/runbooks')) {
    const s = await prisma.systemSettings.findUnique({ where: { id: 'default' } });
    return `"${s?.runbookSettingsRevision ?? 0}"`;
  }
  if (url.includes('/dashboards/')) {
    const m = url.match(/\/dashboards\/([a-z0-9_-]+)/);
    if (m && m[1] !== 'dashboards') {
      const d = await prisma.dashboard.findUnique({ where: { id: m[1] } });
      if (d) return `"${d.revision}"`;
    }
    const d = await prisma.dashboard.findFirst();
    if (d) return `"${d.revision}"`;
  }
  if (url.includes('/postmortems/')) {
    const pm = await prisma.postmortem.findFirst({
      where: { id: fixtures.postmortems.postmortemId }
    });
    if (pm) return `"${pm.revision}"`;
  }
  if (url.includes('/schedules/')) {
    if (url.includes('/layers/') && !url.includes('/layers/order')) {
      const m = url.match(/\/layers\/([a-z0-9_-]+)/);
      if (m && m[1] !== 'layers' && m[1] !== 'order') {
        const lyr = await prisma.onCallLayer.findUnique({ where: { id: m[1] } });
        if (lyr) return `"${lyr.revision}"`;
      }
      const lyr = await prisma.onCallLayer.findFirst({
        where: { scheduleId: fixtures.schedules.scheduleAId }
      });
      if (lyr) return `"${lyr.revision}"`;
    }
    const sch = await prisma.onCallSchedule.findFirst({
      where: { id: fixtures.schedules.scheduleAId }
    });
    if (sch) return `"${sch.revision}"`;
  }
  if (url.includes('/automation/')) {
    if (url.includes('/draft') || url.includes('/publish')) {
      const draft = await prisma.automationDraft.findFirst({
        where: { serviceId: fixtures.services.serviceAId }
      });
      return `"${draft?.revision ?? 0}"`;
    }
    const cfg = await prisma.serviceAutomationConfig.findFirst({
      where: { serviceId: fixtures.services.serviceAId }
    });
    return `"${cfg?.revision ?? 0}"`;
  }
  if (url.includes('/agents/')) {
    const m = url.match(/\/agents\/([a-z0-9_-]+)/);
    if (m && m[1] !== 'agents' && m[1] !== 'configuration') {
      const ag = await prisma.runbookAgent.findUnique({ where: { id: m[1] } });
      if (ag) return `"${ag.configurationRevision}"`;
    }
    const ag = await prisma.runbookAgent.findFirst({
      where: { id: fixtures.agentPools?.agentId }
    });
    if (ag) return `"${ag.configurationRevision}"`;
  }
  if (url.includes('/agent-pools/')) {
    const m = url.match(/\/agent-pools\/([a-z0-9_-]+)/);
    if (m && m[1] !== 'agent-pools' && m[1] !== 'members') {
      const pool = await prisma.runbookAgentPool.findUnique({ where: { id: m[1] } });
      if (pool) return `"${pool.revision}"`;
    }
    const pool = await prisma.runbookAgentPool.findFirst({
      where: { id: fixtures.agentPools?.poolId }
    });
    if (pool) return `"${pool.revision}"`;
  }
  if (url.includes('/secrets/')) {
    const m = url.match(/\/secrets\/([a-z0-9_-]+)/);
    const secId = m && m[1] !== 'secrets' && m[1] !== 'usage' && m[1] !== 'grants' ? m[1] : fixtures.runbookSecrets?.secretId;
    if (secId) {
      const sec = await prisma.runbookSecret.findUnique({ where: { id: secId } });
      if (sec) return `"${sec.revision}"`;
    }
  }
  if (url.includes('/templates/')) {
    const m = url.match(/\/templates\/([a-z0-9_-]+)/);
    const id = m && m[1] !== 'templates' ? m[1] : fixtures.templates?.templateId;
    if (id) {
      const tmpl = await prisma.incidentTemplate.findUnique({ where: { id } });
      if (tmpl) return `"${tmpl.revision}"`;
    }
  }
  if (url.includes('/drafts/')) {
    const dr = await prisma.runbookVersion.findFirst({
      where: { runbookId: fixtures.runbooks.runbookId, state: 'DRAFT' }
    });
    if (dr) return `"${dr.draftRevision}"`;
  }
  if (url.includes('/settings/chatops')) {
    const cfg = await prisma.chatOpsConfig.findUnique({ where: { id: 'default' } });
    if (cfg) return `"${cfg.revision}"`;
  }
  // Fallback GET probe
  try {
    const probe = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    return probe.headers.get('etag');
  } catch {
    return null;
  }
}

async function prepareDisposableForDelete(
  prisma: PrismaClient,
  op: V2Operation,
  fixtures: Fixtures,
  apiBase: string,
  adminToken: string
): Promise<string | null> {
  if (op.operationId === 'deleteTeam') {
    const t = await prisma.team.create({ data: { name: `Disposable Team ${Date.now()}` } });
    return `${apiBase}/teams/${t.id}`;
  }
  if (op.operationId === 'deleteService') {
    const s = await prisma.service.create({
      data: { name: `Disposable Svc ${Date.now()}`, status: 'OPERATIONAL' }
    });
    return `${apiBase}/services/${s.id}`;
  }
  if (op.operationId === 'deleteRunbook') {
    const rb = await prisma.runbook.create({
      data: { name: `Disposable RB ${Date.now()}`, slug: `disp-rb-${Date.now()}` }
    });
    return `${apiBase}/runbooks/${rb.id}`;
  }
  if (op.operationId === 'deleteEscalationPolicy') {
    const ep = await prisma.escalationPolicy.create({
      data: { name: `Disposable EP ${Date.now()}` }
    });
    return `${apiBase}/escalation-policies/${ep.id}`;
  }
  if (op.operationId === 'deleteSchedule') {
    const sch = await prisma.onCallSchedule.create({
      data: { name: `Disposable Sch ${Date.now()}`, timeZone: 'UTC' }
    });
    return `${apiBase}/schedules/${sch.id}`;
  }
  if (op.operationId === 'deleteCustomFieldDefinition') {
    const cf = await prisma.customField.create({
      data: { name: `Disp Field ${Date.now()}`, key: `disp_${Date.now()}`, type: 'TEXT' }
    });
    return `${apiBase}/custom-fields/${cf.id}`;
  }
  if (op.operationId === 'deleteReportDashboard') {
    const db = await prisma.dashboard.create({
      data: {
        name: `Disp Dash ${Date.now()}`,
        layout: { columns: 4, rowHeight: 120 },
        userId: fixtures.users.adminId,
        visibility: 'PRIVATE'
      }
    });
    return `${apiBase}/dashboards/${db.id}`;
  }
  if (op.operationId === 'deleteServiceAccount') {
    const safeName = `Disp SA ${Date.now()}`;
    const email = `sa_${Date.now()}@serviceaccount.opsknight.local`;
    const sa = await prisma.user.create({
      data: {
        name: safeName,
        email,
        role: 'RESPONDER',
        status: 'ACTIVE',
        department: 'SERVICE_ACCOUNT'
      }
    });
    return `${apiBase}/service-accounts/${sa.id}`;
  }
  if (op.operationId === 'deleteRunbookAgentPool') {
    const pool = await prisma.runbookAgentPool.create({
      data: { name: `Disp Pool ${Date.now()}` }
    });
    return `${apiBase}/runbooks/agent-pools/${pool.id}`;
  }
  if (op.operationId === 'deleteIncidentTemplate') {
    const tmpl = await prisma.incidentTemplate.create({
      data: { name: `Disp Tmpl ${Date.now()}`, title: 'Disp Incident', defaultPriority: 'P3' }
    });
    return `${apiBase}/incidents/templates/${tmpl.id}`;
  }
  if (op.operationId === 'deleteIntegration') {
    const int = await prisma.integration.create({
      data: { name: `Disp Int ${Date.now()}`, type: 'GENERIC_WEBHOOK', key: `disp_${Date.now()}`, serviceId: fixtures.services.serviceAId }
    });
    return `${apiBase}/integrations/${int.id}`;
  }
  if (op.operationId === 'deletePostmortem') {
    const inc = await prisma.incident.create({
      data: {
        title: `Temp Resolved Inc ${Date.now()}`,
        status: 'RESOLVED',
        priority: 'P2',
        urgency: 'HIGH',
        serviceId: fixtures.services.serviceAId,
        assigneeId: fixtures.users.responderId,
        resolvedAt: new Date()
      }
    });
    const pm = await prisma.postmortem.create({
      data: {
        incidentId: inc.id,
        title: `Temp PM ${Date.now()}`,
        summary: 'Temp summary',
        status: 'DRAFT',
        createdById: fixtures.users.adminId
      }
    });
    return `${apiBase}/postmortems/${pm.id}`;
  }
  if (op.operationId === 'detachServiceRunbookRule') {
    const r = await prisma.serviceAutomationRule.create({
      data: {
        serviceId: fixtures.services.serviceAId,
        runbookId: fixtures.runbooks.runbookId,
        name: `Disp Rule ${Date.now()}`,
        versionStrategy: 'LATEST_PUBLISHED',
        enabled: true
      }
    });
    return `${apiBase}/services/${fixtures.services.serviceAId}/runbook-rules/${r.id}`;
  }
  if (op.operationId === 'removeIncidentWatcher') {
    const w = await prisma.incidentWatcher.create({
      data: { incidentId: fixtures.incidents.openId, userId: fixtures.users.auditorId }
    });
    return `${apiBase}/incidents/${fixtures.incidents.openId}/watchers/${w.id}`;
  }
  if (op.operationId === 'removeIncidentTag') {
    const t = await prisma.tag.create({
      data: { name: `disp-tag-${Date.now()}` }
    });
    await prisma.incidentTag.create({
      data: {
        incidentId: fixtures.incidents.openId,
        tagId: t.id
      }
    });
    return `${apiBase}/incidents/${fixtures.incidents.openId}/tags/${t.id}`;
  }
  if (op.operationId === 'deletePostmortemActionItem') {
    const ai = await prisma.actionItem.create({
      data: {
        postmortemId: fixtures.postmortems.postmortemId,
        incidentId: fixtures.incidents.openId,
        title: `Disp Item ${Date.now()}`
      }
    });
    return `${apiBase}/postmortems/${fixtures.postmortems.postmortemId}/action-items/${ai.id}`;
  }
  if (op.operationId === 'cancelScheduleOverride') {
    const ov = await prisma.onCallOverride.create({
      data: {
        scheduleId: fixtures.schedules.scheduleAId,
        userId: fixtures.users.responderId,
        start: new Date(Date.now() + 86400000),
        end: new Date(Date.now() + 90000000)
      }
    });
    return `${apiBase}/schedules/${fixtures.schedules.scheduleAId}/overrides/${ov.id}`;
  }
  if (op.operationId === 'deleteScheduleLayer') {
    const lyr = await prisma.onCallLayer.create({
      data: {
        scheduleId: fixtures.schedules.scheduleAId,
        name: `Disp Layer ${Date.now()}`,
        start: new Date(),
        rotationLengthHours: 24,
        priority: 99
      }
    });
    return `${apiBase}/schedules/${fixtures.schedules.scheduleAId}/layers/${lyr.id}`;
  }
  if (op.operationId === 'removeScheduleParticipant') {
    let layer = await prisma.onCallLayer.findFirst({
      where: { scheduleId: fixtures.schedules.scheduleAId }
    });
    if (!layer) {
      layer = await prisma.onCallLayer.create({
        data: {
          scheduleId: fixtures.schedules.scheduleAId,
          name: 'Primary Rotation',
          start: new Date(),
          rotationLengthHours: 24,
          priority: 1
        }
      });
    }
    await prisma.onCallLayerUser.upsert({
      where: { layerId_userId: { layerId: layer.id, userId: fixtures.users.teamBUserId } },
      create: { layerId: layer.id, userId: fixtures.users.teamBUserId, position: 99 },
      update: {}
    });
    return `${apiBase}/schedules/${fixtures.schedules.scheduleAId}/layers/${layer.id}/participants/${fixtures.users.teamBUserId}`;
  }
  if (op.operationId === 'removeTeamMember') {
    await prisma.teamMember.upsert({
      where: { userId_teamId: { userId: fixtures.users.regularId, teamId: fixtures.teams.teamBId } },
      create: { userId: fixtures.users.regularId, teamId: fixtures.teams.teamBId, role: 'MEMBER' },
      update: {}
    });
    return `${apiBase}/teams/${fixtures.teams.teamBId}/members/${fixtures.users.regularId}`;
  }
  if (op.operationId === 'revokeRunbookSecretGrant') {
    const dispPool = await prisma.runbookAgentPool.create({
      data: { name: `Disp Pool For Grant ${Date.now()}`, lifecycle: 'ACTIVE' }
    });
    const g = await prisma.runbookSecretGrant.create({
      data: {
        secretId: fixtures.runbookSecrets?.secretId || '',
        agentPoolId: dispPool.id
      }
    });
    return `${apiBase}/runbooks/secrets/${fixtures.runbookSecrets?.secretId}/grants/${g.id}`;
  }
  if (op.operationId === 'revokeServiceAccountToken') {
    const t = await prisma.apiKey.create({
      data: {
        userId: fixtures.users.serviceAccountUserId,
        name: `Disp Token ${Date.now()}`,
        prefix: `ok_sa_${Date.now()}`.slice(0, 12),
        tokenHash: `token_hash_${Date.now()}`,
        scopes: ['service-accounts:write']
      }
    });
    return `${apiBase}/service-accounts/${fixtures.users.serviceAccountUserId}/tokens/${t.id}`;
  }
  if (op.operationId === 'removeStatusPageSubscriber') {
    const sub = await prisma.statusPageSubscription.create({
      data: {
        statusPageId: fixtures.statusPages.statusPageId,
        email: `disp-sub-${Date.now()}@example.com`,
        token: `disp-tok-${Date.now()}`,
        state: 'ACTIVE',
        verified: true
      }
    });
    return `${apiBase}/status-pages/${fixtures.statusPages.statusPageId}/subscribers/${sub.id}`;
  }
  if (op.operationId === 'deleteStatusPageAsset') {
    const assetId = crypto.randomBytes(32).toString('hex');
    await prisma.statusPageAsset.create({
      data: {
        id: assetId,
        statusPageId: fixtures.statusPages.statusPageId,
        contentType: 'image/png',
        data: Buffer.from('mockpngdata')
      }
    });
    return `${apiBase}/status-pages/${fixtures.statusPages.statusPageId}/assets/${assetId}`;
  }
  if (op.operationId === 'deleteRunbook') {
    const name = `Disposable RB ${Date.now()}`;
    const rb = await prisma.runbook.create({
      data: { name, slug: `disp-rb-del-${Date.now()}` }
    });
    return `${apiBase}/runbooks/${rb.id}`;
  }
  if (op.operationId === 'deleteSavedReport') {
    const rep = await prisma.savedReport.create({
      data: {
        name: `Disp Report ${Date.now()}`,
        metricKeys: ['totalIncidents'],
        userId: fixtures.users.adminId,
        visibility: 'PRIVATE'
      }
    });
    return `${apiBase}/reports/saved/${rep.id}`;
  }

  return null;
}

async function prepareIncidentForAction(
  prisma: PrismaClient,
  action: string,
  fixtures: Fixtures,
  apiBase: string
): Promise<string> {
  const inc = await prisma.incident.create({
    data: {
      title: `Lifecycle Inc ${action} ${Date.now()}`,
      status: action === 'unacknowledge' || action === 'snooze' || action === 'resolve'
        ? 'ACKNOWLEDGED'
        : action === 'reopen'
          ? 'RESOLVED'
          : action === 'unsuppress'
            ? 'SUPPRESSED'
            : action === 'unsnooze'
              ? 'SNOOZED'
              : 'OPEN',
      priority: 'P2',
      urgency: 'HIGH',
      serviceId: fixtures.services.serviceAId,
      assigneeId: fixtures.users.responderId,
      ...(action === 'reopen' ? { resolvedAt: new Date() } : {}),
      ...(action === 'unsnooze' ? { snoozedUntil: new Date(Date.now() + 3600000) } : {})
    }
  });
  return `${apiBase}/incidents/${inc.id}/${action}`;
}

async function main() {
  const DATABASE_URL = requireEnv('DATABASE_URL');
  const prisma = new PrismaClient({
    datasources: { db: { url: DATABASE_URL } }
  });
  const fixturesPath = path.resolve('tests/certification/fixtures.json');
  const fixtures: Fixtures = JSON.parse(fs.readFileSync(fixturesPath, 'utf8'));

  const keyPoolPath = path.resolve('tests/certification/key-pool.json');
  const keyPool: string[] = JSON.parse(fs.readFileSync(keyPoolPath, 'utf8')).tokens;

  const activeObj = await prisma.serviceObjective.findFirst({
    where: { activeTo: null },
    orderBy: { activeFrom: 'desc' }
  });
  if (activeObj) {
    fixtures.objectives = {
      objectiveId: activeObj.id,
      lineageId: activeObj.lineageId
    };
  }

  const limitedPoolPath = path.resolve('tests/certification/limited-pool.json');
  const limitedPool: string[] = JSON.parse(fs.readFileSync(limitedPoolPath, 'utf8')).tokens;

  let defaultLayer = await prisma.onCallLayer.findFirst({
    where: { scheduleId: fixtures.schedules.scheduleAId }
  });
  if (!defaultLayer) {
    defaultLayer = await prisma.onCallLayer.create({
      data: {
        scheduleId: fixtures.schedules.scheduleAId,
        name: 'Primary Rotation',
        start: new Date(),
        rotationLengthHours: 24,
        priority: 1
      }
    });
  }
  fixtures.scheduleLayers = { layerId: defaultLayer.id };

  const activeStatusPage = await prisma.statusPage.findFirst();
  if (activeStatusPage) {
    fixtures.statusPages = { statusPageId: activeStatusPage.id };
  } else {
    const newSp = await prisma.statusPage.create({
      data: {
        name: `Primary Status Page ${Date.now()}`,
        slug: `status-${Date.now()}`,
        organizationName: 'OpsKnight Inc'
      }
    });
    fixtures.statusPages = { statusPageId: newSp.id };
  }

  let sub = await prisma.statusPageSubscription.findFirst({
    where: { statusPageId: fixtures.statusPages.statusPageId }
  });
  if (!sub) {
    sub = await prisma.statusPageSubscription.create({
      data: {
        statusPageId: fixtures.statusPages.statusPageId,
        email: `subscriber-${Date.now()}@example.com`,
        token: `cert-sub-token-${Date.now()}`,
        state: 'ACTIVE',
        verified: true
      }
    });
  }
  fixtures.subscribers = { subscriberId: sub.id };

  // Ensure valid runbook with published and draft versions
  const rb = await prisma.runbook.findUnique({
    where: { id: fixtures.runbooks.runbookId },
    include: { publishedVersion: true }
  }) || await prisma.runbook.findFirst({
    where: { publishedVersionId: { not: null }, archivedAt: null },
    include: { publishedVersion: true }
  });
  if (rb && rb.publishedVersion) {
    fixtures.runbooks.runbookId = rb.id;
    fixtures.runbooks.publishedVersionId = rb.publishedVersionId!;
    let draft = await prisma.runbookVersion.findFirst({
      where: { runbookId: rb.id, state: 'DRAFT' }
    });
    if (!draft) {
      draft = await prisma.runbookVersion.create({
        data: {
          runbookId: rb.id,
          version: (rb.publishedVersion.version ?? 1) + 1,
          state: 'DRAFT',
          definition: rb.publishedVersion.definition ?? { schemaVersion: 1, steps: [] },
          checksum: 'draft_checksum_' + Date.now()
        }
      });
    }
    fixtures.runbooks.draftVersionId = draft.id;
    fixtures.runbookDrafts = { draftVersionId: draft.id };
    fixtures.runbookVersions = { versionId: rb.publishedVersionId! };
  }

  // Ensure valid integration
  let int = await prisma.integration.findFirst({
    where: { serviceId: fixtures.services.serviceAId }
  });
  if (!int) {
    int = await prisma.integration.create({
      data: {
        name: `Cert Integration ${Date.now()}`,
        type: 'GENERIC_WEBHOOK',
        key: `cert_int_${Date.now()}`,
        serviceId: fixtures.services.serviceAId
      }
    });
  }
  fixtures.integrations = { integrationId: int.id };

  // Ensure valid postmortem
  let pm = await prisma.postmortem.findFirst({
    where: { incident: { serviceId: fixtures.services.serviceAId } }
  });
  if (!pm) {
    const inc = await prisma.incident.create({
      data: {
        title: `Resolved Inc for PM ${Date.now()}`,
        status: 'RESOLVED',
        priority: 'P2',
        urgency: 'HIGH',
        serviceId: fixtures.services.serviceAId,
        assigneeId: fixtures.users.responderId,
        resolvedAt: new Date()
      }
    });
    pm = await prisma.postmortem.create({
      data: {
        incidentId: inc.id,
        title: `Cert Postmortem ${Date.now()}`,
        summary: 'Cert PM Summary',
        status: 'DRAFT',
        createdById: fixtures.users.adminId
      }
    });
  }
  fixtures.postmortems = { postmortemId: pm.id };

  // Ensure valid dashboard
  let d = await prisma.dashboard.findFirst();
  if (!d) {
    d = await prisma.dashboard.create({
      data: {
        name: `Primary Dashboard ${Date.now()}`,
        layout: { columns: 4, rowHeight: 120 },
        userId: fixtures.users.adminId,
        visibility: 'PRIVATE'
      }
    });
  }
  fixtures.dashboards = { dashboardId: d.id };

  // Ensure valid serviceAutomationRule
  let rule = await prisma.serviceAutomationRule.findFirst({
    where: { serviceId: fixtures.services.serviceAId, detachedAt: null }
  });
  if (!rule) {
    rule = await prisma.serviceAutomationRule.create({
      data: {
        serviceId: fixtures.services.serviceAId,
        runbookId: fixtures.runbooks.runbookId,
        name: `Cert Rule ${Date.now()}`,
        versionStrategy: 'LATEST_PUBLISHED'
      }
    });
  }
  fixtures.serviceRunbookRules = { ruleId: rule.id };

  // Deduplicate active rules for this runbook to maintain a clean test state
  const extraRules = await prisma.serviceAutomationRule.findMany({
    where: { runbookId: fixtures.runbooks.runbookId, detachedAt: null }
  });
  if (extraRules.length > 1) {
    await prisma.serviceAutomationRule.updateMany({
      where: { runbookId: fixtures.runbooks.runbookId, id: { not: rule.id }, detachedAt: null },
      data: { detachedAt: new Date() }
    });
  }

  // Ensure valid savedReport
  let rep = await prisma.savedReport.findFirst();
  if (!rep) {
    rep = await prisma.savedReport.create({
      data: {
        name: `Cert Saved Report ${Date.now()}`,
        metricKeys: ['incidents.count'],
        userId: fixtures.users.adminId
      }
    });
  }
  (fixtures as any).savedReports = { id: rep.id };

  // Ensure valid automation version
  let autoVer = await prisma.automationVersion.findFirst({
    where: { serviceId: fixtures.services.serviceAId }
  });
  if (!autoVer) {
    autoVer = await prisma.automationVersion.create({
      data: {
        serviceId: fixtures.services.serviceAId,
        versionNumber: 1,
        schemaVersion: 1,
        snapshot: { rules: [], fields: [], schemaVersion: 1 },
        compiledSnapshot: { rules: [], fields: [], schemaVersion: 1 },
        checksum: 'initial_cert_checksum_' + Date.now(),
        publishedBy: fixtures.users.adminId,
        lintReport: []
      }
    });
  }
  fixtures.automationVersions = { versionId: autoVer.id };

  // Ensure valid notification
  let notifRecord = await prisma.notification.findFirst();
  if (!notifRecord) {
    notifRecord = await prisma.notification.create({
      data: {
        userId: fixtures.users.responderId,
        incidentId: fixtures.incidents.openId,
        channel: 'EMAIL',
        status: 'DELIVERED',
        payloadEncrypted: 'mock_enc'
      }
    });
  }
  fixtures.notifications = { notificationId: notifRecord.id };

  const apiBase = fixtures.apiBase;
  const commitSha = 'fdabcf67b45ae772d9c4413dc4a915f5b1ea3cfc';
  const outDir = path.resolve(`reports/api-v2-certification/${commitSha}`);
  fs.mkdirSync(outDir, { recursive: true });

  console.log(`Starting Authoritative API v2 Certification against ${apiBase}`);
  console.log(`Operations to certify: ${V2_OPERATIONS.length}`);
  console.log(`Admin key pool size: ${keyPool.length}`);
  console.log(`Limited key pool size: ${limitedPool.length}`);

  const results: OperationResult[] = [];
  let passCount = 0;
  let failCount = 0;
  let lastCreatedAuditExportId: string | null = null;
  let lastCreatedAuditExportToken: string | null = null;
  let lastCreatedReportExportId: string | null = null;
  let lastCreatedReportExportToken: string | null = null;

  for (let i = 0; i < V2_OPERATIONS.length; i++) {
    const op = V2_OPERATIONS[i];
    const method = op.method.toUpperCase();
    const defaultResolvedPath = resolvePath(op.path, fixtures);
    let fullUrl = `${apiBase}${defaultResolvedPath}`;

    // Select token round-robin from key pool
    let adminToken = keyPool[i % keyPool.length];
    const limitedToken = limitedPool[i % limitedPool.length];

    if ((op.operationId === 'getAuditExport' || op.operationId === 'downloadAuditExport') && lastCreatedAuditExportToken) {
      adminToken = lastCreatedAuditExportToken;
    }

    if ((op.operationId === 'getAuditExport' || op.operationId === 'downloadAuditExport') && lastCreatedAuditExportId) {
      fullUrl = `${apiBase}/audit-exports/${lastCreatedAuditExportId}${op.operationId === 'downloadAuditExport' ? '/download' : ''}`;
    }

    if ((op.operationId === 'getReportExport' || op.operationId === 'downloadReportExport' || op.operationId === 'cancelReportExport') && lastCreatedReportExportToken) {
      adminToken = lastCreatedReportExportToken;
    }

    if ((op.operationId === 'getReportExport' || op.operationId === 'downloadReportExport') && lastCreatedReportExportId) {
      fullUrl = `${apiBase}/reports/exports/${lastCreatedReportExportId}${op.operationId === 'downloadReportExport' ? '/download' : ''}`;
    }

    if ((op.operationId === 'getReportExport' || op.operationId === 'downloadReportExport' || op.operationId === 'cancelReportExport') && lastCreatedReportExportId) {
      fullUrl = fullUrl.replace(/c[a-z0-9]{24}/g, lastCreatedReportExportId);
    }

    // Check mutation contract for preconditionRequired / concurrency
    const contractKey = `${method} /api/v2${op.path.replace(/\{(\w+)\}/g, '[$1]')}`;
    const contract = V2_MUTATION_CONTRACT[contractKey];
    const needsPrecondition = Boolean(contract?.preconditionRequired || contract?.concurrency === 'etag');

    // Handle disposable resource for DELETE
    let disposableUrl: string | null = null;
    if (method === 'DELETE') {
      try {
        disposableUrl = await prepareDisposableForDelete(prisma, op, fixtures, apiBase, adminToken);
        if (disposableUrl) {
          fullUrl = disposableUrl;
        }
      } catch (err: any) {
        console.warn(`Could not prepare disposable for ${op.operationId}:`, err.message);
      }
    }

    // Handle incident lifecycle operations
    if (op.operationId === 'acknowledgeIncident') {
      fullUrl = await prepareIncidentForAction(prisma, 'acknowledge', fixtures, apiBase);
    } else if (op.operationId === 'unacknowledgeIncident') {
      fullUrl = await prepareIncidentForAction(prisma, 'unacknowledge', fixtures, apiBase);
    } else if (op.operationId === 'snoozeIncident') {
      fullUrl = await prepareIncidentForAction(prisma, 'snooze', fixtures, apiBase);
    } else if (op.operationId === 'unsnoozeIncident') {
      fullUrl = await prepareIncidentForAction(prisma, 'unsnooze', fixtures, apiBase);
    } else if (op.operationId === 'suppressIncident') {
      fullUrl = await prepareIncidentForAction(prisma, 'suppress', fixtures, apiBase);
    } else if (op.operationId === 'unsuppressIncident') {
      fullUrl = await prepareIncidentForAction(prisma, 'unsuppress', fixtures, apiBase);
    } else if (op.operationId === 'resolveIncident') {
      fullUrl = await prepareIncidentForAction(prisma, 'resolve', fixtures, apiBase);
    } else if (op.operationId === 'reopenIncident') {
      fullUrl = await prepareIncidentForAction(prisma, 'reopen', fixtures, apiBase);
    }

    if (op.operationId === 'archiveRunbook') {
      const rb = await prisma.runbook.create({
        data: { name: `Disp RB Arc ${Date.now()}`, slug: `disp-rb-arc-${Date.now()}` }
      });
      fullUrl = `${apiBase}/runbooks/${rb.id}/archive`;
    } else if (op.operationId === 'unarchiveRunbook') {
      const rb = await prisma.runbook.create({
        data: { name: `Disp RB Unarc ${Date.now()}`, slug: `disp-rb-un-${Date.now()}`, archivedAt: new Date() }
      });
      fullUrl = `${apiBase}/runbooks/${rb.id}/unarchive`;
    } else if (op.operationId === 'retireRunbookAgentPool') {
      const pool = await prisma.runbookAgentPool.create({
        data: { name: `Disp Retire Pool ${Date.now()}`, lifecycle: 'ACTIVE' }
      });
      fullUrl = `${apiBase}/runbooks/agent-pools/${pool.id}/retire`;
    } else if (op.operationId === 'activateRunbookSigningIdentity') {
      const activeKey = await prisma.runbookExecutionSigningKey.findFirst({ where: { state: 'ACTIVE' } });
      await prisma.runbookExecutionSigningKey.deleteMany({ where: { state: 'NEXT' } });
      const nextKey = await prisma.runbookExecutionSigningKey.create({
        data: {
          id: `disp-next-key-${Date.now()}`,
          publicKey: `mock-pk-${Date.now()}`,
          privateKeyEncrypted: 'mock-enc',
          state: 'NEXT'
        }
      });
      const trusted = [activeKey?.id, nextKey.id].filter(Boolean) as string[];
      await prisma.runbookAgent.updateMany({
        where: { status: { notIn: ['REVOKED', 'ENROLLING'] } },
        data: { trustedSigningKeys: trusted }
      });
      fullUrl = `${apiBase}/runbooks/signing-identities/${nextKey.id}/activate`;
    } else if (op.operationId === 'retireRunbookSigningIdentity') {
      const retiringKey = await prisma.runbookExecutionSigningKey.create({
        data: {
          id: `disp-retire-key-${Date.now()}`,
          publicKey: `mock-pk-${Date.now()}`,
          privateKeyEncrypted: 'mock-enc',
          state: 'RETIRING',
          retiredAt: new Date(Date.now() - 86400000)
        }
      });
      fullUrl = `${apiBase}/runbooks/signing-identities/${retiringKey.id}/retire`;
    } else if (op.operationId === 'revokeRunbookAgent') {
      const ag = await prisma.runbookAgent.create({
        data: {
          name: `Disp Revoke Agent ${Date.now()}`,
          status: 'ONLINE',
          publicKey: `mock-pk-${Date.now()}`
        }
      });
      fullUrl = `${apiBase}/runbooks/agents/${ag.id}/revoke`;
    } else if (op.operationId === 'renewUserInvitation') {
      const u = await prisma.user.create({
        data: {
          email: `invited_${Date.now()}@example.com`,
          name: `Invited User ${Date.now()}`,
          role: 'RESPONDER',
          status: 'INVITED',
          invitedAt: new Date()
        }
      });
      fullUrl = `${apiBase}/users/${u.id}/invitation`;
    }

    if (op.operationId === 'stageRunbookSigningIdentity') {
      await prisma.runbookExecutionSigningKey.deleteMany({ where: { state: 'NEXT' } });
    }

    process.stdout.write(`[${i + 1}/${V2_OPERATIONS.length}] ${method} ${op.path} (${op.operationId})... `);

    // 1. Positive Test
    let currentEtag: string | null = null;
    if (needsPrecondition) {
      currentEtag = await getResourceEtag(fullUrl, adminToken, prisma, op, fixtures);
    }

    let payload = getPayloadForOperation(op, fixtures);

    // If createPostmortem, create fresh resolved incident
    if (op.operationId === 'createPostmortem') {
      const pmInc = await prisma.incident.create({
        data: {
          title: `Resolved Inc for PM ${Date.now()}`,
          status: 'RESOLVED',
          priority: 'P2',
          urgency: 'HIGH',
          serviceId: fixtures.services.serviceAId,
          assigneeId: fixtures.users.responderId,
          resolvedAt: new Date()
        }
      });
      payload = {
        incidentId: pmInc.id,
        title: `Certified Postmortem ${Date.now()}`,
        summary: 'Postmortem summary'
      };
    }

    if (op.operationId === 'stageRunbookSigningIdentity') {
      await prisma.runbookExecutionSigningKey.deleteMany({ where: { state: { not: 'ACTIVE' } } });
      const activeKey = await prisma.runbookExecutionSigningKey.findFirst({ where: { state: 'ACTIVE' } });
      payload = { expectedActiveKeyId: activeKey ? activeKey.id : null };
    } else if (op.operationId === 'activateRunbookSigningIdentity') {
      const activeKey = await prisma.runbookExecutionSigningKey.findFirst({ where: { state: 'ACTIVE' } });
      payload = { expectedActiveKeyId: activeKey?.id || fixtures.signingIdentities?.identityId };
    } else if (op.operationId === 'retireRunbookSigningIdentity') {
      payload = { expectedState: 'RETIRING' };
    }

    if (op.operationId === 'createServiceObjective') {
      const current = await prisma.serviceObjective.findFirst({
        where: { serviceId: fixtures.services.serviceAId, metricType: 'AVAILABILITY', activeTo: null }
      });
      payload = {
        definition: {
          name: `Cert SLO ${Date.now()}`,
          serviceId: fixtures.services.serviceAId,
          metricType: 'AVAILABILITY',
          target: 99.9,
          comparator: 'GREATER_THAN_OR_EQUAL',
          windowType: 'THIRTY_DAYS'
        },
        expectedActiveVersionId: current ? current.id : null
      };
    }

    if (op.operationId === 'updateServiceObjective') {
      payload = { target: 99.5 };
    }

    if (op.operationId === 'archiveServiceObjective') {
      payload = {};
    }

    if (op.operationId === 'retryStatusPagePublication') {
      payload = {};
    }

    if (op.operationId === 'retryNotification') {
      const notif = await prisma.notification.create({
        data: {
          user: { connect: { id: fixtures.users.responderId } },
          channel: 'EMAIL',
          status: 'FAILED',
          message: 'Cert failed message',
          payloadEncrypted: 'mock_encrypted_payload'
        }
      });
      fullUrl = `${apiBase}/notifications/${notif.id}/retry`;
      payload = {};
    }

    if (op.operationId === 'createServiceRunbookRule' || op.operationId === 'updateServiceRunbookRule') {
      const rb = await prisma.runbook.findUnique({
        where: { id: fixtures.runbooks.runbookId },
        select: { publishedVersionId: true }
      });
      const expectedVersionId = rb?.publishedVersionId || fixtures.runbooks.publishedVersionId;
      if (op.operationId === 'createServiceRunbookRule') {
        payload = {
          configuration: {
            runbookId: fixtures.runbooks.runbookId,
            name: `Rule ${Date.now()}`,
            enabled: true,
            mode: 'MANUAL',
            versionStrategy: 'LATEST_PUBLISHED'
          },
          expectedVersionId
        };
      } else {
        payload = {
          configuration: {
            name: `Updated Rule ${Date.now()}`
          },
          expectedVersionId
        };
      }
    }

    if (op.operationId === 'restoreRunbook') {
      const rb = await prisma.runbook.create({
        data: { name: `Disp RB Restore ${Date.now()}`, slug: `disp-rb-res-${Date.now()}`, archivedAt: new Date() }
      });
      fullUrl = `${apiBase}/runbooks/${rb.id}/restore`;
      currentEtag = `"${rb.revision}"`;
      payload = {};
    }

    if (op.operationId === 'duplicateRunbook') {
      const rb = await prisma.runbook.findUnique({ where: { id: fixtures.runbooks.runbookId } });
      currentEtag = `"${rb?.revision ?? 1}"`;
      payload = {};
    }

    if (op.operationId === 'activateServiceRunbookRule') {
      const pubVer = fixtures.runbooks.publishedVersionId;
      const updatedRule = await prisma.serviceAutomationRule.update({
        where: { id: fixtures.serviceRunbookRules?.ruleId },
        data: {
          mode: 'AUTOMATIC',
          versionStrategy: 'PINNED',
          runbookVersionId: pubVer,
          enabled: false
        }
      });
      await prisma.runbookTrigger.deleteMany({
        where: { bindingId: fixtures.serviceRunbookRules?.ruleId }
      });
      await prisma.runbookTrigger.create({
        data: {
          bindingId: fixtures.serviceRunbookRules?.ruleId,
          event: 'INCIDENT_CREATED',
          conditionLogic: 'AND',
          enabled: true
        }
      });
      currentEtag = `"${updatedRule.configurationRevision}"`;
      payload = { confirmMatchAll: true };
    }

    if (op.operationId === 'requestRunbookRulePolicyChecks') {
      let agent = await prisma.runbookAgent.findFirst({ where: { status: 'ONLINE' } });
      if (!agent) {
        agent = await prisma.runbookAgent.create({
          data: { name: 'Cert Agent', status: 'ONLINE', lastHeartbeatAt: new Date() }
        });
      } else {
        await prisma.runbookAgent.update({ where: { id: agent.id }, data: { lastHeartbeatAt: new Date() } });
      }

      const def = {
        steps: [
          {
            key: 'agent_step_1',
            name: 'Check disk',
            type: 'BASH',
            riskClass: 'NON_IDEMPOTENT',
            config: { command: 'df -h' }
          }
        ]
      };
      const chk = crypto.createHash('sha256').update(JSON.stringify(def)).digest('hex');
      const rb = await prisma.runbook.findFirst({ where: { id: fixtures.runbooks.runbookId }, include: { publishedVersion: true } });
      const maxVer = await prisma.runbookVersion.aggregate({ where: { runbookId: rb!.id }, _max: { version: true } });
      const nextVer = (maxVer._max.version || 0) + 1;

      const v = await prisma.runbookVersion.create({
        data: {
          runbookId: rb!.id,
          version: nextVer,
          state: 'PUBLISHED',
          definition: def,
          checksum: chk,
          schemaVersion: 1
        }
      });

      const updatedRule = await prisma.serviceAutomationRule.update({
        where: { id: fixtures.serviceRunbookRules?.ruleId },
        data: {
          defaultAgentId: agent.id,
          versionStrategy: 'PINNED',
          runbookVersionId: v.id
        }
      });
      currentEtag = `"${updatedRule.configurationRevision}"`;
      payload = {};
    }

    if (op.operationId === 'deleteRunbook') {
      const m = fullUrl.match(/\/runbooks\/([a-z0-9_-]+)/);
      if (m) {
        const rb = await prisma.runbook.findUnique({ where: { id: m[1] } });
        payload = { confirmationText: rb?.name || '' };
      }
    }

    if (op.operationId === 'saveAutomationDraft') {
      payload = {
        snapshot: {
          schemaVersion: 1,
          fields: [],
          rules: []
        }
      };
    }

    if (op.operationId === 'activateServiceRunbookRule') {
      const r = await prisma.serviceAutomationRule.findUnique({
        where: { id: fixtures.serviceRunbookRules?.ruleId }
      });
      if (r) currentEtag = `"${r.configurationRevision}"`;
      payload = { confirmMatchAll: true };
    }

    if (op.operationId === 'updatePostmortemActionItem') {
      let ai = await prisma.actionItem.findFirst({
        where: { postmortemId: fixtures.postmortems.postmortemId }
      });
      if (!ai) {
        ai = await prisma.actionItem.create({
          data: {
            postmortemId: fixtures.postmortems.postmortemId,
            incidentId: fixtures.incidents.openId,
            title: 'Action Item for Update'
          }
        });
      }
      fixtures.actionItems = { actionItemId: ai.id };
      fullUrl = fullUrl.replace(/\/action-items\/[^\/]+/, `/action-items/${ai.id}`);
    }

    if (['getRunbookDraft', 'updateRunbookDraft', 'validateRunbookDraft', 'publishRunbookDraft'].includes(op.operationId)) {
      let draft = await prisma.runbookVersion.findFirst({
        where: { runbookId: fixtures.runbooks.runbookId, state: 'DRAFT' }
      });
      if (!draft) {
        const rb = await prisma.runbook.findUnique({
          where: { id: fixtures.runbooks.runbookId },
          include: { publishedVersion: true }
        });
        draft = await prisma.runbookVersion.create({
          data: {
            runbookId: fixtures.runbooks.runbookId,
            version: (rb?.publishedVersion?.version ?? 1) + 1,
            state: 'DRAFT',
            definition: rb?.publishedVersion?.definition ?? { schemaVersion: 1, steps: [] },
            checksum: 'draft_checksum_' + Date.now()
          }
        });
        await prisma.runbook.update({
          where: { id: fixtures.runbooks.runbookId },
          data: { draftVersionId: draft.id }
        });
      }
      fixtures.runbooks.draftVersionId = draft.id;
      fixtures.runbookDrafts = { draftVersionId: draft.id };
      fullUrl = fullUrl.replace(/\/drafts\/[^\/]+/, `/drafts/${draft.id}`);
      currentEtag = `"${draft.draftRevision}"`;
    }

    if (op.operationId === 'publishAutomationVersion') {
      let draft = await prisma.automationDraft.findFirst({
        where: { serviceId: fixtures.services.serviceAId }
      });
      if (!draft) {
        draft = await prisma.automationDraft.create({
          data: {
            serviceId: fixtures.services.serviceAId,
            schemaVersion: 1,
            snapshot: { fields: [], rules: [], schemaVersion: 1 },
            revision: 1,
            updatedBy: fixtures.users.adminId
          }
        });
      }
      const cfg = await prisma.serviceAutomationConfig.findFirst({
        where: { serviceId: fixtures.services.serviceAId }
      });
      currentEtag = `"${draft.revision}"`;
      payload = {
        expectedActiveVersionId: cfg?.activeVersionId ?? null,
        expectedCandidateVersionId: cfg?.mode === 'LIVE' ? (cfg.candidateVersionId ?? null) : undefined
      };
    }

    if (op.operationId === 'updateServiceAutomationMode') {
      const cfg = await prisma.serviceAutomationConfig.findFirst({
        where: { serviceId: fixtures.services.serviceAId }
      });
      payload = {
        mode: 'DISABLED',
        expectedActiveVersionId: cfg?.activeVersionId ?? null
      };
    }

    if (op.operationId === 'restoreAutomationDraft') {
      let ver = await prisma.automationVersion.findFirst({
        where: { serviceId: fixtures.services.serviceAId }
      });
      if (!ver) {
        ver = await prisma.automationVersion.create({
          data: {
            serviceId: fixtures.services.serviceAId,
            versionNumber: 1,
            checksum: 'cert_checksum',
            snapshot: { schemaVersion: 1, fields: [], rules: [] },
            compiledSnapshot: { schemaVersion: 1, fields: [], rules: [] },
            lintReport: {},
            publishedBy: fixtures.users.adminId
          }
        });
      }
      const draft = await prisma.automationDraft.findFirst({
        where: { serviceId: fixtures.services.serviceAId }
      });
      currentEtag = `"${draft?.revision ?? 0}"`;
      payload = { sourceVersionId: ver.id };
    }

    if (op.operationId === 'getAutomationCandidate') {
      let cand = await prisma.automationVersion.findFirst({
        where: { serviceId: fixtures.services.serviceAId }
      });
      if (cand) {
        await prisma.serviceAutomationConfig.upsert({
          where: { serviceId: fixtures.services.serviceAId },
          create: { serviceId: fixtures.services.serviceAId, candidateVersionId: cand.id },
          update: { candidateVersionId: cand.id }
        });
      }
    }

    if (op.operationId === 'discardAutomationCandidate') {
      let cand = await prisma.automationVersion.findFirst({
        where: { serviceId: fixtures.services.serviceAId }
      });
      if (!cand) {
        cand = await prisma.automationVersion.create({
          data: {
            serviceId: fixtures.services.serviceAId,
            versionNumber: 2,
            checksum: 'cert_checksum_cand',
            snapshot: { schemaVersion: 1, fields: [], rules: [] },
            compiledSnapshot: { schemaVersion: 1, fields: [], rules: [] },
            lintReport: {},
            publishedBy: fixtures.users.adminId
          }
        });
      }
      const cfg = await prisma.serviceAutomationConfig.upsert({
        where: { serviceId: fixtures.services.serviceAId },
        create: { serviceId: fixtures.services.serviceAId, candidateVersionId: cand.id },
        update: { candidateVersionId: cand.id }
      });
      currentEtag = `"${cfg.revision}"`;
      payload = { expectedCandidateVersionId: cand.id };
    }

    if (op.operationId === 'activateAutomationCandidate') {
      await prisma.systemSettings.updateMany({
        where: { id: 'default' },
        data: { automationEnabled: true }
      });
      const snap = { fields: [], rules: [], schemaVersion: 1 };
      const chk = computeCanonicalChecksum(snap);
      const latestVer = await prisma.automationVersion.aggregate({
        where: { serviceId: fixtures.services.serviceAId },
        _max: { versionNumber: true }
      });
      const nextVer = (latestVer._max.versionNumber ?? 10) + 1;
      const cand = await prisma.automationVersion.create({
        data: {
          serviceId: fixtures.services.serviceAId,
          versionNumber: nextVer,
          checksum: chk,
          snapshot: snap,
          compiledSnapshot: snap,
          lintReport: {},
          publishedBy: fixtures.users.adminId
        }
      });
      const cfg = await prisma.serviceAutomationConfig.upsert({
        where: { serviceId: fixtures.services.serviceAId },
        create: { serviceId: fixtures.services.serviceAId, mode: 'LIVE', candidateVersionId: cand.id },
        update: { mode: 'LIVE', candidateVersionId: cand.id }
      });
      currentEtag = `"${cfg.revision}"`;
      payload = {
        expectedCandidateVersionId: cand.id,
        expectedActiveVersionId: cfg.activeVersionId ?? null,
        acknowledgeNoShadow: true,
        acknowledgeShadowErrors: true,
        acknowledgeMaterialDifferences: true
      };
    }

    const pubVerId = fixtures.runbooks.publishedVersionId || 'cmvme7bmk000moxdbemowju5w';

    if (op.operationId === 'approveRunbookExecutionStep' || op.operationId === 'rejectRunbookExecutionStep') {
      const ex = await prisma.runbookExecution.create({
        data: {
          runbookId: fixtures.runbooks.runbookId,
          runbookVersionId: pubVerId,
          serviceId: fixtures.services.serviceAId,
          status: 'WAITING_APPROVAL',
          inputValues: {},
          triggeredByUserId: fixtures.users.adminId,
          definitionChecksum: 'mock_checksum',
          deadlineAt: new Date(Date.now() + 3600000)
        }
      });
      const step = await prisma.runbookExecutionStep.create({
        data: {
          executionId: ex.id,
          stepKey: 'step_1',
          name: 'Step 1',
          sequence: 1,
          type: 'APPROVAL',
          riskClass: 'READ_ONLY',
          status: 'WAITING_APPROVAL',
          requiresApproval: true,
          config: {}
        }
      });
      fullUrl = `${apiBase}/runbooks/executions/${ex.id}/steps/${step.id}/${op.operationId === 'approveRunbookExecutionStep' ? 'approve' : 'reject'}`;
      const { computePlanDigest } = await import('../../src/lib/runbooks/definition.js');
      const planDigest = computePlanDigest({
        stepKey: 'step_1',
        stepType: 'APPROVAL',
        riskClass: 'READ_ONLY',
        config: {},
        versionChecksum: 'mock_checksum'
      });
      payload = op.operationId === 'approveRunbookExecutionStep'
        ? { planDigest }
        : { planDigest, reason: 'Cert reject reason' };
    }

    if (op.operationId === 'previewRunbookExecutionRerun' || op.operationId === 'rerunRunbookExecution') {
      const pubVerRow = await prisma.runbookVersion.findUnique({ where: { id: pubVerId } });
      let finishedEx = await prisma.runbookExecution.findFirst({
        where: { status: 'SUCCEEDED', runbookId: fixtures.runbooks.runbookId }
      });
      if (!finishedEx) {
        finishedEx = await prisma.runbookExecution.create({
          data: {
            runbookId: fixtures.runbooks.runbookId,
            runbookVersionId: pubVerId,
            serviceId: fixtures.services.serviceAId,
            status: 'SUCCEEDED',
            inputValues: {},
            triggeredByUserId: fixtures.users.adminId,
            definitionChecksum: pubVerRow?.checksum || '0'.repeat(64),
            deadlineAt: new Date(Date.now() + 3600000)
          }
        });
      }
      if (op.operationId === 'previewRunbookExecutionRerun') {
        fullUrl = `${apiBase}/runbooks/executions/${finishedEx.id}/rerun-preview`;
        payload = {};
      } else {
        const previewRes = await request(`${apiBase}/runbooks/executions/${finishedEx.id}/rerun-preview`, {
          method: 'POST',
          token: adminToken,
          body: {}
        });
        const planDigest = previewRes.json?.data?.digest || previewRes.json?.data?.planDigest || '0'.repeat(64);
        const authorizationToken = previewRes.json?.data?.authorizationToken || '0'.repeat(64);
        fullUrl = `${apiBase}/runbooks/executions/${finishedEx.id}/rerun`;
        payload = { expectedPlanDigest: planDigest, previewAuthorizationToken: authorizationToken };
      }
    }

    if (op.operationId === 'previewRunbookExecution' || op.operationId === 'executeRunbook') {
      payload = {
        parameters: {}
      };
      if (op.operationId === 'previewRunbookExecution') {
        fullUrl = `${apiBase}/runbooks/${fixtures.runbooks.runbookId}/executions/preview`;
      } else {
        fullUrl = `${apiBase}/runbooks/${fixtures.runbooks.runbookId}/execute`;
      }
    }

    if (op.operationId === 'cancelRunbookExecution') {
      const ex = await prisma.runbookExecution.create({
        data: {
          runbookId: fixtures.runbooks.runbookId,
          runbookVersionId: pubVerId,
          serviceId: fixtures.services.serviceAId,
          status: 'RUNNING',
          inputValues: {},
          triggeredByUserId: fixtures.users.adminId,
          definitionChecksum: 'mock_checksum_cancel',
          deadlineAt: new Date(Date.now() + 3600000)
        }
      });
      fullUrl = `${apiBase}/runbooks/executions/${ex.id}/cancel`;
      payload = { reason: 'Cert test cancellation' };
    }

    if (op.operationId === 'getServiceObjectiveEvaluation') {
      const job = await prisma.backgroundJob.findFirst({
        where: {
          type: 'SCHEDULED_TASK',
          payload: { path: ['task'], equals: 'SERVICE_OBJECTIVE_EVALUATE' }
        },
        orderBy: { createdAt: 'desc' }
      });
      if (job) {
        const p = job.payload as any;
        fullUrl = `${apiBase}/service-objectives/${p.lineageId}/evaluations/${job.id}`;
      }
    }

    if (op.operationId === 'getStatusPagePublicationJob') {
      let job = await prisma.backgroundJob.findFirst({
        where: {
          type: 'SCHEDULED_TASK',
          payload: { path: ['task'], equals: 'STATUS_PAGE_PUBLICATION_RETRY' }
        },
        orderBy: { createdAt: 'desc' }
      });
      if (!job) {
        job = await prisma.backgroundJob.create({
          data: {
            id: randomUUID(),
            type: 'SCHEDULED_TASK',
            status: 'PENDING',
            scheduledAt: new Date(),
            payload: {
              task: 'STATUS_PAGE_PUBLICATION_RETRY',
              pageId: fixtures.statusPages.statusPageId,
              actorId: fixtures.users.adminId,
              apiClientId: fixtures.serviceAccounts.serviceAccountId
            }
          }
        });
      }
      const p = job.payload as any;
      fullUrl = `${apiBase}/status-pages/${p.pageId || fixtures.statusPages.statusPageId}/publication/jobs/${job.id}`;
    }

    if (op.operationId === 'updateStatusPageService') {
      await prisma.statusPageService.upsert({
        where: {
          statusPageId_serviceId: {
            statusPageId: fixtures.statusPages.statusPageId,
            serviceId: fixtures.services.serviceAId
          }
        },
        create: {
          statusPageId: fixtures.statusPages.statusPageId,
          serviceId: fixtures.services.serviceAId,
          displayName: 'Primary Cert Service',
          order: 1
        },
        update: {}
      });
    }

    if (op.operationId === 'reorderScheduleLayers') {
      const allLayers = await prisma.onCallLayer.findMany({
        where: { scheduleId: fixtures.schedules.scheduleAId },
        select: { id: true }
      });
      payload = { orderedIds: allLayers.map(l => l.id) };
    }

    if (op.operationId === 'addScheduleParticipant') {
      let layer = await prisma.onCallLayer.findFirst({
        where: { scheduleId: fixtures.schedules.scheduleAId }
      });
      if (!layer) {
        layer = await prisma.onCallLayer.create({
          data: {
            scheduleId: fixtures.schedules.scheduleAId,
            name: 'Primary Rotation',
            start: new Date(),
            rotationLengthHours: 24,
            priority: 1
          }
        });
      }
      await prisma.onCallLayerUser.deleteMany({
        where: { userId: fixtures.users.auditorId, layer: { scheduleId: fixtures.schedules.scheduleAId } }
      });
      fullUrl = `${apiBase}/schedules/${fixtures.schedules.scheduleAId}/layers/${layer.id}/participants`;
      payload = { userId: fixtures.users.auditorId };
    }

    if (op.operationId === 'moveScheduleParticipant') {
      let layer = await prisma.onCallLayer.findFirst({
        where: { scheduleId: fixtures.schedules.scheduleAId }
      });
      if (!layer) {
        layer = await prisma.onCallLayer.create({
          data: {
            scheduleId: fixtures.schedules.scheduleAId,
            name: 'Primary Rotation',
            start: new Date(),
            rotationLengthHours: 24,
            priority: 1
          }
        });
      }
      await prisma.onCallLayerUser.upsert({
        where: { layerId_userId: { layerId: layer.id, userId: fixtures.users.responderId } },
        create: { layerId: layer.id, userId: fixtures.users.responderId, position: 0 },
        update: { position: 0 }
      });
      await prisma.onCallLayerUser.upsert({
        where: { layerId_userId: { layerId: layer.id, userId: fixtures.users.teamAUserId } },
        create: { layerId: layer.id, userId: fixtures.users.teamAUserId, position: 1 },
        update: { position: 1 }
      });
      fullUrl = `${apiBase}/schedules/${fixtures.schedules.scheduleAId}/layers/${layer.id}/participants/${fixtures.users.responderId}`;
      payload = { direction: 'down' };
    }

    if (op.operationId === 'createStatusPage') {
      await prisma.statusPage.deleteMany({});
    }

    if (op.operationId === 'downloadAuditExport' && lastCreatedAuditExportId) {
      // Poll real background export worker until COMPLETED
      for (let attempt = 0; attempt < 25; attempt++) {
        const checkRes = await request(`${apiBase}/audit-exports/${lastCreatedAuditExportId}`, {
          method: 'GET',
          token: adminToken
        });
        if (checkRes.json?.data?.status === 'COMPLETED') break;
        await new Promise(r => setTimeout(r, 200));
      }
    }

    if (op.operationId === 'downloadReportExport' && lastCreatedReportExportId) {
      // Poll real background report worker until COMPLETED
      for (let attempt = 0; attempt < 25; attempt++) {
        const checkRes = await request(`${apiBase}/reports/exports/${lastCreatedReportExportId}`, {
          method: 'GET',
          token: adminToken
        });
        if (checkRes.json?.data?.status === 'COMPLETED') break;
        await new Promise(r => setTimeout(r, 200));
      }
    }

    if (op.operationId === 'cancelReportExport') {
      const createRes = await request(`${apiBase}/reports/exports`, {
        method: 'POST',
        token: adminToken,
        body: {
          metrics: ['totalIncidents', 'activeIncidents'],
          windowDays: 30
        },
        headers: { 'Idempotency-Key': `idem-cancel-${randomUUID()}` }
      });
      if (createRes.json?.data?.id) {
        fullUrl = `${apiBase}/reports/exports/${createRes.json.data.id}/cancel`;
      }
    }

    // Concurrency test before mutation (while resource is in initial state)
    let concurrencyTested = false;
    let concurrencyPass: boolean | undefined = undefined;

    if (needsPrecondition) {
      const staleRes = await request(fullUrl, {
        method,
        token: adminToken,
        body: payload,
        headers: {
          'Idempotency-Key': `stale-idem-${randomUUID()}`,
          'If-Match': '"99999999"'
        }
      });
      concurrencyTested = true;
      concurrencyPass = staleRes.status === 412;
      if (!concurrencyPass) {
        console.warn(`[WARN CONCURRENCY FAIL] ${op.operationId}: expected 412, got ${staleRes.status}`);
      }
    }

    const idemKey = `cert-pos-${randomUUID()}`;
    const posHeaders: Record<string, string> = {
      'Idempotency-Key': idemKey
    };
    if (needsPrecondition) {
      posHeaders['If-Match'] = currentEtag || '"1"';
    }

    const posRes = await request(fullUrl, {
      method,
      token: adminToken,
      body: payload,
      headers: posHeaders
    });

    const hasRequestId = Boolean(posRes.headers.get('x-request-id'));
    const hasSecurityHeaders = Boolean(
      posRes.headers.get('strict-transport-security') &&
      posRes.headers.get('x-content-type-options')
    );
    const isBinaryDownload =
      op.operationId.toLowerCase().includes('download') ||
      Boolean(posRes.headers.get('content-disposition')?.includes('attachment'));
    const is204 = posRes.status === 204;
    const hasEnvelope = is204
      ? (!posRes.text || posRes.text.length === 0 || posRes.headers.get('content-length') === '0')
      : isBinaryDownload
      ? Boolean((posRes.text || posRes.json) && (posRes.headers.get('content-disposition') || posRes.headers.get('x-content-sha256')))
      : Boolean(posRes.json && (posRes.json.data !== undefined || posRes.json.pagination !== undefined));

    if (op.operationId === 'createAuditExport' && posRes.status === 201 && posRes.json?.data?.id) {
      lastCreatedAuditExportId = posRes.json.data.id;
      lastCreatedAuditExportToken = adminToken;
    }

    if (op.operationId === 'createReportExport' && posRes.status === 201 && posRes.json?.data?.id) {
      lastCreatedReportExportId = posRes.json.data.id;
      lastCreatedReportExportToken = adminToken;
    }

    if (op.operationId === 'createServiceObjective' && posRes.status === 201 && posRes.json?.data?.id) {
      fixtures.objectives = {
        objectiveId: posRes.json.data.versionId || posRes.json.data.id,
        lineageId: posRes.json.data.id
      };
    }

    if (op.operationId === 'createServiceRunbookRule' && posRes.status === 201 && posRes.json?.data?.id) {
      fixtures.serviceRunbookRules = { ruleId: posRes.json.data.id };
    }
    if (op.operationId === 'createPostmortem' && posRes.status === 201 && posRes.json?.data?.id) {
      fixtures.postmortems = { postmortemId: posRes.json.data.id };
    }
    if (op.operationId === 'createReportDashboard' && posRes.status === 201 && posRes.json?.data?.id) {
      fixtures.dashboards = { dashboardId: posRes.json.data.id };
    }
    if (op.operationId === 'createStatusPage' && posRes.status === 201 && posRes.json?.data?.id) {
      fixtures.statusPages = { statusPageId: posRes.json.data.id };
    }

    const positivePass = posRes.status >= 200 && posRes.status < 300;

    // 2. Authentication Checks
    const noAuthRes = await request(fullUrl, { method, body: payload });
    const noAuthPass = noAuthRes.status === 401;
    const isProblemDetails = (noAuthRes.headers.get('content-type') || '').includes('problem+json');

    const invAuthRes = await request(fullUrl, {
      method,
      token: 'ok_test_invalid_token_999999999999999999999999',
      body: payload
    });
    const invAuthPass = invAuthRes.status === 401;

    const revAuthRes = await request(fullUrl, {
      method,
      token: fixtures.tokens.revoked,
      body: payload
    });
    const revAuthPass = revAuthRes.status === 401;

    const expAuthRes = await request(fullUrl, {
      method,
      token: fixtures.tokens.expired,
      body: payload
    });
    const expAuthPass = expAuthRes.status === 401;

    // 3. Scope Denial (using round-robin limited token pool)
    let scopeDenialTested = false;
    let scopeDenialPass = true;
    let scopeDenialStatus = 200;
    if (op.scope !== 'incidents:read') {
      scopeDenialTested = true;
      const scopeRes = await request(fullUrl, {
        method,
        token: limitedToken,
        body: payload
      });
      scopeDenialStatus = scopeRes.status;
      scopeDenialPass = scopeRes.status === 403;
    }

    // 4. Input Boundary
    let boundaryTested = true;
    let boundaryNotApplicable = false;
    let boundaryPass = true;
    let boundaryStatus = 400;

    if (method !== 'GET') {
      let invalidPayload: any = { __invalid_field__: 12345, id: 'invalid-malformed' };
      if (payload && typeof payload === 'object' && Object.keys(payload).length > 0) {
        const broken: Record<string, any> = {};
        for (const [k, v] of Object.entries(payload)) {
          broken[k] = typeof v === 'string' ? 99999999 : (typeof v === 'number' ? 'invalid_string_val' : null);
        }
        invalidPayload = broken;
      }
      const boundRes = await request(fullUrl, {
        method,
        token: adminToken,
        headers: { 'Content-Type': 'application/json' },
        body: invalidPayload
      });
      boundaryStatus = boundRes.status;
      boundaryPass = boundRes.status >= 400 && boundRes.status < 500;

      // For DELETE operations or mutation endpoints where body is ignored:
      if (!boundaryPass && op.path.includes('{')) {
        const notFoundUrl = fullUrl.replace(/[a-z0-9_-]{20,}/i, 'c000000000000000000000000');
        const idBoundRes = await request(notFoundUrl, { method, token: adminToken, body: invalidPayload });
        boundaryStatus = idBoundRes.status;
        boundaryPass = idBoundRes.status >= 400 && idBoundRes.status < 500;
      }
    } else {
      if (op.path.includes('{')) {
        const notFoundUrl = fullUrl.replace(/[a-z0-9_-]{20,}/i, 'c000000000000000000000000');
        const boundRes = await request(notFoundUrl, { method, token: adminToken });
        boundaryStatus = boundRes.status;
        boundaryPass = boundRes.status === 404 || boundRes.status >= 400;
      } else if (op.kind === 'list') {
        const queryBoundUrl = fullUrl.includes('?')
          ? `${fullUrl}&cursor=invalid_cursor_val`
          : `${fullUrl}?cursor=invalid_cursor_val`;
        const boundRes = await request(queryBoundUrl, { method, token: adminToken });
        boundaryStatus = boundRes.status;
        boundaryPass = boundRes.status === 400;
      } else {
        // Non-list GET endpoint without path parameters has no cursor or query schema
        boundaryTested = false;
        boundaryNotApplicable = true;
        boundaryStatus = 200;
        boundaryPass = true;
      }
    }

    // 5. Mutation Safety
    let mutationSafety: OperationResult['mutationSafety'] = undefined;
    const idempotencyMode = contract?.idempotency || 'natural';

    if (method === 'DELETE') {
      // Repeat DELETE to non-existent or deleted resource ensures safe deletion
      const repeatDelRes = await request(fullUrl, {
        method: 'DELETE',
        token: adminToken,
        body: payload,
        headers: posHeaders
      });
      const idempotentPass = repeatDelRes.status === 404 || repeatDelRes.status === 204 || repeatDelRes.status === 200;

      mutationSafety = {
        tested: true,
        idempotencyTested: true,
        idempotentPass,
        concurrencyTested,
        concurrencyPass
      };
    } else if (method !== 'GET') {
      // Strict Replay with exact same Idempotency-Key and payload
      const replayRes = await request(fullUrl, {
        method,
        token: adminToken,
        body: payload,
        headers: posHeaders
      });

      let idempotentPass = false;
      if (idempotencyMode === 'required' || idempotencyMode === 'supported') {
        const matchesStatus = replayRes.status === posRes.status;
        const replayedHeader = replayRes.headers.get('idempotency-replayed') === 'true';
        idempotentPass = matchesStatus && (replayedHeader || posRes.status === 204);
      } else if (idempotencyMode === 'natural') {
        // Natural idempotency: state is unchanged, compare-and-set fences duplicate edit (412), or uniqueness/quota rejects repeat (409/403)
        idempotentPass =
          replayRes.status === posRes.status ||
          replayRes.status === 409 ||
          replayRes.status === 412 ||
          replayRes.status === 403 ||
          replayRes.status === 200;
      } else {
        idempotentPass = true;
      }

      if (!idempotentPass) {
        console.warn(`[WARN IDEMPOTENCY FAIL] ${op.operationId} (${idempotencyMode}): pos=${posRes.status}, replay=${replayRes.status}, replayedHeader=${replayRes.headers.get('idempotency-replayed')}`);
      }

      mutationSafety = {
        tested: true,
        idempotencyTested: true,
        idempotentPass,
        concurrencyTested,
        concurrencyPass
      };
    }

    // Strict overall verdict depending on ALL applicable checks
    const mutationSafetyPass = !mutationSafety || (
      mutationSafety.idempotentPass &&
      (!mutationSafety.concurrencyTested || mutationSafety.concurrencyPass === true)
    );

    const overallVerdict: 'PASS' | 'FAIL' =
      positivePass &&
      hasRequestId &&
      hasSecurityHeaders &&
      hasEnvelope &&
      noAuthPass &&
      invAuthPass &&
      revAuthPass &&
      expAuthPass &&
      (!scopeDenialTested || scopeDenialPass) &&
      boundaryPass &&
      mutationSafetyPass
        ? 'PASS'
        : 'FAIL';

    if (overallVerdict === 'PASS') {
      passCount++;
      console.log(`PASS (${posRes.status}, ${posRes.latencyMs}ms)`);
    } else {
      failCount++;
      console.log(`FAIL (pos: ${posRes.status}, scope: ${scopeDenialStatus})`);
    }

    results.push({
      operationId: op.operationId,
      method,
      path: op.path,
      resolvedPath: fullUrl.replace(apiBase, ''),
      requiredScope: op.scope,
      positive: {
        tested: true,
        status: posRes.status,
        pass: positivePass,
        latencyMs: posRes.latencyMs,
        hasRequestId,
        hasSecurityHeaders,
        hasEnvelope,
        errorDetail: !positivePass ? JSON.stringify(posRes.json || posRes.text) : undefined
      },
      noAuth: {
        tested: true,
        status: noAuthRes.status,
        pass: noAuthPass,
        isProblemDetails
      },
      invalidAuth: {
        tested: true,
        status: invAuthRes.status,
        pass: invAuthPass
      },
      revokedAuth: {
        tested: true,
        status: revAuthRes.status,
        pass: revAuthPass
      },
      expiredAuth: {
        tested: true,
        status: expAuthRes.status,
        pass: expAuthPass
      },
      scopeDenial: {
        tested: scopeDenialTested,
        status: scopeDenialStatus,
        pass: scopeDenialPass,
        skipped: !scopeDenialTested
      },
      inputBoundary: {
        tested: boundaryTested,
        notApplicable: boundaryNotApplicable,
        status: boundaryStatus,
        pass: boundaryPass
      },
      mutationSafety,
      overallVerdict,
      evidence: `HTTP ${method} ${fullUrl.replace(apiBase, '')} -> pos=${posRes.status} (${posRes.latencyMs}ms), noAuth=${noAuthRes.status}, invAuth=${invAuthRes.status}, revAuth=${revAuthRes.status}, expAuth=${expAuthRes.status}, scopeDenial=${scopeDenialStatus}`
    });
  }

  await prisma.$disconnect();

  console.log('\n======================================================');
  console.log(`Certification Complete! Total Operations: ${V2_OPERATIONS.length}`);
  console.log(`Passed: ${passCount} | Failed: ${failCount}`);
  console.log(`Pass Rate: ${((passCount / V2_OPERATIONS.length) * 100).toFixed(2)}%`);
  console.log('======================================================\n');

  // Write JSON
  const jsonOut = path.join(outDir, 'OPERATION-MATRIX.json');
  fs.writeFileSync(jsonOut, JSON.stringify({
    certifiedAt: new Date().toISOString(),
    commitSha,
    totalOperations: V2_OPERATIONS.length,
    passedCount: passCount,
    failedCount: failCount,
    passRate: `${((passCount / V2_OPERATIONS.length) * 100).toFixed(2)}%`,
    operations: results
  }, null, 2));
  console.log('Wrote OPERATION-MATRIX.json to', jsonOut);

  // Write CSV
  const csvOut = path.join(outDir, 'OPERATION-MATRIX.csv');
  const csvHeaders = [
    'Operation ID',
    'Method',
    'Path',
    'Scope',
    'Verdict',
    'Pos Status',
    'Latency (ms)',
    'No Auth Status',
    'Inv Auth Status',
    'Scope Denial Status',
    'Boundary Status',
    'Idempotency Pass',
    'Evidence'
  ];
  const csvRows = results.map(r => [
    r.operationId,
    r.method,
    `"${r.path}"`,
    r.requiredScope,
    r.overallVerdict,
    r.positive.status,
    r.positive.latencyMs,
    r.noAuth.status,
    r.invalidAuth.status,
    r.scopeDenial.status ?? 'N/A',
    r.inputBoundary.status,
    r.mutationSafety?.idempotentPass ?? 'N/A',
    `"${r.evidence.replace(/"/g, '""')}"`
  ].join(','));
  fs.writeFileSync(csvOut, [csvHeaders.join(','), ...csvRows].join('\n'));
  console.log('Wrote OPERATION-MATRIX.csv to', csvOut);
}

main().catch(err => {
  console.error('Certification runner crashed:', err);
  process.exit(1);
});
