'use client';

/**
 * Centralized password strength calculation following industry standards.
 *
 * Requirements for each level:
 * - Weak: Doesn't meet basic requirements
 * - Fair: Has length + 1-2 character types
 * - Good: Has length + 3 character types (missing 1)
 * - Strong: Has all 4 types (lower, upper, number, special) + min length
 * - Excellent: Strong + extra length
 */

export interface PasswordStrengthResult {
  score: number; // 0-5 numeric score
  label: string; // Human-readable label
  color: string; // Tailwind background color class
  textColor: string; // Tailwind text color class
  percentage: number; // Progress bar percentage
  meetsMinimum: boolean; // Whether password is acceptable for submission
}

export interface PasswordRequirement {
  label: string;
  met: boolean;
}

const MIN_LENGTH = 8;
const STRONG_LENGTH = 12;
const EXCELLENT_LENGTH = 16;

/**
 * Calculate password strength with proper requirements.
 * A password MUST have uppercase to be considered "Strong".
 */
export function calculatePasswordStrength(password: string): PasswordStrengthResult {
  if (!password) {
    return {
      score: 0,
      label: '',
      color: '',
      textColor: '',
      percentage: 0,
      meetsMinimum: false,
    };
  }

  // Check individual requirements
  const hasMinLength = password.length >= MIN_LENGTH;
  const hasStrongLength = password.length >= STRONG_LENGTH;
  const hasExcellentLength = password.length >= EXCELLENT_LENGTH;
  const hasLowercase = /[a-z]/.test(password);
  const hasUppercase = /[A-Z]/.test(password);
  const hasNumber = /\d/.test(password);
  const hasSpecial = /[^a-zA-Z0-9]/.test(password);

  // Count character types present
  const typeCount = [hasLowercase, hasUppercase, hasNumber, hasSpecial].filter(Boolean).length;

  // Calculate score based on requirements
  // To be "Strong" (score 4), you MUST have all 4 character types
  let score = 0;

  if (!hasMinLength) {
    // Too short - always weak
    score = 1;
  } else if (typeCount < 2) {
    // Only 1 character type - weak
    score = 1;
  } else if (typeCount === 2) {
    // 2 character types - fair
    score = 2;
  } else if (typeCount === 3) {
    // 3 character types - good (missing one requirement)
    score = 3;
  } else if (typeCount === 4) {
    // All 4 character types - strong or excellent based on length
    if (hasExcellentLength) {
      score = 5; // Excellent
    } else if (hasStrongLength) {
      score = 5; // Excellent (12+ chars with all types)
    } else {
      score = 4; // Strong
    }
  }

  // Map score to visual properties
  const strengthMap: Record<number, Omit<PasswordStrengthResult, 'meetsMinimum'>> = {
    0: { score: 0, label: '', color: '', textColor: '', percentage: 0 },
    1: {
      score: 1,
      label: 'Weak',
      color: 'bg-rose-500',
      textColor: 'text-rose-400',
      percentage: 20,
    },
    2: {
      score: 2,
      label: 'Fair',
      color: 'bg-amber-500',
      textColor: 'text-amber-400',
      percentage: 40,
    },
    3: {
      score: 3,
      label: 'Good',
      color: 'bg-yellow-500',
      textColor: 'text-yellow-400',
      percentage: 60,
    },
    4: {
      score: 4,
      label: 'Strong',
      color: 'bg-emerald-500',
      textColor: 'text-emerald-400',
      percentage: 80,
    },
    5: {
      score: 5,
      label: 'Excellent',
      color: 'bg-cyan-500',
      textColor: 'text-cyan-400',
      percentage: 100,
    },
  };

  const result = strengthMap[score] || strengthMap[1];

  // Password meets minimum if it has all 4 character types and minimum length
  const meetsMinimum = hasMinLength && hasLowercase && hasUppercase && hasNumber;

  return {
    ...result,
    meetsMinimum,
  };
}

/**
 * Get detailed password requirements with their current status.
 */
export function getPasswordRequirements(password: string): PasswordRequirement[] {
  return [
    { label: `At least ${MIN_LENGTH} characters`, met: password.length >= MIN_LENGTH },
    { label: 'Contains lowercase letter (a-z)', met: /[a-z]/.test(password) },
    { label: 'Contains uppercase letter (A-Z)', met: /[A-Z]/.test(password) },
    { label: 'Contains number (0-9)', met: /\d/.test(password) },
    { label: 'Contains special character (!@#$...)', met: /[^a-zA-Z0-9]/.test(password) },
  ];
}

/**
 * Check if a password is strong enough for submission.
 * Requires: minimum length + lowercase + uppercase + number.
 * Special characters are optional but improve the strength rating.
 */
export function isPasswordStrong(password: string, minScore: number = 4): boolean {
  const strength = calculatePasswordStrength(password);
  return strength.score >= minScore && strength.meetsMinimum;
}
