import { builtinFields, type Context, type Field } from '../contract';
import { normalizeEventValue } from './normalize';
/** Shared production/test normalization, including scalar size and credential guards. */
export function builtinContext(input: {
  priority: string | null;
  urgency: string;
  severity: string;
  integrationType: string;
  source: string;
}): Context {
  const normalize = (raw: string | null, field: Field) => normalizeEventValue(raw, field).canonical;
  return {
    priority: normalize(input.priority, builtinFields[0]),
    urgency: normalize(input.urgency, builtinFields[1]),
    severity: normalize(input.severity, builtinFields[2]),
    integration: normalize(input.integrationType, builtinFields[3]),
    source: normalize(input.source, builtinFields[4]),
  };
}
