import { canonicalizeEvidenceValue } from '../evidence/canonicalize';

/**
 * Returns a deterministic UTF-8 Buffer of the canonicalized JSON structure.
 * Keys are sorted lexicographically at every depth; Dates are formatted to ISO 8601 strings.
 */
export function canonicalSerializeJson(value: unknown): Buffer {
  const canonical = canonicalizeEvidenceValue(value);
  const jsonStr = JSON.stringify(canonical, null, 2);
  return Buffer.from(jsonStr + '\n', 'utf8');
}
