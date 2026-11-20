'use client';

import { useMemo } from 'react';
import {
  calculatePasswordStrength,
  getPasswordRequirements,
  isPasswordStrong as checkPasswordStrong,
} from '@/lib/password-strength';
import type { PasswordValidationContext } from '@/lib/passwords';

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
  const strength = useMemo(() => calculatePasswordStrength(password, context), [password, context]);
  const requirements = useMemo(
    () => getPasswordRequirements(password, context),
    [password, context]
  );

  if (!password) return null;

  return (
    <div className="space-y-2" aria-live="polite">
      <div className="space-y-1">
        <div className="flex items-center justify-between text-xs">
          <span className="font-medium text-muted-foreground">Password strength</span>
          <span className={`font-semibold ${strength.textColor}`}>{strength.label}</span>
        </div>
        <div
          className="h-1.5 w-full overflow-hidden rounded-full bg-muted"
          role="progressbar"
          aria-label="Password strength"
          aria-valuenow={strength.percentage}
          aria-valuemin={0}
          aria-valuemax={100}
        >
          <div
            className={`h-full transition-all duration-300 ${strength.color || 'bg-muted'}`}
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
                req.met ? 'text-status-ok' : 'text-muted-foreground'
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
