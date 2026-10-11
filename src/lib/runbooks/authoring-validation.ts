import { RunbookDefinitionError } from './errors';
import { parseRunbookDefinition } from './shared-definition';
import { runbookDefinitionSchema, runbookInputsSchema } from './schemas';
import type { RunbookDefinition } from './types';

export interface AuthoringIssue {
  code: string;
  path: (string | number)[];
  severity: 'error';
  message: string;
  stepKey?: string;
}

/** Runs the same parser used by save, publish and execution, without Node or database dependencies. */
export function validateAuthoringDefinition(raw: unknown, inputs: unknown): AuthoringIssue[] {
  const issues: AuthoringIssue[] = [];
  const definitionResult = runbookDefinitionSchema.safeParse(raw);
  const inputResult = runbookInputsSchema.safeParse(inputs);
  for (const [prefix, result] of [
    ['definition', definitionResult],
    ['inputs', inputResult],
  ] as const) {
    if (!result.success)
      for (const issue of result.error.issues) {
        issues.push({
          code: issue.path.includes('defaultValue') ? 'INPUT_DEFAULT_INVALID' : 'SCHEMA_INVALID',
          path: [prefix, ...issue.path],
          severity: 'error',
          message: issue.message,
        });
      }
  }
  if (issues.length) return issues;
  try {
    parseRunbookDefinition(raw, inputResult.success ? inputResult.data : []);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Invalid definition.';
    const stepKey = /Step "([^"]+)"/.exec(message)?.[1];
    const path: (string | number)[] = ['definition'];
    const findStep = (steps: RunbookDefinition['steps'], parent: (string | number)[]): boolean => {
      for (const [index, step] of steps.entries()) {
        const candidate = [...parent, index];
        if (step.key === stepKey) {
          path.splice(0, path.length, ...candidate);
          return true;
        }
        for (const kind of ['precheck', 'verification'] as const) {
          // Only the fixed precheck/verification property names are selected.
          // eslint-disable-next-line security/detect-object-injection
          const nested = step[kind]?.steps;
          if (nested && findStep(nested, [...candidate, kind, 'steps'])) return true;
        }
      }
      return false;
    };
    if (stepKey && definitionResult.success)
      findStep((definitionResult.data as RunbookDefinition).steps, ['definition', 'steps']);
    issues.push({
      code: /undeclared/.test(message)
        ? 'INPUT_REFERENCE_UNDECLARED'
        : /nest/.test(message)
          ? 'DEFINITION_DEPTH_EXCEEDED'
          : /requires at least/.test(message)
            ? 'RISK_CLASS_TOO_LOW'
            : 'DEFINITION_INVALID',
      path,
      severity: 'error',
      message,
      stepKey,
    });
  }
  return issues;
}

export function assertAuthoringDefinition(raw: unknown, inputs: unknown): void {
  const issues = validateAuthoringDefinition(raw, inputs);
  if (issues.length)
    throw new RunbookDefinitionError(issues.map(issue => issue.message).join('; '), { issues });
}
