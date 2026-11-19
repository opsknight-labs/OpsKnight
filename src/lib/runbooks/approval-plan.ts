import { resolveInputTemplates } from '@/lib/runbooks/definition';
import { redactRunbookOutput } from '@/lib/runbooks/redaction';
import { MCP_REDACTED_FIELDS } from '@/lib/mcp/core/projection';

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
  inputValues: Record<string, unknown>,
  /** Already-redacted values a reviewer may see (see approvalInputPreview); others stay masked. */
  shownInputs: Record<string, string> = {}
): Array<[string, string]> {
  const keys = PLAN_KEYS.get(type) ?? [];
  // Review permission does not grant access to submitted input values. Mask before
  // interpolation so arbitrary plaintext cannot bypass output-pattern redaction.
  const shown = new Map(Object.entries(shownInputs));
  const displayInputs = Object.fromEntries(
    Object.keys(inputValues ?? {}).map(key => [key, shown.get(key) ?? '[input withheld]'])
  );
  const resolved = resolveInputTemplates(config, displayInputs) as Record<string, unknown>;
  return Object.entries(resolved)
    .filter(([key, value]) => keys.includes(key) && value !== undefined)
    .map(([key, value]) => [
      key.replace(/([A-Z])/g, ' $1').replace(/^./, letter => letter.toUpperCase()),
      safePlanValue(value),
    ]);
}

const INPUT_PREVIEW_CHARS = 200;
const MAX_INPUT_ROWS = 30;

/**
 * What a reviewer of an assistant's runbook request sees for each submitted input. The inputs
 * decide what a step does (a unit name, a replica count, a path), so an approver who sees only
 * "[input withheld]" cannot judge the change. A value is shown after the same redaction applied
 * to run output; a secret reference, an input of type SECRET_REF and an input whose name looks
 * like a credential are never shown. Long values are cut and say so.
 */
export function approvalInputPreview(
  declared: ReadonlyArray<{ key: string; type?: string | null }>,
  values: Record<string, unknown>
): Array<{ key: string; type: string; value: string }> {
  const types = new Map(declared.map(input => [input.key, input.type ?? 'STRING']));
  return Object.entries(values ?? {})
    .slice(0, MAX_INPUT_ROWS)
    .map(([key, value]) => {
      const type = types.get(key) ?? 'UNDECLARED';
      if (type === 'SECRET_REF' || MCP_REDACTED_FIELDS.test(key))
        return { key, type, value: '[withheld: credential]' };
      const text = typeof value === 'string' ? value : (JSON.stringify(value) ?? '');
      if (text.includes('secret://')) return { key, type, value: '[scoped secret]' };
      const redacted = redactRunbookOutput(text).replace(
        /\b(?:Bearer\s+\S+|ok_[A-Za-z0-9_-]{16,})/gi,
        '[REDACTED]'
      );
      const cut = redacted.slice(0, INPUT_PREVIEW_CHARS);
      const notes = [
        redacted !== text ? ' [part not shown]' : '',
        redacted.length > cut.length ? ' [shortened]' : '',
      ].join('');
      return { key, type, value: `${cut}${notes}` };
    });
}
