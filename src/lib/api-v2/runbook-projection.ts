import { requiresAgent, type RunbookStepType } from '@/lib/runbooks/types';

/**
 * Public, read-only view of a runbook step.
 *
 * A step's `config` holds executable material: shell commands, HTTP targets and
 * headers, environment values and secret references. The REST surface only reads
 * and executes runbooks, so it exposes what a caller needs to understand and run
 * one (what it is, how risky it is, whether it needs approval or an agent) and
 * never the configuration. Definition authoring stays in the product UI.
 */
export interface ApiRunbookStep {
  key: string;
  name: string;
  type: string;
  riskClass: string | null;
  description: string | null;
  requiresApproval: boolean;
  requiresAgent: boolean;
  timeoutSeconds: number | null;
  maxRetries: number | null;
  precheckSteps: ApiRunbookStep[];
  verificationSteps: ApiRunbookStep[];
}

const MAX_NESTING = 3;

function str(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function num(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function nestedSteps(container: unknown, depth: number): ApiRunbookStep[] {
  const steps = (container as { steps?: unknown } | null | undefined)?.steps;
  return Array.isArray(steps) ? steps.map(step => projectRunbookStep(step, depth + 1)) : [];
}

export function projectRunbookStep(raw: unknown, depth = 0): ApiRunbookStep {
  const step = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const type = str(step.type);
  return {
    key: str(step.key) ?? '',
    name: str(step.name) ?? '',
    type: type ?? 'UNKNOWN',
    riskClass: str(step.riskClass),
    description: str(step.description),
    requiresApproval: step.requiresApproval === true || type === 'APPROVAL',
    requiresAgent: type ? requiresAgent(type as RunbookStepType) : false,
    timeoutSeconds: num(step.timeoutSeconds),
    maxRetries: num(step.maxRetries),
    precheckSteps: depth < MAX_NESTING ? nestedSteps(step.precheck, depth) : [],
    verificationSteps: depth < MAX_NESTING ? nestedSteps(step.verification, depth) : [],
  };
}

export function projectRunbookSteps(definition: unknown): ApiRunbookStep[] {
  const steps = (definition as { steps?: unknown } | null | undefined)?.steps;
  return Array.isArray(steps) ? steps.map(step => projectRunbookStep(step)) : [];
}
