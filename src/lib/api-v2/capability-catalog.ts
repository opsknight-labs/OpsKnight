import { V2_OPERATIONS } from './openapi-registry';

export interface ApiCapability {
  id: string;
  area: string;
  title: string;
  status: 'available' | 'partial' | 'restricted' | 'not-supported';
  explanation: string;
  operationIds: readonly string[];
}

/** Product decisions are explicit. An unsupported capability never creates a fake operation. */
const decisions: readonly ApiCapability[] = [
  {
    id: 'runbook-lifecycle',
    area: 'Runbooks',
    title: 'Metadata, archive, restoration, deletion checks and duplication',
    status: 'partial',
    explanation:
      'Administrator-only lifecycle commands use concrete metadata revisions and durable replay. Privileged metadata includes unpublished and archived runbooks without executable configuration. Restoration keeps service rules disabled. Version comparisons return only structural summaries. The remaining control plane is pending.',
    operationIds: [
      'compareRunbookVersions',
      'getRunbookMetadata',
      'updateRunbookMetadata',
      'archiveRunbook',
      'restoreRunbook',
      'checkRunbookDeletion',
      'deleteRunbook',
      'duplicateRunbook',
    ],
  },
  {
    id: 'runbook-authoring',
    area: 'Runbooks',
    title: 'Create, draft, validate and publish',
    status: 'available',
    explanation:
      'Explicit authoring/publishing scopes and administrator capabilities; draft writes require concrete revision ETags and idempotency keys. Privileged draft reads include a safe editable body that preserves hidden configuration.',
    operationIds: [
      'createRunbook',
      'createRunbookDraft',
      'getRunbookDraft',
      'updateRunbookDraft',
      'validateRunbookDraft',
      'publishRunbookDraft',
      'listRunbookVersions',
    ],
  },
  {
    id: 'runbook-control',
    area: 'Runbooks',
    title: 'Execution preview, decisions, evidence and reruns',
    status: 'available',
    explanation:
      'Execution previews, step/evidence/event reads, plan-bound approvals and rejections, reviewed terminal reruns and asynchronous cancellation use explicit scopes. Approval decisions and reruns require owner/team control or ADMIN; shared domain commands preserve current state, exact plan review and audit/replay atomicity. Combined certification remains pending.',
    operationIds: [
      'previewRunbookExecution',
      'executeRunbook',
      'cancelRunbookExecution',
      'getRunbookExecution',
      'listRunbookExecutionSteps',
      'listRunbookExecutionEvidence',
      'listRunbookExecutionEvents',
      'approveRunbookExecutionStep',
      'rejectRunbookExecutionStep',
      'previewRunbookExecutionRerun',
      'rerunRunbookExecution',
    ],
  },
  {
    id: 'incident-lifecycle',
    area: 'Incidents',
    title: 'Incident lifecycle and watchers',
    status: 'available',
    explanation:
      'Canonical lifecycle and watcher commands, transactional timeline/audit and durable replay. Watcher mutations require operational privileges.',
    operationIds: [
      'reopenIncident',
      'snoozeIncident',
      'unsnoozeIncident',
      'suppressIncident',
      'unsuppressIncident',
      'unacknowledgeIncident',
      'listIncidentWatchers',
      'setIncidentWatcher',
      'removeIncidentWatcher',
    ],
  },
  {
    id: 'schedule-participants',
    area: 'Schedules',
    title: 'Rotation participants',
    status: 'available',
    explanation:
      'Add active responders, remove and move participants through the same commands used by the UI. Layer configuration editing remains separate.',
    operationIds: [
      'addScheduleParticipant',
      'moveScheduleParticipant',
      'removeScheduleParticipant',
    ],
  },
  {
    id: 'service-automation',
    area: 'Services',
    title: 'Alert normalization and routing rules',
    status: 'partial',
    explanation:
      'Global settings, drafts, validation, safe simulation, mode changes, version history, restoration and redacted diagnostics are implemented. Full API-only lifecycle and production certification are pending. Decision history additionally requires incident read permission. Runbook service rules are a different domain.',
    operationIds: [
      'validateAutomation',
      'simulateAutomation',
      'restoreAutomationDraft',
      'listAutomationDecisions',
      'listAutomationObservations',
      'listAutomationVersions',
      'getAutomationVersion',
      'getServiceAutomation',
      'updateServiceAutomationMode',
      'getAutomationSettings',
      'updateAutomationSettings',
      'getAutomationDraft',
      'saveAutomationDraft',
      'publishAutomationVersion',
      'getAutomationCandidate',
      'discardAutomationCandidate',
      'activateAutomationCandidate',
    ],
  },
  {
    id: 'service-settings',
    area: 'Services',
    title: 'Notification settings and response policies',
    status: 'partial',
    explanation:
      'Service notification settings, support hours, classification and SLA policy versions have REST contracts. Remaining notification channel/event controls still require parity work.',
    operationIds: ['getServiceNotificationSettings', 'updateServiceNotificationSettings', 'getServiceSupportHours', 'updateServiceSupportHours', 'getServiceClassificationPolicy', 'updateServiceClassificationPolicy', 'getServiceSlaPolicy', 'updateServiceSlaPolicy'],
  },
  {
    id: 'incident-metadata',
    area: 'Incidents',
    title: 'Custom-field updates, tags and routing decisions',
    status: 'available',
    explanation:
      'Incident custom-field values and tags can be read and updated with scoped authorization, canonical validation, durable replay and transactional timeline events. A redacted incident routing decision requires automation scope and incident visibility.',
    operationIds: ['listIncidentCustomFields', 'getIncidentCustomField', 'setIncidentCustomField', 'listIncidentTags', 'addIncidentTag', 'removeIncidentTag', 'getIncidentRoutingDecision'],
  },
  {
    id: 'incident-diagnostics',
    area: 'Incidents',
    title: 'Cross-feature response diagnostics',
    status: 'partial',
    explanation:
      'A bounded, redacted activity snapshot joins incident alerts, events, routing, notification delivery and Runbook recovery. Incident-scoped pagination, advisory action discovery, evidence-based related-incident search, service health, escalation preview, operational events and service audit changes support investigation. Deployment-change ingestion is not yet represented by structured records.',
    operationIds: ['getIncidentResponseActivity', 'listIncidentAlerts', 'listIncidentRunbookExecutions', 'listIncidentNotificationAttempts', 'getIncidentAvailableActions', 'listRelatedIncidents', 'listRunbookExecutions', 'listNotificationAttempts', 'getNotificationFeedback', 'listOperationalEvents', 'listServiceChangeEvents', 'previewEscalationPolicy', 'getServiceHealthSummary'],
  },
  {
    id: 'incident-collaboration',
    area: 'Incidents',
    title: 'War-room and collaboration lifecycle',
    status: 'not-supported',
    explanation:
      'Watcher management is available. Provider-backed collaboration lifecycle requires durable provider reconciliation and a dedicated API contract.',
    operationIds: [],
  },
  {
    id: 'incident-templates',
    area: 'Incidents',
    title: 'Incident templates',
    status: 'partial',
    explanation:
      'Template create, list, read, revision-protected update and delete use owner checks, scoped REST credentials, transactional audit and shared UI mutation commands. Combined UI/REST certification remains pending.',
    operationIds: ['listIncidentTemplates', 'createIncidentTemplate', 'getIncidentTemplate', 'updateIncidentTemplate', 'deleteIncidentTemplate'],
  },
  {
    id: 'schedule-layers',
    area: 'Schedules',
    title: 'Layer configuration, override cancellation and coverage previews',
    status: 'partial',
    explanation:
      'Override cancellation, bounded effective coverage reads and participant management are available. Layer rotation configuration and unsaved-change previews still need shared domain contracts.',
    operationIds: ['cancelScheduleOverride', 'getScheduleCoverage', 'addScheduleParticipant', 'removeScheduleParticipant', 'moveScheduleParticipant'],
  },
  {
    id: 'escalation-validation',
    area: 'Escalations',
    title: 'Policy usage and validation workflows',
    status: 'partial',
    explanation:
      'CRUD validates submitted steps. Bounded dependency and validation snapshots report usage, live target availability, stored-step issues and deletion-blocking references. Combined release certification remains pending.',
    operationIds: ['getEscalationPolicyDependencies', 'validateEscalationPolicy'],
  },
  {
    id: 'team-membership',
    area: 'Identity',
    title: 'Team membership and lead administration',
    status: 'partial',
    explanation:
      'Bounded membership reads and revision-protected membership/lead changes use shared UI/REST commands, current ownership checks, last-active-owner protection, SCIM ownership restrictions, session revocation, transactional audits and notifications. Managed service lists/assignment and owner-only activity use shared UI/REST commands with Service revisions, cross-team transfer protection, redacted projections and bounded indexes. Combined certification remains pending.',
    operationIds: [
      'listTeamMembers',
      'setTeamMember',
      'removeTeamMember',
      'getTeamLead',
      'setTeamLead',
      'listTeamServices',
      'assignTeamService',
      'listTeamActivity',
    ],
  },
  {
    id: 'identity-lifecycle',
    area: 'Identity',
    title: 'Invitations, user roles and activation',
    status: 'partial',
    explanation:
      'Shared UI/REST role, lifecycle and invitation commands preserve current administration authority, last-active-admin protection, identity policy/provider fences, linking-approval state and transactional audit/delivery. Manual invitation URLs are disclosed once and stripped from retry receipts; email payloads are encrypted and rechecked at dispatch. Administrator-only dependency counts are available without linked record details. Bulk/profile parity and final combined certification remain unfinished.',
    operationIds: [
      'getUserAdministration',
      'getUserDependencies',
      'administerUser',
      'getUserInvitationPolicy',
      'createUserInvitation',
      'getUserInvitation',
      'renewUserInvitation',
    ],
  },
  {
    id: 'scim',
    area: 'Identity',
    title: 'SCIM provisioning',
    status: 'restricted',
    explanation:
      'Use the existing dedicated SCIM v2 protocol and its credentials. Public REST does not duplicate provisioning ownership.',
    operationIds: [],
  },
  {
    id: 'integration-lifecycle',
    area: 'Integrations',
    title: 'Connector setup and credential rotation',
    status: 'partial',
    explanation:
      'Inbound service integrations support setup, safe configuration, local validation and test payloads, encrypted credential rotation, bounded diagnostics, usage inspection and dependency-checked deletion. OAuth consent and external outbound connector parity remain separate workflows.',
    operationIds: [
      'listIntegrations',
      'getIntegration',
      'listIntegrationTypes',
      'createServiceIntegration',
      'updateIntegration',
      'getIntegrationCredentialState',
      'rotateIntegrationCredentials',
      'validateIntegrationPayload',
      'validateIntegrationConfiguration',
      'getIntegrationDiagnostics',
      'getIntegrationUsage',
      'deleteIntegration',
    ],
  },
  {
    id: 'provider-oauth',
    area: 'Integrations',
    title: 'Provider OAuth authorization',
    status: 'restricted',
    explanation:
      'OAuth consent and callbacks remain provider-authenticated workflows. Ordinary REST credentials cannot bypass consent or retrieve provider tokens.',
    operationIds: [],
  },
  {
    id: 'notification-configuration',
    area: 'Notifications',
    title: 'Delivery preferences and provider diagnostics',
    status: 'partial',
    explanation:
      'Revision-protected self-service preferences, provider configuration, diagnostics, idempotent administrator-addressed test intents and Web Push rotation are available. A dedicated PostgreSQL test verifies provider worker delivery and completed diagnostics. Capacity administration, feedback and recovery still require combined parity and deployment certification.',
    operationIds: [
      'getMyNotificationPreferences',
      'updateMyNotificationPreferences',
      'listNotificationProviders',
      'getNotificationProvider',
      'configureNotificationProvider',
      'getNotificationProviderDiagnostics',
      'testNotificationProvider',
      'rotateWebPushKeys',
    ],
  },
  {
    id: 'runbook-service-rules',
    area: 'Runbooks',
    title: 'Service rules, policy checks and activation',
    status: 'partial',
    explanation:
      'Service rule administration uses explicit read/configure/activate scopes, shared domain commands, rule revisions, immutable version reviews and current target-policy readiness. Private Agent policy-result submission stays on the authenticated Agent protocol. Full combined certification remains pending.',
    operationIds: [
      'listServiceRunbookRules',
      'createServiceRunbookRule',
      'getServiceRunbookRule',
      'updateServiceRunbookRule',
      'detachServiceRunbookRule',
      'validateServiceRunbookRule',
      'listRunbookRulePolicyChecks',
      'requestRunbookRulePolicyChecks',
      'activateServiceRunbookRule',
      'pauseServiceRunbookRule',
      'duplicateServiceRunbookRule',
      'replaceRunbookRuleTriggers',
    ],
  },
  {
    id: 'runbook-agents',
    area: 'Runbooks',
    title: 'Agents, pools and enrollment',
    status: 'partial',
    explanation:
      'Administrator-only fleet reads, policy status, one-time enrollment and terminal revocation use explicit scopes and canonical audits. Enrollment replay stores metadata only. Pool administration, configuration revision fencing and settings use dedicated scopes. Full target-isolation certification remains in progress.',
    operationIds: [
      'listRunbookAgents',
      'getRunbookAgent',
      'getRunbookAgentPolicyStatus',
      'createRunbookAgentEnrollment',
      'getRunbookAgentEnrollment',
      'revokeRunbookAgent',
      'listRunbookSigningIdentities',
      'stageRunbookSigningIdentity',
      'activateRunbookSigningIdentity',
      'retireRunbookSigningIdentity',
      'retireRunbookAgentPool',
      'listRunbookAgentPools',
      'createRunbookAgentPool',
      'getRunbookAgentPool',
      'updateRunbookAgentPool',
      'deleteRunbookAgentPool',
      'checkRunbookAgentPoolDeletion',
      'listRunbookAgentPoolMembers',
      'setRunbookAgentPoolMember',
      'removeRunbookAgentPoolMember',
      'getRunbookAgentConfiguration',
      'updateRunbookAgentConfiguration',
      'getRunbookSettings',
      'updateRunbookSettings',
    ],
  },
  {
    id: 'runbook-secrets',
    area: 'Runbooks',
    title: 'Secret references, rotation and grants',
    status: 'partial',
    explanation:
      'Dedicated scopes protect write-only secret creation/rotation and grant administration. Concrete revisions, canonical audits and metadata-only replay protect concurrent updates. Usage inspection covers exact stored references. Combined Agent certification remains pending.',
    operationIds: [
      'listRunbookSecretUsage',
      'listRunbookSecrets',
      'createRunbookSecret',
      'getRunbookSecret',
      'rotateRunbookSecret',
      'listRunbookSecretGrants',
      'grantRunbookSecret',
      'revokeRunbookSecretGrant',
    ],
  },
  {
    id: 'agent-protocol',
    area: 'Runbooks',
    title: 'Agent claims and acknowledgments',
    status: 'restricted',
    explanation:
      'The authenticated /api/runbook-agent/v1 protocol remains separate. Ordinary REST credentials cannot claim agent jobs or acknowledge execution results.',
    operationIds: [],
  },
  {
    id: 'status-management',
    area: 'Status pages',
    title: 'Components, subscribers and branding',
    status: 'partial',
    explanation:
      'Page CRUD and announcements are available. Subscriber administration uses explicit privacy scopes and shared revocation/suppression commands. Appearance, privacy, content and general settings use the shared publication command with all-writer revision fencing. Component membership/presentation and durable publication retry/status are available. Domains/assets and full publication parity remain in progress.',
    operationIds: [
      'getStatusPagePublication',
      'retryStatusPagePublication',
      'getStatusPagePublicationJob',
      'listStatusPageServices',
      'setStatusPageServices',
      'updateStatusPageService',
      'getStatusPageAppearance',
      'updateStatusPageAppearance',
      'getStatusPagePrivacy',
      'updateStatusPagePrivacy',
      'getStatusPageContent',
      'updateStatusPageContent',
      'getStatusPageSettings',
      'updateStatusPageSettings',
      'listStatusPageSubscribers',
      'getStatusPageSubscriber',
      'removeStatusPageSubscriber',
      'getStatusPageSubscriberStats',
      'getStatusPageSubscriptionSettings',
    ],
  },
  {
    id: 'postmortem-workflows',
    area: 'Postmortems',
    title: 'Structured impact, contributors and action items',
    status: 'partial',
    explanation:
      'Postmortem CRUD now persists strictly validated structured impact metrics used by the UI. Factors, five-whys, contributors, action-item lifecycle and explicit publication still need shared contracts.',
    operationIds: ['createPostmortem', 'getPostmortem', 'updatePostmortem'],
  },
  {
    id: 'report-exports',
    area: 'Reports',
    title: 'Saved reports and asynchronous exports',
    status: 'partial',
    explanation:
      'The report catalog, bounded actor-scoped metric queries, saved definitions and encrypted asynchronous metric exports are available. Exports require current global report and incident access and the originating credential; broader reporting and certification remain in progress.',
    operationIds: [
      'getReportCatalog', 'queryReportMetrics', 'listSavedReports', 'createSavedReport',
      'getSavedReport', 'updateSavedReport', 'deleteSavedReport',
      'createReportExport', 'getReportExport', 'downloadReportExport', 'cancelReportExport',
    ],
  },
  {
    id: 'slo-management',
    area: 'Reports',
    title: 'Service objectives',
    status: 'partial',
    explanation:
      'The four supported metrics have explicit contracts, immutable versioned writes, archived reads, bounded history and quota-bound asynchronous evaluation. Scoped readers receive actor-filtered evaluations; shared daily history requires global metric visibility. Full product UI parity, performance and final combined certification remain in progress.',
    operationIds: [
      'getServiceObjectiveCatalog',
      'listServiceObjectives',
      'createServiceObjective',
      'getServiceObjective',
      'updateServiceObjective',
      'archiveServiceObjective',
      'listServiceObjectiveVersions',
      'listServiceObjectiveSnapshots',
      'getServiceObjectiveHistory',
      'evaluateServiceObjective',
      'getServiceObjectiveEvaluation',
    ],
  },
  {
    id: 'dashboards',
    area: 'Reports',
    title: 'Dashboards and analytics configuration',
    status: 'partial',
    explanation:
      'Saved dashboard CRUD, widget replacement, visibility and accessible template cloning use explicit report scopes, owner/team checks, revision fencing and audited idempotency. Actor-scoped data projection and bounded, audited JSON downloads are available; combined UI/REST parity and load certification remain pending.',
    operationIds: [
      'listReportDashboards',
      'createReportDashboard',
      'getReportDashboard',
      'getReportDashboardData',
      'downloadReportDashboardData',
      'duplicateReportDashboard',
      'listReportDashboardWidgets',
      'replaceReportDashboardWidgets',
      'updateReportDashboard',
      'deleteReportDashboard',
    ],
  },
  {
    id: 'audit-export',
    area: 'Administration',
    title: 'Audit export and integrity verification',
    status: 'not-supported',
    explanation:
      'Redacted audit reads are available. Export jobs and integrity verification need separate permissions and result-retention contracts.',
    operationIds: [],
  },
  {
    id: 'operational-settings',
    area: 'Administration',
    title: 'SLA, custom-field definitions, ChatOps and preferences',
    status: 'partial',
    explanation:
      'Workspace SLA policies now share the UI versioned command with scoped, revision-protected REST reads and writes. Custom-field definitions, ChatOps and remaining preferences still require dedicated contracts.',
    operationIds: ['getWorkspaceSlaPolicy', 'updateWorkspaceSlaPolicy'],
  },
  {
    id: 'sensitive-maintenance',
    area: 'Administration',
    title: 'Erasure, authentication mode and encryption keys',
    status: 'restricted',
    explanation:
      'High-impact maintenance requires separate security classification, narrowly scoped policies and review. admin:manage does not establish a public CRUD contract.',
    operationIds: [],
  },
];

/** The baseline groups are derived from shipped operations, so the catalog cannot omit them. */
export const API_CAPABILITY_CATALOG: readonly ApiCapability[] = [
  ...[...new Set(V2_OPERATIONS.map(operation => operation.path.split('/')[1]))].map(area => ({
    id: `baseline-${area}`,
    area,
    title: `Supported ${area} operations`,
    status: 'available' as const,
    explanation:
      'See the operation list for exact inputs, required scopes, role policies and retry guarantees. Availability does not imply full product parity.',
    operationIds: V2_OPERATIONS.filter(operation => operation.path.split('/')[1] === area).map(
      operation => operation.operationId
    ),
  })),
  ...decisions,
];
