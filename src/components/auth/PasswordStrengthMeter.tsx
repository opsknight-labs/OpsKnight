'use client';

import { useMemo } from 'react';
import {
  calculatePasswordStrength,
  getPasswordRequirements,
  isPasswordStrong as checkPasswordStrong,
} from '@/lib/password-strength';
import { validatePasswordStrength, type PasswordValidationContext } from '@/lib/passwords';

interface PasswordStrengthMeterProps {
  password: string;
  showRequirements?: boolean;
  context?: PasswordValidationContext;
  /** @deprecated The security policy is centralized and cannot be weakened per component. */
  minLength?: number;
}

export default function PasswordStrengthMeter({
  password,
  showRequirements = true,
  context,
}: PasswordStrengthMeterProps) {
  const strength = useMemo(
    () => calculatePasswordStrength(password, context),
    [password, context]
  );
  const requirements = useMemo(
    () => getPasswordRequirements(password, context),
    [password, context]
  );

  if (!password) return null;

  return (
    <div className="space-y-2" aria-live="polite">
      <div className="space-y-1">
        <div className="flex items-center justify-between text-xs">
          <span className="font-medium text-slate-600 dark:text-slate-300">Password strength</span>
          <span className={`font-semibold ${strength.textColor}`}>{strength.label}</span>
        </div>
        <div
          className="h-1.5 w-full overflow-hidden rounded-full bg-slate-200 dark:bg-slate-800"
          role="progressbar"
          aria-label="Password strength"
          aria-valuenow={strength.percentage}
          aria-valuemin={0}
          aria-valuemax={100}
        >
          <div
            className={`h-full transition-all duration-300 ${strength.color || 'bg-slate-400'}`}
            style={{ width: `${strength.percentage}%` }}
          />
        </div>
      </div>

      {showRequirements && (
        <div className="space-y-1 pt-1">
          {requirements.map(req => (
            <div
              key={req.label}
              className={`flex items-center gap-2 text-xs ${
                req.met ? 'text-emerald-600 dark:text-emerald-400' : 'text-slate-400'
              }`}
            >
              <span aria-hidden="true">{req.met ? '✓' : '○'}</span>
              <span>{req.label}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export { checkPasswordStrong as isPasswordStrong };

export function getPasswordError(
  password: string,
  context?: PasswordValidationContext,
  _minLength?: number
): string | null {
  return validatePasswordStrength(password, context);
}
