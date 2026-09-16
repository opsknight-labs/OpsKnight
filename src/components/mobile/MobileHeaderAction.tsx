'use client';

import Link from 'next/link';
import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

type MobileHeaderActionTone = 'default' | 'ok' | 'warning' | 'danger';

type MobileHeaderActionProps = {
  icon: ReactNode;
  label: string;
  href?: string;
  onClick?: () => void;
  tone?: MobileHeaderActionTone;
  title?: string;
  className?: string;
};

function toneClassName(tone: MobileHeaderActionTone): string {
  switch (tone) {
    case 'ok':
      return 'text-emerald-600 dark:text-emerald-400';
    case 'warning':
      return 'text-amber-600 dark:text-amber-400';
    case 'danger':
      return 'text-rose-600 dark:text-rose-400';
    default:
      return 'text-muted-foreground';
  }
}

/**
 * Every mobile header action (back, create, search, status...) shares one
 * geometry: 44x44 touch target, radius, focus ring and pressed feedback. No
 * individual action may opt into its own card-like border/shadow/background,
 * which is what previously made search look like a separate larger control.
 */
export default function MobileHeaderAction({
  icon,
  label,
  href,
  onClick,
  tone = 'default',
  title,
  className,
}: MobileHeaderActionProps) {
  const classes = cn(
    'inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-transparent bg-transparent transition-colors active:scale-95 hover:border-border hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
    toneClassName(tone),
    className
  );

  if (href) {
    return (
      <Link href={href} className={classes} aria-label={label} title={title}>
        {icon}
      </Link>
    );
  }

  return (
    <button type="button" className={classes} aria-label={label} title={title} onClick={onClick}>
      {icon}
    </button>
  );
}
