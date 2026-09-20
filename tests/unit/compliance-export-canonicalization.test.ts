import { describe, expect, it } from 'vitest';
import { canonicalSerializeJson } from '@/lib/compliance/export/serializer';

describe('canonicalSerializeJson', () => {
  it('serializes objects deterministically regardless of key order', () => {
    const objA = { z: 1, a: 2, m: { y: 'test', b: 'nested' } };
    const objB = { a: 2, m: { b: 'nested', y: 'test' }, z: 1 };

    const bufA = canonicalSerializeJson(objA);
    const bufB = canonicalSerializeJson(objB);

    expect(bufA.equals(bufB)).toBe(true);
    expect(bufA.toString('utf8')).toBe(bufB.toString('utf8'));
  });

  it('formats dates consistently to ISO 8601 strings', () => {
    const date = new Date('2026-09-20T10:00:00.000Z');
    const buf = canonicalSerializeJson({ timestamp: date });
    const parsed = JSON.parse(buf.toString('utf8'));

    expect(parsed.timestamp).toBe('2026-09-20T10:00:00.000Z');
  });

  it('preserves array order without sorting arrays', () => {
    const arr = [3, 1, 2];
    const buf = canonicalSerializeJson({ list: arr });
    const parsed = JSON.parse(buf.toString('utf8'));

    expect(parsed.list).toEqual([3, 1, 2]);
  });
});
