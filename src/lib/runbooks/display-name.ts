import { resolveInputTemplates } from './shared-definition';
import { redactRunbookOutput } from './redaction';

/** Resolve descriptive metadata without exposing sensitive input values or secret identifiers. */
export function redactRunbookDisplayName(
  name: string,
  inputValues?: Record<string, unknown>,
  inputTypes: ReadonlyArray<{ key: string; type: string }> = []
): string {
  const sensitiveKeys = new Set(
    inputTypes.filter(input => input.type === 'SECRET_REF').map(input => input.key)
  );
  const displayInputs = Object.fromEntries(
    Object.entries(inputValues ?? {}).map(([key, value]) => [
      key,
      sensitiveKeys.has(key) || /secret|password|token|authorization|credential|api.?key/i.test(key)
        ? '[REDACTED]'
        : value,
    ])
  );
  return redactRunbookOutput(
    String(inputValues ? resolveInputTemplates(name, displayInputs) : name).replace(
      /secret:\/\/[a-z0-9-]+/g,
      '[REDACTED]'
    )
  );
}

/** Structured review output never exposes credential fields or secret references. */
export function redactRunbookConfiguration(value: unknown, key = ''): unknown {
  if (/secret|password|token|authorization|credential|api.?key/i.test(key)) return '[REDACTED]';
  if (typeof value === 'string') return redactRunbookDisplayName(value);
  if (Array.isArray(value)) return value.map(item => redactRunbookConfiguration(item));
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value).map(([field, item]) => [field, redactRunbookConfiguration(item, field)])
    );
  return value;
}
