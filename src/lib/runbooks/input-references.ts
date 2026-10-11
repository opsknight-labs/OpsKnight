import type { RunbookDefinition, RunbookStepDefinition } from './types';

/** Rewrites values only; object keys and ordinary condition-looking text are preserved. */
export function rewriteInputReferences(
  definition: RunbookDefinition,
  oldKey: string,
  newKey: string
): RunbookDefinition {
  if (!oldKey || !newKey || oldKey === newKey) return definition;
  const rewrite = (value: unknown): unknown => {
    if (typeof value === 'string')
      return value.replace(/\$\{\{\s*inputs\.([a-z0-9_]+)\s*\}\}/g, (match, key: string) =>
        key === oldKey ? `\${{ inputs.${newKey} }}` : match
      );
    if (Array.isArray(value)) return value.map(rewrite);
    if (value && typeof value === 'object')
      return Object.fromEntries(
        Object.entries(value).map(([key, nested]) => [key, rewrite(nested)])
      );
    return value;
  };
  const visit = (step: RunbookStepDefinition): RunbookStepDefinition => {
    const config = rewrite(step.config) as Record<string, unknown>;
    if (
      step.type === 'CONDITION' &&
      (config.field === `input.${oldKey}` || config.field === `inputs.${oldKey}`)
    ) {
      config.field = `input.${newKey}`;
    }
    if (step.type === 'BASH' && typeof config.command === 'string') {
      config.command = config.command.replace(
        /\bOPSKNIGHT_INPUT_([A-Z0-9_]+)\b/g,
        (match, key: string) =>
          key === oldKey.toUpperCase() ? `OPSKNIGHT_INPUT_${newKey.toUpperCase()}` : match
      );
    }
    return {
      ...step,
      name: rewrite(step.name) as string,
      description: rewrite(step.description) as string | undefined,
      config,
      ...(step.precheck
        ? { precheck: { ...step.precheck, steps: step.precheck.steps.map(visit) } }
        : {}),
      ...(step.verification
        ? { verification: { ...step.verification, steps: step.verification.steps.map(visit) } }
        : {}),
    };
  };
  return { ...definition, steps: definition.steps.map(visit) };
}
