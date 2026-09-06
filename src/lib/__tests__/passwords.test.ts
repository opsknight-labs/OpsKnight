import { describe, expect, it } from 'vitest';
import { validatePasswordStrength } from '@/lib/passwords';

describe('validatePasswordStrength', () => {
  it('rejects short passwords', () => {
    expect(validatePasswordStrength('Short1!')).toBeTruthy();
  });

  it('rejects passwords exceeding 128 characters', () => {
    const longPassword = 'Aa1!' + 'x'.repeat(126); // 130 chars total
    expect(validatePasswordStrength(longPassword)).toBe('Password must not exceed 128 characters.');
  });

  it('requires upper, lower, and number', () => {
    expect(validatePasswordStrength('alllowercase1!')).toBeTruthy();
    expect(validatePasswordStrength('ALLUPPERCASE1!')).toBeTruthy();
    expect(validatePasswordStrength('NoNumbersHere!')).toBeTruthy();
  });

  it('requires special character', () => {
    expect(validatePasswordStrength('StrongPass1')).toBe(
      'Password must include at least one special character.'
    );
  });

  it('accepts strong passwords with all requirements', () => {
    expect(validatePasswordStrength('StrongPass1!')).toBeNull();
    expect(validatePasswordStrength('MyP@ssw0rd123')).toBeNull();
    expect(validatePasswordStrength('SecureKey#2024')).toBeNull();
  });
});
