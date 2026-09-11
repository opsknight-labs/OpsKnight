'use client';

import {
  PASSWORD_MAX_LENGTH,
  PASSWORD_MAX_UTF8_BYTES,
  PASSWORD_MIN_LENGTH,
  getPasswordCharacterLength,
  getPasswordUtf8Length,
  isCompromisedPassword,
  validatePasswordStrength,
  type PasswordValidationContext,
} from '@/lib/passwords';

export interface PasswordStrengthResult {
  score: number;
  label: string;
  color: string;
  textColor: string;
  percentage: number;
  meetsMinimum: boolean;
}

export interface PasswordRequirement {
  label: string;
  met: boolean;
}

type PasswordStrengthPresentation = Omit<PasswordStrengthResult, 'meetsMinimum'>;

function getStrengthPresentation(score: number): PasswordStrengthPresentation {
  switch (score) {
    case 1:
      return { score: 1, label: 'Weak', color: 'bg-rose-500', textColor: 'text-rose-500', percentage: 20 };
    case 2:
      return { score: 2, label: 'Fair', color: 'bg-amber-500', textColor: 'text-amber-500', percentage: 40 };
    case 3:
      return { score: 3, label: 'Good', color: 'bg-yellow-500', textColor: 'text-yellow-600', percentage: 60 };
    case 4:
      return { score: 4, label: 'Strong', color: 'bg-emerald-500', textColor: 'text-emerald-600', percentage: 80 };
    case 5:
      return { score: 5, label: 'Excellent', color: 'bg-cyan-500', textColor: 'text-cyan-600', percentage: 100 };
    default:
      return { score: 0, label: '', color: '', textColor: '', percentage: 0 };
  }
}

/**
 * UX strength indicator. Acceptance remains controlled solely by the shared
 * server-compatible password policy; character-class composition is never a
 * requirement.
 */
export function calculatePasswordStrength(
  password: string,
  context?: PasswordValidationContext
): PasswordStrengthResult {
  if (!password) return { ...getStrengthPresentation(0), meetsMinimum: false };

  const characterLength = getPasswordCharacterLength(password);
  const meetsMinimum = validatePasswordStrength(password, context) === null;
  let score = 1;
  if (characterLength >= 10) score = 2;
  if (characterLength >= PASSWORD_MIN_LENGTH) score = 3;
  if (meetsMinimum) score = 4;
  if (meetsMinimum && characterLength >= 24) score = 5;

  return { ...getStrengthPresentation(score), meetsMinimum };
}

export function getPasswordRequirements(
  password: string,
  context?: PasswordValidationContext
): PasswordRequirement[] {
  const characterLength = getPasswordCharacterLength(password);
  return [
    { label: `At least ${PASSWORD_MIN_LENGTH} characters`, met: characterLength >= PASSWORD_MIN_LENGTH },
    { label: `No more than ${PASSWORD_MAX_LENGTH} characters`, met: characterLength <= PASSWORD_MAX_LENGTH },
    { label: `Within ${PASSWORD_MAX_UTF8_BYTES} UTF-8 bytes (bcrypt safety limit)`, met: getPasswordUtf8Length(password) <= PASSWORD_MAX_UTF8_BYTES },
    {
      label: 'Not common, default, or account-identifying',
      met: characterLength > 0 && !isCompromisedPassword(password, context),
    },
  ];
}

/**
 * Preserve the historical `(password, minScore)` call shape while supporting
 * `(password, context)`. The numeric score was always UX-only; acceptance is
 * now exclusively the centralized security policy and cannot be weakened by a
 * caller-provided score.
 */
export function isPasswordStrong(
  password: string,
  contextOrLegacyMinScore?: PasswordValidationContext | number,
  _legacyMinScore: number = 4
): boolean {
  const context =
    typeof contextOrLegacyMinScore === 'number' ? undefined : contextOrLegacyMinScore;
  return validatePasswordStrength(password, context) === null;
}
