'use client';
import { cloneElement, useId, type ReactElement } from 'react';
import { Button, type ButtonProps } from '@/components/ui/shadcn/button';
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
    <div className="min-w-0 space-y-2">
      {cloneElement(children, {
        disabled: !availability.allowed || children.props.disabled,
        'aria-describedby': availability.blockers.length ? id : undefined,
      })}
      {availability.blockers.length > 0 && (
        <ul
          id={id}
          className="space-y-1 text-xs text-muted-foreground"
          aria-label={`${availability.action} requirements`}
        >
          {availability.blockers.map(blocker => (
            <li key={blocker.code}>
              {blocker.message}
              {blocker.resolutionTarget && onResolve && (
                <Button
                  variant="link"
                  size="sm"
                  className="h-auto px-1 py-0 text-xs"
                  onClick={() => onResolve(blocker.resolutionTarget!)}
                >
                  {blocker.resolutionLabel ?? 'Resolve requirement'}
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
