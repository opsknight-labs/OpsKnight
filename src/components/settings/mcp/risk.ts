import type { McpRisk } from '@/lib/mcp/catalog/capabilities';

/**
 * One source for how MCP risk classes look and read on every screen: the approvals queue, the
 * review pages and Exposed capabilities. Client-safe (no catalog import).
 */
export const MCP_RISK: Record<McpRisk, { title: string; short: string; className: string }> = {
  R0: {
    title: 'Read only',
    short: 'Read only',
    className:
      'border-blue-300 bg-blue-50 text-blue-900 dark:border-blue-500/50 dark:bg-blue-500/10 dark:text-blue-200',
  },
  R1: {
    title: 'Routine change',
    short: 'Routine',
    className:
      'border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-500/50 dark:bg-amber-500/10 dark:text-amber-200',
  },
  R2: {
    title: 'Sensitive change',
    short: 'Sensitive',
    className:
      'border-orange-300 bg-orange-50 text-orange-900 dark:border-orange-500/50 dark:bg-orange-500/10 dark:text-orange-200',
  },
  R3: {
    title: 'Destructive or high-impact change',
    short: 'Destructive',
    className:
      'border-rose-300 bg-rose-50 text-rose-900 dark:border-rose-500/50 dark:bg-rose-500/10 dark:text-rose-200',
  },
};

const RISKS = new Map(Object.entries(MCP_RISK));
const NEUTRAL = 'border-border bg-muted/60 text-muted-foreground';

/**
 * Display data for any risk value. R0–R3 get their class colours; anything else (runbook steps
 * use READ_ONLY, IDEMPOTENT_WRITE and NON_IDEMPOTENT) shows its raw value in a neutral pill.
 */
export function riskMeta(risk: string) {
  return RISKS.get(risk) ?? { title: risk, short: risk, className: NEUTRAL };
}

/** "R3 · Destructive or high-impact change": the code stays visible for policy matching. */
export function riskLabel(risk: string) {
  const meta = riskMeta(risk);
  return RISKS.has(risk) ? `${risk} · ${meta.title}` : meta.title;
}

/** The pill markup shared by every risk badge. */
export const RISK_PILL_CLASS =
  'inline-flex items-center whitespace-nowrap rounded-md border px-2 py-0.5 text-[11px] font-semibold leading-4';
