import { resolveInputTemplates } from '@/lib/runbooks/definition';
import { redactRunbookOutput } from '@/lib/runbooks/redaction';

const PLAN_KEYS = new Map<string, string[]>([
  ['HTTP', ['method', 'url']],
  ['SYSTEMD', ['action', 'unit']],
  ['DOCKER', ['action', 'container']],
  ['KUBERNETES', ['action', 'namespace', 'resource', 'name']],
  ['BASH', ['command']],
  ['WAIT', ['durationSeconds']],
]);

function safePlanValue(value: unknown): string {
  if (typeof value !== 'string') return JSON.stringify(value).slice(0, 500);
  if (value.includes('secret://')) return '[scoped secret]';
  try {
    const url = new URL(value);
    url.username = '';
    url.password = '';
    return redactRunbookOutput(url.toString()).slice(0, 500);
  } catch {
    return redactRunbookOutput(value).slice(0, 500);
  }
}

/** Human-readable, secret-safe summary of the resolved action an approver authorizes. */
export function resolvedApprovalPlan(
  type: string,
  config: Record<string, unknown>,
  inputValues: Record<string, unknown>
): Array<[string, string]> {
  const keys = PLAN_KEYS.get(type) ?? [];
  const resolved = resolveInputTemplates(config, inputValues) as Record<string, unknown>;
  return Object.entries(resolved)
    .filter(([key, value]) => keys.includes(key) && value !== undefined)
    .map(([key, value]) => [
      key.replace(/([A-Z])/g, ' $1').replace(/^./, letter => letter.toUpperCase()),
      safePlanValue(value),
    ]);
}
