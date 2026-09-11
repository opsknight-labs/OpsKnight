import { describe, expect, it } from 'vitest';
import {
  PASSWORD_MAX_LENGTH,
  PASSWORD_MAX_UTF8_BYTES,
  PASSWORD_MIN_LENGTH,
  getPasswordCharacterLength,
  isCompromisedPassword,
  validatePasswordStrength,
} from '@/lib/passwords';

describe('password policy', () => {
  it('enforces the minimum length without composition rules', () => {
    expect(validatePasswordStrength('short password')).toContain(`${PASSWORD_MIN_LENGTH}`);
    expect(validatePasswordStrength('this is a long passphrase')).toBeNull();
    expect(validatePasswordStrength('alllowercasebutlongenough')).toBeNull();
    expect(validatePasswordStrength('x'.repeat(PASSWORD_MIN_LENGTH - 1))).not.toBeNull();
    expect(validatePasswordStrength('x'.repeat(PASSWORD_MIN_LENGTH))).toBeNull();
  });

  it('counts Unicode code points instead of UTF-16 code units', () => {
    expect(getPasswordCharacterLength('A')).toBe(1);
    expect(getPasswordCharacterLength('😀')).toBe(1);
    expect(getPasswordCharacterLength('é')).toBe(1);
    // No password normalization is performed: a combining sequence is two code points.
    expect(getPasswordCharacterLength('e\u0301')).toBe(2);
  });

  it('allows whitespace and Unicode when within the hashing limit', () => {
    expect(validatePasswordStrength('spaces are valid here')).toBeNull();
    expect(validatePasswordStrength('安全な passphrase 123')).toBeNull();
  });

  it('enforces configured character boundaries', () => {
    expect(validatePasswordStrength('x'.repeat(PASSWORD_MAX_LENGTH))).toBeNull();
    expect(validatePasswordStrength('x'.repeat(PASSWORD_MAX_LENGTH + 1))).toContain(
      `${PASSWORD_MAX_LENGTH}`
    );
  });

  it('rejects bcrypt-truncating UTF-8 inputs explicitly', () => {
    const password = '界'.repeat(Math.ceil(PASSWORD_MAX_UTF8_BYTES / 3) + 1);
    expect(validatePasswordStrength(password)).toContain('UTF-8 bytes');
  });

  it('rejects compromised/default passwords through one abstraction', () => {
    expect(validatePasswordStrength('correcthorsebatterystaple')).toContain('commonly used');
    expect(validatePasswordStrength('PasswordPassword')).toContain('commonly used');
    expect(isCompromisedPassword('administrator123')).toBe(true);
  });

  it('can reject exact account-identifying secrets without broad substring rules', () => {
    expect(
      validatePasswordStrength('admin@example.com', { email: 'admin@example.com' })
    ).toContain('account-identifying');
    expect(
      validatePasswordStrength('a long phrase for admin@example.com', { email: 'admin@example.com' })
    ).toBeNull();
  });

  it('rejects embedded null characters', () => {
    expect(validatePasswordStrength('long-enough-pass\u0000word')).toContain('null character');
  });
});
