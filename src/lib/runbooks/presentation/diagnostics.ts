import 'server-only';
import { redactRunbookOutput } from '../redaction';

export function formatDiagnosticEvidence(value: unknown): string {
  if (value === null || value === undefined) return 'Not recorded';
  // Evidence is not a raw configuration dump; additionally hide credential-shaped keys.
  const serialized = JSON.stringify(value, (key, entry: unknown) => /secret|password|token|authorization|private.?key|credential/i.test(key) ? '[REDACTED]' : entry, 2);
  return redactRunbookOutput(serialized ?? 'Not recorded');
}
