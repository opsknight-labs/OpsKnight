import type { CustomField } from '@prisma/client';

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
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(val)) {
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
