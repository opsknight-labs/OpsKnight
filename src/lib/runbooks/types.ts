/**
 * OpsKnight Runbooks — Domain types and constants.
 *
 * This module defines the canonical TypeScript types, discriminated unions,
 * and runtime constants for the Runbooks domain. It mirrors the Prisma schema
 * enums but adds derived types, guards, and structural contracts that the ORM
 * layer does not express.
 */

// ---------------------------------------------------------------------------
// Version state
// ---------------------------------------------------------------------------

export const RUNBOOK_VERSION_STATES = ['DRAFT', 'PUBLISHED', 'RETIRED'] as const;
export type RunbookVersionState = (typeof RUNBOOK_VERSION_STATES)[number];

export function isTerminalVersionState(state: RunbookVersionState): boolean {
  return state === 'RETIRED';
}

// ---------------------------------------------------------------------------
// Binding mode
// ---------------------------------------------------------------------------

export const RUNBOOK_BINDING_MODES = ['MANUAL', 'SUGGESTED', 'AUTOMATIC'] as const;
export type RunbookBindingMode = (typeof RUNBOOK_BINDING_MODES)[number];

// ---------------------------------------------------------------------------
// Version strategy
// ---------------------------------------------------------------------------

export const RUNBOOK_VERSION_STRATEGIES = ['PINNED', 'LATEST_PUBLISHED'] as const;
export type RunbookVersionStrategy = (typeof RUNBOOK_VERSION_STRATEGIES)[number];

// ---------------------------------------------------------------------------
// Trigger events
// ---------------------------------------------------------------------------

export const RUNBOOK_TRIGGER_EVENTS = [
  'INCIDENT_CREATED',
  'INCIDENT_UPDATED',
  'URGENCY_CHANGED',
  'STATUS_CHANGED',
  'ALERT_RECEIVED',
  'MANUAL',
  'API',
  'CHATOPS',
  'SCHEDULED',
] as const;
export type RunbookTriggerEvent = (typeof RUNBOOK_TRIGGER_EVENTS)[number];

export function isIncidentTriggerEvent(event: RunbookTriggerEvent): boolean {
  return (
    event === 'INCIDENT_CREATED' ||
    event === 'INCIDENT_UPDATED' ||
    event === 'URGENCY_CHANGED' ||
    event === 'STATUS_CHANGED'
  );
}

// ---------------------------------------------------------------------------
// Execution status
// ---------------------------------------------------------------------------

export const RUNBOOK_EXECUTION_STATUSES = [
  'QUEUED',
  'RUNNING',
  'WAITING_AGENT',
  'WAITING_APPROVAL',
  'PAUSED',
  'SUCCEEDED',
  'FAILED',
  'CANCEL_REQUESTED',
  'CANCELLED',
  'TIMED_OUT',
] as const;
export type RunbookExecutionStatus = (typeof RUNBOOK_EXECUTION_STATUSES)[number];

export const TERMINAL_EXECUTION_STATUSES: ReadonlySet<RunbookExecutionStatus> = new Set([
  'SUCCEEDED',
  'FAILED',
  'CANCELLED',
  'TIMED_OUT',
]);

export function isTerminalExecutionStatus(status: RunbookExecutionStatus): boolean {
  return TERMINAL_EXECUTION_STATUSES.has(status);
}

export function isActiveExecutionStatus(status: RunbookExecutionStatus): boolean {
  return !TERMINAL_EXECUTION_STATUSES.has(status);
}

// ---------------------------------------------------------------------------
// Step types
// ---------------------------------------------------------------------------

export const RUNBOOK_STEP_TYPES = [
  'MANUAL',
  'APPROVAL',
  'CONDITION',
  'WAIT',
  'HTTP',
  'LINUX_DIAGNOSTICS',
  'SYSTEMD',
  'DOCKER',
  'KUBERNETES',
  'BASH',
] as const;
export type RunbookStepType = (typeof RUNBOOK_STEP_TYPES)[number];

/** Steps that can be executed locally without an agent. */
export const LOCAL_STEP_TYPES: ReadonlySet<RunbookStepType> = new Set([
  'MANUAL',
  'APPROVAL',
  'CONDITION',
  'WAIT',
  'HTTP',
]);

/** Steps that require a remote agent for execution. */
export function requiresAgent(stepType: RunbookStepType): boolean {
  return !LOCAL_STEP_TYPES.has(stepType);
}

// ---------------------------------------------------------------------------
// Risk classification
// ---------------------------------------------------------------------------

export const RUNBOOK_RISK_CLASSES = ['READ_ONLY', 'IDEMPOTENT_WRITE', 'NON_IDEMPOTENT'] as const;
export type RunbookRiskClass = (typeof RUNBOOK_RISK_CLASSES)[number];

/**
 * Whether a step with the given risk class can be safely retried after an
 * UNKNOWN outcome.
 */
export function isSafeToRetryAfterUnknown(riskClass: RunbookRiskClass): boolean {
  return riskClass === 'READ_ONLY';
}

/**
 * Whether a step with the given risk class can be retried at all on failure.
 */
export function isRetryable(riskClass: RunbookRiskClass): boolean {
  return riskClass !== 'NON_IDEMPOTENT';
}

// ---------------------------------------------------------------------------
// Step status
// ---------------------------------------------------------------------------

export const RUNBOOK_STEP_STATUSES = [
  'PENDING',
  'READY',
  'RUNNING',
  'WAITING_AGENT',
  'WAITING_APPROVAL',
  'SUCCEEDED',
  'FAILED',
  'SKIPPED',
  'CANCELLED',
  'UNKNOWN',
] as const;
export type RunbookStepStatus = (typeof RUNBOOK_STEP_STATUSES)[number];

export const TERMINAL_STEP_STATUSES: ReadonlySet<RunbookStepStatus> = new Set([
  'SUCCEEDED',
  'FAILED',
  'SKIPPED',
  'CANCELLED',
]);

export function isTerminalStepStatus(status: RunbookStepStatus): boolean {
  return TERMINAL_STEP_STATUSES.has(status);
}

// ---------------------------------------------------------------------------
// Attempt status
// ---------------------------------------------------------------------------

export const RUNBOOK_ATTEMPT_STATUSES = [
  'PENDING',
  'CLAIMED',
  'RUNNING',
  'SUCCEEDED',
  'FAILED',
  'CANCELLED',
  'TIMED_OUT',
  'UNKNOWN',
] as const;
export type RunbookAttemptStatus = (typeof RUNBOOK_ATTEMPT_STATUSES)[number];

export const TERMINAL_ATTEMPT_STATUSES: ReadonlySet<RunbookAttemptStatus> = new Set([
  'SUCCEEDED',
  'FAILED',
  'CANCELLED',
  'TIMED_OUT',
  'UNKNOWN',
]);

export function isTerminalAttemptStatus(status: RunbookAttemptStatus): boolean {
  return TERMINAL_ATTEMPT_STATUSES.has(status);
}

// ---------------------------------------------------------------------------
// Agent status
// ---------------------------------------------------------------------------

export const RUNBOOK_AGENT_STATUSES = [
  'ENROLLING',
  'ONLINE',
  'DEGRADED',
  'OFFLINE',
  'REVOKED',
] as const;
export type RunbookAgentStatus = (typeof RUNBOOK_AGENT_STATUSES)[number];

export function isAgentAvailable(status: RunbookAgentStatus): boolean {
  return status === 'ONLINE' || status === 'DEGRADED';
}

// ---------------------------------------------------------------------------
// Agent pool mode
// ---------------------------------------------------------------------------

export const RUNBOOK_AGENT_POOL_MODES = ['LOCAL_HOSTS', 'SHARED_TARGET'] as const;
export type RunbookAgentPoolMode = (typeof RUNBOOK_AGENT_POOL_MODES)[number];

// ---------------------------------------------------------------------------
// Condition operators
// ---------------------------------------------------------------------------

export const RUNBOOK_CONDITION_OPERATORS = [
  'EQUALS',
  'NOT_EQUALS',
  'CONTAINS',
  'STARTS_WITH',
  'IN',
  'NOT_IN',
  'EXISTS',
  'NOT_EXISTS',
] as const;
export type RunbookConditionOperator = (typeof RUNBOOK_CONDITION_OPERATORS)[number];

// ---------------------------------------------------------------------------
// Input types
// ---------------------------------------------------------------------------

export const RUNBOOK_INPUT_TYPES = [
  'STRING',
  'NUMBER',
  'BOOLEAN',
  'URL',
  'DURATION',
  'SECRET_REF',
  'SELECT',
] as const;
export type RunbookInputType = (typeof RUNBOOK_INPUT_TYPES)[number];

// ---------------------------------------------------------------------------
// Trigger-by type
// ---------------------------------------------------------------------------

export const RUNBOOK_TRIGGER_BY_TYPES = [
  'USER',
  'TRIGGER',
  'API',
  'CHATOPS',
  'SCHEDULE',
] as const;
export type RunbookTriggerByType = (typeof RUNBOOK_TRIGGER_BY_TYPES)[number];

// ---------------------------------------------------------------------------
// Condition logic
// ---------------------------------------------------------------------------

export const RUNBOOK_CONDITION_LOGICS = ['AND', 'OR'] as const;
export type RunbookConditionLogic = (typeof RUNBOOK_CONDITION_LOGICS)[number];

// ---------------------------------------------------------------------------
// Runbook job payload kinds
// ---------------------------------------------------------------------------

export const RUNBOOK_JOB_KINDS = [
  'EVALUATE_TRIGGER',
  'ADVANCE_EXECUTION',
  'RECONCILE_EXECUTION',
] as const;
export type RunbookJobKind = (typeof RUNBOOK_JOB_KINDS)[number];

export interface RunbookJobPayload {
  kind: RunbookJobKind;
  executionId?: string;
  incidentId?: string;
  sourceEventId?: string;
  bindingId?: string;
}

// ---------------------------------------------------------------------------
// Step definition (within RunbookVersion.definition JSON)
// ---------------------------------------------------------------------------

export interface RunbookStepDefinition {
  key: string;
  name: string;
  type: RunbookStepType;
  riskClass: RunbookRiskClass;
  description?: string;
  /** Configuration specific to the step type. */
  config: Record<string, unknown>;
  /** Optional verification step(s) to run after this action. */
  verification?: RunbookVerificationDefinition;
  /** Optional pre-check step(s) to run before this action. */
  precheck?: RunbookPrecheckDefinition;
  /** Timeout in seconds. */
  timeoutSeconds?: number;
  /** Maximum number of retry attempts. */
  maxRetries?: number;
  /** Whether this step requires explicit approval before execution. */
  requiresApproval?: boolean;
}

export interface RunbookVerificationDefinition {
  steps: RunbookStepDefinition[];
  /** Delay in seconds before running verification. */
  delaySeconds?: number;
}

export interface RunbookPrecheckDefinition {
  steps: RunbookStepDefinition[];
}

// ---------------------------------------------------------------------------
// Full runbook definition (stored as RunbookVersion.definition)
// ---------------------------------------------------------------------------

export interface RunbookDefinition {
  steps: RunbookStepDefinition[];
  description?: string;
  /** Default timeout for the entire runbook execution in seconds. */
  defaultTimeoutSeconds?: number;
  /** Default retry policy for all steps. */
  defaultMaxRetries?: number;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Maximum number of steps in a single runbook. */
export const MAX_RUNBOOK_STEPS = 50;

/** Maximum number of inputs a runbook can declare. */
export const MAX_RUNBOOK_INPUTS = 30;

/** Maximum output preview stored in PostgreSQL (bytes). */
export const MAX_OUTPUT_PREVIEW_BYTES = 32_768; // 32 KB

/** Default lease duration for agent job claims (seconds). */
export const DEFAULT_LEASE_DURATION_SECONDS = 300; // 5 minutes

/** Default timeout for runbook execution (seconds). */
export const DEFAULT_EXECUTION_TIMEOUT_SECONDS = 3600; // 1 hour

/** Default timeout for a single step (seconds). */
export const DEFAULT_STEP_TIMEOUT_SECONDS = 600; // 10 minutes

/** Maximum concurrent automatic write actions per service. */
export const MAX_AUTO_WRITE_ACTIONS_PER_SERVICE = 3;

/** Maximum concurrent write actions per agent pool. */
export const MAX_CONCURRENT_WRITE_ACTIONS_PER_POOL = 5;

/** Circuit breaker: fail count before pausing automatic execution. */
export const CIRCUIT_BREAKER_FAIL_THRESHOLD = 3;
