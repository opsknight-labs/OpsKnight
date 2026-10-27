/**
 * Canonical REST v2 operation registry.
 *
 * One row per operation: its stable operationId (SDK method name), the API scope
 * that authorises it, and the shape of the `data` it returns. The OpenAPI document
 * is finalised from this table (see openapi-finalize.ts), and
 * tests/unit/api-v2-openapi-conformance.test.ts verifies the table against the route
 * handlers (scope, existence) so the contract cannot drift from the implementation.
 */
export type OperationResultKind = 'item' | 'list' | 'none' | 'binary';

export interface V2OperationDefinition {
  method: 'get' | 'post' | 'patch' | 'put' | 'delete';
  path: string;
  operationId: string;
  scope: string;
  kind: OperationResultKind;
  /** Name of the component schema describing one `data` item. Empty when kind is 'none'. */
  schema: string;
}

const op = (
  method: V2OperationDefinition['method'],
  path: string,
  operationId: string,
  scope: string,
  kind: OperationResultKind,
  schema: string
): V2OperationDefinition => ({ method, path, operationId, scope, kind, schema });

export const V2_OPERATIONS: readonly V2OperationDefinition[] = [
  op('get', '/settings/chatops', 'getChatOpsConfiguration', 'chatops:read', 'item', 'ChatOpsConfiguration'),
  op('put', '/settings/chatops', 'updateChatOpsConfiguration', 'chatops:write', 'item', 'ChatOpsConfiguration'),
  op('get', '/custom-fields', 'listCustomFieldDefinitions', 'custom-fields:read', 'item', 'CustomFieldDefinitionCollection'),
  op('post', '/custom-fields', 'createCustomFieldDefinition', 'custom-fields:write', 'item', 'CustomFieldDefinition'),
  op('get', '/custom-fields/{id}', 'getCustomFieldDefinition', 'custom-fields:read', 'item', 'CustomFieldDefinition'),
  op('patch', '/custom-fields/{id}', 'updateCustomFieldDefinition', 'custom-fields:write', 'item', 'CustomFieldDefinition'),
  op('delete', '/custom-fields/{id}', 'deleteCustomFieldDefinition', 'custom-fields:write', 'none', ''),
  op('post', '/audit-exports', 'createAuditExport', 'audit:export', 'item', 'AuditExport'),
  op('get', '/audit-exports/{id}', 'getAuditExport', 'audit:export', 'item', 'AuditExport'),
  op('get', '/audit-exports/{id}/download', 'downloadAuditExport', 'audit:export', 'binary', ''),
  op(
    'get',
    '/notification-providers',
    'listNotificationProviders',
    'notification-providers:read',
    'list',
    'NotificationProvider'
  ),
  op(
    'get',
    '/notification-providers/{provider}',
    'getNotificationProvider',
    'notification-providers:read',
    'item',
    'NotificationProvider'
  ),
  op(
    'put',
    '/notification-providers/{provider}',
    'configureNotificationProvider',
    'notification-providers:write',
    'item',
    'NotificationProvider'
  ),
  op(
    'get',
    '/notification-providers/{provider}/diagnostics',
    'getNotificationProviderDiagnostics',
    'notification-providers:read',
    'item',
    'NotificationProviderDiagnostics'
  ),
  op(
    'post',
    '/notification-providers/{provider}/test',
    'testNotificationProvider',
    'notification-providers:test',
    'item',
    'NotificationProviderTest'
  ),
  op(
    'post',
    '/notification-providers/web-push/rotate',
    'rotateWebPushKeys',
    'notification-providers:write',
    'item',
    'WebPushRotation'
  ),
  op(
    'get',
    '/users/me/notification-preferences',
    'getMyNotificationPreferences',
    'notification-preferences:read',
    'item',
    'UserNotificationPreferences'
  ),
  op(
    'patch',
    '/users/me/notification-preferences',
    'updateMyNotificationPreferences',
    'notification-preferences:write',
    'item',
    'UserNotificationPreferences'
  ),
  op('get', '/teams/{id}/activity', 'listTeamActivity', 'teams:read', 'list', 'TeamActivity'),
  op('get', '/teams/{id}/services', 'listTeamServices', 'teams:read', 'list', 'TeamManagedService'),
  op(
    'put',
    '/teams/{id}/services/{serviceId}',
    'assignTeamService',
    'teams:write',
    'item',
    'TeamManagedService'
  ),
  op('get', '/teams/{id}/members', 'listTeamMembers', 'teams:read', 'list', 'TeamMembership'),
  op(
    'put',
    '/teams/{id}/members/{userId}',
    'setTeamMember',
    'teams:write',
    'item',
    'TeamMembershipChange'
  ),
  op(
    'delete',
    '/teams/{id}/members/{userId}',
    'removeTeamMember',
    'teams:write',
    'item',
    'TeamMembershipChange'
  ),
  op(
    'get',
    '/users/invitation-policy',
    'getUserInvitationPolicy',
    'users:read',
    'item',
    'UserInvitationPolicy'
  ),
  op('post', '/users/invitations', 'createUserInvitation', 'users:write', 'item', 'UserInvitation'),
  op(
    'get',
    '/users/{id}/invitation',
    'getUserInvitation',
    'users:read',
    'item',
    'UserInvitationState'
  ),
  op(
    'post',
    '/users/{id}/invitation',
    'renewUserInvitation',
    'users:write',
    'item',
    'UserInvitation'
  ),
  op(
    'get',
    '/users/{id}/administration',
    'getUserAdministration',
    'users:read',
    'item',
    'UserAdministration'
  ),
  op(
    'get',
    '/users/{id}/dependencies',
    'getUserDependencies',
    'users:read',
    'item',
    'UserDependencies'
  ),
  op(
    'patch',
    '/users/{id}/administration',
    'administerUser',
    'users:write',
    'item',
    'UserAdministration'
  ),
  op('get', '/teams/{id}/lead', 'getTeamLead', 'teams:read', 'item', 'TeamLead'),
  op('put', '/teams/{id}/lead', 'setTeamLead', 'teams:write', 'item', 'TeamLeadChange'),
  op(
    'get',
    '/runbooks/signing-identities',
    'listRunbookSigningIdentities',
    'runbook-signing:read',
    'list',
    'RunbookSigningIdentity'
  ),
  op(
    'post',
    '/runbooks/signing-identities',
    'stageRunbookSigningIdentity',
    'runbook-signing:write',
    'item',
    'RunbookSigningIdentity'
  ),
  op(
    'post',
    '/runbooks/signing-identities/{id}/activate',
    'activateRunbookSigningIdentity',
    'runbook-signing:write',
    'item',
    'RunbookSigningIdentity'
  ),
  op(
    'post',
    '/runbooks/signing-identities/{id}/retire',
    'retireRunbookSigningIdentity',
    'runbook-signing:write',
    'item',
    'RunbookSigningIdentity'
  ),

  op(
    'get',
    '/runbooks/secrets/{id}/usage',
    'listRunbookSecretUsage',
    'runbook-secrets:read',
    'list',
    'RunbookSecretUsage'
  ),
  op(
    'post',
    '/runbooks/agent-pools/{id}/retire',
    'retireRunbookAgentPool',
    'runbook-agent-pools:write',
    'item',
    'RunbookAgentPool'
  ),
  op(
    'get',
    '/runbooks/agent-pools',
    'listRunbookAgentPools',
    'runbook-agents:read',
    'list',
    'RunbookAgentPool'
  ),
  op(
    'post',
    '/runbooks/agent-pools',
    'createRunbookAgentPool',
    'runbook-agent-pools:write',
    'item',
    'RunbookAgentPool'
  ),
  op(
    'get',
    '/runbooks/agent-pools/{id}',
    'getRunbookAgentPool',
    'runbook-agents:read',
    'item',
    'RunbookAgentPool'
  ),
  op(
    'patch',
    '/runbooks/agent-pools/{id}',
    'updateRunbookAgentPool',
    'runbook-agent-pools:write',
    'item',
    'RunbookAgentPool'
  ),
  op(
    'delete',
    '/runbooks/agent-pools/{id}',
    'deleteRunbookAgentPool',
    'runbook-agent-pools:write',
    'none',
    ''
  ),
  op(
    'get',
    '/runbooks/agent-pools/{id}/deletion-check',
    'checkRunbookAgentPoolDeletion',
    'runbook-agents:read',
    'item',
    'RunbookAgentPoolDeletionCheck'
  ),
  op(
    'get',
    '/runbooks/agent-pools/{id}/members',
    'listRunbookAgentPoolMembers',
    'runbook-agents:read',
    'list',
    'RunbookAgentPoolMember'
  ),
  op(
    'put',
    '/runbooks/agent-pools/{id}/members/{agentId}',
    'setRunbookAgentPoolMember',
    'runbook-agent-pools:write',
    'item',
    'RunbookAgentPoolMembership'
  ),
  op(
    'delete',
    '/runbooks/agent-pools/{id}/members/{agentId}',
    'removeRunbookAgentPoolMember',
    'runbook-agent-pools:write',
    'item',
    'RunbookAgentPoolMembership'
  ),
  op(
    'get',
    '/runbooks/agents/{id}/configuration',
    'getRunbookAgentConfiguration',
    'runbook-agents:read',
    'item',
    'RunbookAgentConfiguration'
  ),
  op(
    'patch',
    '/runbooks/agents/{id}/configuration',
    'updateRunbookAgentConfiguration',
    'runbook-agents:write',
    'item',
    'RunbookAgentConfiguration'
  ),
  op(
    'get',
    '/runbooks/secrets',
    'listRunbookSecrets',
    'runbook-secrets:read',
    'list',
    'RunbookSecretMetadata'
  ),
  op(
    'post',
    '/runbooks/secrets',
    'createRunbookSecret',
    'runbook-secrets:write',
    'item',
    'RunbookSecretMetadata'
  ),
  op(
    'get',
    '/runbooks/secrets/{id}',
    'getRunbookSecret',
    'runbook-secrets:read',
    'item',
    'RunbookSecretMetadata'
  ),
  op(
    'post',
    '/runbooks/secrets/{id}/rotate',
    'rotateRunbookSecret',
    'runbook-secrets:write',
    'item',
    'RunbookSecretMetadata'
  ),
  op(
    'get',
    '/runbooks/secrets/{id}/grants',
    'listRunbookSecretGrants',
    'runbook-secrets:read',
    'list',
    'RunbookSecretGrant'
  ),
  op(
    'post',
    '/runbooks/secrets/{id}/grants',
    'grantRunbookSecret',
    'runbook-secrets:grant',
    'item',
    'RunbookSecretGrant'
  ),
  op(
    'delete',
    '/runbooks/secrets/{id}/grants/{grantId}',
    'revokeRunbookSecretGrant',
    'runbook-secrets:grant',
    'none',
    ''
  ),
  op(
    'get',
    '/settings/runbooks',
    'getRunbookSettings',
    'runbook-settings:read',
    'item',
    'RunbookSettings'
  ),
  op(
    'patch',
    '/settings/runbooks',
    'updateRunbookSettings',
    'runbook-settings:write',
    'item',
    'RunbookSettings'
  ),

  op('get', '/runbooks/agents', 'listRunbookAgents', 'runbook-agents:read', 'list', 'RunbookAgent'),
  op(
    'get',
    '/runbooks/agents/{id}',
    'getRunbookAgent',
    'runbook-agents:read',
    'item',
    'RunbookAgent'
  ),
  op(
    'get',
    '/runbooks/agents/{id}/policy-status',
    'getRunbookAgentPolicyStatus',
    'runbook-agents:read',
    'item',
    'RunbookAgentPolicyStatus'
  ),
  op(
    'post',
    '/runbooks/agent-enrollments',
    'createRunbookAgentEnrollment',
    'runbook-agents:enroll',
    'item',
    'RunbookAgentEnrollment'
  ),
  op(
    'get',
    '/runbooks/agent-enrollments/{id}',
    'getRunbookAgentEnrollment',
    'runbook-agents:read',
    'item',
    'RunbookAgentEnrollmentStatus'
  ),
  op(
    'post',
    '/runbooks/agents/{id}/revoke',
    'revokeRunbookAgent',
    'runbook-agents:revoke',
    'item',
    'RunbookAgentRevocation'
  ),

  op(
    'get',
    '/runbooks/executions/{id}/steps',
    'listRunbookExecutionSteps',
    'runbooks:read',
    'list',
    'RunbookExecutionStepSummary'
  ),
  op('get', '/runbooks/executions', 'listRunbookExecutions', 'runbooks:read', 'list', 'RunbookExecutionSummary'),
  op(
    'get',
    '/runbooks/executions/{id}/evidence',
    'listRunbookExecutionEvidence',
    'runbooks:read',
    'list',
    'RunbookExecutionEvidence'
  ),
  op(
    'get',
    '/runbooks/executions/{id}/events',
    'listRunbookExecutionEvents',
    'runbooks:read',
    'list',
    'RunbookExecutionEvent'
  ),
  op(
    'post',
    '/runbooks/executions/{id}/steps/{stepId}/approve',
    'approveRunbookExecutionStep',
    'runbooks:approve',
    'item',
    'RunbookIntervention'
  ),
  op(
    'post',
    '/runbooks/executions/{id}/steps/{stepId}/reject',
    'rejectRunbookExecutionStep',
    'runbooks:approve',
    'item',
    'RunbookIntervention'
  ),
  op(
    'post',
    '/runbooks/executions/{id}/rerun-preview',
    'previewRunbookExecutionRerun',
    'runbooks:execute',
    'item',
    'RunbookExecutionPreview'
  ),
  op(
    'post',
    '/runbooks/executions/{id}/rerun',
    'rerunRunbookExecution',
    'runbooks:execute',
    'item',
    'RunbookRerun'
  ),
  op(
    'get',
    '/service-objectives/catalog',
    'getServiceObjectiveCatalog',
    'service-objectives:read',
    'item',
    'ServiceObjectiveCatalog'
  ),
  op(
    'get',
    '/service-objectives',
    'listServiceObjectives',
    'service-objectives:read',
    'list',
    'ServiceObjective'
  ),
  op(
    'post',
    '/service-objectives',
    'createServiceObjective',
    'service-objectives:write',
    'item',
    'ServiceObjective'
  ),
  op(
    'get',
    '/service-objectives/{id}',
    'getServiceObjective',
    'service-objectives:read',
    'item',
    'ServiceObjective'
  ),
  op(
    'patch',
    '/service-objectives/{id}',
    'updateServiceObjective',
    'service-objectives:write',
    'item',
    'ServiceObjective'
  ),
  op(
    'post',
    '/service-objectives/{id}/archive',
    'archiveServiceObjective',
    'service-objectives:write',
    'item',
    'ServiceObjective'
  ),
  op(
    'get',
    '/service-objectives/{id}/versions',
    'listServiceObjectiveVersions',
    'service-objectives:read',
    'list',
    'ServiceObjective'
  ),
  op(
    'get',
    '/service-objectives/{id}/snapshots',
    'listServiceObjectiveSnapshots',
    'service-objectives:read',
    'list',
    'ServiceObjectiveSnapshot'
  ),
  op(
    'get',
    '/service-objectives/{id}/history',
    'getServiceObjectiveHistory',
    'service-objectives:read',
    'list',
    'ServiceObjectiveHistoryItem'
  ),
  op(
    'post',
    '/service-objectives/{id}/evaluate',
    'evaluateServiceObjective',
    'service-objectives:evaluate',
    'item',
    'ServiceObjectiveEvaluationJob'
  ),
  op(
    'get',
    '/service-objectives/{id}/evaluations/{evaluationId}',
    'getServiceObjectiveEvaluation',
    'service-objectives:read',
    'item',
    'ServiceObjectiveEvaluationJob'
  ),
  op(
    'get',
    '/status-pages/{id}/publication',
    'getStatusPagePublication',
    'status-pages:read',
    'item',
    'StatusPagePublication'
  ),
  op(
    'post',
    '/status-pages/{id}/publication/retry',
    'retryStatusPagePublication',
    'status-pages:write',
    'item',
    'StatusPagePublicationJob'
  ),
  op(
    'get',
    '/status-pages/{id}/publication/jobs/{jobId}',
    'getStatusPagePublicationJob',
    'status-pages:read',
    'item',
    'StatusPagePublicationJob'
  ),
  op(
    'get',
    '/status-pages/{id}/services',
    'listStatusPageServices',
    'status-pages:read',
    'list',
    'StatusPageService'
  ),
  op(
    'put',
    '/status-pages/{id}/services',
    'setStatusPageServices',
    'status-pages:write',
    'item',
    'StatusPageConfigurationResult'
  ),
  op(
    'patch',
    '/status-pages/{id}/services/{serviceId}',
    'updateStatusPageService',
    'status-pages:write',
    'item',
    'StatusPageConfigurationResult'
  ),
  op(
    'get',
    '/status-pages/{id}/appearance',
    'getStatusPageAppearance',
    'status-pages:read',
    'item',
    'StatusPageAppearance'
  ),
  op(
    'patch',
    '/status-pages/{id}/appearance',
    'updateStatusPageAppearance',
    'status-pages:write',
    'item',
    'StatusPageConfigurationResult'
  ),
  op(
    'get',
    '/status-pages/{id}/privacy',
    'getStatusPagePrivacy',
    'status-pages:read',
    'item',
    'StatusPagePrivacy'
  ),
  op(
    'patch',
    '/status-pages/{id}/privacy',
    'updateStatusPagePrivacy',
    'status-pages:write',
    'item',
    'StatusPageConfigurationResult'
  ),
  op(
    'get',
    '/status-pages/{id}/content',
    'getStatusPageContent',
    'status-pages:read',
    'item',
    'StatusPageContent'
  ),
  op(
    'patch',
    '/status-pages/{id}/content',
    'updateStatusPageContent',
    'status-pages:write',
    'item',
    'StatusPageConfigurationResult'
  ),
  op(
    'get',
    '/status-pages/{id}/settings',
    'getStatusPageSettings',
    'status-pages:read',
    'item',
    'StatusPageSettings'
  ),
  op('post', '/status-pages/{id}/assets', 'uploadStatusPageAsset', 'status-pages:write', 'item', 'StatusPageAssetUpload'),
  op('get', '/status-pages/{id}/assets', 'listStatusPageAssets', 'status-pages:read', 'item', 'StatusPageAssetCollection'),
  op('delete', '/status-pages/{id}/assets/{assetId}', 'deleteStatusPageAsset', 'status-pages:write', 'none', ''),
  op(
    'patch',
    '/status-pages/{id}/settings',
    'updateStatusPageSettings',
    'status-pages:write',
    'item',
    'StatusPageConfigurationResult'
  ),
  op(
    'get',
    '/status-pages/{id}/subscribers',
    'listStatusPageSubscribers',
    'status-page-subscribers:read',
    'list',
    'StatusPageSubscriber'
  ),
  op(
    'get',
    '/status-pages/{id}/subscribers/{subscriberId}',
    'getStatusPageSubscriber',
    'status-page-subscribers:read',
    'item',
    'StatusPageSubscriber'
  ),
  op(
    'delete',
    '/status-pages/{id}/subscribers/{subscriberId}',
    'removeStatusPageSubscriber',
    'status-page-subscribers:write',
    'none',
    ''
  ),
  op(
    'get',
    '/status-pages/{id}/subscriber-stats',
    'getStatusPageSubscriberStats',
    'status-page-subscribers:read',
    'item',
    'StatusPageSubscriberStats'
  ),
  op(
    'get',
    '/status-pages/{id}/subscription-settings',
    'getStatusPageSubscriptionSettings',
    'status-pages:read',
    'item',
    'StatusPageSubscriptionSettings'
  ),
  op(
    'get',
    '/services/{id}/runbook-rules',
    'listServiceRunbookRules',
    'runbook-rules:read',
    'list',
    'ServiceRunbookRuleSummary'
  ),
  op(
    'post',
    '/services/{id}/runbook-rules',
    'createServiceRunbookRule',
    'runbook-rules:write',
    'item',
    'ServiceRunbookRule'
  ),
  op(
    'get',
    '/services/{id}/runbook-rules/{ruleId}',
    'getServiceRunbookRule',
    'runbook-rules:read',
    'item',
    'ServiceRunbookRule'
  ),
  op(
    'patch',
    '/services/{id}/runbook-rules/{ruleId}',
    'updateServiceRunbookRule',
    'runbook-rules:write',
    'item',
    'ServiceRunbookRule'
  ),
  op(
    'delete',
    '/services/{id}/runbook-rules/{ruleId}',
    'detachServiceRunbookRule',
    'runbook-rules:write',
    'none',
    ''
  ),
  op(
    'post',
    '/services/{id}/runbook-rules/{ruleId}/validate',
    'validateServiceRunbookRule',
    'runbook-rules:read',
    'item',
    'RunbookRuleReadiness'
  ),
  op(
    'get',
    '/services/{id}/runbook-rules/{ruleId}/policy-checks',
    'listRunbookRulePolicyChecks',
    'runbook-rules:read',
    'list',
    'RunbookRulePolicyCheck'
  ),
  op(
    'post',
    '/services/{id}/runbook-rules/{ruleId}/policy-checks',
    'requestRunbookRulePolicyChecks',
    'runbook-rules:activate',
    'item',
    'RunbookRulePolicyRequest'
  ),
  op(
    'post',
    '/services/{id}/runbook-rules/{ruleId}/activate',
    'activateServiceRunbookRule',
    'runbook-rules:activate',
    'item',
    'ServiceRunbookRule'
  ),
  op(
    'post',
    '/services/{id}/runbook-rules/{ruleId}/pause',
    'pauseServiceRunbookRule',
    'runbook-rules:write',
    'item',
    'ServiceRunbookRule'
  ),
  op(
    'post',
    '/services/{id}/runbook-rules/{ruleId}/duplicate',
    'duplicateServiceRunbookRule',
    'runbook-rules:write',
    'item',
    'ServiceRunbookRule'
  ),
  op(
    'put',
    '/services/{id}/runbook-rules/{ruleId}/triggers',
    'replaceRunbookRuleTriggers',
    'runbook-rules:write',
    'item',
    'ServiceRunbookRule'
  ),

  op(
    'get',
    '/runbooks/{id}/versions/{versionId}/diff',
    'compareRunbookVersions',
    'runbooks:write',
    'item',
    'RunbookVersionDiff'
  ),
  op(
    'get',
    '/runbooks/{id}/metadata',
    'getRunbookMetadata',
    'runbooks:write',
    'item',
    'RunbookMetadata'
  ),
  op(
    'patch',
    '/runbooks/{id}',
    'updateRunbookMetadata',
    'runbooks:write',
    'item',
    'RunbookMetadata'
  ),
  op(
    'post',
    '/runbooks/{id}/archive',
    'archiveRunbook',
    'runbooks:write',
    'item',
    'RunbookMetadata'
  ),
  op(
    'post',
    '/runbooks/{id}/restore',
    'restoreRunbook',
    'runbooks:write',
    'item',
    'RunbookMetadata'
  ),
  op(
    'get',
    '/runbooks/{id}/delete-check',
    'checkRunbookDeletion',
    'runbooks:write',
    'item',
    'RunbookDeleteEligibility'
  ),
  op('delete', '/runbooks/{id}', 'deleteRunbook', 'runbooks:write', 'none', ''),
  op(
    'post',
    '/runbooks/{id}/duplicate',
    'duplicateRunbook',
    'runbooks:write',
    'item',
    'RunbookMetadata'
  ),

  op(
    'post',
    '/services/{id}/automation/validate',
    'validateAutomation',
    'automation:read',
    'item',
    'AutomationValidation'
  ),
  op(
    'post',
    '/services/{id}/automation/simulate',
    'simulateAutomation',
    'automation:read',
    'item',
    'AutomationSimulation'
  ),
  op(
    'post',
    '/services/{id}/automation/restore',
    'restoreAutomationDraft',
    'automation:write',
    'item',
    'AutomationDraft'
  ),
  op(
    'get',
    '/services/{id}/automation/decisions',
    'listAutomationDecisions',
    'automation:read',
    'list',
    'AutomationDecision'
  ),
  op(
    'get',
    '/services/{id}/automation/observations',
    'listAutomationObservations',
    'automation:read',
    'list',
    'AutomationObservation'
  ),

  op(
    'get',
    '/services/{id}/automation/versions',
    'listAutomationVersions',
    'automation:read',
    'list',
    'AutomationVersionSummary'
  ),
  op(
    'get',
    '/services/{id}/automation/versions/{versionId}',
    'getAutomationVersion',
    'automation:read',
    'item',
    'AutomationVersionDetail'
  ),
  op(
    'get',
    '/services/{id}/automation',
    'getServiceAutomation',
    'automation:read',
    'item',
    'AutomationConfiguration'
  ),
  op(
    'patch',
    '/services/{id}/automation/mode',
    'updateServiceAutomationMode',
    'automation:publish',
    'item',
    'AutomationConfiguration'
  ),
  op(
    'post',
    '/services/{id}/automation/publish',
    'publishAutomationVersion',
    'automation:publish',
    'item',
    'AutomationPublishedVersion'
  ),
  op(
    'get',
    '/services/{id}/automation/draft',
    'getAutomationDraft',
    'automation:read',
    'item',
    'AutomationDraft'
  ),
  op(
    'put',
    '/services/{id}/automation/draft',
    'saveAutomationDraft',
    'automation:write',
    'item',
    'AutomationDraft'
  ),
  op(
    'get',
    '/services/{id}/automation/candidate',
    'getAutomationCandidate',
    'automation:read',
    'item',
    'AutomationCandidateVersion'
  ),
  op(
    'delete',
    '/services/{id}/automation/candidate',
    'discardAutomationCandidate',
    'automation:publish',
    'item',
    'AutomationConfig'
  ),
  op(
    'post',
    '/services/{id}/automation/candidates/activate',
    'activateAutomationCandidate',
    'automation:publish',
    'item',
    'AutomationConfig'
  ),
  op(
    'get',
    '/settings/automation',
    'getAutomationSettings',
    'automation-settings:read',
    'item',
    'AutomationSettings'
  ),
  op(
    'patch',
    '/settings/automation',
    'updateAutomationSettings',
    'automation-settings:write',
    'item',
    'AutomationSettings'
  ),
  op(
    'get',
    '/incidents/{id}/watchers',
    'listIncidentWatchers',
    'incidents:read',
    'list',
    'IncidentWatcher'
  ),
  op('get', '/incidents/{id}/tags', 'listIncidentTags', 'incidents:read', 'list', 'IncidentTag'),
  op('get', '/incidents/{id}/custom-fields', 'listIncidentCustomFields', 'incidents:read', 'list', 'IncidentCustomField'),
  op('get', '/incidents/templates', 'listIncidentTemplates', 'incidents:read', 'list', 'IncidentTemplate'),
  op('post', '/incidents/templates', 'createIncidentTemplate', 'incidents:write', 'item', 'IncidentTemplate'),
  op('get', '/incidents/templates/{templateId}', 'getIncidentTemplate', 'incidents:read', 'item', 'IncidentTemplate'),
  op('patch', '/incidents/templates/{templateId}', 'updateIncidentTemplate', 'incidents:write', 'item', 'IncidentTemplate'),
  op('delete', '/incidents/templates/{templateId}', 'deleteIncidentTemplate', 'incidents:write', 'item', 'IncidentTemplateDeletion'),
  op('get', '/incidents/{id}/custom-fields/{fieldId}', 'getIncidentCustomField', 'incidents:read', 'item', 'IncidentCustomField'),
  op('put', '/incidents/{id}/custom-fields/{fieldId}', 'setIncidentCustomField', 'incidents:write', 'item', 'IncidentCustomField'),
  op('post', '/incidents/{id}/tags', 'addIncidentTag', 'incidents:write', 'item', 'IncidentTagAdded'),
  op('delete', '/incidents/{id}/tags/{tagId}', 'removeIncidentTag', 'incidents:write', 'item', 'IncidentTagRemoved'),
  op('get', '/incidents/{id}/routing-decision', 'getIncidentRoutingDecision', 'automation:read', 'item', 'AutomationDecision'),
  op(
    'post',
    '/incidents/{id}/watchers',
    'setIncidentWatcher',
    'incidents:write',
    'item',
    'IncidentWatcher'
  ),
  op(
    'delete',
    '/incidents/{id}/watchers/{watcherId}',
    'removeIncidentWatcher',
    'incidents:write',
    'item',
    'IncidentWatcherRemoved'
  ),
  op(
    'post',
    '/runbooks/{id}/executions/preview',
    'previewRunbookExecution',
    'runbooks:execute',
    'item',
    'RunbookExecutionPreview'
  ),
  op(
    'post',
    '/runbooks/executions/{id}/cancel',
    'cancelRunbookExecution',
    'runbooks:execute',
    'item',
    'RunbookCancellationRequested'
  ),
  op(
    'post',
    '/schedules/{id}/layers/{layerId}/participants',
    'addScheduleParticipant',
    'schedules:write',
    'item',
    'ScheduleParticipantMutation'
  ),
  op(
    'patch',
    '/schedules/{id}/layers/{layerId}/participants/{userId}',
    'moveScheduleParticipant',
    'schedules:write',
    'item',
    'ScheduleParticipantMutation'
  ),
  op(
    'delete',
    '/schedules/{id}/layers/{layerId}/participants/{userId}',
    'removeScheduleParticipant',
    'schedules:write',
    'item',
    'ScheduleParticipantMutation'
  ),
  op(
    'post',
    '/incidents/{id}/unsuppress',
    'unsuppressIncident',
    'incidents:write',
    'item',
    'IncidentLifecycleResult'
  ),
  op(
    'post',
    '/incidents/{id}/suppress',
    'suppressIncident',
    'incidents:write',
    'item',
    'IncidentLifecycleResult'
  ),
  op(
    'post',
    '/incidents/{id}/unsnooze',
    'unsnoozeIncident',
    'incidents:write',
    'item',
    'IncidentLifecycleResult'
  ),
  op(
    'post',
    '/incidents/{id}/snooze',
    'snoozeIncident',
    'incidents:write',
    'item',
    'IncidentLifecycleResult'
  ),
  op(
    'post',
    '/incidents/{id}/unacknowledge',
    'unacknowledgeIncident',
    'incidents:write',
    'item',
    'IncidentLifecycleResult'
  ),
  op(
    'post',
    '/incidents/{id}/reopen',
    'reopenIncident',
    'incidents:write',
    'item',
    'IncidentLifecycleResult'
  ),
  op('post', '/runbooks', 'createRunbook', 'runbooks:write', 'item', 'RunbookCreated'),
  op(
    'get',
    '/runbooks/{id}/versions',
    'listRunbookVersions',
    'runbooks:write',
    'list',
    'RunbookAuthoringVersion'
  ),
  op(
    'post',
    '/runbooks/{id}/drafts',
    'createRunbookDraft',
    'runbooks:write',
    'item',
    'RunbookAuthoringVersion'
  ),
  op(
    'get',
    '/runbooks/{id}/drafts/{versionId}',
    'getRunbookDraft',
    'runbooks:write',
    'item',
    'RunbookDraftRead'
  ),
  op(
    'patch',
    '/runbooks/{id}/drafts/{versionId}',
    'updateRunbookDraft',
    'runbooks:write',
    'item',
    'RunbookAuthoringVersion'
  ),
  op(
    'post',
    '/runbooks/{id}/drafts/{versionId}/validate',
    'validateRunbookDraft',
    'runbooks:write',
    'item',
    'RunbookDraftValidation'
  ),
  op(
    'post',
    '/runbooks/{id}/drafts/{versionId}/publish',
    'publishRunbookDraft',
    'runbooks:publish',
    'item',
    'RunbookAuthoringVersion'
  ),
  op('get', '/audit-logs', 'listAuditLogs', 'audit:read', 'list', 'AuditLog'),
  op(
    'get',
    '/escalation-policies/{id}',
    'getEscalationPolicy',
    'escalation-policies:read',
    'item',
    'EscalationPolicy'
  ),
  op('get', '/escalation-policies/{id}/dependencies', 'getEscalationPolicyDependencies', 'escalation-policies:read', 'item', 'EscalationPolicyDependencies'),
  op('get', '/escalation-policies/{id}/validation', 'validateEscalationPolicy', 'escalation-policies:read', 'item', 'EscalationPolicyValidation'),
  op('get', '/status-pages/{id}/preview', 'previewStatusPage', 'status-pages:read', 'item', 'StatusPagePreview'),
  op('get', '/schedules/{id}/layers', 'listScheduleLayers', 'schedules:read', 'item', 'ScheduleLayerCollection'),
  op('post', '/schedules/{id}/layers', 'createScheduleLayer', 'schedules:write', 'item', 'ScheduleLayer'),
  op('get', '/schedules/{id}/layers/{layerId}', 'getScheduleLayer', 'schedules:read', 'item', 'ScheduleLayer'),
  op('patch', '/schedules/{id}/layers/{layerId}', 'updateScheduleLayer', 'schedules:write', 'item', 'ScheduleLayer'),
  op('delete', '/schedules/{id}/layers/{layerId}', 'deleteScheduleLayer', 'schedules:write', 'none', ''),
  op('put', '/schedules/{id}/layers/order', 'reorderScheduleLayers', 'schedules:write', 'item', 'ScheduleLayerOrder'),
  op('post', '/schedules/{id}/coverage/preview', 'previewScheduleCoverage', 'schedules:write', 'item', 'ScheduleLayerPreview'),
  op('get', '/schedules/{id}/dependencies', 'getScheduleDependencies', 'schedules:write', 'item', 'ScheduleDependencies'),
  op('get', '/schedules/{id}/changes', 'listScheduleChanges', 'schedules:write', 'list', 'AuditLog'),
  op(
    'patch',
    '/escalation-policies/{id}',
    'updateEscalationPolicy',
    'escalation-policies:write',
    'item',
    'EscalationPolicy'
  ),
  op(
    'delete',
    '/escalation-policies/{id}',
    'deleteEscalationPolicy',
    'escalation-policies:write',
    'item',
    'ActionResult'
  ),
  op(
    'get',
    '/escalation-policies',
    'listEscalationPolicies',
    'escalation-policies:read',
    'list',
    'EscalationPolicy'
  ),
  op(
    'post',
    '/escalation-policies',
    'createEscalationPolicy',
    'escalation-policies:write',
    'item',
    'EscalationPolicy'
  ),
  op(
    'post',
    '/incidents/{id}/acknowledge',
    'acknowledgeIncident',
    'incidents:write',
    'item',
    'IncidentTransition'
  ),
  op(
    'post',
    '/incidents/{id}/assign',
    'assignIncident',
    'incidents:write',
    'item',
    'IncidentAssignment'
  ),
  op('get', '/incidents/{id}/notes', 'listIncidentNotes', 'incidents:read', 'list', 'IncidentNote'),
  op('post', '/incidents/{id}/notes', 'addIncidentNote', 'incidents:write', 'item', 'IncidentNote'),
  op(
    'post',
    '/incidents/{id}/resolve',
    'resolveIncident',
    'incidents:write',
    'item',
    'IncidentTransition'
  ),
  op('get', '/incidents/{id}', 'getIncident', 'incidents:read', 'item', 'Incident'),
  op('patch', '/incidents/{id}', 'updateIncident', 'incidents:write', 'item', 'Incident'),
  op(
    'get',
    '/incidents/{id}/timeline',
    'getIncidentTimeline',
    'incidents:read',
    'list',
    'IncidentTimelineEvent'
  ),
  op('get', '/incidents', 'listIncidents', 'incidents:read', 'list', 'Incident'),
  op('post', '/incidents', 'createIncident', 'incidents:write', 'item', 'Incident'),
  op('get', '/integrations/{id}', 'getIntegration', 'integrations:read', 'item', 'Integration'),
  op('get', '/integrations/types', 'listIntegrationTypes', 'integrations:read', 'list', 'IntegrationType'),
  op('post', '/services/{id}/integrations', 'createServiceIntegration', 'integrations:create', 'item', 'IntegrationCreated'),
  op('get', '/integrations/{id}/credentials', 'getIntegrationCredentialState', 'integrations:read', 'item', 'IntegrationCredentialState'),
  op('post', '/integrations/{id}/credentials', 'rotateIntegrationCredentials', 'integrations:credentials:write', 'item', 'IntegrationCredentialRotation'),
  op('post', '/integrations/{id}/test', 'validateIntegrationPayload', 'integrations:test', 'item', 'IntegrationTestResult'),
  op('get', '/integrations/{id}/diagnostics', 'getIntegrationDiagnostics', 'integrations:read', 'item', 'IntegrationDiagnostics'),
  op('post', '/integrations/{id}/validate', 'validateIntegrationConfiguration', 'integrations:test', 'item', 'IntegrationValidation'),
  op('get', '/integrations/{id}/usage', 'getIntegrationUsage', 'integrations:read', 'item', 'IntegrationUsage'),
  op('delete', '/integrations/{id}', 'deleteIntegration', 'integrations:delete', 'none', ''),
  op(
    'patch',
    '/integrations/{id}',
    'updateIntegration',
    'integrations:write',
    'item',
    'Integration'
  ),
  op('get', '/integrations', 'listIntegrations', 'integrations:read', 'list', 'Integration'),
  op(
    'post',
    '/notifications/{id}/retry',
    'retryNotification',
    'notifications:write',
    'item',
    'ActionResult'
  ),
  op('get', '/notifications', 'listNotifications', 'notifications:read', 'list', 'Notification'),
  op('get', '/notifications/{id}/attempts', 'listNotificationAttempts', 'notifications:read', 'list', 'NotificationDeliveryAttempt'),
  op('get', '/notifications/{id}/feedback', 'getNotificationFeedback', 'notifications:read', 'item', 'NotificationFeedback'),
  op('get', '/incidents/{id}/response-activity', 'getIncidentResponseActivity', 'incidents:read', 'item', 'IncidentResponseActivity'),
  op('get', '/incidents/{id}/war-rooms', 'listIncidentWarRooms', 'incidents:read', 'list', 'IncidentWarRoom'),
  op('get', '/incidents/{id}/alerts', 'listIncidentAlerts', 'incidents:read', 'list', 'IncidentAlertSummary'),
  op('get', '/incidents/{id}/runbook-executions', 'listIncidentRunbookExecutions', 'incidents:read', 'list', 'RunbookExecutionSummary'),
  op('get', '/incidents/{id}/notification-attempts', 'listIncidentNotificationAttempts', 'incidents:read', 'list', 'IncidentNotificationAttempt'),
  op('get', '/incidents/{id}/available-actions', 'getIncidentAvailableActions', 'incidents:read', 'item', 'IncidentAvailableActions'),
  op('get', '/incidents/{id}/related-incidents', 'listRelatedIncidents', 'incidents:read', 'item', 'RelatedIncidents'),
  op('get', '/incidents/{id}/intelligence', 'getIncidentIntelligence', 'incidents:read', 'item', 'IncidentIntelligence'),
  op('get', '/operational-events', 'listOperationalEvents', 'incidents:read', 'list', 'OperationalEvent'),
  op('get', '/services/{id}/change-events', 'listServiceChangeEvents', 'services:read', 'list', 'ServiceChangeEvent'),
  op('post', '/escalation-policies/{id}/preview', 'previewEscalationPolicy', 'escalation-policies:read', 'item', 'EscalationPolicyPreview'),
  op('get', '/services/{id}/health-summary', 'getServiceHealthSummary', 'services:read', 'item', 'ServiceHealthSummary'),
  op('get', '/postmortems/{id}', 'getPostmortem', 'postmortems:read', 'item', 'Postmortem'),
  op('get', '/postmortems/{id}/versions', 'listPostmortemVersions', 'postmortems:read', 'item', 'PostmortemVersionCollection'),
  op('get', '/postmortems/{id}/action-items', 'listPostmortemActionItems', 'postmortems:read', 'item', 'PostmortemActionItemCollection'),
  op('put', '/postmortems/{id}/action-items', 'replacePostmortemActionItems', 'postmortems:write', 'item', 'PostmortemActionItemCollection'),
  op('patch', '/postmortems/{id}/action-items/{itemId}', 'updatePostmortemActionItem', 'postmortems:write', 'item', 'PostmortemActionItemChange'),
  op('delete', '/postmortems/{id}/action-items/{itemId}', 'deletePostmortemActionItem', 'postmortems:write', 'item', 'PostmortemActionItemDeletion'),
  op('post', '/postmortems/{id}/publish', 'publishPostmortem', 'postmortems:write', 'item', 'PostmortemPublication'),
  op('get', '/postmortems/{id}/contributors', 'listPostmortemContributors', 'postmortems:read', 'item', 'PostmortemContributors'),
  op('put', '/postmortems/{id}/contributors', 'replacePostmortemContributors', 'postmortems:write', 'item', 'PostmortemContributors'),
  op('patch', '/postmortems/{id}', 'updatePostmortem', 'postmortems:write', 'item', 'Postmortem'),
  op('delete', '/postmortems/{id}', 'deletePostmortem', 'postmortems:write', 'none', ''),
  op('get', '/postmortems', 'listPostmortems', 'postmortems:read', 'list', 'Postmortem'),
  op('post', '/postmortems', 'createPostmortem', 'postmortems:write', 'item', 'Postmortem'),
  op('get', '/reports/metrics', 'getMetricsReport', 'reports:read', 'item', 'MetricsReport'),
  op('get', '/reports/catalog', 'getReportCatalog', 'reports:read', 'item', 'ReportCatalog'),
  op('post', '/reports/query', 'queryReportMetrics', 'reports:read', 'item', 'ReportQueryResult'),
  op('get', '/reports/saved', 'listSavedReports', 'reports:read', 'list', 'SavedReport'),
  op('post', '/reports/saved', 'createSavedReport', 'reports:write', 'item', 'SavedReport'),
  op('get', '/reports/saved/{id}', 'getSavedReport', 'reports:read', 'item', 'SavedReport'),
  op('patch', '/reports/saved/{id}', 'updateSavedReport', 'reports:write', 'item', 'SavedReport'),
  op('delete', '/reports/saved/{id}', 'deleteSavedReport', 'reports:write', 'none', ''),
  op('post', '/reports/exports', 'createReportExport', 'reports:read', 'item', 'ReportExport'),
  op('get', '/reports/exports/{id}', 'getReportExport', 'reports:read', 'item', 'ReportExport'),
  op('get', '/reports/exports/{id}/download', 'downloadReportExport', 'reports:read', 'binary', ''),
  op('post', '/reports/exports/{id}/cancel', 'cancelReportExport', 'reports:read', 'item', 'ReportExportCancellation'),
  op('get', '/dashboards', 'listReportDashboards', 'reports:read', 'list', 'ReportDashboardSummary'),
  op('post', '/dashboards', 'createReportDashboard', 'reports:write', 'item', 'ReportDashboard'),
  op('get', '/dashboards/{id}', 'getReportDashboard', 'reports:read', 'item', 'ReportDashboard'),
  op('get', '/dashboards/{id}/data', 'getReportDashboardData', 'reports:read', 'item', 'ReportDashboardData'),
  op('get', '/dashboards/{id}/export', 'downloadReportDashboardData', 'reports:read', 'binary', ''),
  op('post', '/dashboards/{id}/duplicate', 'duplicateReportDashboard', 'reports:write', 'item', 'ReportDashboard'),
  op('get', '/dashboards/{id}/widgets', 'listReportDashboardWidgets', 'reports:read', 'item', 'ReportDashboardWidgets'),
  op('put', '/dashboards/{id}/widgets', 'replaceReportDashboardWidgets', 'reports:write', 'item', 'ReportDashboardWidgets'),
  op('patch', '/dashboards/{id}', 'updateReportDashboard', 'reports:write', 'item', 'ReportDashboard'),
  op('delete', '/dashboards/{id}', 'deleteReportDashboard', 'reports:write', 'none', ''),
  op(
    'post',
    '/runbooks/{id}/execute',
    'executeRunbook',
    'runbooks:execute',
    'item',
    'RunbookExecutionStarted'
  ),
  op('get', '/runbooks/{id}', 'getRunbook', 'runbooks:read', 'item', 'Runbook'),
  op(
    'get',
    '/runbooks/executions/{id}',
    'getRunbookExecution',
    'runbooks:read',
    'item',
    'RunbookExecution'
  ),
  op('get', '/runbooks', 'listRunbooks', 'runbooks:read', 'list', 'Runbook'),
  op(
    'get',
    '/schedules/{id}/on-call',
    'getScheduleOnCall',
    'schedules:read',
    'item',
    'ScheduleOnCall'
  ),
  op(
    'get',
    '/schedules/{id}/overrides',
    'listScheduleOverrides',
    'schedules:read',
    'list',
    'ScheduleOverride'
  ),
  op(
    'post',
    '/schedules/{id}/overrides',
    'createScheduleOverride',
    'schedules:write',
    'item',
    'ScheduleOverride'
  ),
  op(
    'delete',
    '/schedules/{id}/overrides/{overrideId}',
    'cancelScheduleOverride',
    'schedules:write',
    'item',
    'ScheduleOverrideCancellation'
  ),
  op(
    'get',
    '/schedules/{id}/coverage',
    'getScheduleCoverage',
    'schedules:read',
    'item',
    'ScheduleCoverage'
  ),
  op('get', '/schedules/{id}', 'getSchedule', 'schedules:read', 'item', 'Schedule'),
  op('patch', '/schedules/{id}', 'updateSchedule', 'schedules:write', 'item', 'Schedule'),
  op('delete', '/schedules/{id}', 'deleteSchedule', 'schedules:write', 'item', 'ActionResult'),
  op('get', '/schedules', 'listSchedules', 'schedules:read', 'list', 'Schedule'),
  op('post', '/schedules', 'createSchedule', 'schedules:write', 'item', 'Schedule'),
  op(
    'get',
    '/service-accounts/{id}',
    'getServiceAccount',
    'service-accounts:read',
    'item',
    'ServiceAccount'
  ),
  op(
    'delete',
    '/service-accounts/{id}',
    'deleteServiceAccount',
    'service-accounts:write',
    'item',
    'ActionResult'
  ),
  op(
    'delete',
    '/service-accounts/{id}/tokens/{tokenId}',
    'revokeServiceAccountToken',
    'service-accounts:write',
    'item',
    'ActionResult'
  ),
  op(
    'post',
    '/service-accounts/{id}/tokens',
    'issueServiceAccountToken',
    'service-accounts:write',
    'item',
    'ServiceAccountTokenIssued'
  ),
  op(
    'get',
    '/service-accounts',
    'listServiceAccounts',
    'service-accounts:read',
    'list',
    'ServiceAccount'
  ),
  op(
    'post',
    '/service-accounts',
    'createServiceAccount',
    'service-accounts:write',
    'item',
    'ServiceAccount'
  ),
  op('get', '/services/{id}', 'getService', 'services:read', 'item', 'Service'),
  op('get', '/services/{id}/notification-settings', 'getServiceNotificationSettings', 'services:read', 'item', 'ServiceNotificationSettings'),
  op('patch', '/services/{id}/notification-settings', 'updateServiceNotificationSettings', 'services:write', 'item', 'ServiceNotificationSettings'),
  op('get', '/services/{id}/support-hours', 'getServiceSupportHours', 'response-policy:read', 'item', 'ServiceSupportHours'),
  op('put', '/services/{id}/support-hours', 'updateServiceSupportHours', 'response-policy:write', 'item', 'ServiceSupportHours'),
  op('get', '/services/{id}/response-policy/classification', 'getServiceClassificationPolicy', 'response-policy:read', 'item', 'ServiceClassificationPolicy'),
  op('put', '/services/{id}/response-policy/classification', 'updateServiceClassificationPolicy', 'response-policy:write', 'item', 'ServiceClassificationPolicy'),
  op('get', '/services/{id}/response-policy/sla', 'getServiceSlaPolicy', 'response-policy:read', 'item', 'ServiceSlaPolicy'),
  op('put', '/services/{id}/response-policy/sla', 'updateServiceSlaPolicy', 'response-policy:write', 'item', 'ServiceSlaPolicy'),
  op('get', '/settings/incident-sla', 'getWorkspaceSlaPolicy', 'response-policy:read', 'item', 'ServiceSlaPolicy'),
  op('put', '/settings/incident-sla', 'updateWorkspaceSlaPolicy', 'response-policy:write', 'item', 'ServiceSlaPolicy'),
  op('patch', '/services/{id}', 'updateService', 'services:write', 'item', 'Service'),
  op('delete', '/services/{id}', 'deleteService', 'services:write', 'item', 'ActionResult'),
  op('get', '/services', 'listServices', 'services:read', 'list', 'Service'),
  op('post', '/services', 'createService', 'services:write', 'item', 'Service'),
  op(
    'get',
    '/status-pages/{id}/announcements',
    'listStatusPageAnnouncements',
    'status-pages:read',
    'list',
    'StatusPageAnnouncement'
  ),
  op(
    'post',
    '/status-pages/{id}/announcements',
    'createStatusPageAnnouncement',
    'status-pages:write',
    'item',
    'StatusPageAnnouncement'
  ),
  op('get', '/status-pages/{id}', 'getStatusPage', 'status-pages:read', 'item', 'StatusPage'),
  op('patch', '/status-pages/{id}', 'updateStatusPage', 'status-pages:write', 'item', 'StatusPage'),
  op('get', '/status-pages', 'listStatusPages', 'status-pages:read', 'list', 'StatusPage'),
  op('post', '/status-pages', 'createStatusPage', 'status-pages:write', 'item', 'StatusPage'),
  op('get', '/teams/{id}', 'getTeam', 'teams:read', 'item', 'Team'),
  op('patch', '/teams/{id}', 'updateTeam', 'teams:write', 'item', 'Team'),
  op('delete', '/teams/{id}', 'deleteTeam', 'teams:write', 'item', 'ActionResult'),
  op('get', '/teams', 'listTeams', 'teams:read', 'list', 'Team'),
  op('post', '/teams', 'createTeam', 'teams:write', 'item', 'Team'),
  op('get', '/users/{id}', 'getUser', 'users:read', 'item', 'User'),
  op('get', '/users', 'listUsers', 'users:read', 'list', 'User'),
];

export function findOperation(method: string, path: string): V2OperationDefinition | undefined {
  return V2_OPERATIONS.find(o => o.method === method.toLowerCase() && o.path === path);
}
