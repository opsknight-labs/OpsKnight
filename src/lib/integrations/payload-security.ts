import type { IntegrationEventEnvelope } from '@/lib/automation/runtime';
import { eventDedupKey } from '@/lib/incidents/event-identity';

const CREDENTIAL_PATTERNS = [
  /Bearer\s+[A-Za-z0-9\-_.]+/gi,
  /Basic\s+[A-Za-z0-9+/=]{16,}/gi,
  /\bok_[A-Za-z0-9_-]{20,}\b/g,
  /xox[baprs]-[0-9]{10,13}-[0-9]{10,13}[a-zA-Z0-9-]*/g,
  /AKIA[0-9A-Z]{16}/g,
];

/** Credential filtering for retained business context. Unlike diagnostic
 * sanitization this preserves contact fields used by Automation routing. */
export function sanitizeCredentialString(value: string): string {
  // Scan URLs once with a bounded scheme. Applying a scheme-search regex
  // repeatedly to long plain strings causes quadratic work on alert bodies.
  let result = value.includes('://')
    ? value.replace(/[a-zA-Z][a-zA-Z0-9+.-]{0,127}:\/\/[^\s<>"']+/g, uri =>
        uri
          .replace(/^([^:]+:\/\/)([^:\s/@]+):([^@\s/]+)@/, '$1$2:[REDACTED]@')
          .replace(/^([^:]+:\/\/):([^@\s/]+)@/, '$1:[REDACTED]@')
          .replace(
            /([?&](?:token|secret|key|sig|signature|api_key|password|pwd)=)[^&#\s]*/gi,
            '$1[REDACTED]'
          )
      )
    : value;
  // Exclude diagnostic email removal and the legacy unbounded URL pattern.
  for (const pattern of CREDENTIAL_PATTERNS) result = result.replace(pattern, '[REDACTED]');
  return result;
}

// Match credential field names without destroying domain keys such as groupKey,
// dedup_key, monkey, or fingerprint. This boundary is shared by inbox storage,
// Service Automation, alert storage, and incident descriptions.
const CREDENTIAL_FIELD =
  /^(?:routingkey|xapikey|xintegrationkey|apikey|accesskey|secretaccesskey|privatekey|password|passwd|authorization|proxyauthorization|cookie|setcookie|clientsecret|signingsecret|signaturesecret|webhooksecret|connectionstring|databaseurl|dsn|bearer|jwt|credentials?|.*token|.*password|.*secret)$/i;

export function sanitizeProviderData(value: unknown, seen = new WeakSet<object>()): unknown {
  if (typeof value === 'string') return sanitizeCredentialString(value);
  if (value === null || typeof value !== 'object') return value;
  if (seen.has(value)) return '[CIRCULAR]';
  seen.add(value);
  const result = Array.isArray(value)
    ? value.map(item => sanitizeProviderData(item, seen))
    : Object.fromEntries(
        Object.entries(value).map(([key, item]) => [
          key,
          CREDENTIAL_FIELD.test(key.replace(/[^a-z0-9]/gi, ''))
            ? '[REDACTED]'
            : sanitizeProviderData(item, seen),
        ])
      );
  seen.delete(value);
  return result;
}

export function sanitizeIntegrationEnvelope(
  input: IntegrationEventEnvelope
): IntegrationEventEnvelope {
  return {
    ...input,
    event: {
      ...input.event,
      // Preserve the original implicit identity before credentials are removed.
      dedup_key:
        input.event.dedup_key.trim() || eventDedupKey(input.event.dedup_key, input.event.payload),
      payload: {
        ...input.event.payload,
        summary: sanitizeCredentialString(input.event.payload.summary),
        source: sanitizeCredentialString(input.event.payload.source),
        custom_details: sanitizeProviderData(input.event.payload.custom_details),
      },
    },
    providerPayload: sanitizeProviderData(input.providerPayload),
  };
}
