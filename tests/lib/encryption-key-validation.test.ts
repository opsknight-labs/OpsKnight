import { describe, expect, it } from 'vitest';
import { validateEncryptionKeyConfiguration } from '@/lib/encryption-key-validation';

const KEY_A = 'a'.repeat(64);
const KEY_B = 'b'.repeat(64);

describe('validateEncryptionKeyConfiguration', () => {
  it('accepts the legacy single hexadecimal key', () => {
    expect(validateEncryptionKeyConfiguration(KEY_A)).toEqual({
      valid: true,
      format: 'single',
      entryCount: 1,
    });
  });

  it('accepts a bounded keyring with distinct IDs', () => {
    expect(validateEncryptionKeyConfiguration(`primary:${KEY_A},previous:${KEY_B}`)).toEqual({
      valid: true,
      format: 'keyring',
      entryCount: 2,
    });
  });

  it.each([
    [undefined, 'missing'],
    ['', 'missing'],
    [`primary:${KEY_A},`, 'invalid-separator'],
    [` primary:${KEY_A}`, 'surrounding-whitespace'],
    [`primary:${KEY_A}, previous:${KEY_B}`, 'invalid-whitespace'],
    [`bad id:${KEY_A}`, 'invalid-key-id'],
    [`primary:${KEY_A}:extra`, 'invalid-separator'],
    [`primary:${'a'.repeat(63)}`, 'invalid-key'],
    [`primary:${'z'.repeat(64)}`, 'invalid-key'],
    [`primary:${KEY_A},primary:${KEY_B}`, 'duplicate-key-id'],
  ])('rejects malformed key material (%s)', (value, expectedReason) => {
    expect(validateEncryptionKeyConfiguration(value)).toEqual({
      valid: false,
      reason: expectedReason,
    });
  });

  it('rejects absurdly large keyring input before parsing entries', () => {
    const oversized = `primary:${KEY_A},${'x'.repeat(17_000)}`;
    expect(validateEncryptionKeyConfiguration(oversized)).toEqual({
      valid: false,
      reason: 'too-large',
    });
  });
});
