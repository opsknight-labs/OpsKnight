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
  return {
    priority: normalizeValue(input.priority, builtinFields[0]),
    urgency: normalizeValue(input.urgency, builtinFields[1]),
    severity: normalizeValue(input.severity, builtinFields[2]),
    integration: normalizeValue(input.integrationType, builtinFields[3]),
    source: normalizeValue(input.source, builtinFields[4]),
  };
}
