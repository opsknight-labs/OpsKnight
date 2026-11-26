import { describe, expect, it } from 'vitest';
import {
  CustomAttributesSchema,
  attributeFilterValues,
  attributeMatches,
  attributeOptions,
  attributesFromLines,
  attributesToLines,
  parseAttributeFilter,
} from '@/lib/business-services/attributes';

describe('custom attributes', () => {
  it('parses key = value lines into typed scalars and round-trips', () => {
    const parsed = attributesFromLines('cost_center = 4410\npci = true\nowner = payments team');
    expect(parsed).toEqual({ cost_center: 4410, pci: true, owner: 'payments team' });
    expect(attributesFromLines(attributesToLines(parsed))).toEqual(parsed);
  });
  it('rejects bad keys, lines without =, and more than 20 keys', () => {
    expect(attributesFromLines('1bad = x')).toBeNull();
    expect(attributesFromLines('novalue')).toBeNull();
    const many = Object.fromEntries(Array.from({ length: 21 }, (_, i) => [`k${i}`, i]));
    expect(CustomAttributesSchema.safeParse(many).success).toBe(false);
    expect(CustomAttributesSchema.safeParse({ nested: { a: 1 } }).success).toBe(false);
  });
});

describe('attribute filter', () => {
  it('parses key=value and rejects bad keys or empty values', () => {
    expect(parseAttributeFilter('cost_center=ops-42')).toEqual({
      key: 'cost_center',
      value: 'ops-42',
    });
    expect(parseAttributeFilter(' pci = true ')).toEqual({ key: 'pci', value: 'true' });
    expect(parseAttributeFilter('=x')).toBeNull();
    expect(parseAttributeFilter('9bad=x')).toBeNull();
    expect(parseAttributeFilter('key=')).toBeNull();
    expect(parseAttributeFilter(undefined)).toBeNull();
  });

  it('matches the text value and its typed reading, never other keys', () => {
    const attrs = { pci: true, budget: 3, owner: 'ann' };
    expect(attributeMatches(attrs, { key: 'pci', value: 'true' })).toBe(true);
    expect(attributeMatches(attrs, { key: 'budget', value: '3' })).toBe(true);
    expect(attributeMatches(attrs, { key: 'owner', value: 'ann' })).toBe(true);
    expect(attributeMatches(attrs, { key: 'owner', value: 'bob' })).toBe(false);
    expect(attributeMatches(null, { key: 'owner', value: 'ann' })).toBe(false);
    expect(attributeFilterValues('false')).toEqual(['false', false]);
  });

  it('lists distinct key=value options, sorted', () => {
    expect(attributeOptions([{ b: 1, a: 'x' }, { a: 'x' }, null])).toEqual(['a=x', 'b=1']);
  });
});
