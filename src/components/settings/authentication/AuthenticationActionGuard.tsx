'use client';

import { cloneElement, useId, type ReactElement } from 'react';
import { Button, type ButtonProps } from '@/components/ui/shadcn/button';
import { AlertCircle, ArrowRight, ChevronDown } from 'lucide-react';
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

/**
 * Wraps a privileged action. When the action is unavailable the primary blocker and its
 * resolution are shown inline (not in a hover tooltip), further blockers are one click away,
 * and the disabled control is described by the same text for assistive technology.
 */
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
  const [primary, ...others] = availability.blockers;
  // "Busy" is transient and self-explanatory; never present it as a requirement.
  const actionable = primary && primary.code !== 'busy';

  const resolution = (blocker: ActionBlocker) =>
    blocker.resolutionTarget && onResolve ? (
      <Button
        type="button"
        variant="link"
        size="sm"
        className="h-auto p-0 text-xs font-semibold text-primary gap-1"
        onClick={() => onResolve(blocker.resolutionTarget!)}
      >
        {blocker.resolutionLabel ?? getDefaultResolutionLabel(blocker.resolutionTarget)}
        <ArrowRight className="h-3 w-3" aria-hidden />
      </Button>
    ) : null;

  return (
    <div className="min-w-0 space-y-2">
      {cloneElement(children, {
        disabled: !availability.allowed || children.props.disabled,
        'aria-describedby': actionable ? id : undefined,
      })}

      {actionable && (
        <div className="min-w-0 rounded-lg border border-amber-500/25 bg-amber-50/60 px-3 py-2 text-xs dark:border-amber-500/20 dark:bg-amber-950/20">
          <div className="flex items-start gap-2">
            <AlertCircle
              className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-600 dark:text-amber-400"
              aria-hidden
            />
            <div className="min-w-0 space-y-1">
              <p id={id} className="text-foreground/90 leading-relaxed">
                {primary.message}
              </p>
              {resolution(primary)}
            </div>
          </div>
          {others.length > 0 && (
            <details className="group mt-1.5 pl-5">
              <summary className="cursor-pointer select-none text-muted-foreground hover:text-foreground list-none inline-flex items-center gap-1">
                <ChevronDown
                  className="h-3 w-3 transition-transform group-open:rotate-180"
                  aria-hidden
                />
                {others.length} more {others.length === 1 ? 'requirement' : 'requirements'}
              </summary>
              <ul className="mt-1.5 space-y-1.5">
                {others.map(blocker => (
                  <li key={blocker.code} className="text-muted-foreground leading-relaxed">
                    <span>{blocker.message}</span> {resolution(blocker)}
                  </li>
                ))}
              </ul>
            </details>
          )}
        </div>
      )}
    </div>
  );
}
