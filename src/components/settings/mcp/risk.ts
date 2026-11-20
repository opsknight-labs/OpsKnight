import type { McpRisk } from '@/lib/mcp/catalog/capabilities';
import { toneClasses } from '@/components/patterns/status-tone';

/**
 * One source for how MCP risk classes look and read on every screen: the approvals queue, the
 * review pages and Exposed capabilities. Client-safe (no catalog import).
 */
export const MCP_RISK: Record<McpRisk, { title: string; short: string; className: string }> = {
  R0: {
    title: 'Read only',
    short: 'Read only',
    className: toneClasses('info').soft,
  },
  R1: {
    title: 'Routine change',
    short: 'Routine',
    className: toneClasses('elevated').soft,
  },
  R2: {
    title: 'Sensitive change',
    short: 'Sensitive',
    className: toneClasses('critical').soft,
  },
  R3: {
    title: 'Destructive or high-impact change',
    short: 'Destructive',
    className: toneClasses('critical').filled,
  },
};

const RISKS = new Map(Object.entries(MCP_RISK));
const NEUTRAL = toneClasses('neutral').soft;

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
  'inline-flex items-center whitespace-nowrap rounded-md border px-2 py-0.5 text-2xs font-semibold leading-4';

/** Runbook step risk classes (src/lib/runbooks/types.ts), lowest first, in plain words. */
const RUNBOOK_STEP_RISK = new Map([
  ['READ_ONLY', { title: 'Read only', className: MCP_RISK.R0.className }],
  ['IDEMPOTENT_WRITE', { title: 'Change, safe to repeat', className: MCP_RISK.R1.className }],
  ['NON_IDEMPOTENT', { title: 'Change, not safe to repeat', className: MCP_RISK.R3.className }],
]);
const RUNBOOK_RISK_ORDER = [...RUNBOOK_STEP_RISK.keys()];

export function runbookStepRiskMeta(risk: string) {
  return RUNBOOK_STEP_RISK.get(risk) ?? riskMeta(risk);
}

/** The highest-risk step of a plan, so the reviewer sees it without scrolling. Unknown ranks top. */
export function highestRunbookStepRisk(risks: readonly string[]): string | null {
  if (!risks.length) return null;
  const rank = (risk: string) => {
    const index = RUNBOOK_RISK_ORDER.indexOf(risk);
    return index === -1 ? RUNBOOK_RISK_ORDER.length : index;
  };
  return [...risks].sort((a, b) => rank(b) - rank(a))[0];
}
