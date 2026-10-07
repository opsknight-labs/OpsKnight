import { builtinFields, type Context } from '../contract';
import { normalizeValue } from './normalize';
/** Shared production/test normalization, including scalar size and credential guards. */
export function builtinContext(input: {
  priority: string | null;
  urgency: string;
  severity: string;
  integrationType: string;
  source: string;
}): Context {
  const values = new Map<string, string | null>([
    ['priority', input.priority],
    ['urgency', input.urgency],
    ['severity', input.severity],
    ['integration', input.integrationType],
    ['source', input.source],
  ]);
  return Object.fromEntries(
    builtinFields.map(field => [field.key, normalizeValue(values.get(field.key), field)])
  );
}
