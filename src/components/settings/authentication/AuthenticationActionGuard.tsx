'use client';

import { cloneElement, useId, type ReactElement } from 'react';
import { Button, type ButtonProps } from '@/components/ui/shadcn/button';
import { AlertCircle, ArrowRight } from 'lucide-react';
import type { AuthenticationSection } from '@/lib/auth-control/dashboard';

export type ActionBlocker = {
  code: string;
  message: string;
  resolutionLabel?: string;
  resolutionTarget?: AuthenticationSection;
};

export type ActionAvailability = { action: string; allowed: boolean; blockers: ActionBlocker[] };

export function actionAvailability(
  action: string,
  blockers: Array<ActionBlocker | false | null | undefined>
): ActionAvailability {
  const present = blockers.filter((value): value is ActionBlocker => Boolean(value));
  return { action, allowed: present.length === 0, blockers: present };
}

function getDefaultResolutionLabel(target: AuthenticationSection): string {
  switch (target) {
    case 'connection':
      return 'Go to Provider Connection';
    case 'access':
      return 'Go to Access & Users';
    case 'policy':
      return 'Go to Sessions & Policies';
    case 'emergency':
      return 'Go to Emergency Recovery';
    case 'diagnostics':
      return 'Go to Diagnostics';
    default:
      return 'Open Section';
  }
}

export default function AuthenticationActionGuard({
  availability,
  children,
  onResolve,
}: {
  availability: ActionAvailability;
  children: ReactElement<ButtonProps>;
  onResolve?: (target: AuthenticationSection) => void;
}) {
  const id = useId();

  return (
    <div className="min-w-0 space-y-2.5">
      {cloneElement(children, {
        disabled: !availability.allowed || children.props.disabled,
        'aria-describedby': availability.blockers.length ? id : undefined,
      })}

      {availability.blockers.length > 0 && (
        <div
          className="rounded-lg border border-amber-500/25 bg-amber-50/70 p-3 text-xs dark:border-amber-500/20 dark:bg-amber-950/20 space-y-2 shadow-2xs"
          aria-label={`${availability.action} requirements`}
        >
          <div className="flex items-center gap-1.5 font-semibold text-amber-950 dark:text-amber-200">
            <AlertCircle className="h-3.5 w-3.5 shrink-0 text-amber-600 dark:text-amber-400" />
            <span>Requirements to {availability.action.toLowerCase()}:</span>
          </div>

          <ul id={id} className="space-y-1.5 pl-5 list-disc marker:text-amber-500">
            {availability.blockers.map(blocker => (
              <li key={blocker.code} className="text-muted-foreground leading-relaxed">
                <div className="inline-flex flex-wrap items-center gap-x-2 gap-y-1">
                  <span>{blocker.message}</span>
                  {blocker.resolutionTarget && onResolve && (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="h-6 px-2 text-[11px] font-medium text-primary hover:text-primary hover:bg-primary/10 border-primary/25 gap-1 shadow-none"
                      onClick={() => onResolve(blocker.resolutionTarget!)}
                    >
                      <span>
                        {blocker.resolutionLabel ??
                          getDefaultResolutionLabel(blocker.resolutionTarget)}
                      </span>
                      <ArrowRight className="h-3 w-3" />
                    </Button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
