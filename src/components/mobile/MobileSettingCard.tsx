'use client';

import type { ReactNode } from 'react';
import MobileCard from '@/components/mobile/MobileCard';
import { cn } from '@/lib/utils';

type MobileSettingCardProps = {
  /** Small icon rendered inside a fixed-size mobile icon container. */
  icon: ReactNode;
  title: string;
  /** Short status line under the title, e.g. "Off" or "Following system". */
  status?: string;
  /** Header-row control, e.g. a switch or chevron. Never wraps to a new line. */
  action?: ReactNode;
  /** Full-width supporting copy rendered below the header row. */
  description?: ReactNode;
  /** Additional content below the description (e.g. a segmented control). */
  children?: ReactNode;
  className?: string;
};

/**
 * Canonical mobile "settings" card anatomy shared across Appearance, App
 * Lock, and future device-preference cards:
 *
 *   [icon] Title                 action
 *          short status
 *
 *          supporting description
 *
 *          optional secondary control/content
 */
export default function MobileSettingCard({
  icon,
  title,
  status,
  action,
  description,
  children,
  className,
}: MobileSettingCardProps) {
  return (
    <MobileCard variant="default" padding="md" className={cn('space-y-3', className)}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-muted text-foreground">
            {icon}
          </span>
          <div className="min-w-0 pt-0.5">
            <h3 className="text-sm font-semibold text-foreground">{title}</h3>
            {status ? <p className="mt-0.5 text-xs text-muted-foreground">{status}</p> : null}
          </div>
        </div>
        {action ? (
          // Owns the 44px minimum touch target so no consumer can shrink it below guideline.
          <div className="flex min-h-11 min-w-11 shrink-0 items-center justify-end">{action}</div>
        ) : null}
      </div>
      {description ? (
        <div className="text-xs leading-relaxed text-muted-foreground">{description}</div>
      ) : null}
      {children}
    </MobileCard>
  );
}

