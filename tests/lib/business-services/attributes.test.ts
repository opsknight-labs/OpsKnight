import { describe, expect, it } from 'vitest';
import {
  CustomAttributesSchema,
  attributesFromLines,
  attributesToLines,
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
