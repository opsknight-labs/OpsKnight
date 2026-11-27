import { redactRunbookConfiguration } from '@/lib/runbooks/display-name';
import type { BindingReadiness } from '@/lib/runbooks/binding-readiness';
import { formatDateTime } from '@/lib/timezone';

export type RuleStatusKind = 'AUTOMATIC' | 'SUGGESTED' | 'MANUAL' | 'PAUSED' | 'ARCHIVED';

export function ruleStatusKind(rule: {
  mode: string;
  enabled: boolean;
  detachedAt: Date | null;
}): RuleStatusKind {
  if (rule.detachedAt) return 'ARCHIVED';
  if (!rule.enabled) return 'PAUSED';
  return rule.mode === 'AUTOMATIC' || rule.mode === 'SUGGESTED' ? rule.mode : 'MANUAL';
}

export const MODE_LABELS: Record<string, string> = {
  AUTOMATIC: 'Automatic',
  SUGGESTED: 'Suggested',
  MANUAL: 'Manual',
};

export function strategyLabel(strategy: string): string {
  return strategy === 'PINNED' ? 'pinned' : 'latest published';
}

const EVENT_LABELS = new Map<string, string>([
  ['INCIDENT_CREATED', 'Incident created'],
  ['INCIDENT_UPDATED', 'Incident updated'],
  ['URGENCY_CHANGED', 'Urgency changed'],
  ['STATUS_CHANGED', 'Status changed'],
  ['ALERT_RECEIVED', 'Alert received'],
  ['MANUAL', 'Manual'],
  ['API', 'API'],
  ['CHATOPS', 'ChatOps'],
  ['SCHEDULED', 'Scheduled'],
]);

export function eventLabel(event: string): string {
  return EVENT_LABELS.get(event) ?? event.replaceAll('_', ' ').toLowerCase();
}

const FIELD_LABELS = new Map<string, string>([
  ['incident.id', 'Incident ID'],
  ['incident.urgency', 'Incident urgency'],
  ['incident.priority', 'Incident priority'],
  ['incident.status', 'Incident status'],
  ['incident.title', 'Incident title'],
  ['incident.description', 'Incident description'],
  ['incident.tags', 'Incident tags'],
  ['service.id', 'Service ID'],
  ['service.name', 'Service name'],
  ['service.teamId', 'Service team'],
]);

export function conditionFieldLabel(field: string): string {
  const known = FIELD_LABELS.get(field) ?? FIELD_LABELS.get(`incident.${field}`);
  if (known) return known;
  const input = /^inputs?\.(.+)$/.exec(field);
  return input ? `Input ${input[1]}` : field;
}

const OPERATOR_LABELS = new Map<string, string>([
  ['EQUALS', '='],
  ['NOT_EQUALS', '≠'],
  ['CONTAINS', 'contains'],
  ['STARTS_WITH', 'starts with'],
  ['IN', 'is one of'],
  ['NOT_IN', 'is not one of'],
  ['EXISTS', 'exists'],
  ['NOT_EXISTS', 'does not exist'],
]);

export function formatConditionValue(value: unknown): string {
  const redacted = redactRunbookConfiguration(value);
  if (Array.isArray(redacted)) return redacted.map(item => formatScalar(item)).join(', ');
  return formatScalar(redacted);
}

function formatScalar(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return JSON.stringify(value);
}

export function describeCondition(condition: {
  field: string;
  operator: string;
  value: unknown;
}): string {
  const field = conditionFieldLabel(condition.field);
  const operator = OPERATOR_LABELS.get(condition.operator) ?? condition.operator.toLowerCase();
  if (condition.operator === 'EXISTS' || condition.operator === 'NOT_EXISTS')
    return `${field} ${operator}`;
  return `${field} ${operator} ${formatConditionValue(condition.value)}`.trim();
}

export type ReadinessTone = 'success' | 'warning' | 'danger' | 'neutral';

export function readinessPresentation(state: BindingReadiness['state']): {
  label: string;
  tone: ReadinessTone;
} {
  switch (state) {
    case 'CONFIGURATION_VALID':
      return { label: 'Configuration valid', tone: 'success' };
    case 'CHECKS_REQUIRED':
      return { label: 'Checks required', tone: 'warning' };
    case 'BLOCKED':
      return { label: 'Blocked', tone: 'danger' };
    case 'UNKNOWN':
      return { label: 'Unknown', tone: 'danger' };
    default:
      return { label: 'Paused', tone: 'neutral' };
  }
}

export const TONE_DOT: Record<ReadinessTone, string> = {
  success: 'bg-emerald-500',
  warning: 'bg-amber-500',
  danger: 'bg-rose-500',
  neutral: 'bg-slate-400',
};

export const TONE_TEXT: Record<ReadinessTone, string> = {
  success: 'text-emerald-700 dark:text-emerald-400',
  warning: 'text-amber-700 dark:text-amber-400',
  danger: 'text-rose-700 dark:text-rose-400',
  neutral: 'text-muted-foreground',
};

export function readinessFixHint(
  code: string,
  serviceId: string,
  runbookId: string
): { label: string; href: string } | null {
  const configure = `/services/${serviceId}?tab=runbooks`;
  if (code.startsWith('AGENT_POLICY_'))
    return {
      label: 'Review Agent local policy',
      href: `/runbooks/agents?agentId=${encodeURIComponent(code.slice('AGENT_POLICY_'.length))}`,
    };
  if (code.startsWith('TARGET_CHECK_')) return { label: 'Review target', href: '#target' };
  switch (code) {
    case 'NO_TRIGGER':
      return { label: 'Enable an incident-created trigger', href: configure };
    case 'VERSION_NOT_PINNED':
      return { label: 'Pin a published version', href: configure };
    case 'VERSION_UNAVAILABLE':
      return { label: 'Publish or select an available version', href: `/runbooks/${runbookId}` };
    case 'AUTOMATIC_DYNAMIC_TARGET_UNSUPPORTED':
    case 'TARGET_MISSING':
    case 'TARGET_TOO_BROAD':
    case 'AUTOMATIC_POLICY_TARGET_LIMIT':
    case 'TARGET_AMBIGUOUS':
      return { label: 'Adjust the rule target', href: configure };
    case 'AGENT_OFFLINE':
      return { label: 'Check Agent fleet health', href: '/runbooks/agents' };
    case 'CHECK_UNAVAILABLE':
      return { label: 'Validate configuration again', href: '#checks' };
    default:
      return null;
  }
}

export function shortChecksum(checksum: string | null | undefined, length = 12): string {
  return checksum ? checksum.slice(0, length) : '—';
}

export function formatAbsolute(date: Date, timeZone: string = 'UTC'): string {
  return formatDateTime(date, timeZone, { format: 'datetime', includeTimeZone: true });
}

export function formatDuration(
  startedAt: Date | null,
  completedAt: Date | null,
  status: string
): string {
  if (!startedAt) return '—';
  if (!completedAt)
    return ['RUNNING', 'WAITING_AGENT', 'WAITING_APPROVAL'].includes(status) ? 'In progress' : '—';
  const seconds = Math.max(0, Math.round((completedAt.getTime() - startedAt.getTime()) / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ${seconds % 60}s`;
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

const TERMINAL = new Set(['SUCCEEDED', 'FAILED', 'TIMED_OUT', 'CANCELLED']);

export function successRate(executions: ReadonlyArray<{ status: string }>): number | null {
  const finished = executions.filter(execution => TERMINAL.has(execution.status));
  if (finished.length === 0) return null;
  return Math.round(
    (finished.filter(execution => execution.status === 'SUCCEEDED').length / finished.length) * 100
  );
}

export type RuleInputRow = { key: string; label: string; value: string; secret: boolean };

export function ruleInputRows(
  definitions: ReadonlyArray<{ key: string; label: string; type: string; defaultValue: unknown }>,
  values: unknown
): RuleInputRow[] {
  const configured =
    values && typeof values === 'object' && !Array.isArray(values)
      ? (values as Record<string, unknown>)
      : {};
  const rows: RuleInputRow[] = definitions.map(input => {
    const value = configured[input.key] ?? input.defaultValue;
    const secret = input.type === 'SECRET_REF';
    return {
      key: input.key,
      label: input.label || input.key,
      secret,
      value:
        value === undefined || value === null || value === ''
          ? 'Not set'
          : secret
            ? 'Configured secret reference'
            : formatScalar(redactRunbookConfiguration(value, input.key)),
    };
  });
  for (const [key, value] of Object.entries(configured)) {
    if (definitions.some(input => input.key === key)) continue;
    rows.push({
      key,
      label: key,
      secret: false,
      value: formatScalar(redactRunbookConfiguration(value, key)),
    });
  }
  return rows;
}
