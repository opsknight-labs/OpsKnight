import type { SavedActionReference } from '@/lib/intelligence/conversations/contract';
import type { SquireProposalView } from './SquireProposalCard';
export type Citation = {
  kind: 'incident' | 'runbook' | 'change' | 'alert' | 'service' | 'schedule' | 'postmortem';
  id: string;
  label: string;
  href: string;
  observedAt?: string;
  why?: string;
};
export type Turn = {
  id?: string;
  role: 'user' | 'assistant';
  content: string;
  contextProof?: string;
  notice?: string;
  mode?: 'ai' | 'basic';
  /** The deterministic intent a basic answer was built for; sent with feedback. */
  intent?: string;
  /** What the assistant is looking up right now. */
  activity?: string;
  /** Shown after partial text when the answer was cut off. */
  error?: string;
  failed?: boolean;
  proposals?: SquireProposalView[];
  savedActions?: SavedActionReference[];
  citations?: Citation[];
  suggestions?: string[];
  /** The incident page the turn was asked on; history only carries turns from the same page. */
  incidentId?: string;
  /** Steps of an investigation answer, in order. */
  investigation?: InvestigationStepView[];
};

/** Mirrors `SquireInvestigationStep` from the server contract (kept dependency-free for the client). */
export type InvestigationStepView = {
  index: number;
  title: string;
  status: 'running' | 'done' | 'failed';
  calls: Array<{ tool: string; label: string; ok?: boolean }>;
};

/** Replaces the step with the same index, or appends it; ignores anything malformed. */
export function mergeInvestigationStep(
  steps: InvestigationStepView[] | undefined,
  step: unknown
): InvestigationStepView[] | undefined {
  if (!step || typeof step !== 'object') return steps;
  const value = step as Partial<InvestigationStepView>;
  if (
    typeof value.index !== 'number' ||
    typeof value.title !== 'string' ||
    !['running', 'done', 'failed'].includes(value.status ?? '') ||
    !Array.isArray(value.calls)
  )
    return steps;
  const clean: InvestigationStepView = {
    index: value.index,
    title: value.title.slice(0, 200),
    status: value.status as InvestigationStepView['status'],
    calls: value.calls
      .filter(call => call && typeof call.tool === 'string' && typeof call.label === 'string')
      .slice(0, 8)
      .map(call => ({
        tool: call.tool,
        label: call.label.slice(0, 120),
        ...(typeof call.ok === 'boolean' ? { ok: call.ok } : {}),
      })),
  };
  const others = (steps ?? []).filter(existing => existing.index !== clean.index);
  return [...others, clean].sort((a, b) => a.index - b.index).slice(0, 16);
}
