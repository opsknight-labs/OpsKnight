import 'server-only';
import { redactRunbookOutput } from '../redaction';

export function formatDiagnosticEvidence(
  value: unknown,
  inputValues: Record<string, unknown> = {}
): string {
  if (value === null || value === undefined) return 'Not recorded';
  const knownValues = Object.values(inputValues ?? {})
    .filter((entry): entry is string => typeof entry === 'string' && entry.length > 0)
    .sort((a, b) => b.length - a.length);
  // Redact leaf strings before JSON escaping, including arbitrary values that
  // have no credential-shaped name or recognizable token prefix.
  // Evidence is not a raw configuration dump; additionally hide credential-shaped keys.
  const serialized = JSON.stringify(
    value,
    (key, entry: unknown) =>
      /secret|password|token|authorization|private.?key|credential/i.test(key)
        ? '[REDACTED]'
        : typeof entry === 'string'
          ? redactRunbookOutput(entry, knownValues)
          : entry,
    2
  );
  // Object keys and serialized escapes can also contain submitted values.
  const serializedValues = [
    ...new Set(knownValues.flatMap(entry => [entry, JSON.stringify(entry).slice(1, -1)])),
  ];
  return redactRunbookOutput(serialized ?? 'Not recorded', serializedValues);
}
