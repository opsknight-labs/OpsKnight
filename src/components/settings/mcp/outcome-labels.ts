import type { PillTone } from '@/components/settings/mcp/McpListKit';

/** Plain labels for the bounded request outcomes recorded in the activity log. */
const OUTCOME = new Map<string, { label: string; tone: PillTone }>([
  ['served', { label: 'Answered', tone: 'success' }],
  ['task_created', { label: 'Started a task', tone: 'success' }],
  ['subscription_opened', { label: 'Listening', tone: 'info' }],
  ['tool_error', { label: 'Tool error', tone: 'warning' }],
  ['protocol_rejected', { label: 'Rejected request', tone: 'warning' }],
  ['subscription_rejected', { label: 'Rejected request', tone: 'warning' }],
  ['invalid_request', { label: 'Invalid request', tone: 'warning' }],
  ['result_too_large', { label: 'Result too large', tone: 'warning' }],
  ['rate_limited', { label: 'Rate limited', tone: 'warning' }],
  ['busy', { label: 'Server busy', tone: 'warning' }],
  ['unauthenticated', { label: 'Not signed in', tone: 'danger' }],
  ['forbidden', { label: 'Not allowed', tone: 'danger' }],
  ['disabled', { label: 'MCP turned off', tone: 'danger' }],
  ['unavailable', { label: 'Unavailable', tone: 'danger' }],
  ['error', { label: 'Server error', tone: 'danger' }],
]);

export function outcomeMeta(outcome: string) {
  return OUTCOME.get(outcome) ?? { label: outcome, tone: 'neutral' as PillTone };
}
