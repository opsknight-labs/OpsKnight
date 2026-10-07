/* eslint-disable security/detect-object-injection -- Keys are schema-validated or derived from compiled field definitions. */
import { LIMITS, type Field, type FieldState, type Scalar } from '../contract';
export function normalizedString(value: string, field: Pick<Field, 'caseSensitive'>): string {
  const trimmed = value.trim();
  return field.caseSensitive ? trimmed : trimmed.toLowerCase();
}
export function normalizeValue(raw: unknown, field: Field): FieldState {
  if (raw === null || raw === undefined || (typeof raw === 'string' && raw.trim() === '')) return { state: 'MISSING' };
  if (!['string', 'number', 'boolean'].includes(typeof raw)) throw new Error('EXTRACTION_LIMIT');
  if (typeof raw === 'string' && new TextEncoder().encode(raw).length > (field.type === 'ENUM' ? LIMITS.enumBytes : LIMITS.stringBytes)) throw new Error('EXTRACTION_LIMIT');
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
  const allowed = field.allowedValues?.map(v => normalizedString(v, field));
  return field.type === 'ENUM' && !allowed?.includes(value) ? unmapped : { state: 'RECOGNIZED', value };
}
