/* eslint-disable security/detect-object-injection -- Keys are schema-validated or derived from compiled field definitions. */
import { isSensitiveValue } from './privacy';
import { LIMITS, type Field, type FieldState, type Scalar } from '../contract';
// Normalization is synchronous; reuse bounded scratch space instead of allocating
// an encoder and a byte array for every extracted field.
const utf8Encoder = new TextEncoder();
const utf8Scratch = new Uint8Array(Math.max(LIMITS.stringBytes, LIMITS.enumBytes) + 4);
function exceedsUtf8Limit(value: string, limit: number): boolean {
  const { read, written } = utf8Encoder.encodeInto(value, utf8Scratch);
  return read < value.length || written > limit;
}

export function normalizedString(value: string, field: Pick<Field, 'caseSensitive'>): string {
  const trimmed = value.trim();
  return field.caseSensitive ? trimmed : trimmed.toLowerCase();
}
export function normalizeValue(raw: unknown, field: Field): FieldState {
  if (raw === null || raw === undefined || (typeof raw === 'string' && raw.trim() === ''))
    return { state: 'MISSING' };
  if (!['string', 'number', 'boolean'].includes(typeof raw)) throw new Error('EXTRACTION_LIMIT');
  if (
    typeof raw === 'string' &&
    exceedsUtf8Limit(raw, field.type === 'ENUM' ? LIMITS.enumBytes : LIMITS.stringBytes)
  )
    throw new Error('EXTRACTION_LIMIT');
  if (typeof raw === 'string' && isSensitiveValue(raw)) throw new Error('EXTRACTION_LIMIT');
  const unmapped: FieldState = { state: 'UNMAPPED', raw: raw as Scalar };
  if (field.type === 'NUMBER') {
    if (typeof raw === 'boolean') return unmapped;
    const value = typeof raw === 'number' ? raw : Number(String(raw).trim());
    return Number.isFinite(value) ? { state: 'RECOGNIZED', value } : unmapped;
  }
  if (field.type === 'BOOLEAN') {
    const value = typeof raw === 'string' ? raw.trim().toLowerCase() : raw;
    if (value === true || value === 'true') return { state: 'RECOGNIZED', value: true };
    if (value === false || value === 'false') return { state: 'RECOGNIZED', value: false };
    return unmapped;
  }
  if (typeof raw !== 'string') return unmapped;
  const key = normalizedString(raw, field);
  const value = Object.prototype.hasOwnProperty.call(field.aliases, key) ? field.aliases[key] : key;
  if (field.type === 'ENUM') {
    const canonical = field.allowedValues?.find(
      choice => normalizedString(choice, field) === normalizedString(value, field)
    );
    return canonical === undefined ? unmapped : { state: 'RECOGNIZED', value: canonical };
  }
  return { state: 'RECOGNIZED', value };
}
