/**
 * Label canonicalization. Labels feed correlation rules and similarity, are persisted, and may come
 * from attacker-influenced alert content, so extraction is strictly bounded and never keeps anything
 * that looks like a credential.
 */

export const MAX_LABELS = 32;
export const MAX_LABEL_KEY_LENGTH = 64;
export const MAX_LABEL_VALUE_LENGTH = 128;
const MAX_DEPTH = 3;

const SECRET_KEY_PATTERN =
  /(?:pass(?:word|wd)?|secret|token|auth|api[-_.]?key|credential|cookie|session|bearer|private|signature|ssn|card)/i;
// Long unbroken credential-shaped values (JWTs, base64 blobs, hex keys) are dropped regardless of key.
const CREDENTIAL_VALUE_PATTERN = /^[A-Za-z0-9+/=_.-]{32,}$/;

export type CanonicalLabels = Record<string, string>;

function labelValue(value: unknown): string | null {
  if (typeof value === 'boolean' || typeof value === 'number') return String(value);
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (trimmed.length === 0 || CREDENTIAL_VALUE_PATTERN.test(trimmed)) return null;
  return trimmed.toLowerCase().slice(0, MAX_LABEL_VALUE_LENGTH);
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
        if (!normalizedKey || SECRET_KEY_PATTERN.test(normalizedKey)) continue;
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
  return Object.fromEntries([...collected.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
}
