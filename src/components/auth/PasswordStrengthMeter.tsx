'use client';

import { useMemo } from 'react';
import {
  calculatePasswordStrength,
  getPasswordRequirements,
  isPasswordStrong as checkPasswordStrong,
  type PasswordStrengthResult,
  type PasswordRequirement,
} from '@/lib/password-strength';

interface PasswordStrengthMeterProps {
  password: string;
  showRequirements?: boolean;
  minLength?: number;
}

export default function PasswordStrengthMeter({
  password,
  showRequirements = true,
  minLength = 8,
}: PasswordStrengthMeterProps) {
  const strength = useMemo(() => calculatePasswordStrength(password), [password]);
  const requirements = useMemo(() => getPasswordRequirements(password), [password]);

  if (!password) {
    return null;
  }

  // Map textColor to bgColor for progress bar
  const getBgColor = (textColor: string): string => {
    if (textColor.includes('rose')) return 'bg-rose-500';
    if (textColor.includes('amber')) return 'bg-amber-500';
    if (textColor.includes('yellow')) return 'bg-yellow-500';
    if (textColor.includes('emerald')) return 'bg-emerald-500';
    if (textColor.includes('cyan')) return 'bg-cyan-500';
    return 'bg-slate-400';
  };

  return (
    <div className="space-y-2">
      {/* Strength Bar */}
      <div className="space-y-1">
        <div className="flex items-center justify-between text-xs">
          <span className="font-medium text-slate-600">Password strength</span>
          <span className={`font-semibold capitalize ${strength.textColor}`}>{strength.label}</span>
        </div>
        <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-200">
          <div
            className={`h-full transition-all duration-300 ${getBgColor(strength.textColor)}`}
            style={{ width: `${strength.percentage}%` }}
          />
        </div>
      </div>

      {/* Requirements Checklist */}
      {showRequirements && (
        <div className="space-y-1 pt-1">
          {requirements.map((req, idx) => (
            <div
              key={idx}
              className={`flex items-center gap-2 text-xs transition-colors ${
                req.met ? 'text-emerald-600' : 'text-slate-400'
              }`}
            >
              {req.met ? (
                <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M5 13l4 4L19 7"
                  />
                </svg>
              ) : (
                <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M6 18L18 6M6 6l12 12"
                  />
                </svg>
              )}
              <span>{req.label}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * Re-export utility functions from centralized module
 */
export { checkPasswordStrong as isPasswordStrong };

export function getPasswordError(password: string, minLength: number = 8): string | null {
  if (password.length < minLength) {
    return `Password must be at least ${minLength} characters`;
  }
  if (!/[a-z]/.test(password)) {
    return 'Password must contain a lowercase letter';
  }
  if (!/[A-Z]/.test(password)) {
    return 'Password must contain an uppercase letter';
  }
  if (!/[0-9]/.test(password)) {
    return 'Password must contain a number';
  }
  return null;
}
