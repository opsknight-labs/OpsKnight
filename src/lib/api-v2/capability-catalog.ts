import { V2_OPERATIONS } from './openapi-registry';

export interface ApiCapability {
  id: string;
  area: string;
  title: string;
  status: 'available' | 'restricted' | 'not-supported';
  explanation: string;
  operationIds: readonly string[];
}

/** Product decisions are explicit. An unsupported capability never creates a fake operation. */
const decisions: readonly ApiCapability[] = [
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
    title: 'Execution preview and cancellation',
    status: 'available',
    explanation:
      'Explicit execution privilege. Previews create no execution jobs. Cancellation is asynchronous and returns CANCEL_REQUESTED.',
    operationIds: [
      'previewRunbookExecution',
      'executeRunbook',
      'cancelRunbookExecution',
      'getRunbookExecution',
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
    status: 'not-supported',
    explanation:
      'The separate service-automation branch must be integrated and its evaluator contract certified before exposing rule management. Existing runbook service rules are a different domain.',
    operationIds: [],
  },
  {
    id: 'service-settings',
    area: 'Services',
    title: 'Notification settings and response policies',
    status: 'not-supported',
    explanation:
      'Basic service CRUD is available. Complete notification, support-hours and response-policy management still requires shared commands and versioned REST contracts.',
    operationIds: [],
  },
  {
    id: 'incident-metadata',
    area: 'Incidents',
    title: 'Custom-field updates, tags and routing decisions',
    status: 'not-supported',
    explanation:
      'Incident creation accepts validated custom fields. Separate metadata updates, tag management and routing-decision history are not yet exposed.',
    operationIds: [],
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
    status: 'not-supported',
    explanation:
      'Template authoring and ownership checks still need extraction from server actions before REST exposure.',
    operationIds: [],
  },
  {
    id: 'schedule-layers',
    area: 'Schedules',
    title: 'Layer configuration, override cancellation and coverage previews',
    status: 'not-supported',
    explanation:
      'Schedules, current on-call, override creation and participant management are available. Remaining rotation editing and period previews need shared domain contracts.',
    operationIds: [],
  },
  {
    id: 'escalation-validation',
    area: 'Escalations',
    title: 'Policy usage and validation workflows',
    status: 'not-supported',
    explanation:
      'Escalation-policy CRUD validates steps. Dedicated dependency and usage operations are not yet exposed.',
    operationIds: [],
  },
  {
    id: 'team-membership',
    area: 'Identity',
    title: 'Team membership administration',
    status: 'not-supported',
    explanation:
      'Team CRUD is available. Membership and role writes need atomic last-owner, session-revocation and audit parity.',
    operationIds: [],
  },
  {
    id: 'identity-lifecycle',
    area: 'Identity',
    title: 'Invitations, user roles and activation',
    status: 'not-supported',
    explanation:
      'Directory reads are available. Manual management must preserve SCIM/SSO ownership, break-glass restrictions, account linking, last-admin and session-revocation invariants.',
    operationIds: [],
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
    status: 'not-supported',
    explanation:
      'Inventory, rename and enable/disable are available. Setup, testing, rotation and deletion require provider-specific secret, SSRF and cutover contracts.',
    operationIds: [],
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
    status: 'not-supported',
    explanation:
      'History and safe failed-delivery retry are available. Configuration, test sends and cost budgets require dedicated contracts.',
    operationIds: [],
  },
  {
    id: 'runbook-service-rules',
    area: 'Runbooks',
    title: 'Service rules, policy checks and activation',
    status: 'not-supported',
    explanation:
      'Execution uses saved rule inputs and pinned versions. Rule management requires revision preconditions and the full target-policy activation workflow.',
    operationIds: [],
  },
  {
    id: 'runbook-agents',
    area: 'Runbooks',
    title: 'Agents, pools and enrollment',
    status: 'not-supported',
    explanation:
      'Agent administration needs dedicated scopes, one-time enrollment handling, revocation and target-isolation certification before public exposure.',
    operationIds: [],
  },
  {
    id: 'runbook-secrets',
    area: 'Runbooks',
    title: 'Secret references, rotation and grants',
    status: 'not-supported',
    explanation:
      'Requires dedicated secret administration privilege and atomic grant/rotation audits. Plaintext retrieval is prohibited.',
    operationIds: [],
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
    status: 'not-supported',
    explanation:
      'Page CRUD and announcements are available. Component/subscriber administration needs dedicated privacy controls, fanout safety and single-page-limit parity.',
    operationIds: [],
  },
  {
    id: 'postmortem-workflows',
    area: 'Postmortems',
    title: 'Structured impact, contributors and action items',
    status: 'not-supported',
    explanation:
      'Postmortem CRUD is available. Structured impact and collaboration require real schemas and shared commands; ignored plain-string impact remains rejected.',
    operationIds: [],
  },
  {
    id: 'report-exports',
    area: 'Reports',
    title: 'Saved reports and asynchronous exports',
    status: 'not-supported',
    explanation:
      'Metrics reads are available. Saved definitions and large exports require durable jobs, bounded resource use and downloadable result authorization.',
    operationIds: [],
  },
  {
    id: 'slo-management',
    area: 'Reports',
    title: 'Service objectives',
    status: 'not-supported',
    explanation:
      'A backend exists, but the supported product management workflow must be completed before promising REST/UI parity.',
    operationIds: [],
  },
  {
    id: 'dashboards',
    area: 'Reports',
    title: 'Dashboards and analytics configuration',
    status: 'not-supported',
    explanation:
      'Metrics reads do not imply dashboard authoring. Dashboard configuration and analytics workflows need explicit capability contracts.',
    operationIds: [],
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
    status: 'not-supported',
    explanation:
      'These customer-facing controls remain in the parity inventory; none is implicitly exposed by ordinary broad CRUD access.',
    operationIds: [],
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
