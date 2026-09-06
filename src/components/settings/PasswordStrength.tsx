'use client';

import { calculatePasswordStrength, getPasswordRequirements } from '@/lib/password-strength';
import { Check, X } from 'lucide-react';
import { cn } from '@/lib/utils';

type Props = {
  password: string;
  showRequirements?: boolean;
};

export default function PasswordStrength({ password, showRequirements = true }: Props) {
  const strength = calculatePasswordStrength(password);
  const requirements = getPasswordRequirements(password);

  if (!password) return null;

  const getSegmentColor = (segmentIndex: number) => {
    if (strength.score < segmentIndex) {
      return 'bg-muted';
    }
    switch (strength.score) {
      case 1:
        return 'bg-rose-500';
      case 2:
        return 'bg-amber-500';
      case 3:
        return 'bg-yellow-500';
      case 4:
        return 'bg-emerald-500';
      case 5:
        return 'bg-cyan-500';
      default:
        return 'bg-muted';
    }
  };

  return (
    <div className="space-y-2.5 pt-1">
      {/* 5-segment Strength Bar */}
      <div className="space-y-1.5">
        <div className="flex items-center justify-between text-xs">
          <span className="text-muted-foreground font-medium">Password Strength</span>
          <span
            className={cn(
              'font-semibold text-xs transition-colors duration-200',
              strength.score === 1 && 'text-rose-500',
              strength.score === 2 && 'text-amber-500',
              strength.score === 3 && 'text-yellow-500',
              strength.score === 4 && 'text-emerald-500',
              strength.score === 5 && 'text-cyan-500'
            )}
          >
            {strength.label}
          </span>
        </div>
        <div className="grid grid-cols-5 gap-1.5 h-1.5 w-full">
          {[1, 2, 3, 4, 5].map(segment => (
            <div
              key={segment}
              className={cn(
                'h-full rounded-full transition-all duration-300',
                getSegmentColor(segment)
              )}
            />
          ))}
        </div>
      </div>

      {/* Interactive Requirements Checklist */}
      {showRequirements && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5 pt-1">
          {requirements.map((req, idx) => (
            <div
              key={idx}
              className={cn(
                'flex items-center gap-1.5 text-xs transition-colors duration-150',
                req.met
                  ? 'text-emerald-600 dark:text-emerald-400 font-medium'
                  : 'text-muted-foreground'
              )}
            >
              {req.met ? (
                <div className="h-3.5 w-3.5 rounded-full bg-emerald-500/10 flex items-center justify-center text-emerald-600 dark:text-emerald-400">
                  <Check className="h-2.5 w-2.5" />
                </div>
              ) : (
                <div className="h-3.5 w-3.5 rounded-full bg-muted flex items-center justify-center text-muted-foreground">
                  <X className="h-2.5 w-2.5" />
                </div>
              )}
              <span>{req.label}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
