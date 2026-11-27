import { describe, expect, it } from 'vitest';
import type { CustomField } from '@prisma/client';
import { MAX_CUSTOM_FIELD_VALUE_BYTES, validateCustomFieldValue } from '@/lib/custom-fields';

const field = (
  type: CustomField['type']
): Pick<CustomField, 'name' | 'type' | 'required' | 'options'> => ({
  name: 'Ticket',
  type,
  required: false,
  options: null,
});

describe('validateCustomFieldValue length limit', () => {
  it('accepts a value at the limit and rejects one byte over with a clear message', () => {
    const atLimit = 'a'.repeat(MAX_CUSTOM_FIELD_VALUE_BYTES);
    expect(validateCustomFieldValue(field('TEXT'), atLimit)).toEqual({
      valid: true,
      normalizedValue: atLimit,
    });

    const result = validateCustomFieldValue(field('TEXT'), `${atLimit}a`);
    expect(result.valid).toBe(false);
    expect(result.error).toBe('Ticket is too long: the limit is 2,000 bytes of text.');
    expect(result.normalizedValue).toBeNull();
  });

  it('counts bytes, so a short string of multi-byte characters can be too long', () => {
    expect(validateCustomFieldValue(field('TEXT'), '€'.repeat(667)).valid).toBe(false);
    expect(validateCustomFieldValue(field('TEXT'), '€'.repeat(666)).valid).toBe(true);
  });

  it('applies to a long URL, which the type check alone would accept', () => {
    const url = `https://example.com/${'x'.repeat(MAX_CUSTOM_FIELD_VALUE_BYTES)}`;
    expect(validateCustomFieldValue(field('URL'), url).valid).toBe(false);
  });
});
