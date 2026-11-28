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

describe('validateCustomFieldValue EMAIL', () => {
  it.each(['a@b.co', 'first.last+tag@sub.example.org', 'X@Y.Z'])('accepts %s', value => {
    expect(validateCustomFieldValue(field('EMAIL'), value).valid).toBe(true);
  });

  it.each([
    'plain',
    'no-at.example.com',
    '@example.com',
    'a@@b.co',
    'a@b',
    'a@b.',
    'a@.co',
    'a.b@c',
    'a b@c.co',
  ])('rejects %s', value => {
    expect(validateCustomFieldValue(field('EMAIL'), value).valid).toBe(false);
  });

  it('lower-cases a valid address and refuses a pathological one quickly', () => {
    expect(validateCustomFieldValue(field('EMAIL'), 'Ada@Example.COM').normalizedValue).toBe(
      'ada@example.com'
    );
    const started = Date.now();
    const hostile = `${'!@!.'.repeat(400)}!`;
    expect(validateCustomFieldValue(field('EMAIL'), hostile).valid).toBe(false);
    expect(Date.now() - started).toBeLessThan(200);
  });
});
