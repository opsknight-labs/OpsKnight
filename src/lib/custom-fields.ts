import type { CustomField } from '@prisma/client';

/** UTF-8 bytes of one custom field value; well under the btree entry limit of CustomFieldValue.value. */
export const MAX_CUSTOM_FIELD_VALUE_BYTES = 2000;

/**
 * One '@' with text on both sides, a dot inside the domain, no whitespace, at most 254 characters.
 * Plain string checks keep this linear for any input (a regular expression over user text is not).
 */
function isPlausibleEmail(value: string): boolean {
  if (value.length > 254 || /\s/.test(value)) return false;
  const at = value.indexOf('@');
  if (at < 1 || at !== value.lastIndexOf('@')) return false;
  const dot = value.lastIndexOf('.');
  return dot > at + 1 && dot < value.length - 1;
}

export function validateCustomFieldValue(
  field: Pick<CustomField, 'name' | 'type' | 'required' | 'options'>,
  value: string | number | boolean | null | undefined
): { valid: boolean; error?: string; normalizedValue: string | null } {
  if (value === null || value === undefined || value === '') {
    if (field.required) {
      return { valid: false, error: `${field.name} is required.`, normalizedValue: null };
    }
    return { valid: true, normalizedValue: null };
  }

  const val = String(value).trim();

  // The value column is btree-indexed, which cannot hold an entry of about 2.7 KB: refuse a long
  // value here with a clear message instead of failing the insert with a 500.
  if (new TextEncoder().encode(val).length > MAX_CUSTOM_FIELD_VALUE_BYTES) {
    return {
      valid: false,
      error: `${field.name} is too long: the limit is ${MAX_CUSTOM_FIELD_VALUE_BYTES.toLocaleString('en-US')} bytes of text.`,
      normalizedValue: null,
    };
  }

  switch (field.type) {
    case 'NUMBER': {
      const num = Number(val);
      if (isNaN(num) || !isFinite(num)) {
        return {
          valid: false,
          error: `${field.name} must be a valid number.`,
          normalizedValue: null,
        };
      }
      return { valid: true, normalizedValue: String(num) };
    }
    case 'BOOLEAN': {
      const lower = val.toLowerCase();
      if (lower !== 'true' && lower !== 'false') {
        return {
          valid: false,
          error: `${field.name} must be true or false.`,
          normalizedValue: null,
        };
      }
      return { valid: true, normalizedValue: lower };
    }
    case 'DATE': {
      const parsed = Date.parse(val);
      if (isNaN(parsed)) {
        return {
          valid: false,
          error: `${field.name} must be a valid date.`,
          normalizedValue: null,
        };
      }
      return { valid: true, normalizedValue: new Date(parsed).toISOString() };
    }
    case 'SELECT': {
      const opts = Array.isArray(field.options) ? (field.options as string[]) : [];
      if (opts.length > 0 && !opts.includes(val)) {
        return {
          valid: false,
          error: `${field.name} must be one of: ${opts.join(', ')}`,
          normalizedValue: null,
        };
      }
      return { valid: true, normalizedValue: val };
    }
    case 'EMAIL': {
      if (!isPlausibleEmail(val)) {
        return {
          valid: false,
          error: `${field.name} must be a valid email address.`,
          normalizedValue: null,
        };
      }
      return { valid: true, normalizedValue: val.toLowerCase() };
    }
    case 'URL': {
      if (!/^https?:\/\/.+/i.test(val)) {
        return {
          valid: false,
          error: `${field.name} must be a valid URL starting with http:// or https://`,
          normalizedValue: null,
        };
      }
      return { valid: true, normalizedValue: val };
    }
    default:
      return { valid: true, normalizedValue: val };
  }
}
