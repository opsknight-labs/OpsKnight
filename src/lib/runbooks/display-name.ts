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
