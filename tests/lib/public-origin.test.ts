import { describe, expect, it } from 'vitest';
import { normalizePublicOrigin } from '@/lib/public-origin';

describe('normalizePublicOrigin', () => {
  it.each([
    ['https://opsknight.example.com', 'https://opsknight.example.com'],
    ['https://opsknight.example.com/', 'https://opsknight.example.com'],
    ['https://opsknight.example.com:8443', 'https://opsknight.example.com:8443'],
    ['http://localhost:3000', 'http://localhost:3000'],
  ])('normalizes %s', (value, expected) => {
    expect(normalizePublicOrigin(value)).toBe(expected);
  });

  it.each([
    'ftp://opsknight.example.com',
    'https://opsknight.example.com/path',
    'https://opsknight.example.com/?query=1',
    'https://opsknight.example.com/#fragment',
    'https://user:password@opsknight.example.com',
  ])('rejects non-origin value %s', value => {
    expect(() => normalizePublicOrigin(value)).toThrow('INVALID_PUBLIC_ORIGIN');
  });
});
