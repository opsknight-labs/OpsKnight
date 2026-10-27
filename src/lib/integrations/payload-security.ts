import type { IntegrationEventEnvelope } from '@/lib/automation/runtime';
import { eventDedupKey } from '@/lib/incidents/event-identity';

const CREDENTIAL_PATTERNS = [
  /Bearer\s+[A-Za-z0-9\-_.]+/gi,
  /Basic\s+[A-Za-z0-9+/=]{16,}/gi,
  /\bok_[A-Za-z0-9_-]{20,}\b/g,
  /xox[baprs]-[0-9]{10,13}-[0-9]{10,13}[a-zA-Z0-9-]*/g,
  /AKIA[0-9A-Z]{16}/g,
  /-----BEGIN [A-Z0-9 ]{0,64}PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z0-9 ]{0,64}PRIVATE KEY-----|$)/g,
];

const CREDENTIAL_NAMES = new Set([
  'routingkey',
  'xapikey',
  'xintegrationkey',
  'apikey',
  'accesskey',
  'secretaccesskey',
  'privatekey',
  'secretkey',
  'password',
  'passwd',
  'pwd',
  'authorization',
  'authorizationheader',
  'proxyauthorization',
  'proxyauthorizationheader',
  'auth',
  'authheader',
  'authentication',
  'authenticationheader',
  'cookie',
  'setcookie',
  'clientsecret',
  'signingsecret',
  'signaturesecret',
  'webhooksecret',
  'connectionstring',
  'databaseurl',
  'dsn',
  'bearer',
  'jwt',
  'credential',
  'credentials',
]);

/** Classify canonical authentication names and explicit credential compounds.
 * Ordinary domain keys (groupKey, teamKey, dedup_key, fingerprint) remain intact.
 */
function canonicalCredentialField(key: string): string {
  let canonical = key;
  // URL query names may encode separators or letters. Decode a bounded number
  // of times; malformed escapes remain classifiable without throwing.
  for (let pass = 0; pass < 2 && canonical.includes('%'); pass++) {
    try {
      canonical = decodeURIComponent(canonical);
    } catch {
      break;
    }
  }
  return canonical.toLowerCase().replace(/[^a-z0-9]/g, '');
}

export function isCredentialField(key: string): boolean {
  const canonical = canonicalCredentialField(key);
  return (
    CREDENTIAL_NAMES.has(canonical) ||
    [
      'token',
      'password',
      'passwd',
      'secret',
      'secretkey',
      'secretaccesskey',
      'privatekey',
      'authorizationheader',
      'authheader',
      'credential',
      'credentials',
    ].some(suffix => canonical.endsWith(suffix))
  );
}

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
          .replace(/([?&#])([^=&#\s]+)=([^&#\s]*)/g, (match, separator, name) =>
            isCredentialField(name) ||
            ['key', 'sig', 'signature'].includes(canonicalCredentialField(name))
              ? `${separator}${name}=[REDACTED]`
              : match
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
          isCredentialField(key) ? '[REDACTED]' : sanitizeProviderData(item, seen),
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
