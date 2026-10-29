/**
 * Label canonicalization. Labels feed correlation rules and similarity, are persisted, and may come
 * from attacker-influenced alert content, so extraction is strictly bounded and never keeps anything
 * that looks like a credential.
 */
import { maskVolatileIdentifiers } from './text';

export const MAX_LABELS = 32;
export const MAX_LABEL_KEY_LENGTH = 64;
export const MAX_LABEL_VALUE_LENGTH = 128;
const MAX_DEPTH = 3;

/**
 * Key segments (split on separators and camelCase) that mark a value as secret. Whole segments are matched,
 * so `password`, `db_password` and `apiKey` are dropped while `bypass`, `compass`, `author` and `private_ip`
 * are kept.
 */
const SECRET_SEGMENTS = new Set([
  'pass',
  'password',
  'passwd',
  'pwd',
  'passphrase',
  'secret',
  'token',
  'auth',
  'authorization',
  'credential',
  'credentials',
  'cookie',
  'session',
  'sessionid',
  'bearer',
  'signature',
  'ssn',
  'card',
  'cvv',
  'pin',
]);
const SECRET_COMPOUNDS = [
  'apikey',
  'accesskey',
  'privatekey',
  'secretkey',
  'clientsecret',
  'authtoken',
];

function isSecretKey(key: string): boolean {
  const segments = key
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
  if (segments.some(segment => SECRET_SEGMENTS.has(segment))) return true;
  const joined = segments.join('');
  return SECRET_COMPOUNDS.some(compound => joined.includes(compound));
}

/**
 * Credential-shaped values are dropped whatever their key: JWTs, long hex strings, and long unbroken base64
 * blobs mixing cases and digits. Long values made of readable dotted or dashed words (host names, pod names,
 * cloud resource names) are not credentials and are kept.
 */
const JWT_SEGMENT = /^[A-Za-z0-9_-]{8,}$/;
const HEX_VALUE = /^(?:0x)?[0-9a-fA-F]{32,}$/;
const BLOB_VALUE = /^[A-Za-z0-9+/=_]{32,}$/;

function isCredentialValue(value: string): boolean {
  const segments = value.split('.');
  const jwt =
    value.startsWith('ey') &&
    segments.length >= 2 &&
    segments.length <= 3 &&
    segments.every(segment => JWT_SEGMENT.test(segment));
  if (jwt || HEX_VALUE.test(value)) return true;
  return BLOB_VALUE.test(value) && /[A-Z]/.test(value) && /[a-z]/.test(value) && /\d/.test(value);
}

export type CanonicalLabels = Record<string, string>;

/**
 * A label value as it is compared: lower-cased with identifiers that differ between replicas (generated pod
 * names, IP addresses, UUIDs, long hex ids, timestamps) masked, so labels from different pods of the same
 * workload match while meaningful values (regions, status codes, versions) are kept.
 */
function labelValue(value: unknown): string | null {
  if (typeof value === 'boolean' || typeof value === 'number') return String(value);
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (trimmed.length === 0 || isCredentialValue(trimmed)) return null;
  const masked = maskVolatileIdentifiers(trimmed);
  return masked ? masked.slice(0, MAX_LABEL_VALUE_LENGTH) : null;
}

/**
 * Flattens nested JSON into `a.b` keys (depth-limited), keeps only primitive values, and returns a
 * key-sorted record so equal inputs always serialize identically.
 */
export function canonicalizeLabels(source: unknown): CanonicalLabels {
  const collected = new Map<string, string>();

  const visit = (value: unknown, prefix: string, depth: number) => {
    if (collected.size >= MAX_LABELS || depth > MAX_DEPTH) return;
    if (Array.isArray(value)) return; // arrays are unordered noise for grouping purposes
    if (value !== null && typeof value === 'object') {
      for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
        const normalizedKey = key.trim().toLowerCase().slice(0, MAX_LABEL_KEY_LENGTH);
        if (!normalizedKey || isSecretKey(key)) continue;
        visit(child, prefix ? `${prefix}.${normalizedKey}` : normalizedKey, depth + 1);
        if (collected.size >= MAX_LABELS) return;
      }
      return;
    }
    const normalized = labelValue(value);
    if (prefix && normalized !== null) {
      collected.set(prefix.slice(0, MAX_LABEL_KEY_LENGTH), normalized);
    }
  };

  visit(source, '', 0);
  return Object.fromEntries(
    [...collected.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
  );
}
